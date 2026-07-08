/**
 * gym-job-reaper/index.ts
 *
 * Sweep for staged gym cohort generation jobs whose stage worker vanished — the
 * gym mirror of job-reaper (see its header for the correctness contract; same
 * discipline, gym_program_jobs table):
 *   - find_stale_gym_program_jobs returns only status='processing' jobs with an
 *     expired lease. A thrown stage is already status='failed' (never re-rolled);
 *     a job parked at 'awaiting_approval' (owner review) is invisible to the
 *     sweep for as long as the owner takes.
 *   - re-dispatch fires gym-generate with { resume_job_id }; the atomic claim
 *     makes a race with a live self-retrigger safe.
 *   - past MAX_DISPATCH_ATTEMPTS the job is force-failed AND the gym's config
 *     row gets a backoff so the fleet queue rotates.
 *
 * Schedule via pg_cron every ~2 min (same cadence as job-reaper; SQL in the
 * deploy notes). Open-endpoint pattern matches job-reaper: the sweep can only
 * ever touch jobs whose lease already expired, so a stray call is harmless.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  forceMarkGymJobFailed,
  type GymProgramJobRow,
  gymSelfRetrigger,
  MAX_DISPATCH_ATTEMPTS,
  STALENESS_SECONDS,
  writeGymConfigBackoff,
} from "../_shared/gym-dispatcher.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (_req) => {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data, error } = await supa.rpc("find_stale_gym_program_jobs", {
    p_staleness_seconds: STALENESS_SECONDS,
  });
  if (error) {
    console.error("[gym-job-reaper] find_stale_gym_program_jobs error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stale = (data ?? []) as GymProgramJobRow[];
  const results: Array<{ job: string; action: string; stage: string | null }> = [];

  for (const job of stale) {
    const attempts = job.stage_dispatch_attempts ?? 0;
    if (attempts >= MAX_DISPATCH_ATTEMPTS) {
      await forceMarkGymJobFailed(
        supa,
        job.id,
        `Stage '${job.next_stage}' exhausted ${MAX_DISPATCH_ATTEMPTS} reaper re-dispatch attempts.`,
      );
      await writeGymConfigBackoff(supa, job.gym_id);
      results.push({ job: job.id, action: "failed_exhausted", stage: job.next_stage });
      continue;
    }

    await supa
      .from("gym_program_jobs")
      .update({ stage_dispatch_attempts: attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .then(() => {}, () => {});

    try {
      await gymSelfRetrigger(job.id);
      results.push({ job: job.id, action: "redispatched", stage: job.next_stage });
    } catch (e) {
      console.warn(`[gym-job-reaper] re-dispatch of ${job.id} failed (will retry next sweep):`, e);
      results.push({ job: job.id, action: "redispatch_error", stage: job.next_stage });
    }
  }

  console.log(`[gym-job-reaper] swept ${stale.length} stale job(s): ${JSON.stringify(results)}`);
  return new Response(
    JSON.stringify({ ok: true, swept: stale.length, results }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
