/**
 * signature-draft-worker — drains signature_draft_queue (every workout gets
 * a signature, rev-61 automation chain, link 1).
 *
 * One invocation = one claimed batch (DRAFT_BATCH_SIZE, sequential drafts —
 * the per-invocation outbound budget, saga ruling 2026-11-05), then a
 * self-retrigger while the queue is nonempty. Safety is NOT this chain:
 *   - claim_signature_drafts is atomic (single-drainer lease + SKIP LOCKED),
 *     so a stray or duplicate invocation claims nothing or claims safely —
 *     which is why, like job-reaper, there is no inbound auth gate.
 *   - the reaper (job-reaper → reap_signature_drafts) requeues vanished
 *     claims and fires this worker; a lost retrigger costs latency only.
 *   - the single-drainer lease is the global Anthropic in-flight cap.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  DRAFT_BATCH_SIZE,
  processClaimedJobs,
  type QueueJob,
} from "../_shared/signature-draft-queue.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function selfRetrigger(): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/signature-draft-worker`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ kick: true }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.warn(`[signature-draft-worker] self-retrigger failed (reaper will sweep): ${(e as Error).message}`);
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = crypto.randomUUID();

  // Atomic claim: zero rows = another drainer is live OR the queue is empty.
  // Either way this invocation has nothing to do.
  const { data: jobs, error: claimErr } = await supa.rpc("claim_signature_drafts", {
    p_token: token,
    p_limit: DRAFT_BATCH_SIZE,
  });
  if (claimErr) {
    console.error(`[signature-draft-worker] claim failed: ${claimErr.message}`);
    return json({ ok: false, error: claimErr.message }, 500);
  }
  const batch = (jobs ?? []) as QueueJob[];
  if (batch.length === 0) {
    return json({ ok: true, claimed: 0 });
  }

  let stats;
  try {
    stats = await processClaimedJobs(supa, batch);
  } finally {
    await supa.rpc("release_signature_drainer", { p_token: token })
      .then(() => {}, () => {});
  }

  // Latency optimization only: keep the chain going while work remains.
  const { count } = await supa
    .from("signature_draft_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued");
  const remaining = count ?? 0;
  console.log(
    `[signature-draft-worker] batch: claimed=${batch.length} done=${stats.done} already_signed=${stats.already_signed} retry=${stats.failed_retry} failed=${stats.failed_final} remaining=${remaining}`,
  );
  if (remaining > 0) {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(selfRetrigger());
  }

  return json({ ok: true, claimed: batch.length, ...stats, remaining });
});
