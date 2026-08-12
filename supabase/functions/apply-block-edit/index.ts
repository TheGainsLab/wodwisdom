/**
 * apply-block-edit: resolve a chat-coach block proposal (ai_edit_log row).
 *
 *   { ai_edit_log_id, action: "apply" }   → write the proposal into the block,
 *       mark the log row accepted, and (metcons) null-then-recompute the
 *       expected_benchmark in the background.
 *   { ai_edit_log_id, action: "decline" } → mark the log row refused.
 *
 * Server-side (not the client's direct table writes the old AI Edit used)
 * because the benchmark recompute needs the Anthropic key, and because
 * write + log-mark + benchmark-null belong in one place. Ownership is
 * enforced by walking block → workout → program → user.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  applyBlockProposal,
  loadOwnedBlock,
  refreshMetconBenchmark,
} from "../_shared/block-edit.ts";
import type { BlockPrescription } from "../_shared/v2-output-schema.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, cors: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, cors, 401);

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Invalid token" }, cors, 401);

    const body = await req.json();
    const logId = body?.ai_edit_log_id;
    const action = body?.action;
    if (!logId || typeof logId !== "string") return json({ error: "ai_edit_log_id is required" }, cors, 400);
    if (action !== "apply" && action !== "decline") return json({ error: 'action must be "apply" or "decline"' }, cors, 400);

    const { data: logRow } = await supa
      .from("ai_edit_log")
      .select("id, user_id, block_id, proposal, outcome")
      .eq("id", logId)
      .maybeSingle();
    if (!logRow || logRow.user_id !== user.id) return json({ error: "Proposal not found" }, cors, 404);
    if (logRow.outcome != null) return json({ error: "Proposal already resolved", code: "ALREADY_RESOLVED" }, cors, 409);

    if (action === "decline") {
      await supa.from("ai_edit_log")
        .update({ outcome: "refused", resolved_at: new Date().toISOString() })
        .eq("id", logId);
      return json({ ok: true, outcome: "refused" }, cors);
    }

    // apply — verify the block still belongs to this athlete before writing.
    const owned = await loadOwnedBlock(supa, logRow.block_id as string, user.id);
    if (!owned) return json({ error: "Block not found" }, cors, 404);

    const proposal = logRow.proposal as BlockPrescription;
    await applyBlockProposal(supa, logRow.block_id as string, proposal);
    await supa.from("ai_edit_log")
      .update({ outcome: "accepted", resolved_at: new Date().toISOString() })
      .eq("id", logId);

    // Benchmark refresh runs after the response — the athlete's Apply is
    // instant; the prediction refills seconds later (or stays null, honestly).
    if (proposal.block_type === "metcon") {
      const { data: prof } = await supa
        .from("athlete_profiles").select("gender").eq("user_id", user.id).maybeSingle();
      EdgeRuntime.waitUntil(
        refreshMetconBenchmark(supa, logRow.block_id as string, proposal, prof?.gender ?? null),
      );
    }

    return json({ ok: true, outcome: "accepted" }, cors);
  } catch (e) {
    return json({ error: (e as Error).message }, cors, 500);
  }
});
