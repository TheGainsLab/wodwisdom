/**
 * coach-state-audits_test.ts
 *
 * Unit tests for the eval-layer integrity checks (coach-state-audits.ts) and
 * the per-athlete reason-code shaping (allowedReasonCodes). Fixtures mirror
 * the 2026-08 side-by-side findings: unsupported reason codes, at-standard
 * contradictions, overconfident priorities on all-self-reported data.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import type { CoachStateContent } from "./coach-state.ts";
import { allowedReasonCodes, buildEmitCoachStateTool } from "./coach-state.ts";
import { auditCoachState, type CoachStateAuditInputs } from "./coach-state-audits.ts";

// ============================================================
// Fixtures
// ============================================================

/** Fresh unlinked athlete: no goal, no history, no competition, all lifts
 *  self-reported low-confidence — the exact shape of the 2026-08 test athlete. */
function freshPayload(overrides: Partial<CoachStateAuditInputs> = {}): CoachStateAuditInputs {
  return {
    training_context: { goal_text: null },
    previous_cycle: null,
    competition: null,
    athlete_model: {
      capability_revisions: [],
      logged_competition_results: [],
      outside_training: null,
      normative: {
        press_to_bodyweight: { value: 0.644, threshold: 0.86, gap: -0.216, position: "well_below" },
        bench_to_bodyweight: { value: 1, threshold: 1.46, gap: -0.46, position: "well_below" },
        snatch_to_back_squat: { value: 0.507, threshold: 0.6, gap: -0.093, position: "well_below" },
        deadlift_to_back_squat: { value: 1.301, threshold: 1.3, gap: 0.001, position: "at_or_near" },
        deadlift_to_bodyweight: { value: 2.111, threshold: 2.5, gap: -0.389, position: "well_below" },
      },
      competition_movements: {},
      capabilities: {
        back_squat: { confidence: "low" },
        snatch: { confidence: "low" },
        press: { confidence: "low" },
      },
    },
    ...overrides,
  };
}

function content(overrides: Partial<CoachStateContent> = {}): CoachStateContent {
  return {
    headline: "Your pressing is the clearest gap in an otherwise strong profile.",
    summary: "s".repeat(160),
    priorities: [
      {
        focus: "upper_body_pressing",
        rank: 1,
        confidence: "medium",
        reasons: ["below_relative_strength_floor"],
        evidence: ["press_to_bodyweight"],
        athlete_facing_rationale: "Your press is light for your bodyweight.",
        recommended_action: "Add dedicated strict pressing volume.",
      },
      {
        focus: "olympic_lifting",
        rank: 2,
        confidence: "medium",
        reasons: ["oly_imbalance"],
        evidence: ["snatch_to_back_squat"],
        athlete_facing_rationale: "Your snatch trails your squat.",
        recommended_action: "Add snatch technical volume.",
      },
    ],
    maintain: [
      {
        focus: "posterior_chain",
        reasons: ["already_at_standard"],
        athlete_facing_rationale: "Your hinge balance is where it should be.",
      },
    ],
    deprioritize: [],
    recovery_posture: { stance: "conservative", confidence: "high", reasons: ["masters_age"] },
    strength_emphasis: { value: "technical", confidence: "medium", reasons: ["oly_imbalance"] },
    coach_state_builder_version: "v1.6",
    ...overrides,
  } as CoachStateContent;
}

// ============================================================
// allowedReasonCodes — shaping
// ============================================================

Deno.test("shaping strips goal/history/competition/observed codes for a fresh athlete", () => {
  const allowed = new Set(allowedReasonCodes(freshPayload()));
  for (const gone of ["supports_stated_goal", "high_prior_load", "recent_competition", "observed_progress", "observed_plateau", "low_adherence"]) {
    assert(!allowed.has(gone as never), `${gone} should be stripped`);
  }
  assert(allowed.has("below_relative_strength_floor"));
  assert(allowed.has("masters_age"));
});

Deno.test("shaping keeps codes when the grounding data exists", () => {
  const p = freshPayload({
    training_context: { goal_text: "masters quarterfinals" },
    competition: { linked: true },
    previous_cycle: { any: true },
  });
  const allowed = new Set(allowedReasonCodes(p));
  assert(allowed.has("supports_stated_goal"));
  assert(allowed.has("recent_competition"));
  assert(allowed.has("high_prior_load"));
});

Deno.test("buildEmitCoachStateTool narrows every reasons enum when given a reason enum", () => {
  const reasons = ["masters_age", "oly_imbalance"];
  const tool = buildEmitCoachStateTool(["press_to_bodyweight"], reasons);
  const props = tool.input_schema.properties;
  assertEquals(props.priorities.items.properties.reasons.items.enum, reasons);
  assertEquals(props.maintain.items.properties.reasons.items.enum, reasons);
  assertEquals(props.deprioritize.items.properties.reasons.items.enum, reasons);
  assertEquals(props.recovery_posture.properties.reasons.items.enum, reasons);
  assertEquals(props.strength_emphasis.properties.reasons.items.enum, reasons);
});

// ============================================================
// auditCoachState
// ============================================================

Deno.test("clean fresh-athlete coach state passes", () => {
  const r = auditCoachState(content(), freshPayload());
  assertEquals(r.violations, []);
  assertEquals(r.passed, true);
});

Deno.test("unsupported reason code is flagged (Sonnet's supports_stated_goal with null goal)", () => {
  const cs = content();
  cs.priorities[0].reasons = ["below_relative_strength_floor", "supports_stated_goal"];
  const r = auditCoachState(cs, freshPayload());
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("supports_stated_goal")));
});

Deno.test("already_at_standard contradicting well_below normatives is flagged", () => {
  const cs = content({
    deprioritize: [{ focus: "powerlifting_strength", reasons: ["already_at_standard"] }],
  });
  const r = auditCoachState(cs, freshPayload());
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("deadlift_to_bodyweight")));
});

Deno.test("already_at_standard on posterior_chain passes when hinge balance is at_or_near", () => {
  // Fable's call: posterior_chain (deadlift_to_back_squat at_or_near) is
  // legitimately at-standard even while ABSOLUTE strength is well_below.
  const r = auditCoachState(content(), freshPayload());
  assertEquals(r.passed, true);
});

Deno.test("high priority confidence on all-self-reported data with no competition is flagged", () => {
  const cs = content();
  cs.priorities[0].confidence = "high";
  const r = auditCoachState(cs, freshPayload());
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("confidence \"high\"")));
});

Deno.test("high priority confidence passes when competition data exists", () => {
  const cs = content();
  cs.priorities[0].confidence = "high";
  const r = auditCoachState(cs, freshPayload({ competition: { linked: true } }));
  assertEquals(r.passed, true);
});

Deno.test("focus in both priorities and maintain is flagged", () => {
  const cs = content({
    maintain: [{ focus: "upper_body_pressing", reasons: ["already_at_standard"], athlete_facing_rationale: "Solid." }],
  });
  const r = auditCoachState(cs, freshPayload());
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("both priorities and maintain")));
});

Deno.test("duplicate ranks are flagged", () => {
  const cs = content();
  cs.priorities[1].rank = 1;
  const r = auditCoachState(cs, freshPayload());
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("Duplicate priority ranks")));
});

Deno.test("evidence key missing from the athlete's model is flagged", () => {
  const cs = content();
  cs.priorities[0].evidence = ["ghd_sit_ups_competition_percentile"];
  const r = auditCoachState(cs, freshPayload());
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("does not exist")));
});
