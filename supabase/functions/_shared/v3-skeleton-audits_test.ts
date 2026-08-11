/**
 * v3-skeleton-audits_test.ts
 *
 * Tests for the 2026-08 adoption changes to the LIVE skeleton audit loop:
 * the active-recovery coverage exception and the graduated machine rows
 * (M4/M6/M7/M8) running inside runSkeletonAudits.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import type { BlockIntent, DaySkeleton, SkeletonOutput, WeekSkeleton } from "./v3-output-schema.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";
import { auditSkeletonCoverage, runSkeletonAudits } from "./v3-skeleton-audits.ts";

function day(num: number, overrides: Partial<DaySkeleton> = {}): DaySkeleton {
  return {
    day_num: num,
    day_intent: "heavy squat + short metcon",
    block_types: ["warm-up", "skills", "strength", "accessory", "metcon", "cool-down"],
    primary_lift: num % 2 === 0 ? "Bench Press" : "Back Squat",
    strength_scheme: "5x5 @75%",
    metcon_focus: "short power couplet (6-8 min)",
    skill_focus: "Skill maintenance EMOM",
    block_intents: [],
    ...overrides,
  };
}

const CONFORMING_INTENTS: BlockIntent[] = [
  { block_type: "strength", focus: "olympic_lifting", purpose: "develop", source_priority_rank: 1 },
  { block_type: "skills", focus: "olympic_lifting", purpose: "develop", source_priority_rank: 1 },
  { block_type: "metcon", focus: "gymnastics_pulling", purpose: "develop", source_priority_rank: 2 },
  { block_type: "accessory", focus: "posterior_chain", purpose: "maintain" },
];

function baseSkeleton(): SkeletonOutput {
  const mkWeek = (n: number, intent: string): WeekSkeleton => ({
    week_num: n,
    weekly_intent: intent,
    days: [day(1, { block_intents: CONFORMING_INTENTS }), day(2, { block_intents: CONFORMING_INTENTS })],
  });
  return {
    month_plan: {
      weekly_intent: ["build", "build", "build", "deload"],
      strength_progression: "Back Squat: W1 5×5 @75% → W3 4×3 @82%. Bench Press: W1 5×5 @72% → W3 4×4 @80%.",
      deload_placement: "Week 4 deload — reduced volume before retest.",
    },
    weeks: [mkWeek(1, "build"), mkWeek(2, "build"), mkWeek(3, "build"), mkWeek(4, "deload")],
  };
}

function tdi(): TrainingDesignInput {
  return {
    priorities: [
      { focus: "olympic_lifting", rank: 1, confidence: "high" },
      { focus: "gymnastics_pulling", rank: 2, confidence: "medium" },
    ],
    maintain: ["posterior_chain"],
    deprioritize: ["upper_body_pressing"],
    recovery_stance: "standard",
    strength_emphasis: "balanced",
    days_per_week: 2,
    session_length_minutes: 60,
    equipment: {},
    do_not_program: [],
    vocabulary: [],
    lifts: {},
    previous_cycle: null,
    coach_state_version: 1,
    athlete_model_version: 1,
  };
}

Deno.test("coverage: active-recovery day is exempt from strength+metcon (accessory still required)", () => {
  const s = baseSkeleton();
  s.weeks[3].days[1] = day(2, {
    block_types: ["warm-up", "mobility", "skills", "accessory", "active-recovery", "cool-down"],
    primary_lift: undefined,
    strength_scheme: undefined,
    metcon_focus: undefined,
    block_intents: [
      { block_type: "skills", focus: "olympic_lifting", purpose: "maintain" },
      { block_type: "accessory", focus: "posterior_chain", purpose: "maintain" },
    ],
  });
  assertEquals(auditSkeletonCoverage(s).passed, true);

  // Without accessory the exception does not apply cleanly.
  const bare = baseSkeleton();
  bare.weeks[3].days[1] = day(2, {
    block_types: ["warm-up", "mobility", "active-recovery", "cool-down"],
    primary_lift: undefined,
    strength_scheme: undefined,
    metcon_focus: undefined,
    block_intents: [],
  });
  const r = auditSkeletonCoverage(bare);
  assertEquals(r.passed, false);
  assert(r.violations[0].includes("active-recovery"));
});

Deno.test("coverage: normal days still require strength + accessory + metcon", () => {
  const s = baseSkeleton();
  s.weeks[0].days[0].block_types = ["warm-up", "skills", "accessory", "metcon", "cool-down"];
  const r = auditSkeletonCoverage(s);
  assertEquals(r.passed, false);
  assert(r.violations[0].includes("strength"));
});

Deno.test("runSkeletonAudits includes graduated machine rows when the TDI is present", () => {
  const result = runSkeletonAudits({
    skeleton: baseSkeleton(),
    daysPerWeek: 2,
    trainingDesignInput: tdi(),
  });
  const rules = result.all.map((r) => r.rule);
  for (const expected of ["machine_row_m4", "machine_row_m6", "machine_row_m7", "machine_row_m8"]) {
    assert(rules.includes(expected), `missing ${expected} in [${rules.join(", ")}]`);
  }
  assertEquals(result.passed, true);
});

Deno.test("runSkeletonAudits passes a short-session athlete — M7 is advisory, never blocking", () => {
  // 40-min session: the flat 45-min block estimate exceeds it before any
  // metcon, so under the old hard-fail M7 this athlete could never generate
  // (SkeletonLoopExhausted). Advisory M7 must let the skeleton through.
  const shortTdi = { ...tdi(), session_length_minutes: 40 };
  const result = runSkeletonAudits({
    skeleton: baseSkeleton(),
    daysPerWeek: 2,
    trainingDesignInput: shortTdi,
  });
  assertEquals(result.passed, true);
  assert(!result.failures.some((f) => f.rule === "machine_row_m7"));
});

Deno.test("runSkeletonAudits fails via M6 when the plan promises an unprogrammed lift", () => {
  const s = baseSkeleton();
  s.month_plan.strength_progression += " Deadlift: W1 4×4 @75% → W3 3×3 @85%.";
  const result = runSkeletonAudits({ skeleton: s, daysPerWeek: 2, trainingDesignInput: tdi() });
  assertEquals(result.passed, false);
  assert(result.failures.some((f) => f.rule === "machine_row_m6"));
});
