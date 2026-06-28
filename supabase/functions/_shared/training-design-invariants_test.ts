/**
 * Unit tests for the Step 3 allocation invariants. Run with:
 *   deno test supabase/functions/_shared/training-design-invariants_test.ts --no-check
 *
 * Synthetic (TrainingDesignInput, SkeletonOutput) pairs: a conforming skeleton
 * passes; each invariant has a failing case. Pure, no IO.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { checkAllocationInvariants } from "./training-design-invariants.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";
import type { BlockIntent, SkeletonOutput } from "./v3-output-schema.ts";

function tdi(): TrainingDesignInput {
  return {
    priorities: [
      { focus: "gymnastics_pressing", rank: 1, confidence: "high" },
      { focus: "midline", rank: 2, confidence: "medium" },
      { focus: "powerlifting_strength", rank: 3, confidence: "medium" },
    ],
    maintain: ["olympic_lifting", "gymnastics_pulling"],
    deprioritize: ["anaerobic_capacity"],
    recovery_stance: "conservative",
    strength_emphasis: "absolute_strength",
    days_per_week: 4,
    session_length_minutes: 60,
    equipment: {},
    do_not_program: [],
    vocabulary: [],
    lifts: {},
    previous_cycle: null,
    coach_state_version: 4,
    athlete_model_version: 2,
  };
}

/** A one-week skeleton whose block_intents faithfully execute tdi():
 *  develop pressing + midline + powerlifting, maintain OLY + pulling. */
function skeletonFrom(intentsByDay: BlockIntent[][]): SkeletonOutput {
  return {
    month_plan: {} as SkeletonOutput["month_plan"],
    weeks: [{
      week_num: 1,
      weekly_intent: "build",
      days: intentsByDay.map((bis, i) => ({
        day_num: i + 1,
        day_intent: "test",
        block_types: ["strength", "skills", "accessory", "metcon"],
        block_intents: bis,
      })),
    }],
  };
}

const CONFORMING = skeletonFrom([
  [
    { block_type: "skills", focus: "gymnastics_pressing", purpose: "develop", source_priority_rank: 1 },
    { block_type: "strength", focus: "powerlifting_strength", purpose: "develop", source_priority_rank: 3 },
    { block_type: "accessory", focus: "midline", purpose: "support" },
    { block_type: "metcon", focus: "olympic_lifting", purpose: "maintain" },
  ],
  [
    { block_type: "skills", focus: "midline", purpose: "develop", source_priority_rank: 2 },
    { block_type: "strength", focus: "olympic_lifting", purpose: "maintain" },
    { block_type: "accessory", focus: "gymnastics_pulling", purpose: "maintain" },
    { block_type: "metcon", focus: "aerobic_capacity", purpose: "support" },
  ],
]);

Deno.test("conforming skeleton passes all invariants", () => {
  const r = checkAllocationInvariants(tdi(), CONFORMING);
  assertEquals(r.violations, []);
  assert(r.passed);
});

Deno.test("missing develop priority → violation", () => {
  // Drop the midline develop block entirely.
  const sk = skeletonFrom([
    [{ block_type: "skills", focus: "gymnastics_pressing", purpose: "develop", source_priority_rank: 1 },
      { block_type: "strength", focus: "powerlifting_strength", purpose: "develop", source_priority_rank: 3 }],
  ]);
  const r = checkAllocationInvariants(tdi(), sk);
  assert(!r.passed);
  assert(r.violations.some((v) => v.includes("midline") && v.includes("#2")));
});

Deno.test("deprioritized focus declared develop → violation", () => {
  const sk = skeletonFrom([
    [
      { block_type: "skills", focus: "gymnastics_pressing", purpose: "develop", source_priority_rank: 1 },
      { block_type: "skills", focus: "midline", purpose: "develop", source_priority_rank: 2 },
      { block_type: "strength", focus: "powerlifting_strength", purpose: "develop", source_priority_rank: 3 },
      { block_type: "metcon", focus: "anaerobic_capacity", purpose: "develop", source_priority_rank: 1 },
    ],
  ]);
  const r = checkAllocationInvariants(tdi(), sk);
  assert(!r.passed);
  assert(r.violations.some((v) => v.includes("anaerobic_capacity") && v.includes("DEPRIORITIZED")));
});

Deno.test("develop for a non-priority focus → violation", () => {
  const sk = skeletonFrom([
    [
      { block_type: "skills", focus: "gymnastics_pressing", purpose: "develop", source_priority_rank: 1 },
      { block_type: "skills", focus: "midline", purpose: "develop", source_priority_rank: 2 },
      { block_type: "strength", focus: "powerlifting_strength", purpose: "develop", source_priority_rank: 3 },
      { block_type: "accessory", focus: "posterior_chain", purpose: "develop" },
    ],
  ]);
  const r = checkAllocationInvariants(tdi(), sk);
  assert(!r.passed);
  assert(r.violations.some((v) => v.includes("posterior_chain") && v.includes("not in the priorities")));
});

Deno.test("bad source_priority_rank → violation", () => {
  const sk = skeletonFrom([
    [
      { block_type: "skills", focus: "gymnastics_pressing", purpose: "develop", source_priority_rank: 9 },
      { block_type: "skills", focus: "midline", purpose: "develop", source_priority_rank: 2 },
      { block_type: "strength", focus: "powerlifting_strength", purpose: "develop", source_priority_rank: 3 },
    ],
  ]);
  const r = checkAllocationInvariants(tdi(), sk);
  assert(!r.passed);
  assert(r.violations.some((v) => v.includes("source_priority_rank 9")));
});

Deno.test("empty block_intents on a focus-bearing day → violation", () => {
  const sk: SkeletonOutput = {
    month_plan: {} as SkeletonOutput["month_plan"],
    weeks: [{
      week_num: 1,
      weekly_intent: "build",
      days: [{ day_num: 1, day_intent: "x", block_types: ["strength", "metcon"], block_intents: [] }],
    }],
  };
  const r = checkAllocationInvariants(tdi(), sk);
  assert(!r.passed);
  assert(r.violations.some((v) => v.includes("block_intents is empty")));
});

Deno.test("maintain block carrying source_priority_rank → violation", () => {
  const sk = skeletonFrom([
    [
      { block_type: "skills", focus: "gymnastics_pressing", purpose: "develop", source_priority_rank: 1 },
      { block_type: "skills", focus: "midline", purpose: "develop", source_priority_rank: 2 },
      { block_type: "strength", focus: "powerlifting_strength", purpose: "develop", source_priority_rank: 3 },
      // maintain block wrongly tagged with a rank (the pollution we're killing):
      { block_type: "accessory", focus: "gymnastics_pulling", purpose: "maintain", source_priority_rank: 1 },
    ],
  ]);
  const r = checkAllocationInvariants(tdi(), sk);
  assert(!r.passed);
  assert(r.violations.some((v) => v.includes("must NOT set source_priority_rank")));
});

Deno.test("missing maintain touch → warning, not violation", () => {
  // CONFORMING touches olympic_lifting + gymnastics_pulling already; drop pulling.
  const sk = skeletonFrom([
    [
      { block_type: "skills", focus: "gymnastics_pressing", purpose: "develop", source_priority_rank: 1 },
      { block_type: "skills", focus: "midline", purpose: "develop", source_priority_rank: 2 },
      { block_type: "strength", focus: "powerlifting_strength", purpose: "develop", source_priority_rank: 3 },
      { block_type: "strength", focus: "olympic_lifting", purpose: "maintain" },
    ],
  ]);
  const r = checkAllocationInvariants(tdi(), sk);
  assert(r.passed); // still passes — maintain gaps are soft
  assert(r.warnings.some((w) => w.includes("gymnastics_pulling")));
});
