/**
 * coach-state.ts
 *
 * Step 2 of the coaching-state architecture (see memory:
 * coaching-state-architecture). The JUDGMENT layer.
 *
 * CoachState is the coach's CURRENT BELIEFS about an athlete — the typed
 * decisions (what to develop / maintain / deprioritize, recovery posture,
 * strength emphasis) made ONCE, from the deterministic Athlete Model (Step 1).
 * It is the object the program generator + the athlete-facing eval both
 * consume, so eval and program align by construction.
 *
 * LOCKED PRINCIPLE (structural, not just prose):
 *   CoachState may ONLY reference the Athlete Model — it NEVER computes new
 *   facts. Enforced by construction: there are NO numeric fact fields here.
 *   Decisions point at Athlete Model keys via `evidence: AthleteModelKey[]`
 *   (compiler-checked). The only free text is athlete-facing rationale, which
 *   the prompt constrains to cite Athlete Model values verbatim, never derive.
 *
 * Named CoachState (not CoachingStrategy): the object is beliefs, not just
 * strategy (recovery_posture / maintain are judgments). The name leaves room
 * for additive fields later — confidence, assumptions, unknowns, projections.
 *
 * This file holds the typed contract (types + enums + the EMIT tool schema +
 * the deterministic projection to the legacy EvaluationOutput). The system
 * prompt lives in coach-state-prompt.ts.
 */

import { type AthleteModelKey, NORMATIVE_KEYS } from "./athlete-model.ts";
import type { EvaluationOutput } from "./v2-output-schema.ts";

/** A reference into the Athlete Model. The known strength normative keys
 *  (AthleteModelKey) keep autocomplete + typo-protection; competition-movement
 *  keys (Step 1.5) are athlete-specific, so the type is widened to string while
 *  the per-call tool enum (buildEmitCoachStateTool) enforces validity at runtime. */
export type EvidenceKey = AthleteModelKey | (string & {});

// Bump on any prompt/schema/logic change — a bump triggers a NEW CoachState
// version on recompute (same as an input change).
// v1.1 (Step 1.5): prompt + evidence enum now include competition_movements,
// so gymnastics/midline/skill priorities carry typed movement evidence.
// v1.2: permanent "weigh evidence by confidence" rule (today: don't anchor on
// n=1 competition movements; a priority's confidence reflects its weakest
// evidence). Heuristic-only — no schema change.
// v1.3: athlete-facing prose must use plain coach language — no internal field
// keys (bench_to_bodyweight) or system terms (normative model / position) in
// headline/summary/rationale/recommended_action. Prompt-only.
// v1.4 (Step 4): the Athlete Model is now training-aware (capabilities carry
// source="observed" + capability_revisions). Prompt + reason codes
// (observed_progress / observed_plateau / low_adherence) let CoachState reason
// from that evidence.
export const COACH_STATE_BUILDER_VERSION = "v1.4";

// ============================================================
// Controlled vocabularies — LOCKED v1 (DATA, versioned with the schema;
// adding one later is a value change, not a migration). The model can only
// emit these (enforced via the tool-schema enums below), so strategies stay
// comparable across athletes + over time.
//
// DESIGN PRINCIPLE: FocusArea = the development AXIS. The "why" (it's a
// competition gate, a modality gap, a time-domain hole) lives in ReasonCode,
// NOT in a separate focus. That keeps focus at axis-altitude (picking the
// actual movement is Training Design's job downstream).
// ============================================================

/** The trainable development axes. Every ALL_SKILL_KEYS skill maps to exactly
 *  one gymnastics/skill axis; conditioning is energy-system, not modality. */
export const FOCUS_AREAS = [
  // strength / lifting
  "olympic_lifting",
  "powerlifting_strength",
  "posterior_chain",
  "upper_body_pressing",
  // gymnastics / skill (pulling = pull-ups/MUs/T2B/rope; pressing = HSPU/dips/
  // wall walks; midline = GHD/L-sit; skill_coordination = DU/pistols/HS walk)
  "gymnastics_pulling",
  "gymnastics_pressing",
  "midline",
  "skill_coordination",
  // conditioning (energy systems; modality/time-domain carried by ReasonCode)
  "aerobic_capacity",
  "anaerobic_capacity",
  "mixed_modal_conditioning",
] as const;
export type FocusArea = typeof FOCUS_AREAS[number];

export const REASON_CODES = [
  // GAP / weakness signals
  "largest_competition_gap",
  "below_relative_strength_floor",
  "oly_imbalance",
  "posterior_chain_imbalance",
  "upper_lower_imbalance",
  "time_domain_weakness",
  "modality_coverage_gap",
  "skill_gate_risk",
  "low_skill_proficiency", // self-reported; the ONLY gymnastics gap signal for
  //                           an unlinked athlete → its priority confidence is
  //                           usually "low" (that's what the field is for).
  // PRIORITIZATION (why this, why now)
  "highest_expected_roi",
  "foundational_prerequisite",
  "supports_stated_goal",
  "low_recovery_cost",
  // MAINTAIN / DEPRIORITIZE justification
  "already_at_standard",
  "not_goal_relevant",
  "recovery_budget_limited",
  // RECOVERY-posture modulation
  "masters_age",
  "recent_competition",
  "high_prior_load",
  "injury_constraint",
  // OBSERVED training signals (Step 4 — from the synthesized Athlete Model:
  // capability source="observed", capability_revisions, adherence).
  "observed_progress",
  "observed_plateau",
  "low_adherence",
] as const;
export type ReasonCode = typeof REASON_CODES[number];

/** Confidence in the DECISION (not in the facts — that's the Athlete Model's
 *  capability confidence). Sometimes the coach knows; sometimes evidence is
 *  mixed. Distinct type so the two meanings never conflate. */
export type DecisionConfidence = "low" | "medium" | "high";

/** Abstract, reusable coaching intent — NOT generator-specific. Step 3's
 *  skeleton maps it onto its concrete strength lever. */
export type StrengthEmphasis = "technical" | "balanced" | "absolute_strength";

export type RecoveryStance = "aggressive" | "standard" | "conservative";

// ============================================================
// Types
// ============================================================

export interface CoachStatePriority {
  focus: FocusArea;
  /** 1 = highest. */
  rank: number;
  /** Confidence in this prioritization decision. */
  confidence: DecisionConfidence;
  reasons: ReasonCode[];
  /** Refs into the Athlete Model that ground this decision — the fact/judgment
   *  seam. Strength normative keys OR competition-movement keys (Step 1.5);
   *  validity is enforced by the per-call tool enum (buildEmitCoachStateTool). */
  evidence: EvidenceKey[];
  /** 1–2 sentences, athlete-facing — WHY this is a priority. Decision-locked:
   *  it renders the eval, so the explanation can never drift from the decision. */
  athlete_facing_rationale: string;
  /** The strategy-level action (NOT a prescription) — e.g. "Add dedicated
   *  snatch technical volume." Renders the eval's recommendations. */
  recommended_action: string;
}

export interface CoachStateMaintain {
  focus: FocusArea;
  reasons: ReasonCode[];
  /** Athlete-facing — why it's a strength worth keeping (renders eval strengths). */
  athlete_facing_rationale: string;
}

export interface CoachStateDeprioritize {
  focus: FocusArea;
  reasons: ReasonCode[];
}

export interface CoachStateRecoveryPosture {
  stance: RecoveryStance;
  confidence: DecisionConfidence;
  reasons: ReasonCode[];
}

export interface CoachStateStrengthEmphasis {
  value: StrengthEmphasis;
  confidence: DecisionConfidence;
  reasons: ReasonCode[];
}

/** The deterministic content the LLM emits (everything except the persistence-
 *  assigned version / created_at). */
export interface CoachStateContent {
  coach_state_builder_version: string;

  /** One sentence, athlete-facing — the most important thing right now. */
  headline: string;
  /** 2–4 paragraph athlete-facing synthesis (renders eval detailed_analysis). */
  summary: string;

  priorities: CoachStatePriority[]; // what to DEVELOP, ranked
  maintain: CoachStateMaintain[]; // keep, don't push
  deprioritize: CoachStateDeprioritize[]; // explicitly NOT this cycle

  recovery_posture: CoachStateRecoveryPosture;
  strength_emphasis: CoachStateStrengthEmphasis;
}

/** The persisted, versioned snapshot. References the Athlete Model version it
 *  was built on (provenance lineage). */
export interface CoachState extends CoachStateContent {
  version: number;
  athlete_id: string;
  created_at: string;
  /** Input pin — the exact Athlete Model version the beliefs were formed from. */
  athlete_model_version: number;
  /** Continuation-ready; unused in v1 (Step 4 feedback loop fills it). */
  cycle_pointer: { month: number } | null;
}

// ============================================================
// EMIT tool schema — forced tool-use contract for the LLM. The enums are the
// SAME as-const arrays as the TS types, so the model can only emit valid
// focus / reason / evidence values (no invented variants).
// ============================================================

/**
 * Build the emit tool with a per-athlete evidence enum. evidenceEnum should be
 * athleteModelEvidenceKeys(model) = the static strength normative keys PLUS this
 * athlete's competition-movement keys (Step 1.5) — so the LLM can cite a
 * movement percentile as typed evidence, and the API rejects any key that
 * isn't actually in this athlete's model. This is the runtime guarantee behind
 * the (compile-time-widened) evidence type.
 */
export function buildEmitCoachStateTool(evidenceEnum: readonly string[]) {
  const tool = structuredClone(EMIT_COACH_STATE_TOOL);
  tool.input_schema.properties.priorities.items.properties.evidence.items.enum = [...evidenceEnum];
  return tool;
}

export const EMIT_COACH_STATE_TOOL = {
  name: "emit_coach_state",
  description:
    "Emit the coach's current beliefs about this athlete as a typed decision object. " +
    "You are given a precomputed athlete_model (facts). Decide what to DEVELOP (priorities, " +
    "ranked), MAINTAIN, and DEPRIORITIZE this cycle, plus recovery posture and strength emphasis. " +
    "Reference the athlete_model's normative keys via `evidence` — do NOT restate or recompute numbers. " +
    "Each decision carries a controlled reason code set and a confidence in the DECISION.",
  input_schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        minLength: 20,
        maxLength: 400,
        description: "One sentence: the single most important thing about this athlete right now.",
      },
      summary: {
        type: "string",
        minLength: 150,
        maxLength: 4000,
        description: "2-4 paragraphs of athlete-facing synthesis. May cite athlete_model values verbatim; never derive new numbers.",
      },
      priorities: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        description: "What to DEVELOP this cycle, ranked biggest-opportunity first.",
        items: {
          type: "object",
          properties: {
            focus: { type: "string", enum: [...FOCUS_AREAS] },
            rank: { type: "integer", minimum: 1, maximum: 5 },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            reasons: {
              type: "array",
              minItems: 1,
              items: { type: "string", enum: [...REASON_CODES] },
            },
            evidence: {
              type: "array",
              description: "Athlete Model keys grounding this decision — strength normatives AND competition_movements keys. Empty only when truly nothing in the model applies.",
              items: { type: "string", enum: [...NORMATIVE_KEYS] as string[] },
            },
            athlete_facing_rationale: { type: "string", minLength: 10, maxLength: 500 },
            recommended_action: { type: "string", minLength: 10, maxLength: 300 },
          },
          required: ["focus", "rank", "confidence", "reasons", "evidence", "athlete_facing_rationale", "recommended_action"],
          additionalProperties: false,
        },
      },
      maintain: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        description: "Strengths / at-standard areas to keep without pushing.",
        items: {
          type: "object",
          properties: {
            focus: { type: "string", enum: [...FOCUS_AREAS] },
            reasons: { type: "array", minItems: 1, items: { type: "string", enum: [...REASON_CODES] } },
            athlete_facing_rationale: { type: "string", minLength: 10, maxLength: 500 },
          },
          required: ["focus", "reasons", "athlete_facing_rationale"],
          additionalProperties: false,
        },
      },
      deprioritize: {
        type: "array",
        minItems: 0,
        maxItems: 6,
        description: "Axes explicitly NOT emphasized this cycle (and why). Can't develop everything at once.",
        items: {
          type: "object",
          properties: {
            focus: { type: "string", enum: [...FOCUS_AREAS] },
            reasons: { type: "array", minItems: 1, items: { type: "string", enum: [...REASON_CODES] } },
          },
          required: ["focus", "reasons"],
          additionalProperties: false,
        },
      },
      recovery_posture: {
        type: "object",
        properties: {
          stance: { type: "string", enum: ["aggressive", "standard", "conservative"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          reasons: { type: "array", minItems: 1, items: { type: "string", enum: [...REASON_CODES] } },
        },
        required: ["stance", "confidence", "reasons"],
        additionalProperties: false,
      },
      strength_emphasis: {
        type: "object",
        properties: {
          value: { type: "string", enum: ["technical", "balanced", "absolute_strength"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          reasons: { type: "array", minItems: 1, items: { type: "string", enum: [...REASON_CODES] } },
        },
        required: ["value", "confidence", "reasons"],
        additionalProperties: false,
      },
    },
    required: [
      "headline",
      "summary",
      "priorities",
      "maintain",
      "deprioritize",
      "recovery_posture",
      "strength_emphasis",
    ],
    additionalProperties: false,
  },
};

// ============================================================
// Deterministic projection — CoachState → legacy EvaluationOutput. "The eval
// renders from the typed object": the athlete-facing prose IS the decision
// rationale, so it can never drift from the decisions. Pure, no LLM.
// ============================================================

export function evaluationFromCoachState(cs: CoachStateContent): EvaluationOutput {
  const ranked = [...cs.priorities].sort((a, b) => a.rank - b.rank);
  return {
    headline_takeaway: cs.headline,
    strengths: cs.maintain.map((m) => m.athlete_facing_rationale),
    weaknesses_and_priorities: ranked.map((p) => p.athlete_facing_rationale),
    detailed_analysis: cs.summary,
    recommendations: ranked.map((p) => p.recommended_action),
  };
}
