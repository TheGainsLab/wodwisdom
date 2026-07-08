// deno test supabase/functions/_shared/gym-session-budget_test.ts --allow-env --no-check
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  auditSessionBudget,
  estimateDayMinutes,
  estimateMetconMinutes,
  estimateStrengthMinutes,
} from "./gym-session-budget.ts";
import type { SkeletonOutput } from "./v3-output-schema.ts";

Deno.test("estimateStrengthMinutes: parses sets from NxM schemes; default 4 sets", () => {
  assertEquals(estimateStrengthMinutes("5x5 @75%"), 17); // 5*2.5+4 = 16.5 → 17
  assertEquals(estimateStrengthMinutes("3x3 @65%"), 12); // 3*2.5+4 = 11.5 → 12
  assertEquals(estimateStrengthMinutes("6x2 @70% complex"), 19);
  assertEquals(estimateStrengthMinutes(null), 14); // 4*2.5+4
  assertEquals(estimateStrengthMinutes("build to heavy single"), 14);
});

Deno.test("estimateMetconMinutes: stated range wins (top), keywords fall back, default 14", () => {
  assertEquals(estimateMetconMinutes("long aerobic chipper 20-25 min"), 25);
  assertEquals(estimateMetconMinutes("sprint couplet 8 min"), 8);
  assertEquals(estimateMetconMinutes("long grind, no number"), 22);
  assertEquals(estimateMetconMinutes("short anaerobic burst"), 8);
  assertEquals(estimateMetconMinutes("EMOM 12"), 14); // known blind spot: no "min" → default
  assertEquals(estimateMetconMinutes(null), 14);
});

function day(blockTypes: string[], opts: { scheme?: string; metcon?: string } = {}) {
  return {
    day_num: 1,
    day_intent: "test",
    block_types: blockTypes,
    strength_scheme: opts.scheme ?? null,
    metcon_focus: opts.metcon ?? null,
  // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("estimateDayMinutes: sums the block list; cool-down is off the clock", () => {
  // The 6-block personal-training day that started all this: warm-up 10 +
  // skills 15 + 5x5 strength 17 + accessory 12 + long metcon 22 + cool-down 0
  // (owner decision: cool-down not counted) = 76.
  const { total } = estimateDayMinutes(
    day(["warm-up", "skills", "strength", "accessory", "metcon", "cool-down"], {
      scheme: "5x5 @75%",
      metcon: "long aerobic chipper 18-22 min",
    }),
  );
  assertEquals(total, 76);
});

Deno.test("estimateDayMinutes: the class day template fits a 60-min hour", () => {
  // Owner's class template: warm-up 10 + ONE focus + metcon + (uncounted) cool-down.
  const strengthDay = estimateDayMinutes(
    day(["warm-up", "strength", "metcon", "cool-down"], {
      scheme: "5x5 @75%",
      metcon: "medium mixed triplet 18 min",
    }),
  );
  assertEquals(strengthDay.total, 45); // 10 + 17 + 18 + 0

  const skillsDay = estimateDayMinutes(
    day(["warm-up", "skills", "metcon", "cool-down"], {
      metcon: "long aerobic intervals 25 min",
    }),
  );
  assertEquals(skillsDay.total, 50); // 10 + 15 + 25 + 0
});

Deno.test("auditSessionBudget: flags over-budget days with location, passes fitting days", () => {
  const overDay = day(["warm-up", "skills", "strength", "accessory", "metcon", "cool-down"], {
    scheme: "5x5 @75%",
    metcon: "long aerobic chipper 20-25 min",
  }); // 10+15+17+12+25+0 = 79
  const fitDay = day(["warm-up", "strength", "metcon", "cool-down"], {
    scheme: "5x5 @75%",
    metcon: "medium couplet 12 min",
  }); // 10+17+12+0 = 39
  const skeleton = {
    month_plan: {},
    weeks: [{ week_num: 1, weekly_intent: "build", days: [overDay, { ...fitDay, day_num: 2 }] }],
  // deno-lint-ignore no-explicit-any
  } as any as SkeletonOutput;

  const violations = auditSessionBudget(skeleton, 60);
  assertEquals(violations.length, 1);
  assert(violations[0].includes("Week 1 Day 1"), "violation names the day");
  assert(violations[0].includes("60-min"), "violation names the budget");

  // A 90-min budget fits both days.
  assertEquals(auditSessionBudget(skeleton, 90).length, 0);
});
