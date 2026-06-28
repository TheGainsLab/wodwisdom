/**
 * v3-dispatcher.ts
 *
 * Shared dispatcher primitives for the resumable, per-stage v3 program
 * generator. generate-program-v3 ran every stage in one edge invocation and
 * died at the ~400s wall-clock on heavy runs. This splits generation across
 * invocations — each stage is its own invocation with a fresh clock — using an
 * atomic DB lease so a reaper can re-dispatch a vanished stage without ever
 * double-running it.
 *
 * Correctness model (see 20260603010000_v3_dispatcher_lease_rpcs.sql):
 *   - claim_program_stage = atomic UPDATE ... RETURNING. A worker proceeds only
 *     if a row comes back. Writes a fresh claim_token (the FENCING token).
 *   - heartbeat bumps the lease while a stage runs, gated on claim_token, so a
 *     long writer stage isn't reclaimed mid-flight.
 *   - the final state-commit is ALSO gated on claim_token, so if the reaper did
 *     reclaim this job, the superseded worker's commit matches 0 rows and aborts
 *     without corrupting state.
 *   - the resume ruling self-enforces: a thrown writer stage → markFailed →
 *     status='failed' → excluded from the reaper sweep (no re-roll on throw);
 *     a VANISHED stage stays status='processing' → reaper resumes it.
 *
 * Used by: generate-program-v3 (worker) + job-reaper (sweep).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { WriterPayload } from "./build-writer-payload.ts";
import type { SkeletonOutput } from "./v3-output-schema.ts";
import type { WriterOutput, WeekPrescription } from "./v2-output-schema.ts";
import type { BlockLocation } from "./compute-block-benchmark.ts";
import type { CoachState } from "./coach-state.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================
// Timing constants. Invariant: STALENESS > LEASE > HEARTBEAT.
//   - heartbeat renews a live stage's lease well inside the TTL,
//   - a dead worker stops renewing → lease expires at LEASE,
//   - the reaper only reclaims after the longer STALENESS margin,
//     so a momentary slow heartbeat never triggers a false reclaim.
// ============================================================

export const LEASE_SECONDS = 120;
export const HEARTBEAT_MS = 35_000;
export const STALENESS_SECONDS = 180;
/** Reaper re-dispatch cap per stage. Reset to 0 on every successful advance. */
export const MAX_DISPATCH_ATTEMPTS = 3;

// ============================================================
// Stages
// ============================================================

export type Stage =
  | "payload_building"
  | "coach_state"
  | "skeleton"
  | "fill_week_1"
  | "fill_week_2"
  | "fill_week_3"
  | "fill_week_4"
  | "benchmark_audit"
  | "surgical"
  | "safety_review"
  | "saving";

export const FIRST_STAGE: Stage = "payload_building";

/** Default linear successor. Surgical is special — it may re-enter itself while
 *  making progress — so the surgical stage decides its own next_stage rather
 *  than relying on this. Everything else advances linearly. */
const LINEAR_ORDER: Stage[] = [
  "payload_building",
  "coach_state",
  "skeleton",
  "fill_week_1",
  "fill_week_2",
  "fill_week_3",
  "fill_week_4",
  "benchmark_audit",
  "surgical",
  "safety_review",
  "saving",
];

export function nextLinearStage(s: Stage): Stage | "complete" {
  const i = LINEAR_ORDER.indexOf(s);
  if (i < 0 || i === LINEAR_ORDER.length - 1) return "complete";
  return LINEAR_ORDER[i + 1];
}

const WRITER_STAGES = new Set<Stage>([
  "coach_state",
  "skeleton",
  "fill_week_1",
  "fill_week_2",
  "fill_week_3",
  "fill_week_4",
  "surgical",
]);

/** Writer stages (LLM-producing) NEVER auto-retry on throw — a throw fails the
 *  job now (honors "no writer retry EVER"); only a VANISHED writer stage is
 *  reaper-resumed. Non-writer stages handle transient retries inside their own
 *  run() and only throw when genuinely giving up. */
export function isWriterStage(s: Stage): boolean {
  return WRITER_STAGES.has(s);
}

// ============================================================
// Resume state — the FULL context to resume a job at any stage. Persisted as
// program_jobs.resume_state (jsonb) and clears the closure that the old
// monolithic processJob held in memory.
// ============================================================

export interface SurgicalCursor {
  /** The WriterOutput, mutated in place across surgical passes. */
  output: WriterOutput;
  /** Blocks whose benchmark recompute failed on a prior pass — drives the
   *  targeted (not full) recompute so surgical passes stay cheap. */
  pendingFailures: BlockLocation[];
  /** Failing-block count per pass; 3 stable values = stall → halt. */
  recentCounts: number[];
  /** 1-based surgical pass number. */
  pass: number;
}

export interface ResumeState {
  /** Append-vs-create + which month. Seeded at kickoff BEFORE stage 1, because
   *  payload_building needs monthNumber for buildWriterPayload. */
  continuation: { programId: string | null; monthNumber: number };
  /** Built once in payload_building — rebuilding re-fires parse-injuries +
   *  re-hits the DB and can drift. */
  payload?: WriterPayload;
  /** CoachState (judgment) — reuse-if-current by (athlete_model_version,
   *  coach_state_builder_version), built/persisted in the coach_state stage. */
  coachState?: CoachState;
  /** The execution CONTRACT projected from CoachState — the ONLY intent the
   *  skeleton + week-fill consume (Step 3). Decision-data is stripped. */
  trainingDesignInput?: TrainingDesignInput;
  /** Also mirrored to program_jobs.skeleton_json for the admin panel. */
  skeleton?: SkeletonOutput;
  /** Accumulated one per fill_week_N stage. */
  weeks?: WeekPrescription[];
  /** Output after benchmark_audit (full recompute + first audit + programmatic
   *  patches). Handed to surgical, which carries its own cursor. */
  output?: WriterOutput;
  /** Surgical cursor — present once surgical begins. */
  surgical?: SurgicalCursor;
  /** Block-local audits surgical couldn't resolve; surfaced in result_json. */
  residualFailures?: unknown[];
  /** Safety review result (advisory, log-only). */
  safety?: { safe: boolean; reasoning: string; errored: boolean };
  /** FIRST-CYCLE job-level dedup: the programs row id, persisted the instant
   *  saveProgramV3 creates it, so a saving re-entry reuses it instead of
   *  creating a second program. (Append mode dedups via the program_months
   *  marker instead.) */
  programId?: string;
  /** Wall-clock start, for elapsed_ms in result_json. */
  startedAtMs?: number;
}

// ============================================================
// Job row (the columns the dispatcher reads)
// ============================================================

export interface ProgramJobRow {
  id: string;
  user_id: string;
  status: string;
  next_stage: Stage | null;
  resume_state: ResumeState | null;
  claim_token: string | null;
  locked_at: string | null;
  stage_dispatch_attempts: number;
  skeleton_json: SkeletonOutput | null;
}

// ============================================================
// Lease primitives
// ============================================================

export interface Claim {
  job: ProgramJobRow;
  claimToken: string;
}

/** Atomically claim a job's current stage. Returns the claim (caller proceeds)
 *  or null (another worker holds a live lease, or the stage already advanced —
 *  caller MUST abort without side effects). */
export async function claimStage(
  supa: SupabaseClient,
  jobId: string,
  expectedStage: Stage,
): Promise<Claim | null> {
  const { data, error } = await supa.rpc("claim_program_stage", {
    p_job_id: jobId,
    p_expected_stage: expectedStage,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) {
    console.error(`[dispatcher] claim_program_stage(${expectedStage}) error:`, error.message);
    return null;
  }
  if (!data) return null; // 0 rows — lease held or stage advanced
  const job = data as ProgramJobRow;
  if (!job.claim_token) return null;
  return { job, claimToken: job.claim_token };
}

/** Bump the lease, gated on the fencing token. Returns false if superseded. */
async function heartbeatOnce(
  supa: SupabaseClient,
  jobId: string,
  claimToken: string,
): Promise<boolean> {
  const { data, error } = await supa.rpc("heartbeat_program_stage", {
    p_job_id: jobId,
    p_claim_token: claimToken,
  });
  if (error) return false;
  return data === true;
}

export interface Heartbeat {
  stop: () => void;
  /** True once a heartbeat found the token no longer ours (reaper reclaimed). */
  superseded: () => boolean;
}

/** Start a background heartbeat that renews the lease every HEARTBEAT_MS while a
 *  stage runs. If a heartbeat finds the token is no longer ours, it flips
 *  superseded() and stops — the worker should check superseded() before
 *  committing and abort if true. */
export function startHeartbeat(
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

/** Token-gated state write. Returns true if committed (we still owned the job),
 *  false if superseded (0 rows — a reaper reclaimed mid-stage; caller aborts). */
async function commitGated(
  supa: SupabaseClient,
  jobId: string,
  claimToken: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supa
    .from("program_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("claim_token", claimToken)
    .select("id");
  if (error) {
    console.error("[dispatcher] commitGated error:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/** Advance to the next stage: persist the new resume_state, set next_stage,
 *  reset the dispatch-attempt counter, and free the lease so the next
 *  invocation can claim immediately. `extraPatch` merges extra columns into the
 *  same token-gated write (e.g. the skeleton stage mirroring skeleton_json).
 *  Token-gated. */
export async function advanceStage(
  supa: SupabaseClient,
  jobId: string,
  claimToken: string,
  nextStage: Stage,
  resumeState: ResumeState,
  displayStage?: string,
  extraPatch?: Record<string, unknown>,
): Promise<boolean> {
  return await commitGated(supa, jobId, claimToken, {
    ...(extraPatch ?? {}),
    next_stage: nextStage,
    stage: displayStage ?? nextStage,
    resume_state: resumeState,
    stage_dispatch_attempts: 0,
    locked_at: null,
    claim_token: null,
  });
}

/** Terminal success. Token-gated. */
export async function completeJob(
  supa: SupabaseClient,
  jobId: string,
  claimToken: string,
  programId: string,
  resultJson: Record<string, unknown>,
  resumeState: ResumeState,
  extraPatch?: Record<string, unknown>,
): Promise<boolean> {
  return await commitGated(supa, jobId, claimToken, {
    ...(extraPatch ?? {}),
    status: "complete",
    stage: null,
    next_stage: null,
    locked_at: null,
    claim_token: null,
    program_id: programId,
    result_json: resultJson,
    resume_state: resumeState,
  });
}

/** Token-gated failure (the worker's own throw). A superseded worker should NOT
 *  call this — check heartbeat.superseded() first. The gate is a second guard:
 *  if the token already changed, this matches 0 rows and the new owner's run is
 *  untouched. */
export async function failStageGated(
  supa: SupabaseClient,
  jobId: string,
  claimToken: string,
  message: string,
  resultJson?: Record<string, unknown>,
): Promise<void> {
  await commitGated(supa, jobId, claimToken, {
    status: "failed",
    stage: null,
    next_stage: null,
    locked_at: null,
    claim_token: null,
    error: message.slice(0, 1000),
    ...(resultJson ? { result_json: resultJson } : {}),
  });
}

/** Unconditional failure (the reaper, which holds no claim — used when a job
 *  exhausts MAX_DISPATCH_ATTEMPTS). Not token-gated. */
export async function forceMarkFailed(
  supa: SupabaseClient,
  jobId: string,
  message: string,
): Promise<void> {
  await supa
    .from("program_jobs")
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

/** Fire the next stage's invocation. Best-effort, for interactive latency
 *  (first-gen/admin/migrate runs are sometimes watched — waiting on the reaper's
 *  next tick would mean a multi-minute spinner). If this POST is lost, the
 *  reaper picks the job up at the next sweep; correctness never depends on it. */
export async function selfRetrigger(
  functionName: string,
  jobId: string,
  userId: string,
): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "x-webhook-user-id": userId,
      },
      body: JSON.stringify({ resume_job_id: jobId }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // best-effort; reaper backstops
  }
}

// ============================================================
// runStageWithLease — the per-stage harness every stage runs through.
// ============================================================

export interface StageOutcome {
  /** The next stage to run, or "complete" to finish the job. For surgical,
   *  return "surgical" again to re-enter (another pass). */
  next: Stage | "complete";
  /** Full resume_state to persist. */
  resumeState: ResumeState;
  /** Optional human-facing display label (defaults to `next`). */
  displayStage?: string;
  /** Extra columns to merge into the same token-gated commit (e.g. skeleton
   *  mirroring skeleton_json for the admin panel). */
  extraPatch?: Record<string, unknown>;
  /** Required when next === "complete". */
  complete?: { programId: string; resultJson: Record<string, unknown> };
}

/**
 * Claim → heartbeat → run one stage → token-gated commit → self-retrigger.
 *
 * The single discipline every stage follows. `run` receives the live job row +
 * its resume_state and returns where to go next plus the new state. A throw from
 * `run` fails the job (token-gated); writer stages rely on this (no retry on
 * throw), non-writer stages should catch their own transient errors inside `run`
 * and only throw when giving up.
 *
 * No-ops silently (returns) when the claim fails (another worker owns it) or the
 * job is superseded mid-stage — both are normal under at-least-once dispatch.
 */
export async function runStageWithLease(
  supa: SupabaseClient,
  jobId: string,
  userId: string,
  functionName: string,
  expectedStage: Stage,
  run: (job: ProgramJobRow, resumeState: ResumeState) => Promise<StageOutcome>,
): Promise<void> {
  const claim = await claimStage(supa, jobId, expectedStage);
  if (!claim) return; // lease held elsewhere or stage already advanced

  const hb = startHeartbeat(supa, jobId, claim.claimToken);
  try {
    const resumeState = (claim.job.resume_state ?? {}) as ResumeState;
    const outcome = await run(claim.job, resumeState);

    hb.stop();
    if (hb.superseded()) return; // reaper reclaimed mid-stage — do not commit

    if (outcome.next === "complete") {
      if (!outcome.complete) throw new Error("stage returned complete with no payload");
      await completeJob(
        supa, jobId, claim.claimToken,
        outcome.complete.programId, outcome.complete.resultJson, outcome.resumeState,
        outcome.extraPatch,
      );
      return; // terminal — no self-retrigger
    }

    const committed = await advanceStage(
      supa, jobId, claim.claimToken,
      outcome.next, outcome.resumeState, outcome.displayStage, outcome.extraPatch,
    );
    if (committed) await selfRetrigger(functionName, jobId, userId);
  } catch (err) {
    hb.stop();
    if (hb.superseded()) return; // a new owner is running; leave it alone
    const message = err instanceof Error ? err.message : String(err);
    // A stage may attach a `resultJson` to its error (e.g. skeleton exhaustion
    // carrying the last skeleton + failures for the admin panel).
    const resultJson = (err as { resultJson?: Record<string, unknown> })?.resultJson;
    console.error(`[dispatcher] stage ${expectedStage} failed:`, err);
    await failStageGated(supa, jobId, claim.claimToken, message, resultJson);
  }
}
