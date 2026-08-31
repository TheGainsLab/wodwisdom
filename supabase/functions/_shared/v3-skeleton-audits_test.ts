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
  for (const expected of ["machine_row_m4", "machine_row_m6", "machine_row_m8"]) {
    assert(rules.includes(expected), `missing ${expected} in [${rules.join(", ")}]`);
  }
  assertEquals(result.passed, true);
});

Deno.test("runSkeletonAudits fails via M6 when the plan promises an unprogrammed lift", () => {
  const s = baseSkeleton();
  s.month_plan.strength_progression += " Deadlift: W1 4×4 @75% → W3 3×3 @85%.";
  const result = runSkeletonAudits({ skeleton: s, daysPerWeek: 2, trainingDesignInput: tdi() });
  assertEquals(result.passed, false);
  assert(result.failures.some((f) => f.rule === "machine_row_m6"));
});

// ============================================================
// Part D (2026-08-31): dedicated cardio — entitlement strip + plan check
// ============================================================

import { auditCardioPlan, stripCardioBlocks } from "./v3-skeleton-audits.ts";

function cardioDay(num: number, minutes = 20): DaySkeleton {
  return day(num, {
    block_types: ["warm-up", "strength", "accessory", "metcon", "cardio", "cool-down"],
    // deno-lint-ignore no-explicit-any
    ...( { block_minutes: [
      { block_type: "warm-up", minutes: 10 },
      { block_type: "strength", minutes: 25 },
      { block_type: "accessory", minutes: 12 },
      { block_type: "metcon", minutes: 15 },
      { block_type: "cardio", minutes },
      { block_type: "cool-down", minutes: 8 },
    ] } as any),
  });
}

Deno.test("stripCardioBlocks removes cardio everywhere and reports locations (Engine entitlement gate)", () => {
  const s = baseSkeleton();
  s.weeks[0].days[0] = cardioDay(1);
  s.weeks[2].days[1] = cardioDay(2);
  const stripped = stripCardioBlocks(s);
  assertEquals(stripped, ["W1D1", "W3D2"]);
  for (const wk of s.weeks) {
    for (const d of wk.days) {
      assert(!(d.block_types ?? []).includes("cardio"));
      // deno-lint-ignore no-explicit-any
      assert(!((d as any).block_minutes ?? []).some((b: { block_type: string }) => b.block_type === "cardio"));
    }
  }
});

Deno.test("auditCardioPlan: clean authorized plan produces no lines", () => {
  const s = baseSkeleton();
  s.weeks[0].days[0] = cardioDay(1, 20);
  const lines = auditCardioPlan(s, { source_priority_rank: 1 }, 90, 5);
  assertEquals(lines, []);
});

Deno.test("auditCardioPlan flags: unauthorized, over-count, out-of-band minutes, weekly % cap, rank-vs-dose", () => {
  const s = baseSkeleton();
  // Week 1: 3 cardio days (2-day weeks in fixture — add a third day)
  s.weeks[0].days = [cardioDay(1, 35), cardioDay(2, 30), cardioDay(3, 30)];
  const unauthorized = auditCardioPlan(s, null, 90, 5);
  assert(unauthorized.some((l) => l.includes("WITHOUT typed dedicated_cardio")));
  const lines = auditCardioPlan(s, { source_priority_rank: 3 }, 60, 3); // weekly budget 180, cap 45
  assert(lines.some((l) => l.includes("35 min (band 10-30)")));
  assert(lines.some((l) => l.includes("cap 25%")));
  assert(lines.some((l) => l.includes("rank 3")));
  // No budget stated → % check silently skipped, count checks remain
  const noBudget = auditCardioPlan(s, { source_priority_rank: 1 }, null, 3);
  assert(!noBudget.some((l) => l.includes("25%")));
});
