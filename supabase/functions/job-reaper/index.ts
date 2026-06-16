/**
 * job-reaper/index.ts
 *
 * Sweep for v3 program-generation jobs whose stage worker vanished — a
 * self-retrigger POST was lost, or a stage was wall-clock-killed without running
 * markFailed. Such jobs sit status='processing' with an expired lease forever
 * (the old zombie). The reaper re-dispatches them so generation resumes.
 *
 * Correctness contract (see v3-dispatcher.ts + the lease RPCs):
 *   - find_stale_program_jobs returns only status='processing' jobs whose lease
 *     is older than STALENESS_SECONDS. A stage that THREW is already
 *     status='failed' and excluded → the reaper never re-rolls a writer stage
 *     that explicitly failed (only resumes a VANISHED one — the resume ruling).
 *   - re-dispatch just fires generate-program-v3 with { resume_job_id }, which
 *     runs the job's current stage behind the atomic claim — so a job a
 *     self-retrigger is ALSO racing gets claimed exactly once.
 *   - each re-dispatch bumps stage_dispatch_attempts; past MAX_DISPATCH_ATTEMPTS
 *     the job is force-failed (a stage that can't complete in its own fresh
 *     clock after N tries is genuinely stuck, not just slow).
 *
 * Invoked by pg_cron every ~2 min. Service-authed (verify_jwt=false; we still
 * require the service key in the Authorization header).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  STALENESS_SECONDS,
  MAX_DISPATCH_ATTEMPTS,
  forceMarkFailed,
  type ProgramJobRow,
} from "../_shared/v3-dispatcher.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GENERATOR = "generate-program-v3";

async function redispatch(jobId: string, userId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/functions/v1/${GENERATOR}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "x-webhook-user-id": userId,
    },
    body: JSON.stringify({ resume_job_id: jobId }),
    signal: AbortSignal.timeout(10_000),
  });
}

Deno.serve(async (_req) => {
  // No inbound auth check — matching monthly-generation-cron's deliberate
  // pattern (see its header comment). Gating is verify_jwt=false + the function
  // URL being unguessable; a custom bearer-check against the service/anon key
  // silently 401's every pg_cron run because pg_cron's key doesn't match the
  // function's env. The real safety guard is find_stale_program_jobs, which only
  // ever returns jobs whose lease has already expired — a healthy job heartbeats
  // and is invisible to the sweep, so even a stray call can't disrupt live work.
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data, error } = await supa.rpc("find_stale_program_jobs", {
    p_staleness_seconds: STALENESS_SECONDS,
  });
  if (error) {
    console.error("[job-reaper] find_stale_program_jobs error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stale = (data ?? []) as ProgramJobRow[];
  const results: Array<{ job: string; action: string; stage: string | null }> = [];

  for (const job of stale) {
    const attempts = job.stage_dispatch_attempts ?? 0;
    if (attempts >= MAX_DISPATCH_ATTEMPTS) {
      await forceMarkFailed(
        supa,
        job.id,
        `Stage '${job.next_stage}' exhausted ${MAX_DISPATCH_ATTEMPTS} reaper re-dispatch attempts.`,
      );
      results.push({ job: job.id, action: "failed_exhausted", stage: job.next_stage });
      continue;
    }

    // Bump the dispatch counter before re-firing. A normal stage advance resets
    // it to 0, so it only climbs while a job is genuinely stuck at one stage.
    await supa
      .from("program_jobs")
      .update({ stage_dispatch_attempts: attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .then(() => {}, () => {});

    try {
      await redispatch(job.id, job.user_id);
      results.push({ job: job.id, action: "redispatched", stage: job.next_stage });
    } catch (e) {
      console.warn(`[job-reaper] re-dispatch of ${job.id} failed (will retry next sweep):`, e);
      results.push({ job: job.id, action: "redispatch_error", stage: job.next_stage });
    }
  }

  console.log(`[job-reaper] swept ${stale.length} stale job(s): ${JSON.stringify(results)}`);
  return new Response(
    JSON.stringify({ ok: true, swept: stale.length, results }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
