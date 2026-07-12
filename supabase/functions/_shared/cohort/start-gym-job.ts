/**
 * cohort/start-gym-job.ts — build the gym program envelope from a gym's config
 * and create+fire a staged generation job. The ONE kickoff path, shared by the
 * scheduled cron (gym-cohort-cron, pause off) and the portal review desk's
 * on-demand start (gym-program, pause ON) so the two can't drift.
 *
 * Inputs are GYM-LEVEL ONLY (Decision 11, docs/portfolio/PRODUCT_BOUNDARIES.md):
 * the gym's config drives generation; NO member data is read. The per-member
 * scaling roster (grants→links→athlete_profiles) was removed under Decision 11
 * R1/R2 — the retail profile is retail-only, and per-member scaling returns (if
 * ever) as affiliate-side membership-slot inputs, never from profiles.
 * resume_state.roster is always empty, a legal state end-to-end: the shared
 * program generates; persist-cohort-result writes no scaling rows.
 *
 * Does the cheap DB work (vocabulary, RAG), builds the envelope, inserts the
 * gym_program_jobs row, and fires the worker's first stage. Returns the job id.
 * Throws GymJobReadError on any DB read/write failure BEFORE the paid LLM run
 * starts (a failed read costs a retry, never a broken program stamped success).
 *
 * The caller owns: the atomic gym claim (cron) or the on-demand config read
 * (portal), the one-active-job guard, and any backoff bookkeeping on failure.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchVocabulary } from "../build-writer-payload.ts";
import { buildRagContext } from "../build-rag-context.ts";
import {
  buildGymCohortEnvelope,
  cohortReferenceLifts,
  type CohortStrategy,
  type GymCohortConfig,
} from "./build-gym-cohort-envelope.ts";
import { GYM_FIRST_STAGE, type GymResumeState, gymSelfRetrigger } from "../gym-dispatcher.ts";

/** The generation-relevant columns of a gym_cohort_configs row. */
export interface GymJobConfig {
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
}

/** The two job states that count as "a draft in flight" — a gym may have at
 *  most one. Enforced at the DB by a UNIQUE partial index
 *  (idx_gym_program_jobs_gym_active); the app checks are a courtesy that give a
 *  clean 409 before the insert. Shared so the cron and the portal door agree. */
export const ACTIVE_JOB_STATUSES = ["processing", "awaiting_approval"] as const;

/** A DB read/write failed — abort BEFORE any paid LLM work is started. */
export class GymJobReadError extends Error {
  constructor(table: string, detail: string) {
    super(`${table} read failed: ${detail}`);
    this.name = "GymJobReadError";
  }
}

/** The gym already has an active job — the UNIQUE active-index rejected the
 *  insert (23505). The DB is the real guard against a portal start racing the
 *  cron (or another start); the pre-checks can both read empty. */
export class GymJobConflictError extends Error {
  constructor() {
    super("a generation is already in flight for this gym");
    this.name = "GymJobConflictError";
  }
}

export interface StartGymJobResult {
  job_id: string;
  /** Always 0 since Decision 11 removed per-member scaling. Kept (as literal 0)
   *  for portal seam compatibility; remove on both sides in the class sweep. */
  members_scaled: number;
  /** Always 0 — see members_scaled. */
  members_with_weights: number;
}

export async function startGymJob(
  supa: SupabaseClient,
  cfg: GymJobConfig,
  opts: { pauseAfterSkeleton: boolean; nowIso: string },
): Promise<StartGymJobResult> {
  const { nowIso } = opts;

  // ── Vocabulary — abort on a real read error (empty vocab burns LLM passes). ─
  const { vocabulary, error: vocabErr } = await fetchVocabulary(supa, { onError: "signal" });
  if (vocabErr) throw new GymJobReadError("movements", vocabErr);

  // Decision 11 R1/R2: no member reads. The gym program is generated from the
  // gym's config alone; resume_state.roster stays empty (supported end-to-end).

  // ── RAG methodology block for the reference class target (retail parity). ────
  const rag = await buildRagContext(supa, cohortReferenceLifts(cfg.target_level, cfg.units), {});

  const gymConfig: GymCohortConfig = {
    days_per_week: cfg.days_per_week,
    session_length_minutes: cfg.session_length_minutes,
    equipment: cfg.equipment,
    target_level: cfg.target_level,
    do_not_program: cfg.do_not_program,
    units: cfg.units,
    goal_text: cfg.goal_text,
    strategy: cfg.strategy,
  };

  const envelope = buildGymCohortEnvelope(gymConfig, vocabulary, nowIso, { rag });

  const initialResume: GymResumeState = {
    gym_id: cfg.gym_id,
    domain_pack: cfg.domain_pack,
    payload: envelope.shared_payload,
    tdi: envelope.shared_training_design_input,
    roster: [], // Decision 11: per-member scaling removed; empty is supported end-to-end.
    startedAtMs: Date.now(),
  };
  const { data: job, error: jobErr } = await supa
    .from("gym_program_jobs")
    .insert({
      gym_id: cfg.gym_id,
      status: "processing",
      stage: GYM_FIRST_STAGE,
      next_stage: GYM_FIRST_STAGE,
      resume_state: initialResume,
      // Owner-review gate: true parks the job at awaiting_approval after the
      // skeleton stage (the review desk); false runs straight through (cron).
      pause_after_skeleton: opts.pauseAfterSkeleton,
    })
    .select("id")
    .single();
  if (jobErr) {
    // The UNIQUE active-index is the real one-active-job guard (a racing start
    // or cron both pass their pre-check, then one insert loses here).
    if (jobErr.code === "23505" || /duplicate key|unique/i.test(jobErr.message ?? "")) {
      throw new GymJobConflictError();
    }
    throw new GymJobReadError("gym_program_jobs", jobErr.message);
  }
  if (!job) throw new GymJobReadError("gym_program_jobs", "insert returned no row");

  await gymSelfRetrigger(job.id as string);

  return { job_id: job.id as string, members_scaled: 0, members_with_weights: 0 };
}
