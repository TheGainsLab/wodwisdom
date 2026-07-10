/**
 * cohort/start-gym-job.ts — build the cohort envelope + roster from a gym's
 * config and create+fire a staged generation job. The ONE kickoff path, shared
 * by the scheduled cron (gym-cohort-cron, pause off) and the portal review
 * desk's on-demand start (gym-program, pause ON) so the two can't drift.
 *
 * Does the cheap DB work (vocabulary, roster from grants→links→profiles, RAG),
 * builds the envelope, inserts the gym_program_jobs row, and fires the worker's
 * first stage. Returns the job id. Throws GymJobReadError on any DB read/write
 * failure BEFORE the paid LLM run starts (a failed read costs a retry, never a
 * broken program stamped success).
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
import { buildCohortRoster, type CohortMemberIntake } from "./build-cohort-roster.ts";
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

interface InjuryConstraints {
  do_not_program?: string[] | null;
}

export interface StartGymJobResult {
  job_id: string;
  members_scaled: number;
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

  // ── Roster = members who joined this gym AND hold an active engine_cohort grant,
  //    attributes from the ONE PROFILE (athlete_profiles — Decision 1). ─────────
  const { data: grants, error: grantErr } = await supa
    .from("user_entitlements")
    .select("user_id")
    .eq("feature", "engine_cohort")
    .eq("granted_by", cfg.gym_id)
    .or("expires_at.is.null,expires_at.gt." + nowIso);
  if (grantErr) throw new GymJobReadError("user_entitlements", grantErr.message);
  const grantedIds = new Set((grants ?? []).map((g) => (g as { user_id: string }).user_id));

  let members: CohortMemberIntake[] = [];
  let membersWithWeights = 0;
  if (grantedIds.size > 0) {
    const { data: links, error: linkErr } = await supa
      .from("member_gym_links")
      .select("user_id")
      .eq("gym_id", cfg.gym_id)
      .eq("status", "joined")
      .in("user_id", [...grantedIds]);
    if (linkErr) throw new GymJobReadError("member_gym_links", linkErr.message);
    const rosterIds = (links ?? [])
      .map((l) => (l as { user_id: string }).user_id)
      .filter((id) => grantedIds.has(id));

    if (rosterIds.length > 0) {
      const { data: profiles, error: profErr } = await supa
        .from("athlete_profiles")
        .select("user_id, gender, bodyweight, units, lifts, injuries_structured")
        .in("user_id", rosterIds);
      if (profErr) throw new GymJobReadError("athlete_profiles", profErr.message);
      const byUser = new Map(
        (profiles ?? []).map((p) => [(p as { user_id: string }).user_id, p as Record<string, unknown>]),
      );

      members = rosterIds.map((userId) => {
        const p = byUser.get(userId);
        const lifts = (p?.lifts as Record<string, number | null> | null) ?? null;
        if (lifts && Object.values(lifts).some((v) => typeof v === "number" && v > 0)) membersWithWeights++;
        const injuries = p?.injuries_structured as InjuryConstraints | null;
        return {
          athlete_ref: userId,
          gender: (p?.gender as string | null) ?? null,
          bodyweight: (p?.bodyweight as number | null) ?? null,
          units: (p?.units as "lbs" | "kg" | null) ?? cfg.units,
          lifts,
          do_not_program: injuries?.do_not_program ?? null,
        };
      });
    }
  }

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
  const roster = buildCohortRoster(members, nowIso); // may be empty (shared program still generates)

  const initialResume: GymResumeState = {
    gym_id: cfg.gym_id,
    domain_pack: cfg.domain_pack,
    payload: envelope.shared_payload,
    tdi: envelope.shared_training_design_input,
    roster,
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

  return { job_id: job.id as string, members_scaled: roster.length, members_with_weights: membersWithWeights };
}
