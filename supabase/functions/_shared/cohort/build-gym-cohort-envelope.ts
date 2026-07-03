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
 * `vocabulary` (a `movements` display_name list) and a `nowIso`. It reuses the
 * real deterministic layers — `buildAthleteModel` (facts) and
 * `buildTrainingDesignInput` (the judgment→execution projection) — so the shared
 * program is generated from exactly the same input shapes as retail, not a
 * parallel path that could drift.
 *
 * The class target is a REFERENCE athlete derived transparently from a reference
 * bodyweight × per-lift strength-standard multipliers, scaled by target_level —
 * a tunable method, not fabricated absolute numbers. The coaching strategy is a
 * fixed, deterministic "shared conditioning class" default (GYM_SKU_SPEC §1: the
 * Engine Class is a cardio/mixed-modal class, NOT individually adaptive), so no
 * LLM coach-state call is needed for the cohort target.
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
} from "../athlete-model.ts";
import {
  type CoachState,
  type FocusArea,
} from "../coach-state.ts";
import {
  buildTrainingDesignInput,
  type TrainingDesignInput,
} from "../training-design-input.ts";

export type CohortTargetLevel = "beginner" | "intermediate" | "advanced";

/** The minimal gym-level cohort spec. Assembled from the gym's class config
 *  (affiliate side: equipment inventory, class days/length) — the affiliate
 *  passes these; this builder turns them into the Engine envelope. */
export interface GymCohortConfig {
  /** Gym tenant id (affiliate community id) — echoed as the request tenant_id. */
  tenant_id: string;
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

// Intermediate strength standards as bodyweight multiples (× bodyweight), scaled
// by level below. Transparent + tunable (not fabricated absolutes).
const LIFT_BW_MULTIPLIER: Record<string, number> = {
  back_squat: 1.6, front_squat: 1.3, overhead_squat: 0.9, deadlift: 2.0,
  snatch: 0.9, power_snatch: 0.78, clean: 1.2, clean_and_jerk: 1.15, jerk: 1.2,
  power_clean: 1.08, push_jerk: 1.08, press: 0.68, push_press: 0.9, bench_press: 1.2,
};
const LEVEL_FACTOR: Record<CohortTargetLevel, number> = {
  beginner: 0.72, intermediate: 1.0, advanced: 1.28,
};

function referenceLifts(level: CohortTargetLevel, units: "lbs" | "kg"): Record<string, number | null> {
  const bw = REFERENCE_BODYWEIGHT[units];
  const factor = LEVEL_FACTOR[level];
  const out: Record<string, number | null> = {};
  for (const k of ALL_LIFT_KEYS) {
    const mult = LIFT_BW_MULTIPLIER[k];
    out[k] = mult != null ? Math.round((bw * mult * factor) / 5) * 5 : null;
  }
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
    lifts: referenceLifts(config.target_level, config.units),
    skills,
    conditioning,
    equipment: equipmentMap(config.equipment),
  };
}

/**
 * The fixed, deterministic coaching strategy for a shared Engine Class: a
 * conditioning-forward, balanced-strength "keep everyone moving" posture. No
 * per-athlete judgment (the differentiation guard: the class is NOT individually
 * adaptive — GYM_SKU_SPEC §1). Confidence is "medium" — a sensible default, not
 * evidence-derived. Only allocation-relevant fields matter downstream (the tdi
 * projection drops the narrative fields), but they are filled for a valid shape.
 */
function cohortCoachState(nowIso: string): CoachState {
  const dev = (focus: FocusArea, rank: number): CoachState["priorities"][number] => ({
    focus, rank, confidence: "medium",
    reasons: ["supports_stated_goal", "highest_expected_roi"],
    evidence: [],
    athlete_facing_rationale: "A shared conditioning class develops engine across modalities.",
    recommended_action: "Program mixed-modal conditioning with progressive aerobic and anaerobic exposure.",
  });
  return {
    coach_state_builder_version: "cohort-default-v1",
    headline: "Build a broad, durable engine as a class.",
    summary: "Shared Engine Class: conditioning-forward, mixed-modal, with balanced strength kept alive. Not individually adaptive — the shared path is scaled to each member's numbers.",
    priorities: [
      dev("mixed_modal_conditioning", 1),
      dev("aerobic_capacity", 2),
      dev("anaerobic_capacity", 3),
    ],
    maintain: [
      { focus: "posterior_chain", reasons: ["already_at_standard"], athlete_facing_rationale: "Keep foundational strength alive." },
      { focus: "upper_body_pressing", reasons: ["already_at_standard"], athlete_facing_rationale: "Maintain pressing capacity." },
    ],
    deprioritize: [
      { focus: "olympic_lifting", reasons: ["recovery_budget_limited"] },
      { focus: "skill_coordination", reasons: ["not_goal_relevant"] },
    ],
    recovery_posture: { stance: "standard", confidence: "medium", reasons: [] },
    strength_emphasis: { value: "balanced", confidence: "medium", reasons: [] },
    // Persistence-assigned fields — sentinels for the unpersisted cohort default.
    version: 0,
    athlete_id: "cohort-default",
    created_at: nowIso,
    athlete_model_version: 0,
    cycle_pointer: null,
  };
}

export interface BuildGymCohortEnvelopeResult {
  shared_payload: WriterPayload;
  shared_training_design_input: TrainingDesignInput;
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
    rag: "",
  };

  const shared_training_design_input = buildTrainingDesignInput(cohortCoachState(nowIso), {
    days_per_week: config.days_per_week,
    session_length_minutes: config.session_length_minutes,
    equipment: profile.equipment,
    do_not_program: config.do_not_program,
    vocabulary,
    lifts: profile.lifts,
    previous_cycle: null,
  });

  return { shared_payload, shared_training_design_input };
}
