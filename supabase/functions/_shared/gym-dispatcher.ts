/**
 * gym-dispatcher.ts
 *
 * Dispatcher primitives for the resumable, per-stage GYM cohort generator —
 * a deliberate mirror of v3-dispatcher.ts on the gym_program_jobs table.
 * gym-cohort-cron ran the whole cohort pipeline in one invocation and was
 * wall-clock-killed every time (~200s limit vs ~8min of work; verified
 * 2026-07-07). Same fix as retail: one stage per invocation, atomic DB lease +
 * fencing token, reaper re-dispatch for vanished stages.
 *
 * Kept SEPARATE from v3-dispatcher rather than generalizing it: the retail
 * dispatcher is production-load-bearing and its ResumeState is retail-shaped.
 * The timing constants and the SurgicalCursor shape are imported from it so
 * the two can't drift on the values that matter. (Debt: if a third staged
 * pipeline ever appears, generalize then.)
 *
 * Gym-specific additions over the retail mirror:
 *   - StageOutcome.pause — the owner-review gate. A paused commit parks the job
 *     at status='awaiting_approval' with next_stage preserved and does NOT
 *     self-retrigger; the reaper ignores non-'processing' jobs, so the job sits
 *     until an explicit approve call flips it back and re-fires. This is where
 *     "the owner reviews the skeleton before the writer writes" plugs in.
 *   - failure backoff — on a thrown stage the gym's gym_cohort_configs row gets
 *     a next_attempt_at backoff (mirroring the old cron's catch), so a
 *     persistently-failing gym rotates to the back of the fleet queue.
 *
 * Used by: gym-generate (worker) + gym-job-reaper (sweep) + gym-cohort-cron (kickoff).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { WriterPayload } from "./build-writer-payload.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";
import type { SkeletonOutput } from "./v3-output-schema.ts";
import type { WeekPrescription, WriterOutput } from "./v2-output-schema.ts";
import type { AthleteInput } from "./engine/contract.ts";
import {
  HEARTBEAT_MS,
  LEASE_SECONDS,
  type SurgicalCursor,
} from "./v3-dispatcher.ts";
export { MAX_DISPATCH_ATTEMPTS, STALENESS_SECONDS } from "./v3-dispatcher.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================
// Stages
// ============================================================

export type GymStage =
  | "skeleton"
  | "fill_week_1"
  | "fill_week_2"
  | "fill_week_3"
  | "fill_week_4"
  | "benchmark_audit"
  | "surgical"
  | "safety_review"
  | "saving";

export const GYM_FIRST_STAGE: GymStage = "skeleton";

// ============================================================
// Resume state — everything a stage needs to pick the job back up. The cron
// seeds payload/tdi/roster at kickoff (all DB reads happen there, before any
// paid LLM work — preserving the old cron's abort-before-spend discipline).
// ============================================================

export interface GymResumeState {
  gym_id: string;
  domain_pack: string;
  /** The cohort envelope's shared payload (reference class target + RAG). */
  payload?: WriterPayload;
  /** The cohort envelope's coaching strategy projection. */
  tdi?: TrainingDesignInput;
  /** The scaling roster (may be empty — shared program still generates). */
  roster?: AthleteInput[];
  /** Also mirrored to gym_program_jobs.skeleton_json for the review desk. */
  skeleton?: SkeletonOutput;
  /** Accumulated one per fill_week_N stage. */
  weeks?: WeekPrescription[];
  /** Output after benchmark_audit; surgical carries its own cursor. */
  output?: WriterOutput;
  surgical?: SurgicalCursor;
  residualFailures?: unknown[];
  safety?: { safe: boolean; reasoning: string; errored: boolean };
  startedAtMs?: number;
}

export interface GymProgramJobRow {
  id: string;
  gym_id: string;
  status: string;
  next_stage: GymStage | null;
  resume_state: GymResumeState | null;
  claim_token: string | null;
  locked_at: string | null;
  stage_dispatch_attempts: number;
  pause_after_skeleton: boolean;
  skeleton_json: SkeletonOutput | null;
}

// ============================================================
// Lease primitives (retail semantics, gym table/RPCs)
// ============================================================

export interface GymClaim {
  job: GymProgramJobRow;
  claimToken: string;
}

export async function claimGymStage(
  supa: SupabaseClient,
  jobId: string,
  expectedStage: GymStage,
): Promise<GymClaim | null> {
  const { data, error } = await supa.rpc("claim_gym_program_stage", {
    p_job_id: jobId,
    p_expected_stage: expectedStage,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) {
    console.error(`[gym-dispatcher] claim_gym_program_stage(${expectedStage}) error:`, error.message);
    return null;
  }
  if (!data) return null; // lease held or stage advanced
  const job = data as GymProgramJobRow;
  if (!job.claim_token) return null;
  return { job, claimToken: job.claim_token };
}

async function heartbeatOnce(
  supa: SupabaseClient,
  jobId: string,
  claimToken: string,
): Promise<boolean> {
  const { data, error } = await supa.rpc("heartbeat_gym_program_stage", {
    p_job_id: jobId,
    p_claim_token: claimToken,
  });
  if (error) return false;
  return data === true;
}

interface Heartbeat {
  stop: () => void;
  superseded: () => boolean;
}

function startHeartbeat(
  supa: SupabaseClient,
  jobId: string,
  claimToken: string,
): Heartbeat {
  let superseded = false;
  const interval = setInterval(async () => {
    const ok = await heartbeatOnce(supa, jobId, claimToken);
    if (!ok) {
      superseded = true;
      clearInterval(interval);
    }
  }, HEARTBEAT_MS);
  return {
    stop: () => clearInterval(interval),
    superseded: () => superseded,
  };
}

async function commitGated(
  supa: SupabaseClient,
  jobId: string,
  claimToken: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supa
    .from("gym_program_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("claim_token", claimToken)
    .select("id");
  if (error) {
    console.error("[gym-dispatcher] commitGated error:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/** Unconditional failure (the reaper's exhaustion path — holds no claim). */
export async function forceMarkGymJobFailed(
  supa: SupabaseClient,
  jobId: string,
  message: string,
): Promise<void> {
  await supa
    .from("gym_program_jobs")
    .update({
      status: "failed",
      stage: null,
      next_stage: null,
      locked_at: null,
      claim_token: null,
      error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .then(() => {}, () => {});
}

/** Failure backoff on the gym's config row — mirrors the old cron's catch, so a
 *  persistently-failing gym rotates to the back of the fleet queue instead of
 *  being re-claimed head-of-line every monthly tick. Uses attempt_count already
 *  bumped by claim_due_gym_cohort. Best-effort. */
export async function writeGymConfigBackoff(
  supa: SupabaseClient,
  gymId: string,
): Promise<void> {
  const BACKOFF_BASE_MS = 30 * 60_000;
  const BACKOFF_CAP_MS = 24 * 60 * 60_000;
  const { data } = await supa
    .from("gym_cohort_configs")
    .select("attempt_count")
    .eq("gym_id", gymId)
    .maybeSingle();
  const attempts = (data as { attempt_count?: number } | null)?.attempt_count ?? 1;
  const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
  const nextAttemptIso = new Date(Date.now() + backoffMs).toISOString();
  await supa
    .from("gym_cohort_configs")
    .update({ next_attempt_at: nextAttemptIso })
    .eq("gym_id", gymId)
    .then(() => {}, (err) => console.error("[gym-dispatcher] backoff write failed:", err));
}

/** Fire the next stage's invocation. Best-effort; the reaper backstops. */
export async function gymSelfRetrigger(jobId: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/gym-generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ resume_job_id: jobId }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // best-effort; gym-job-reaper backstops
  }
}

// ============================================================
// runGymStageWithLease — the per-stage harness (retail discipline + pause).
// ============================================================

export interface GymStageOutcome {
  /** Next stage, or "complete" to finish. Surgical may return "surgical" to re-enter. */
  next: GymStage | "complete";
  resumeState: GymResumeState;
  displayStage?: string;
  /** Extra columns merged into the same token-gated commit (e.g. skeleton_json). */
  extraPatch?: Record<string, unknown>;
  /** Park at status='awaiting_approval' (next_stage preserved, no retrigger).
   *  The owner-review gate — resumed by gym-generate's approve path. */
  pause?: boolean;
  /** Required when next === "complete". */
  complete?: { cohortProgramId: string; resultJson: Record<string, unknown> };
}

/**
 * Claim → heartbeat → run one stage → token-gated commit → self-retrigger
 * (or pause / complete). A throw fails the job AND writes the gym's config
 * backoff. No-ops silently when the claim fails or the job is superseded —
 * both normal under at-least-once dispatch.
 */
export async function runGymStageWithLease(
  supa: SupabaseClient,
  jobId: string,
  expectedStage: GymStage,
  run: (job: GymProgramJobRow, resumeState: GymResumeState) => Promise<GymStageOutcome>,
): Promise<void> {
  const claim = await claimGymStage(supa, jobId, expectedStage);
  if (!claim) return;

  const hb = startHeartbeat(supa, jobId, claim.claimToken);
  try {
    const resumeState = (claim.job.resume_state ?? {}) as GymResumeState;
    const outcome = await run(claim.job, resumeState);

    hb.stop();
    if (hb.superseded()) return; // reaper reclaimed mid-stage — do not commit

    if (outcome.next === "complete") {
      if (!outcome.complete) throw new Error("stage returned complete with no payload");
      await commitGated(supa, jobId, claim.claimToken, {
        ...(outcome.extraPatch ?? {}),
        status: "complete",
        stage: null,
        next_stage: null,
        locked_at: null,
        claim_token: null,
        cohort_program_id: outcome.complete.cohortProgramId,
        result_json: outcome.complete.resultJson,
        resume_state: outcome.resumeState,
      });
      return; // terminal — no self-retrigger
    }

    if (outcome.pause) {
      // Park for owner review: next_stage preserved so approve just flips
      // status back to 'processing' and re-fires.
      await commitGated(supa, jobId, claim.claimToken, {
        ...(outcome.extraPatch ?? {}),
        status: "awaiting_approval",
        next_stage: outcome.next,
        stage: outcome.displayStage ?? "awaiting_approval",
        resume_state: outcome.resumeState,
        stage_dispatch_attempts: 0,
        locked_at: null,
        claim_token: null,
      });
      return; // no self-retrigger — the approve call resumes
    }

    const committed = await commitGated(supa, jobId, claim.claimToken, {
      ...(outcome.extraPatch ?? {}),
      next_stage: outcome.next,
      stage: outcome.displayStage ?? outcome.next,
      resume_state: outcome.resumeState,
      stage_dispatch_attempts: 0,
      locked_at: null,
      claim_token: null,
    });
    if (committed) await gymSelfRetrigger(jobId);
  } catch (err) {
    hb.stop();
    if (hb.superseded()) return; // a new owner is running; leave it alone
    const message = err instanceof Error ? err.message : String(err);
    const resultJson = (err as { resultJson?: Record<string, unknown> })?.resultJson;
    console.error(`[gym-dispatcher] stage ${expectedStage} failed:`, err);
    await commitGated(supa, jobId, claim.claimToken, {
      status: "failed",
      stage: null,
      next_stage: null,
      locked_at: null,
      claim_token: null,
      error: message.slice(0, 1000),
      ...(resultJson ? { result_json: resultJson } : {}),
    });
    await writeGymConfigBackoff(supa, claim.job.gym_id);
  }
}
