/**
 * build-writer-payload.ts
 *
 * v2 payload assembler. Produces the typed object that both the v2
 * writer LLM (program-gen) and the safety-review LLM consume. Replaces
 * what `derive-athlete-diagnostic.ts` + `reconciler.ts` + the prose
 * formatters did in v1: pre-digesting raw data into curated prose.
 *
 * v2's approach is the opposite — hand the LLM raw data and let it
 * apply coaching judgment, with the system prompt carrying the
 * conventions. This module does *nothing* but data shaping:
 *   - one SELECT against athlete_profiles
 *   - optionally one Tier 4 bundle fetch (when athlete is linked)
 *   - one SELECT against movements for the vocabulary
 *   - rag: retired 2026-08-11 (empty string; composer owns example retrieval)
 *
 * Locked design rules (see competition_history_feature_plan.md):
 *   - 9 top-level payload keys: basics, lifts, skills, conditioning,
 *     equipment, training_context, competition, vocabulary, rag.
 *   - JSONB blobs (lifts/skills/conditioning/equipment) hydrate to
 *     complete canonical-key maps; missing values = null (equipment
 *     missing = false in a non-empty record; an EMPTY record means the
 *     athlete never did the equipment review and hydrates all-true —
 *     see hydrateEquipment in tier-status.ts).
 *   - days_per_week defaults to 5, clamped to [3, 6].
 *   - Tier 4 bundle is sliced: character_affinity + identity dropped;
 *     everything else passed through.
 *   - Vocabulary = display_name strings (Title Case) from movements
 *     WHERE competition_count > 0.
 *   - recent_training omitted from Month 1 payload entirely (folded
 *     into deferred month-to-month continuity work).
 *   - guidelines dropped — coaching judgment lives in the system
 *     prompt, not a parallel channel.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ALL_SKILL_KEYS,
  ALL_CONDITIONING_KEYS,
  ALL_LIFT_KEYS,
  SKILL_DISPLAY_NAMES,
  hydrateEquipment,
} from "./tier-status.ts";
import { computeEquipmentBlockedMovements } from "./equipment-movements.ts";
import { fetchTier4Bundle, type Tier4Bundle } from "./fetch-tier4-bundle.ts";
import {
  computeGrid,
  computeSkillCost,
  hasBarbellEquipment,
  hasBarbellMovementNames,
  skillsInMovementNames,
  type GridRowData,
  type GridSourceRow,
  type SkillCostRow,
} from "./performance-grid.ts";
import {
  type AthleteModel,
  buildAthleteModel,
  type LoggedCompetitionResult,
  profileStaticFromRow,
} from "./athlete-model.ts";
import { buildTrainingSummary } from "./training-summary.ts";
import { buildOutsideTrainingFacts, fetchOutsideTraining } from "./athlete-activities.ts";
import type { CoachingIntake } from "./coaching-intake.ts";
import { persistAthleteModel } from "./persist-athlete-model.ts";
import { persistTrainingSummary } from "./persist-training-summary.ts";
import {
  computeTimeInZone,
  type ZoneMinutes,
  zonesTouched,
} from "./engine-spectrum.ts";
import { checkEntitlement } from "./entitlements.ts";

// ============================================================
// Payload types
// ============================================================

export type SkillLevel = "none" | "beginner" | "intermediate" | "advanced";

export interface BasicsPayload {
  age: number | null;
  height: number | null;
  bodyweight: number | null;
  gender: string | null;
  units: "lbs" | "kg" | null;
}

export interface InjuryConstraints {
  summary: string;
  do_not_program: string[];
  suggested_subs: { instead_of: string; use: string }[];
  /**
   * Provenance for each entry in `do_not_program` (handoff Priority 2), derived at
   * merge time — NOT persisted. Injury blocks are bodily (liftable only via the
   * athlete's confirmation flow); equipment blocks are situational (a future
   * "full gym this week" toggle may lift them). A consumer that lifts blocks MUST
   * consult this map and never clear `injury`/`both` movements. Absent on the raw
   * parse output; populated by build-writer-payload after the equipment merge.
   */
  blocked_by?: Record<string, "equipment" | "injury" | "both">;
}

/**
 * The athlete-confirmed avoidance gate (handoff 1.1). Stored on
 * athlete_profiles.injuries_avoidance_confirmed; valid only for the exact text it
 * was confirmed against (confirmed_against_hash === injuries_constraints_hash).
 */
export interface AvoidanceConfirmed {
  do_not_program: string[];
  confirmed_at: string;
  confirmed_against_hash: string;
}

export interface TrainingContextPayload {
  /** User-specified or default 5; clamped to [3, 6]. */
  days_per_week: 3 | 4 | 5 | 6;
  /** The athlete's per-session time budget in minutes (profile slider).
   *  Null when never set — the skeleton then plans without a time budget.
   *  The gym cohort envelope sets it from the cohort config instead. */
  session_length_minutes?: number | null;
  /** Raw user free-text — NOT parsed. */
  goal_text: string | null;
  /** Raw user free-text — NOT parsed. */
  injuries_constraints_text: string | null;
  /**
   * Structured form of injuries_constraints_text, produced asynchronously
   * by the parse-injuries-constraints edge function. Null when never
   * parsed (or text is empty). When present, it's the canonical
   * banned-movement list the writer + safety review should consult.
   */
  injuries_structured: InjuryConstraints | null;
  self_perception_level: string | null;
}

/**
 * Tier 4 slice the writer consumes. Bundle's `character_affinity` and
 * `identity` are deliberately dropped per the locked design.
 */
export interface CompetitionPayload {
  competition_summary: Tier4Bundle["competition_summary"];
  movement_affinity: Tier4Bundle["movement_affinity"];
  time_domain_modality_breakdown: Tier4Bundle["time_domain_modality_breakdown"];
  recent_raw_results: Tier4Bundle["recent_raw_results"];
  /** Per-workout career history. Optional — dropped from the program-generator
   *  payload (the aggregates carry enough signal) but kept for the evaluator. */
  all_results?: NonNullable<Tier4Bundle["all_results"]>;
  movement_competency: NonNullable<Tier4Bundle["movement_competency"]>;
  fitness_signature: NonNullable<Tier4Bundle["fitness_signature"]>;
  /** Server-side aggregations of athlete's per-result work/power (bundle 1.8.0,
   *  upstream sql/134). null when the upstream couldn't compute (zero finished
   *  results in the underlying pool, unlinked, or 1.8.0 not yet served). */
  power_profile: NonNullable<Tier4Bundle["power_profile"]> | null;
}

export interface PreviousCycleSummary {
  program_id: string;
  program_name: string | null;
  last_completed_date: string | null;
  /** Whether the prior cycle had any completed logs to lean on. Informational
   *  only — absence of logging is NEVER a penalty (a busy week / light logger
   *  is not low capacity); we just progress off the prescription instead. */
  logged: boolean;
  /** Per-lift PRESCRIPTION from last cycle (the backbone — always present for a
   *  v3 prior cycle; empty for a v1 prior program). logged_* are additive: null
   *  when unlogged → progress normally, never cut. */
  strength: Array<{
    lift: string;                    // canonical key, e.g. "back_squat"
    top_pct_1rm: number | null;      // heaviest % prescribed last cycle
    top_weight: number | null;       // heaviest prescribed weight (lb)
    sessions: number;                // # strength/accessory blocks it appeared in
    logged_avg_rpe: number | null;   // null = unlogged
    logged_hit_rate: number | null;  // % sets actual ≥ prescribed; null = unlogged
  }>;
  /** Metcon coverage from last cycle's prescribed time caps — to rebalance
   *  time-domain spread this cycle. */
  conditioning: {
    metcons: number;
    time_domains: { short: number; medium: number; long: number; untimed: number };
  };
  /** Map keyed by canonical skill key (e.g. "bar_muscle_ups"). Reps/holds the
   *  athlete ACTUALLY logged — positive signal only; never used to regress a
   *  skill (low/absent volume may just mean it wasn't logged). */
  skill_volume: Record<string, {
    total_reps: number;
    total_hold_seconds: number;
    days: number;
  }>;
  /** The athlete's own logged block notes from the prior cycle, newest first
   *  (bounded: latest 30, each ≤500 chars). Free text typed at log time —
   *  qualitative evidence for month_in_review and load decisions. Absent on
   *  pre-migration RPC results; empty array when nothing was noted. */
  block_notes?: Array<{
    date: string | null;
    block_type: string;
    note: string;
  }>;
}

/** The duration x barbell-presence performance grid + skill-cost list
 *  (founder spec, 2026-10-03) - the honest per-event aggregation that
 *  replaced the service's closable_gaps on the admin card and MetCons tab.
 *  Columns short/medium/long/all; rows all/barbell/no_barbell; every cell
 *  an event-weighted percentile average with its count. Counts are the
 *  evidence size: small-n cells are hints, not findings. */
export interface PerformanceGridPayload {
  /** Cohort percentile across the athlete's competition events. */
  competition: { grid: GridRowData[]; skill_cost: SkillCostRow[]; scored: number } | null;
  /** Open-field percentile across scored logged program metcons. */
  training: { grid: GridRowData[]; skill_cost: SkillCostRow[]; scored: number } | null;
}

/** The athlete's Engine training, reduced to evidence the generator can
 *  flex around (2026-10 Engine-awareness contract). Present ONLY when all
 *  of these hold: the caller opted in (the program generator), the athlete
 *  holds the engine entitlement, has a chosen track, AND has completed-
 *  session evidence in the trailing 28 days (≥2 sessions, the latest within
 *  21 days). A subscription or track choice alone NEVER shades programming,
 *  and ~3 silent weeks decays the athlete back to self-sufficient — both
 *  render as null here, indistinguishable from no Engine at all, which is
 *  exactly the zero-effect the contract demands. Soft-fails to null. */
export interface EngineTrainingPayload {
  /** Engine track id (engine_programs registry). */
  track: string;
  /** The athlete's own stated Engine goal, verbatim. */
  goal: string | null;
  /** Completed sessions, trailing 28 days, reduced to minutes-in-zone
   *  (pace-fraction-anchored zones; see engine-spectrum.ts). */
  trailing_28_days: {
    sessions: number;
    cadence_per_week: number;
    minutes_counted: number;
    time_in_zone_minutes: ZoneMinutes;
  };
  /** The next days on the athlete's FIXED catalog track, projected at the
   *  observed cadence over the coming 4 weeks. Deterministic — Engine never
   *  adapts to this program; this program flexes around Engine. */
  upcoming_4_weeks: {
    projected_sessions: number;
    days: Array<{ day_type: string; minutes: number | null; zones: string[] }>;
    time_in_zone_minutes: ZoneMinutes;
  };
}

export interface WriterPayload {
  basics: BasicsPayload;
  /** All 14 canonical lift keys; null when user hasn't entered. */
  lifts: Record<string, number | null>;
  /** All canonical skill keys; null when user hasn't rated. */
  skills: Record<string, SkillLevel | null>;
  /** All 7 conditioning benchmark keys; null when user hasn't entered. */
  conditioning: Record<string, string | number | null>;
  /** All canonical equipment keys; false when absent from a non-empty
   *  record. Empty record = unreviewed = all true (hydrateEquipment). */
  equipment: Record<string, boolean>;
  training_context: TrainingContextPayload;
  /** Deterministic Athlete Model (coaching-state Step 1) — the authoritative,
   *  precomputed fact-sheet every LLM stage consumes instead of re-deriving:
   *  strength ratios, bodyweight multipliers, normative positions, recovery
   *  class. Always present (generation never depends on persistence; an
   *  unpersisted fallback carries version 0). FACTS only — no priority labels;
   *  "what to train" is Coaching Strategy's call. */
  athlete_model: AthleteModel;
  /** Tier 4 slice when linked + fetch succeeded; null otherwise. */
  competition: CompetitionPayload | null;
  /** See PerformanceGridPayload. null only when neither source has a
   *  scored workout. */
  performance_grid: PerformanceGridPayload | null;
  /** See EngineTrainingPayload. GENERATOR ONLY (includeEngineTraining) and
   *  evidence-gated — the only change every other payload sees is this
   *  constant null field (no prompt addendum, no behavior shift). */
  engine_training: EngineTrainingPayload | null;
  /** Step 27 carry-forward: most-recently-active completed cycle's
   *  adherence + skip rate + per-skill volume. NULL for first-time athletes
   *  or anyone without a completed log against any prior program. */
  previous_cycle: PreviousCycleSummary | null;
  /** display_name strings — the writer's allowed-movement set. */
  vocabulary: string[];
  /** Latest COMPLETE profile evaluation narrative (profile_evaluations.analysis).
   *  The coach's synthesized fitness judgment. Read on EVERY generation (month 1
   *  and continuation) — the profile/eval can change between cycles. NULL when the
   *  athlete has no completed evaluation yet, or the read soft-failed. */
  profile_evaluation: string | null;
  /** Latest training evaluation narrative (training_evaluations.analysis) — the
   *  coach's read of recent training. Populated only for continuation months
   *  (month >= 2); month 1 has no training history. Complements previous_cycle
   *  (structured actuals) with narrative interpretation. NULL otherwise. */
  training_evaluation: string | null;
  /** Concatenated RAG context (TODO: wire to v1's searchChunks chain). */
  rag: string;
}

// ============================================================
// Helpers — coercion / hydration
// ============================================================

function clampDaysPerWeek(n: number | null | undefined): 3 | 4 | 5 | 6 {
  if (n == null || !Number.isFinite(n)) return 5;
  const r = Math.round(n);
  if (r <= 3) return 3;
  if (r >= 6) return 6;
  return r as 3 | 4 | 5 | 6;
}

// Exported so the cohort roster builder resolves member 1RMs by the EXACT same rule
// retail uses (this coercion decides prescribed weights and must not drift).
export function asLiftValue(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function asSkillLevel(v: unknown): SkillLevel | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "none" || s === "beginner" || s === "intermediate" || s === "advanced") {
    return s;
  }
  return null;
}

function asConditioningValue(v: unknown): string | number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asUnits(v: unknown): "lbs" | "kg" | null {
  const s = asString(v);
  return s === "lbs" || s === "kg" ? s : null;
}

// ============================================================
// Do-not-program merge — the ONE precedence rule for movements the AI
// must never prescribe. Shared by program generation (buildWriterPayload)
// and AI-Edit (adjust-workout) so the two paths cannot drift.
// ============================================================

/**
 * Normalize equipment and merge every avoidance source into one canonical
 * `InjuryConstraints` with per-movement provenance:
 *
 *   1. Injury blocks — the athlete-CONFIRMED avoidance list (handoff 1.1)
 *      when it is valid for the current constraint text
 *      (confirmed_against_hash === injuries_constraints_hash). ROLLOUT
 *      SAFETY (T4 before T3/T6): with no valid confirmation — every
 *      existing user until they complete the one-time show-back — fall
 *      back to the raw parsed list so protection is NEVER dropped.
 *   2. Equipment blocks — the static movement expansion of missing
 *      equipment (boolean map → movement list).
 *   3. Union of both, `blocked_by` derived at merge (handoff Priority 2),
 *      NOT persisted. Injury blocks are bodily (liftable only via the
 *      confirmation flow); equipment blocks are situational (a future
 *      "full gym this week" toggle may lift them). A consumer that lifts
 *      blocks MUST consult blocked_by and never clear `injury`/`both`.
 */
export function computeMergedAvoidance(profile: {
  equipment?: Record<string, unknown> | null;
  injuries_structured?: InjuryConstraints | null;
  injuries_constraints_hash?: string | null;
  injuries_avoidance_confirmed?: AvoidanceConfirmed | null;
}): { equipment: Record<string, boolean>; injuries_structured: InjuryConstraints } {
  // Empty record = never reviewed = assume fully equipped (see hydrateEquipment) —
  // otherwise an unreviewed profile would block EVERY equipment movement here.
  const equipment = hydrateEquipment(profile.equipment);
  const equipmentBlocked = computeEquipmentBlockedMovements(equipment);

  const base: InjuryConstraints = profile.injuries_structured ?? {
    summary: "No injury constraints.",
    do_not_program: [],
    suggested_subs: [],
  };
  const confirmed = profile.injuries_avoidance_confirmed ?? null;
  const confirmationValid =
    confirmed != null &&
    profile.injuries_constraints_hash != null &&
    confirmed.confirmed_against_hash === profile.injuries_constraints_hash;
  const injuryBlocked = confirmationValid ? confirmed!.do_not_program : base.do_not_program;

  const injurySet = new Set(injuryBlocked);
  const equipSet = new Set(equipmentBlocked);
  const mergedDoNotProgram = Array.from(new Set([...injurySet, ...equipSet])).sort();
  const blockedBy: Record<string, "equipment" | "injury" | "both"> = {};
  for (const m of mergedDoNotProgram) {
    const inj = injurySet.has(m);
    const eq = equipSet.has(m);
    blockedBy[m] = inj && eq ? "both" : inj ? "injury" : "equipment";
  }
  return {
    equipment,
    injuries_structured: { ...base, do_not_program: mergedDoNotProgram, blocked_by: blockedBy },
  };
}

// ============================================================
// Tier 4 bundle slicer — drops character_affinity + identity; passes
// everything else through. NonNullable fallbacks return empty
// structures so the writer reads stable shapes regardless of which
// `?include=` flags the upstream returned data for.
// ============================================================

function sliceTier4Bundle(bundle: Tier4Bundle, includeAllResults: boolean): CompetitionPayload {
  const sliced: CompetitionPayload = {
    competition_summary: bundle.competition_summary,
    movement_affinity: bundle.movement_affinity,
    time_domain_modality_breakdown: bundle.time_domain_modality_breakdown,
    recent_raw_results: bundle.recent_raw_results,
    movement_competency: bundle.movement_competency ?? [],
    fitness_signature: bundle.fitness_signature ?? {
      closable_gaps: [],
      stage_progression: [],
      stimulus_breakdown: {
        overall: { all: { n_workouts: 0, cohort_percentile: 0, worldwide_percentile: 0 } },
        modality: {},
        load_class: {},
        skill_gated: {},
        time_domain: {},
      },
    },
    power_profile: bundle.power_profile ?? null,
  };
  if (includeAllResults) {
    sliced.all_results = bundle.all_results ?? [];
  }
  return sliced;
}

/**
 * Read the athlete's enriched Try-It throwbacks (competition_workout_results,
 * with the catalog metadata log-throwback captured) → typed
 * LoggedCompetitionResult[]. Best-effort: [] on any error. Most recent first,
 * capped — this is supplementary evidence, not the backbone.
 */
async function fetchLoggedCompetitionResults(
  supa: SupabaseClient,
  userId: string,
): Promise<LoggedCompetitionResult[]> {
  try {
    const { data, error } = await supa
      .from("competition_workout_results")
      .select(
        "workout_name, movements, time_domain, classification, score_type, score_value, finished, worldwide_percentile, cohort_percentile, avg_power_watts, avg_w_per_kg, performed_at",
      )
      .eq("user_id", userId)
      .order("performed_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []).map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        workout_name: typeof r.workout_name === "string" && r.workout_name ? r.workout_name : "Competition workout",
        movements: Array.isArray(r.movements) ? (r.movements as string[]) : [],
        time_domain: (r.time_domain as string | null) ?? null,
        classification: (r.classification as string | null) ?? null,
        score_type: String(r.score_type ?? ""),
        score_value: typeof r.score_value === "number" ? r.score_value : 0,
        finished: (r.finished as boolean | null) ?? null,
        worldwide_percentile: (r.worldwide_percentile as number | null) ?? null,
        cohort_percentile: (r.cohort_percentile as number | null) ?? null,
        avg_power_watts: (r.avg_power_watts as number | null) ?? null,
        avg_w_per_kg: (r.avg_w_per_kg as number | null) ?? null,
        performed_at: String(r.performed_at ?? ""),
      };
    });
  } catch (err) {
    console.warn(`[build-writer-payload] logged competition results fetch failed for ${userId}:`, err);
    return [];
  }
}

// ============================================================
// Vocabulary fetch — display_name strings for the ENTIRE curated movements
// catalog (no competition_count filter). The writer's allowed-movement set.
// competition_count is a relevance signal, not an inclusion gate: filtering on
// it hid the whole support/accessory catalog (RDL, Strict Press, rows, etc.),
// which made the writer substitute the nearest competition movement. Suitability
// is already guarded by the curated table + do-not-program list + safety review.
// ============================================================

// Retail path: soft-fails to [] on error (audit rule #7 then rejects any movement
// string — a self-limiting degradation). The cohort cron passes { onError: "signal" }
// so it can ABORT before a paid LLM run instead of generating against an empty vocab
// (which would burn the surgical recovery passes). Both share this one query + coercion.
export async function fetchVocabulary(supa: SupabaseClient): Promise<string[]>;
export async function fetchVocabulary(
  supa: SupabaseClient,
  opts: { onError: "signal" },
): Promise<{ vocabulary: string[]; error: string | null }>;
export async function fetchVocabulary(
  supa: SupabaseClient,
  opts?: { onError: "signal" },
): Promise<string[] | { vocabulary: string[]; error: string | null }> {
  const { data, error } = await supa
    .from("movements")
    .select("display_name")
    .order("display_name", { ascending: true });

  const vocabulary = (data ?? [])
    .map((row) => (row as { display_name: unknown }).display_name)
    .filter((s): s is string => typeof s === "string" && s.trim() !== "");

  if (opts?.onError === "signal") {
    return { vocabulary, error: error ? error.message : null };
  }
  if (error) {
    console.warn(
      "[build-writer-payload] vocabulary fetch failed; proceeding with empty list. Audit rule #7 will reject any movement strings.",
      error,
    );
    return [];
  }
  return vocabulary;
}

// ============================================================
// RAG context — delegates to _shared/build-rag-context.ts (the
// extracted v1 chain). Takes the hydrated lifts + skills maps so
// the RAG builder doesn't have to re-walk the raw athlete_profiles
// row. Same queries, same dedup, same "REFERENCE …" prefix v1
// emits; soft-fails to "" when OPENAI_API_KEY is missing.
// ============================================================

// ============================================================
// Profile row shape — exactly the columns we SELECT.
// ============================================================

interface AthleteProfileRow {
  age: number | null;
  height: number | null;
  bodyweight: number | null;
  gender: string | null;
  units: string | null;
  lifts: Record<string, unknown> | null;
  skills: Record<string, unknown> | null;
  conditioning: Record<string, unknown> | null;
  equipment: Record<string, unknown> | null;
  days_per_week: number | null;
  session_length_minutes: number | null;
  goal: string | null;
  injuries_constraints: string | null;
  injuries_structured: InjuryConstraints | null;
  injuries_constraints_hash: string | null;
  injuries_avoidance_confirmed: AvoidanceConfirmed | null;
  self_perception_level: string | null;
  competition_athlete_id: string | null;
  coaching_intake: CoachingIntake | null;
  updated_at: string | null;
  engine_program_version: string | null;
  engine_current_day: number | null;
  engine_goal: string | null;
}

const PROFILE_COLS =
  "age, height, bodyweight, gender, units, " +
  "lifts, skills, conditioning, equipment, " +
  "days_per_week, session_length_minutes, " +
  "goal, injuries_constraints, injuries_structured, " +
  "injuries_constraints_hash, injuries_avoidance_confirmed, self_perception_level, " +
  "competition_athlete_id, coaching_intake, updated_at, " +
  "engine_program_version, engine_current_day, engine_goal";

// ============================================================
// Main entry point.
// ============================================================

export interface BuildWriterPayloadOptions {
  /**
   * Include the per-workout `all_results` career array in the competition
   * slice. Defaults to true (preserves eval behavior). The program-generator
   * sets this to false — the aggregates (movement_affinity, fitness_signature,
   * movement_competency, closable_gaps) carry enough signal and the raw
   * career array adds ~50–100k tokens of noise.
   */
  includeAllResults?: boolean;
  /**
   * Surface the coaching evaluations (profile_evaluation always; training_
   * evaluation for month >= 2) in the payload. ONLY the program GENERATOR
   * should set this. The profile EVALUATOR (profile-analysis-v2) also builds
   * this payload to PRODUCE an evaluation — feeding it the latest evaluation
   * would be circular — so it leaves this false. Defaults to false.
   */
  includeEvaluations?: boolean;
  /**
   * Month being generated (1 for first cycle, >= 2 for continuation). Gates the
   * training evaluation read (month >= 2 only; month 1 has no training history).
   * Only consulted when includeEvaluations is true. Defaults to 1.
   */
  monthNumber?: number;
  /**
   * Populate engine_training (see EngineTrainingPayload) — the Engine-
   * awareness evidence block. ONLY the program GENERATOR sets this; the
   * eval keeps it false so eval payloads (and the coach states they cache)
   * are untouched. Defaults to false.
   */
  includeEngineTraining?: boolean;
}

export async function buildWriterPayload(
  supa: SupabaseClient,
  userId: string,
  options: BuildWriterPayloadOptions = {},
): Promise<WriterPayload> {
  const includeAllResults = options.includeAllResults ?? true;
  const includeEvaluations = options.includeEvaluations ?? false;
  const monthNumber = options.monthNumber ?? 1;
  const includeEngineTraining = options.includeEngineTraining ?? false;

  // 1. Athlete profile row — hard requirement.
  const { data: profile, error: profileErr } = await supa
    .from("athlete_profiles")
    .select(PROFILE_COLS)
    .eq("user_id", userId)
    .maybeSingle<AthleteProfileRow>();

  if (profileErr) {
    throw new Error(
      `[build-writer-payload] athlete_profiles fetch failed for ${userId}: ${profileErr.message}`,
    );
  }
  if (!profile) {
    throw new Error(
      `[build-writer-payload] athlete_profiles row not found for user ${userId}`,
    );
  }

  // 2. Tier 4 bundle — only when linked. Soft-fails to null on any
  // upstream error (matches fetchTier4Bundle's existing contract).
  let competition: CompetitionPayload | null = null;
  let gridCompetition: PerformanceGridPayload["competition"] = null;
  let gridTraining: PerformanceGridPayload["training"] = null;
  if (profile.competition_athlete_id) {
    // all_results is always fetched now: the performance grid computes from
    // raw events server-side. Whether the RAW events ride into the payload
    // is still gated on includeAllResults (size), as before.
    const tier4Include = ["all_results", "competency", "signature", "power_profile"];
    const bundle = await fetchTier4Bundle(profile.competition_athlete_id, {
      include: tier4Include,
    });
    if (bundle) {
      competition = sliceTier4Bundle(bundle, includeAllResults);
      try {
        const compRows: GridSourceRow[] = (bundle.all_results ?? [])
          .filter((r) => r?.result?.valid && typeof r.result.cohort_percentile === "number")
          .map((r): GridSourceRow => {
            const bucket = r.workout?.time_domain?.bucket;
            const movements = Array.isArray(r.workout?.movements) ? r.workout.movements : [];
            return {
              timeDomain: bucket === "short" || bucket === "medium" || bucket === "long" ? bucket : null,
              percentile: r.result.cohort_percentile,
              hasBarbell: hasBarbellEquipment(movements.map((m) => (Array.isArray((m as { equipment?: string[] }).equipment) ? (m as { equipment: string[] }).equipment : []))),
              skills: skillsInMovementNames(movements.map((m) => String(m?.name ?? ""))),
              label: String(r.workout_name ?? ""),
            };
          });
        const scored = compRows.filter((r) => r.timeDomain !== null).length;
        if (scored > 0) {
          gridCompetition = { grid: computeGrid(compRows), skill_cost: computeSkillCost(compRows), scored };
        }
      } catch (err) {
        console.warn(`[build-writer-payload] competition performance grid failed for ${userId}:`, err);
      }
    }
  }

  // 2b. Self-logged Try-It throwbacks (competition_workout_results, enriched at
  // log time). Surfaced on the Athlete Model (below) — independent of whether the
  // athlete linked official history — so CoachState (→ the eval) and, via
  // CoachState, the generator read them the same way imported results are read.
  const loggedResults = await fetchLoggedCompetitionResults(supa, userId);

  // 2c. Training performance grid — scored logged program metcon blocks,
  // entry movements matched by block_id with the legacy block_label
  // fallback (same matching the Training Log page uses). Soft-fails.
  try {
    const { data: logRows } = await supa
      .from("workout_logs").select("id").eq("user_id", userId).limit(200);
    const logIds = ((logRows ?? []) as Array<{ id: string }>).map((l) => l.id);
    if (logIds.length > 0) {
      const [{ data: blocks }, { data: entries }] = await Promise.all([
        supa.from("workout_log_blocks")
          .select("id, log_id, block_label, time_domain, percentile")
          .in("log_id", logIds).eq("block_type", "metcon").not("percentile", "is", null),
        supa.from("workout_log_entries")
          .select("log_id, block_id, block_label, movement")
          .in("log_id", logIds),
      ]);
      type BlockRow = { id: string; log_id: string; block_label: string | null; time_domain: string | null; percentile: number | string };
      type EntryRow = { log_id: string; block_id: string | null; block_label: string | null; movement: string | null };
      const trainRows: GridSourceRow[] = ((blocks ?? []) as BlockRow[]).map((bRow): GridSourceRow => {
        const movements = ((entries ?? []) as EntryRow[])
          .filter((e) => e.log_id === bRow.log_id &&
            (e.block_id ? e.block_id === bRow.id : e.block_label === bRow.block_label))
          .map((e) => String(e.movement ?? ""))
          .filter((m) => m.length > 0);
        const bucket = bRow.time_domain;
        return {
          timeDomain: bucket === "short" || bucket === "medium" || bucket === "long" ? bucket : null,
          percentile: Number(bRow.percentile),
          hasBarbell: hasBarbellMovementNames(movements),
          skills: skillsInMovementNames(movements),
          label: String(bRow.block_label ?? ""),
        };
      }).filter((r) => Number.isFinite(r.percentile));
      const scored = trainRows.filter((r) => r.timeDomain !== null).length;
      if (scored > 0) {
        gridTraining = { grid: computeGrid(trainRows), skill_cost: computeSkillCost(trainRows), scored };
      }
    }
  } catch (err) {
    console.warn(`[build-writer-payload] training performance grid failed for ${userId}:`, err);
  }

  // 3. Vocabulary — display_name list.
  const vocabulary = await fetchVocabulary(supa);

  // 3b. Previous-cycle summary (Step 27 carry-forward). NULL when the
  // athlete has no completed logs against any prior program. Soft-fails
  // to null on error — carry-forward is informational, not a hard
  // requirement for program generation.
  let previous_cycle: PreviousCycleSummary | null = null;
  try {
    const { data: prev } = await supa.rpc("user_previous_cycle_summary", {
      target_user_id: userId,
    });
    if (prev) previous_cycle = prev as PreviousCycleSummary;
  } catch (err) {
    console.warn(
      `[build-writer-payload] user_previous_cycle_summary failed for ${userId}:`,
      err,
    );
  }

  // 3c. Coaching evaluations — GENERATOR ONLY (includeEvaluations). Both
  // soft-fail to null — a missing evaluation never blocks generation (same
  // contract as previous_cycle).
  //   - profile_evaluation: latest COMPLETE profile eval narrative. Read on
  //     every generation; the athlete's profile/eval can change between cycles.
  //   - training_evaluation: latest training eval narrative — continuation only
  //     (month >= 2). Month 1 has no training history to review.
  let profile_evaluation: string | null = null;
  let training_evaluation: string | null = null;
  if (includeEvaluations) {
    try {
      const { data: pe } = await supa
        .from("profile_evaluations")
        .select("analysis")
        .eq("user_id", userId)
        .eq("status", "complete")
        .not("analysis", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pe?.analysis) profile_evaluation = pe.analysis as string;
    } catch (err) {
      console.warn(`[build-writer-payload] profile_evaluations read failed for ${userId}:`, err);
    }

    if (monthNumber >= 2) {
      try {
        const { data: te } = await supa
          .from("training_evaluations")
          .select("analysis")
          .eq("user_id", userId)
          .not("analysis", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (te?.analysis) training_evaluation = te.analysis as string;
      } catch (err) {
        console.warn(`[build-writer-payload] training_evaluations read failed for ${userId}:`, err);
      }
    }
  }

  // 3d. Engine training context — GENERATOR ONLY, evidence-gated (see
  // EngineTrainingPayload). Soft-fails to null: Engine awareness is
  // informational shading, never a generation dependency.
  let engine_training: EngineTrainingPayload | null = null;
  if (includeEngineTraining) {
    try {
      engine_training = await fetchEngineTraining(supa, userId, profile);
    } catch (err) {
      console.warn(`[build-writer-payload] engine training fetch failed for ${userId}:`, err);
    }
  }

  // 4. Hydrate JSONB blobs to complete canonical-key maps. We need
  // these before the RAG call (it consumes lifts + skills directly).
  const lifts: Record<string, number | null> = {};
  for (const k of ALL_LIFT_KEYS) {
    lifts[k] = asLiftValue((profile.lifts ?? {})[k]);
  }

  // Snake_case-keyed map for the RAG builder (which expects to walk
  // canonical keys and apply its own name transforms).
  const skillsBySnakeKey: Record<string, SkillLevel | null> = {};
  for (const k of ALL_SKILL_KEYS) {
    skillsBySnakeKey[k] = asSkillLevel((profile.skills ?? {})[k]);
  }

  // Display-name-keyed map for the writer payload — the LLM reads
  // "Strict Pull-Ups" / "HSPU" / "L-Sit" directly instead of having
  // to translate from snake_case.
  const skills: Record<string, SkillLevel | null> = {};
  for (const k of ALL_SKILL_KEYS) {
    const displayName = SKILL_DISPLAY_NAMES[k] ?? k;
    skills[displayName] = skillsBySnakeKey[k];
  }

  // 5. RAG — RETIRED from generation (2026-08-11). The v1 reference block was
  // built here for three months with no v3 consumer (skeleton/fill never read
  // payload.rag). Example anchoring now lives in the metcon composer's
  // stratified retrieval (metcon-examples.ts). Field kept for type compat.
  const rag = "";

  // 6. Hydrate the remaining JSONB blobs.
  const conditioning: Record<string, string | number | null> = {};
  for (const k of ALL_CONDITIONING_KEYS) {
    conditioning[k] = asConditioningValue((profile.conditioning ?? {})[k]);
  }

  // Equipment normalization + the do-not-program merge live in
  // computeMergedAvoidance — shared with AI-Edit (adjust-workout) so the
  // generate and edit paths enforce the identical avoidance rule. See the
  // helper's doc for the confirmed-list hash gate and blocked_by provenance.
  const { equipment, injuries_structured: mergedInjuriesStructured } =
    computeMergedAvoidance(profile);

  // 7. Athlete Model (coaching-state Step 1) — compute the deterministic
  // fact-sheet, persist an immutable version (append-only-on-change), and
  // attach it for the LLM stages. Persistence is BEST-EFFORT: a failure must
  // never block generation, so we fall back to an unpersisted version-0 model
  // (same soft contract as previous_cycle / evaluations). Both the eval and
  // the generator build this payload, so both consume the same fact-sheet.
  const profileStatic = profileStaticFromRow(profile);
  // Step 4: observed training evidence (best-effort; empty summary when there
  // are no logs → the Model stays intake-based, no-penalty). Window is relative
  // to NOW (current training picture).
  const todayISO = new Date().toISOString().slice(0, 10);
  const trainingSummary = await buildTrainingSummary(supa, userId, todayISO);
  // Athlete-logged outside training (best-effort; null when none) — becomes
  // the Model's outside_training facts section for CoachState's load/recovery
  // judgment. Never a capability source.
  const outsideTraining = await fetchOutsideTraining(supa, userId)
    .then(buildOutsideTrainingFacts)
    .catch((err) => {
      console.warn(`[build-writer-payload] outside training fetch failed for ${userId}:`, err);
      return null;
    });
  // Persist a versioned snapshot (best-effort) — powers the "what changed in
  // training" diff. Skip empty summaries (no logs) so non-loggers don't get rows.
  if (trainingSummary.sessions_logged > 0) {
    try {
      await persistTrainingSummary(supa, userId, trainingSummary);
    } catch (err) {
      console.warn(`[build-writer-payload] training summary persist failed for ${userId}:`, err);
    }
  }
  const modelContent = buildAthleteModel(profileStatic, competition, {
    asOf: asString(profile.updated_at),
    trainingSummary,
    loggedCompetitionResults: loggedResults,
    coachingIntake: profile.coaching_intake ?? null,
    outsideTraining,
  });
  let athlete_model: AthleteModel = {
    ...modelContent,
    version: 0,
    profile_version: 0,
    created_at: new Date().toISOString(),
  };
  try {
    const persisted = await persistAthleteModel(supa, userId, modelContent, profileStatic);
    athlete_model = persisted.model;
  } catch (err) {
    console.warn(
      `[build-writer-payload] athlete model persistence failed for ${userId} (using unpersisted v0):`,
      err,
    );
  }

  return {
    basics: {
      age: asNumber(profile.age),
      height: asNumber(profile.height),
      bodyweight: asNumber(profile.bodyweight),
      gender: asString(profile.gender),
      units: asUnits(profile.units),
    },
    lifts,
    skills,
    conditioning,
    equipment,
    training_context: {
      days_per_week: clampDaysPerWeek(profile.days_per_week),
      session_length_minutes: asNumber(profile.session_length_minutes),
      goal_text: asString(profile.goal),
      injuries_constraints_text: asString(profile.injuries_constraints),
      injuries_structured: mergedInjuriesStructured,
      self_perception_level: asString(profile.self_perception_level),
    },
    athlete_model,
    competition,
    performance_grid: gridCompetition || gridTraining
      ? { competition: gridCompetition, training: gridTraining }
      : null,
    engine_training,
    previous_cycle,
    vocabulary,
    profile_evaluation,
    training_evaluation,
    rag,
  };
}

// ============================================================
// Engine training context (2026-10 Engine-awareness contract)
// ============================================================

// Legacy version strings → current program ids (mirrors engineService.ts).
const ENGINE_VERSION_ALIASES: Record<string, string> = {
  "5-day": "main_5day",
  "3-day": "main_3day",
};

/** Build EngineTrainingPayload, or null per the evidence ladder:
 *  no entitlement → null; no track → null; fewer than 2 completed sessions
 *  in the trailing 28 days, or the latest older than 21 days → null (the
 *  silent-weeks decay). Only completed sessions ever shade programming —
 *  never the subscription or the track choice alone. */
async function fetchEngineTraining(
  supa: SupabaseClient,
  userId: string,
  profile: AthleteProfileRow,
): Promise<EngineTrainingPayload | null> {
  const rawTrack = asString(profile.engine_program_version);
  if (!rawTrack) return null;
  const track = ENGINE_VERSION_ALIASES[rawTrack] ?? rawTrack;

  const entitled = await checkEntitlement(supa, userId, "engine");
  if (!entitled) return null;

  // Completed sessions, trailing 28 days — ALL tracks. Completed Engine
  // work is real training load regardless of which track served it.
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  const { data: sessRows } = await supa
    .from("engine_workout_sessions")
    .select("date, day_type, program_day_number")
    .eq("user_id", userId)
    .eq("completed", true)
    .gte("date", since)
    .order("date", { ascending: false });
  type SessRow = { date: string; day_type: string | null; program_day_number: number | null };
  const sessions = (sessRows ?? []) as SessRow[];

  if (sessions.length < 2) return null;
  const latestMs = new Date(`${sessions[0].date}T00:00:00Z`).getTime();
  if (!Number.isFinite(latestMs) || Date.now() - latestMs > 21 * 86_400_000) return null;

  // Session minutes come from the catalog (program_day_number is a catalog
  // content reference into the main_5day-keyed 720-day table), with the
  // day type's default duration as fallback. AI self-sequencer override
  // days may miss both — computeTimeInZone skips (and counts) those
  // rather than guessing.
  const sessionDayNums = [
    ...new Set(
      sessions
        .map((s) => s.program_day_number)
        .filter((n): n is number => typeof n === "number"),
    ),
  ];
  type CatalogRow = { day_number: number; day_type: string | null; total_duration_minutes: number | null };
  const catalogByDay = new Map<number, CatalogRow>();
  if (sessionDayNums.length > 0) {
    const { data: cat } = await supa
      .from("engine_workouts")
      .select("day_number, day_type, total_duration_minutes")
      .eq("program_type", "main_5day")
      .in("day_number", sessionDayNums);
    for (const w of (cat ?? []) as CatalogRow[]) catalogByDay.set(w.day_number, w);
  }
  const { data: dtRows } = await supa
    .from("engine_day_types")
    .select("id, max_duration_minutes");
  const defaultMinutes = new Map<string, number | null>(
    ((dtRows ?? []) as Array<{ id: string; max_duration_minutes: number | null }>)
      .map((d) => [d.id, d.max_duration_minutes]),
  );
  const minutesFor = (dayType: string | null, cat: CatalogRow | undefined): number | null => {
    if (typeof cat?.total_duration_minutes === "number") return cat.total_duration_minutes;
    const fallback = dayType != null ? defaultMinutes.get(dayType) : null;
    return typeof fallback === "number" ? fallback : null;
  };

  const observed = sessions.map((s) => {
    const cat = s.program_day_number != null ? catalogByDay.get(s.program_day_number) : undefined;
    const dayType = s.day_type ?? cat?.day_type ?? null;
    return { dayType, minutes: minutesFor(dayType, cat) };
  });
  const trailing = computeTimeInZone(observed);
  const cadencePerWeek = sessions.length / 4;

  // Upcoming: the FIXED catalog from the athlete's current sequence
  // position, as many days as the observed cadence projects over 4 weeks.
  // Sequence-identity: engine_current_day is a program sequence position;
  // the mapping resolves it to catalog content.
  const projected = Math.min(24, Math.max(1, Math.round(cadencePerWeek * 4)));
  const startPos =
    typeof profile.engine_current_day === "number" && profile.engine_current_day >= 1
      ? profile.engine_current_day
      : 1;
  const { data: mapRows } = await supa
    .from("engine_program_mapping")
    .select("program_sequence_order, engine_workout_day_number")
    .eq("engine_program_id", track)
    .gte("program_sequence_order", startPos)
    .order("program_sequence_order")
    .limit(projected);
  const mapping = (mapRows ?? []) as Array<{ program_sequence_order: number; engine_workout_day_number: number }>;

  const upcomingDayNums = [...new Set(mapping.map((m) => m.engine_workout_day_number))]
    .filter((n) => !catalogByDay.has(n));
  if (upcomingDayNums.length > 0) {
    const { data: cat } = await supa
      .from("engine_workouts")
      .select("day_number, day_type, total_duration_minutes")
      .eq("program_type", "main_5day")
      .in("day_number", upcomingDayNums);
    for (const w of (cat ?? []) as CatalogRow[]) catalogByDay.set(w.day_number, w);
  }
  const upcomingDays = mapping
    .map((m) => catalogByDay.get(m.engine_workout_day_number))
    .filter((w): w is CatalogRow => w != null && w.day_type != null)
    .map((w) => ({
      day_type: w.day_type as string,
      minutes: minutesFor(w.day_type, w),
      zones: zonesTouched(w.day_type as string) as string[],
    }));
  const upcoming = computeTimeInZone(
    upcomingDays.map((d) => ({ dayType: d.day_type, minutes: d.minutes })),
  );

  return {
    track,
    goal: asString(profile.engine_goal),
    trailing_28_days: {
      sessions: sessions.length,
      cadence_per_week: Math.round(cadencePerWeek * 10) / 10,
      minutes_counted: trailing.minutesCounted,
      time_in_zone_minutes: trailing.zones,
    },
    upcoming_4_weeks: {
      projected_sessions: projected,
      days: upcomingDays,
      time_in_zone_minutes: upcoming.zones,
    },
  };
}
