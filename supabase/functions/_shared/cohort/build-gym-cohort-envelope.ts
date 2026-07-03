/**
 * cohort/build-gym-cohort-envelope.ts — the minimal gym-level payload builder.
 *
 * Task #5 (cohort program wiring): turns a small gym-level cohort config into the
 * Engine's cohort envelope — `{ shared_payload, shared_training_design_input }` —
 * that `engine-generate` (mode: "cohort") consumes to generate the ONE shared
 * class program. Per-member scaling then rides each member's own numbers (see
 * build-cohort-roster.ts); the shared program is written for a REFERENCE class
 * target, not any individual.
 *
 * PURE + DB-FREE (so it is unit-testable): the caller passes the movement
 * `vocabulary` (a `movements` display_name list), a `nowIso`, and (optionally) a
 * pre-built `rag` methodology block. It reuses the real deterministic layer —
 * `buildAthleteModel` (facts) — so the shared program is generated from exactly the
 * same input shapes as retail, not a parallel path that could drift.
 *
 * The class target is a REFERENCE athlete derived from the CANONICAL strength tables
 * (`THRESHOLDS_V1` in athlete-model.ts) scaled by target_level — one source of truth,
 * self-consistent with the inter-lift ratios buildAthleteModel checks (so the
 * reference athlete never ratio-flags itself). No fabricated fourth standards table.
 *
 * DEBT (filed to #548, with the #547 ruleRecap items): the shared-class coaching
 * STRATEGY below (conditioning-forward, deprioritize olympic_lifting) is CrossFit
 * coaching judgment living in the Engine-side surface. When domain_pack becomes
 * genuinely multi-sport, this strategy belongs ON the pack (a `cohortStrategy` seam),
 * not hardcoded here — same altitude problem as ruleRecap. Tracked, not yet moved.
 */

import type { WriterPayload } from "../build-writer-payload.ts";
import {
  ALL_CONDITIONING_KEYS,
  ALL_EQUIPMENT_KEYS,
  ALL_LIFT_KEYS,
  ALL_SKILL_KEYS,
} from "../tier-status.ts";
import {
  type AthleteModel,
  type AthleteProfileStatic,
  buildAthleteModel,
  THRESHOLDS_V1,
} from "../athlete-model.ts";
import type { TrainingDesignInput } from "../training-design-input.ts";

export type CohortTargetLevel = "beginner" | "intermediate" | "advanced";

/** The minimal gym-level cohort spec. Assembled from the gym's class config
 *  (affiliate side: equipment inventory, class days/length) — the affiliate
 *  passes these; this builder turns them into the Engine envelope. */
export interface GymCohortConfig {
  days_per_week: 3 | 4 | 5 | 6;
  session_length_minutes: number | null;
  /** Canonical equipment keys the gym floor has (ALL_EQUIPMENT_KEYS subset). */
  equipment: string[];
  target_level: CohortTargetLevel;
  /** Class-level banned movements (canonical display names). */
  do_not_program: string[];
  units: "lbs" | "kg";
  /** Optional class intent, shown to the writer as the goal. */
  goal_text?: string | null;
}

// Reference bodyweight for the class target (only used to derive reference loads
// so the shared program's %s land sensibly; per-member scaling uses real numbers).
const REFERENCE_BODYWEIGHT: Record<"lbs" | "kg", number> = { lbs: 170, kg: 77 };

// target_level scales the canonical back-squat/relative-strength bars. A pure level
// scaler (NOT a strength-standards table) — tunable without conflicting with anything.
const LEVEL_FACTOR: Record<CohortTargetLevel, number> = {
  beginner: 0.62, intermediate: 0.84, advanced: 1.08,
};

/**
 * Reference class-target 1RMs, derived from the CANONICAL tables (THRESHOLDS_V1):
 * anchor on the back-squat relative-strength bar × level, then derive the squat/oly
 * family from the canonical inter-lift ratios so the reference athlete is
 * self-consistent (buildAthleteModel won't ratio-flag it). press/bench come from the
 * relative-strength bars; lifts with no canonical anchor stay null. Exported so the
 * cron can build the RAG methodology block from the same reference lifts.
 */
export function cohortReferenceLifts(
  level: CohortTargetLevel,
  units: "lbs" | "kg",
): Record<string, number | null> {
  const bw = REFERENCE_BODYWEIGHT[units];
  const f = LEVEL_FACTOR[level];
  const rel = THRESHOLDS_V1.relative_strength.men; // gender-neutral anchor (class target has no gender)
  const r = THRESHOLDS_V1.ratios;
  const round5 = (n: number) => Math.round(n / 5) * 5;

  const out: Record<string, number | null> = {};
  for (const k of ALL_LIFT_KEYS) out[k] = null;

  const backSquat = round5(bw * rel.back_squat * f);
  out.back_squat = backSquat;
  out.deadlift = round5(backSquat * r.deadlift_to_back_squat);
  out.front_squat = round5(backSquat * r.front_squat_to_back_squat);
  out.snatch = round5(backSquat * r.snatch_to_back_squat);
  out.clean_and_jerk = round5(backSquat * r.clean_jerk_to_back_squat);
  out.overhead_squat = round5((out.snatch ?? 0) * r.overhead_squat_to_snatch);
  out.press = round5(bw * rel.press * f);
  out.bench_press = round5(bw * rel.bench * f);
  return out;
}

function equipmentMap(present: string[]): Record<string, boolean> {
  const set = new Set(present);
  const out: Record<string, boolean> = {};
  for (const k of ALL_EQUIPMENT_KEYS) out[k] = set.has(k);
  return out;
}

/** Build the reference class-target profile (deterministic; no DB). */
function referenceProfile(config: GymCohortConfig): AthleteProfileStatic {
  const skills: Record<string, null> = {};
  for (const k of ALL_SKILL_KEYS) skills[k] = null; // neutral — the class isn't skill-gated
  const conditioning: Record<string, null> = {};
  for (const k of ALL_CONDITIONING_KEYS) conditioning[k] = null;
  return {
    age: null,
    bodyweight: REFERENCE_BODYWEIGHT[config.units],
    gender: null, // gender-neutral target; per-member scaling carries real gender
    height: null,
    units: config.units,
    lifts: cohortReferenceLifts(config.target_level, config.units),
    skills,
    conditioning,
    equipment: equipmentMap(config.equipment),
  };
}

/**
 * The fixed, deterministic coaching strategy for a shared Engine Class, as the
 * execution-layer projection (TrainingDesignInput) directly — no fabricated
 * intermediate CoachState, since none of its narrative/evidence fields survive the
 * projection. Conditioning-forward, balanced strength kept alive; NOT individually
 * adaptive (the differentiation guard — GYM_SKU_SPEC §1).
 *
 * DEBT (#548): this is CrossFit coaching judgment; it belongs on the domain pack
 * when the Engine goes genuinely multi-sport (see file header).
 */
function cohortTrainingDesign(
  config: GymCohortConfig,
  lifts: Record<string, number | null>,
): TrainingDesignInput {
  return {
    priorities: [
      { focus: "mixed_modal_conditioning", rank: 1, confidence: "medium" },
      { focus: "aerobic_capacity", rank: 2, confidence: "medium" },
      { focus: "anaerobic_capacity", rank: 3, confidence: "medium" },
    ],
    maintain: ["posterior_chain", "upper_body_pressing"],
    deprioritize: ["olympic_lifting", "skill_coordination"],
    recovery_stance: "standard",
    strength_emphasis: "balanced",

    days_per_week: config.days_per_week,
    session_length_minutes: config.session_length_minutes,
    equipment: equipmentMap(config.equipment),
    do_not_program: config.do_not_program,
    vocabulary: [], // set by the caller path via the shared_payload; tdi copy filled below
    lifts,
    previous_cycle: null,

    coach_state_version: 0,
    athlete_model_version: 0,
  };
}

export interface BuildGymCohortEnvelopeResult {
  shared_payload: WriterPayload;
  shared_training_design_input: TrainingDesignInput;
}

export interface BuildGymCohortEnvelopeOptions {
  /** Pre-built RAG methodology block (the cron builds it from cohortReferenceLifts
   *  so this stays pure/DB-free). Omit = "" (tests). */
  rag?: string;
}

/**
 * Build the cohort envelope from a gym config + the movement vocabulary (a
 * `movements` display_name list the caller fetched). Pure — pass `nowIso` for
 * the athlete_model timestamp so the result is deterministic in tests.
 */
export function buildGymCohortEnvelope(
  config: GymCohortConfig,
  vocabulary: string[],
  nowIso: string,
  opts: BuildGymCohortEnvelopeOptions = {},
): BuildGymCohortEnvelopeResult {
  const profile = referenceProfile(config);
  const modelContent = buildAthleteModel(profile, null);
  const athlete_model: AthleteModel = {
    ...modelContent,
    version: 0,
    profile_version: 0,
    created_at: nowIso,
  };

  const shared_payload: WriterPayload = {
    basics: {
      age: null,
      height: null,
      bodyweight: profile.bodyweight,
      gender: null,
      units: config.units,
    },
    lifts: profile.lifts,
    skills: Object.fromEntries(ALL_SKILL_KEYS.map((k) => [k, null])),
    conditioning: Object.fromEntries(ALL_CONDITIONING_KEYS.map((k) => [k, null])),
    equipment: profile.equipment,
    training_context: {
      days_per_week: config.days_per_week,
      session_length_minutes: config.session_length_minutes,
      goal_text: config.goal_text ?? "Shared gym Engine Class — build a broad, durable engine.",
      injuries_constraints_text: null,
      injuries_structured: config.do_not_program.length > 0
        ? { summary: "Class-level movement exclusions.", do_not_program: config.do_not_program, suggested_subs: [] }
        : null,
      self_perception_level: config.target_level,
    },
    athlete_model,
    competition: null,
    previous_cycle: null,
    vocabulary,
    profile_evaluation: null,
    training_evaluation: null,
    rag: opts.rag ?? "",
  };

  const shared_training_design_input: TrainingDesignInput = {
    ...cohortTrainingDesign(config, profile.lifts),
    vocabulary, // the week-fill's allowed-movement set
  };

  return { shared_payload, shared_training_design_input };
}
