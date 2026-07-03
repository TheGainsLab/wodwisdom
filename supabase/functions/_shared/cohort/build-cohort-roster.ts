/**
 * cohort/build-cohort-roster.ts — the cohort roster builder.
 *
 * Turns each active gym member's attributes — sourced from the ONE PROFILE
 * (`athlete_profiles`, Decision 1: attributes live only there, every surface reads
 * it) — into the slim `AthleteInput` the cohort scaler consumes. The cron reads the
 * profile and passes a CohortMemberIntake per member; this maps it.
 *
 * `computeCohortScaling` reads ONLY `payload.lifts`, `payload.basics.{units,gender}`,
 * and `training_context.injuries_structured.do_not_program` per member — so this
 * populates exactly those from real member data and fills the rest of the
 * (contract-required) WriterPayload + TrainingDesignInput with cheap, valid
 * defaults. The full per-member payload is contract debt the phase report already
 * flagged (a slim CohortMemberInput is the #548 follow-up); until then this keeps
 * the request type-valid without inventing per-member facts the scaler never reads.
 *
 * PURE + DB-FREE (unit-testable): the caller loads the intakes; this maps them.
 */

import { asLiftValue, type WriterPayload } from "../build-writer-payload.ts";
import { ALL_CONDITIONING_KEYS, ALL_EQUIPMENT_KEYS, ALL_LIFT_KEYS, ALL_SKILL_KEYS } from "../tier-status.ts";
import { type AthleteModel, buildAthleteModel } from "../athlete-model.ts";
import type { TrainingDesignInput } from "../training-design-input.ts";
import type { AthleteInput } from "../engine/contract.ts";

/** One member's light intake (from member_gym_links.engine_intake + the join). */
export interface CohortMemberIntake {
  /** Opaque cross-surface id — the member's wodwisdom user id. */
  athlete_ref: string;
  gender?: string | null;
  bodyweight?: number | null;
  units?: "lbs" | "kg" | null;
  /** Canonical lift-key → 1RM. Missing/unknown lifts simply don't resolve a weight. */
  lifts?: Record<string, number | null> | null;
  /** The member's contraindicated movements (canonical display names). */
  do_not_program?: string[] | null;
}

function hydrateLifts(raw: Record<string, number | null> | null | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  // Reuse retail's asLiftValue so a member's resolved weights follow the exact same
  // coercion rule (zero / negative / non-finite → null).
  for (const k of ALL_LIFT_KEYS) out[k] = asLiftValue(raw?.[k]);
  return out;
}

// A valid-but-empty tdi. The cohort scaler never reads a member's tdi (only the
// SHARED program's), but AthleteInput requires the field.
const EMPTY_TDI: TrainingDesignInput = {
  priorities: [], maintain: [], deprioritize: [],
  recovery_stance: "standard", strength_emphasis: "balanced",
  days_per_week: 5, session_length_minutes: null,
  equipment: {}, do_not_program: [], vocabulary: [], lifts: {},
  previous_cycle: null, coach_state_version: 0, athlete_model_version: 0,
};

const EMPTY_EQUIPMENT: Record<string, boolean> = Object.fromEntries(ALL_EQUIPMENT_KEYS.map((k) => [k, false]));
const NULL_SKILLS = Object.fromEntries(ALL_SKILL_KEYS.map((k) => [k, null]));
const NULL_CONDITIONING = Object.fromEntries(ALL_CONDITIONING_KEYS.map((k) => [k, null]));

/**
 * Build the cohort roster (one slim AthleteInput per member). `nowIso` stamps the
 * per-member athlete_model (deterministic in tests).
 */
export function buildCohortRoster(members: CohortMemberIntake[], nowIso: string): AthleteInput[] {
  // Dedupe by athlete_ref (first wins) — a duplicate ref would collide on
  // engine_member_scaling's UNIQUE(cohort_program_id, athlete_ref) and 500 AFTER
  // the paid generation. member_gym_links is UNIQUE(user_id, gym_id) so this is a
  // belt-and-suspenders guard against a caller passing the same member twice.
  const seen = new Set<string>();
  const unique = members.filter((m) => {
    if (!m.athlete_ref || seen.has(m.athlete_ref)) return false;
    seen.add(m.athlete_ref);
    return true;
  });
  return unique.map((m) => {
    const units: "lbs" | "kg" = m.units ?? "lbs";
    const lifts = hydrateLifts(m.lifts);
    const doNotProgram = (m.do_not_program ?? []).map((s) => String(s).trim()).filter(Boolean);

    const modelContent = buildAthleteModel(
      {
        age: null, bodyweight: m.bodyweight ?? null, gender: m.gender ?? null,
        height: null, units, lifts, skills: NULL_SKILLS, conditioning: NULL_CONDITIONING,
        equipment: EMPTY_EQUIPMENT,
      },
      null,
    );
    const athlete_model: AthleteModel = { ...modelContent, version: 0, profile_version: 0, created_at: nowIso };

    const payload: WriterPayload = {
      basics: { age: null, height: null, bodyweight: m.bodyweight ?? null, gender: m.gender ?? null, units },
      lifts,
      skills: NULL_SKILLS,
      conditioning: NULL_CONDITIONING,
      equipment: EMPTY_EQUIPMENT,
      training_context: {
        days_per_week: 5,
        session_length_minutes: null,
        goal_text: null,
        injuries_constraints_text: null,
        injuries_structured: doNotProgram.length > 0
          ? { summary: "Member movement exclusions.", do_not_program: doNotProgram, suggested_subs: [] }
          : null,
        self_perception_level: null,
      },
      athlete_model,
      competition: null,
      previous_cycle: null,
      vocabulary: [],
      profile_evaluation: null,
      training_evaluation: null,
      rag: "",
    };

    return { athlete_ref: m.athlete_ref, payload, training_design_input: EMPTY_TDI };
  });
}
