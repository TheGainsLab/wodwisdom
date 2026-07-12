/**
 * gym-cohort-cron — KICKOFF for gym cohort program generation (task #5, staged).
 *
 * Scheduled HOURLY by pg_cron so a fleet of gyms drains (the PER-GYM cadence is
 * monthly — regenerate when last_generated_at is null or 30d+ old). Each invocation
 * kicks off ONE gym, then fire-and-forget re-invokes itself so a burst of due gyms
 * drains within a tick.
 *
 * STAGED (2026-07-07): this endpoint no longer runs the pipeline in-process. The
 * synchronous run needed ~8min of LLM while the platform wall-clock kills an
 * invocation at ~200s, so it could NEVER complete (verified in production: six
 * historical attempts, every one killed mid-run, zero programs persisted). It now
 * does only the cheap DB work and hands off to the resumable per-stage worker
 * (gym-generate + gym_program_jobs — the mirror of generate-program-v3's
 * dispatcher). Per invocation, for the most-due eligible gym (claimed atomically):
 *   1. builds the cohort envelope (buildGymCohortEnvelope) from its gym_cohort_configs
 *      row + the movement vocabulary + a RAG methodology block,
 *   2. builds the roster (buildCohortRoster) from its active members' ONE PROFILE
 *      (athlete_profiles — Decision 1), NOT a per-surface intake copy,
 *   3. creates a gym_program_jobs row (resume_state seeded with envelope + roster)
 *      and fires the worker's first stage; returns immediately with the job id.
 *
 * The success stamp (last_generated_at) moved to the worker's saving stage — only a
 * PERSISTED program counts as generated. Failure backoff is written by the worker's
 * fail path (gym-dispatcher); kickoff-time read failures still back off here.
 *
 * SAFETY: every DB read is error-checked and ABORTS before any job is created — a
 * failed read costs one retry, never a broken program stamped success + locked 30d.
 *
 * AUTH: verify_jwt=false (pg_cron can't mint a Supabase JWT), so the handler gates
 * itself on an X-Cron-Key header (GYM_COHORT_CRON_KEY). Unlike job-reaper, a stray
 * POST here starts a paid LLM job, so the endpoint is NOT open.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CohortStrategy } from "../_shared/cohort/build-gym-cohort-envelope.ts";
import { GymJobConflictError, GymJobReadError, startGymJob } from "../_shared/cohort/start-gym-job.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GYM_COHORT_CRON_KEY = Deno.env.get("GYM_COHORT_CRON_KEY");
const REGEN_AFTER_DAYS = 30;
const CLAIM_WINDOW_SECONDS = 900; // 15 min — longer than a generation; the dup guard.
// Exponential backoff for a failing gym: 30m, 1h, 2h, 4h … capped at 24h.
const BACKOFF_BASE_MS = 30 * 60_000;
const BACKOFF_CAP_MS = 24 * 60 * 60_000;

interface ConfigRow {
  gym_id: string;
  domain_pack: string;
  days_per_week: 3 | 4 | 5 | 6;
  session_length_minutes: number | null;
  equipment: string[];
  target_level: "beginner" | "intermediate" | "advanced";
  do_not_program: string[];
  units: "lbs" | "kg";
  goal_text: string | null;
  strategy: CohortStrategy | null;
  attempt_count: number;
}

Deno.serve(async (req) => {
  // ── Auth: fail closed. A stray POST would cost a paid LLM run. ───────────────
  if (!GYM_COHORT_CRON_KEY) {
    return json({ error: "config_missing", detail: "GYM_COHORT_CRON_KEY not set" }, 500);
  }
  if (req.headers.get("x-cron-key") !== GYM_COHORT_CRON_KEY) {
    return json({ error: "forbidden" }, 401);
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const nowIso = new Date().toISOString();

  // ── Claim the most-due eligible gym atomically (dup-generation guard). ───────
  const { data: claimed, error: claimErr } = await supa.rpc("claim_due_gym_cohort", {
    p_regen_after_days: REGEN_AFTER_DAYS,
    p_claim_window_seconds: CLAIM_WINDOW_SECONDS,
  });
  if (claimErr) return json({ error: "claim_failed", detail: claimErr.message }, 500);
  const claimedRows = (claimed ?? []) as ConfigRow[];
  if (claimedRows.length === 0) return json({ message: "no gyms due" });
  const cfg = claimedRows[0];

  // ── In-flight guard: one active job per gym. A job outliving the 15-min claim
  //    window (long generation, or parked at awaiting_approval for owner review)
  //    must not spawn a duplicate when the gym becomes claimable again. ─────────
  const { data: activeJobs, error: activeErr } = await supa
    .from("gym_program_jobs")
    .select("id, status")
    .eq("gym_id", cfg.gym_id)
    .in("status", ["processing", "awaiting_approval"])
    .limit(1);
  if (activeErr) return json({ error: "active_job_check_failed", detail: activeErr.message }, 500);
  if ((activeJobs ?? []).length > 0) {
    // Skip this gym but KEEP DRAINING — a job parked at awaiting_approval for
    // days must not throttle the whole fleet to one gym per hourly tick. The
    // claim already stamped this gym's last_attempt_at, so the re-invoke picks
    // the NEXT most-due gym, not this one again.
    void selfReinvoke(req);
    return json({ message: "job already in flight", gym_id: cfg.gym_id, job_id: activeJobs![0].id, status: activeJobs![0].status });
  }

  try {
    // Scheduled generation runs straight through (no owner-review pause) — the
    // review desk's on-demand start (gym-program) is the paused path. Shared
    // kickoff so the two can't drift.
    const result = await startGymJob(supa, cfg, { pauseAfterSkeleton: false, nowIso });

    // ── Drain: re-invoke for the next due gym (fire-and-forget, one gym/tick budget). ─
    void selfReinvoke(req);

    return json({
      started: true,
      gym_id: cfg.gym_id,
      job_id: result.job_id,
      watch: "select status, next_stage, error from gym_program_jobs where id = '" + result.job_id + "'",
    });
  } catch (e) {
    // A portal `start` won the UNIQUE active-index between our guard and insert
    // — not a failure, just "already in flight". Skip cleanly, no backoff.
    if (e instanceof GymJobConflictError) {
      void selfReinvoke(req);
      return json({ message: "job already in flight (raced portal start)", gym_id: cfg.gym_id });
    }
    // Record a backoff so a persistently-failing gym rotates to the back of the
    // queue instead of starving the fleet head-of-line every tick. (Failures
    // AFTER kickoff are the worker's — gym-dispatcher writes this same backoff.)
    const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, cfg.attempt_count - 1), BACKOFF_CAP_MS);
    const nextAttemptIso = new Date(Date.now() + backoffMs).toISOString();
    await supa
      .from("gym_cohort_configs")
      .update({ next_attempt_at: nextAttemptIso })
      .eq("gym_id", cfg.gym_id)
      .then(() => {}, (err) => console.error("[gym-cohort-cron] backoff write failed:", err));

    const stage = e instanceof GymJobReadError ? "read_failed" : "kickoff_failed";
    console.error("[gym-cohort-cron]", stage, cfg.gym_id, e);
    return json({ error: stage, gym_id: cfg.gym_id, detail: (e as Error).message, next_attempt_at: nextAttemptIso }, 500);
  }
});

/** Fire-and-forget self re-invoke so a burst of due gyms drains within a tick. */
function selfReinvoke(req: Request): void {
  try {
    const url = new URL("/functions/v1/gym-cohort-cron", SUPABASE_URL).toString();
    // Don't await the body; a short timeout so a hung re-invoke can't wedge the run.
    fetch(url, {
      method: "POST",
      headers: { "X-Cron-Key": GYM_COHORT_CRON_KEY!, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
  } catch { /* best-effort drain */ }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
