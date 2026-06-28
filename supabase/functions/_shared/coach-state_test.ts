/**
 * Unit tests for the CoachState layer (coaching-state Step 2). Run with:
 *   deno test supabase/functions/_shared/coach-state_test.ts --no-check
 *
 * Pure coverage: the deterministic EvaluationOutput projection, enum/schema
 * integrity, and the evidence-keyspace sync with the Athlete Model.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import {
  buildEmitCoachStateTool,
  type CoachStateContent,
  COACH_STATE_BUILDER_VERSION,
  EMIT_COACH_STATE_TOOL,
  evaluationFromCoachState,
  FOCUS_AREAS,
  REASON_CODES,
} from "./coach-state.ts";
import { NORMATIVE_KEYS } from "./athlete-model.ts";

function sampleCoachState(): CoachStateContent {
  return {
    coach_state_builder_version: COACH_STATE_BUILDER_VERSION,
    headline: "Strong squat base, but the Olympic lifts are the unlock toward your competitor goal.",
    summary: "Your absolute strength is a real asset. The snatch and clean & jerk lag the squat, "
      + "which caps how much of that strength shows up in competition. This cycle leans technical.",
    priorities: [
      {
        focus: "olympic_lifting", rank: 2, confidence: "high",
        reasons: ["oly_imbalance", "supports_stated_goal"],
        evidence: ["snatch_to_back_squat", "clean_jerk_to_back_squat"],
        athlete_facing_rationale: "Your snatch sits well below where your squat says it could be.",
        recommended_action: "Add dedicated snatch technical volume.",
      },
      {
        focus: "aerobic_capacity", rank: 1, confidence: "medium",
        reasons: ["time_domain_weakness", "highest_expected_roi"],
        evidence: ["power_overall_percentile"],
        athlete_facing_rationale: "Long-domain work is your biggest competition gap.",
        recommended_action: "Bias conditioning toward sustained aerobic pieces.",
      },
      {
        focus: "gymnastics_pulling", rank: 3, confidence: "low",
        reasons: ["low_skill_proficiency", "skill_gate_risk"],
        evidence: [], // unlinked / self-reported only → confidence low, no normative
        athlete_facing_rationale: "Muscle-ups are a competition gate you've rated yourself low on.",
        recommended_action: "Build strict pulling strength toward the first muscle-up.",
      },
    ],
    maintain: [
      {
        focus: "powerlifting_strength", reasons: ["already_at_standard"],
        athlete_facing_rationale: "Your squat and deadlift are genuine strengths — we'll keep them sharp.",
      },
    ],
    deprioritize: [
      { focus: "anaerobic_capacity", reasons: ["recovery_budget_limited", "not_goal_relevant"] },
    ],
    recovery_posture: { stance: "standard", confidence: "medium", reasons: ["masters_age"] },
    strength_emphasis: { value: "technical", confidence: "high", reasons: ["oly_imbalance"] },
  };
}

// ============================================================
// Deterministic projection → EvaluationOutput
// ============================================================

Deno.test("evaluationFromCoachState projects the legacy eval shape, rank-ordered", () => {
  const ev = evaluationFromCoachState(sampleCoachState());

  assertEquals(ev.headline_takeaway, sampleCoachState().headline);
  assertEquals(ev.detailed_analysis, sampleCoachState().summary);

  // weaknesses_and_priorities = priorities by rank (1 first) → rationale text.
  assertEquals(ev.weaknesses_and_priorities[0], "Long-domain work is your biggest competition gap.");
  assertEquals(ev.weaknesses_and_priorities.length, 3);

  // recommendations = priorities by rank → recommended_action.
  assertEquals(ev.recommendations[0], "Bias conditioning toward sustained aerobic pieces.");

  // strengths = maintain rationales.
  assertEquals(ev.strengths.length, 1);
  assert(ev.strengths[0].includes("genuine strengths"));
});

Deno.test("projection is decision-locked (rationale text never invented)", () => {
  const cs = sampleCoachState();
  const ev = evaluationFromCoachState(cs);
  // Every weakness line is literally a priority's rationale — no drift possible.
  const rationales = cs.priorities.map((p) => p.athlete_facing_rationale);
  for (const w of ev.weaknesses_and_priorities) assert(rationales.includes(w));
});

// ============================================================
// Enum / schema integrity
// ============================================================

Deno.test("tool-schema enums match the as-const arrays (single source of truth)", () => {
  const props = EMIT_COACH_STATE_TOOL.input_schema.properties;
  const focusEnum = props.priorities.items.properties.focus.enum;
  const reasonEnum = props.priorities.items.properties.reasons.items.enum;
  const evidenceEnum = props.priorities.items.properties.evidence.items.enum;

  assertEquals(focusEnum, [...FOCUS_AREAS]);
  assertEquals(reasonEnum, [...REASON_CODES]);
  assertEquals(evidenceEnum, [...NORMATIVE_KEYS]);
});

Deno.test("no duplicate enum members", () => {
  assertEquals(new Set(FOCUS_AREAS).size, FOCUS_AREAS.length);
  assertEquals(new Set(REASON_CODES).size, REASON_CODES.length);
  assertEquals(new Set(NORMATIVE_KEYS).size, NORMATIVE_KEYS.length);
});

Deno.test("locked vocabulary counts (guards accidental edits)", () => {
  assertEquals(FOCUS_AREAS.length, 11);
  assertEquals(REASON_CODES.length, 23); // +3 observed signals (Step 4)
  assertEquals(NORMATIVE_KEYS.length, 12);
});

Deno.test("low_skill_proficiency exists — the unlinked-athlete gymnastics gap signal", () => {
  assert((REASON_CODES as readonly string[]).includes("low_skill_proficiency"));
});

// ============================================================
// Step 1.5 — dynamic evidence enum (movement keys join the keyspace)
// ============================================================

Deno.test("buildEmitCoachStateTool sets the evidence enum without mutating the base", () => {
  const keys = [...NORMATIVE_KEYS, "ghd_sit_up_competition_percentile"];
  const tool = buildEmitCoachStateTool(keys);
  const evEnum = tool.input_schema.properties.priorities.items.properties.evidence.items.enum;
  assertEquals(evEnum, keys);
  assert(evEnum.includes("ghd_sit_up_competition_percentile"));

  // The static base tool is untouched (structuredClone, not mutation).
  const baseEnum = EMIT_COACH_STATE_TOOL.input_schema.properties.priorities.items.properties.evidence.items.enum;
  assert(!baseEnum.includes("ghd_sit_up_competition_percentile"));
});
