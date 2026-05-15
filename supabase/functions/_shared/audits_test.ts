/**
 * Unit tests for the 7 deterministic v2 audits. Run with:
 *   deno test supabase/functions/_shared/audits_test.ts
 *
 * Every audit gets at least one passing case and one failing case.
 * Pure-function coverage; no IO, no network.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import {
  auditBlockTypeEnum,
  auditStrengthOneLift,
  auditMetconOnePiece,
  auditRequiredFields,
  auditDayCount,
  auditLoadSanity,
  auditVocabularyCompliance,
} from "./audits.ts";
import type {
  BlockPrescription,
  DayPrescription,
  MovementPrescription,
  WeekPrescription,
  WriterOutput,
} from "./v2-output-schema.ts";

// ============================================================
// Builders — minimal valid WriterOutput we can mutate per test
// ============================================================

function mv(
  movement: string,
  overrides: Partial<MovementPrescription> = {},
): MovementPrescription {
  return { movement, sets: 3, reps: 5, ...overrides };
}

function block(
  block_type: BlockPrescription["block_type"],
  movements: MovementPrescription[],
  overrides: Partial<BlockPrescription> = {},
): BlockPrescription {
  return { block_type, movements, ...overrides };
}

function day(
  day_num: number,
  blocks: BlockPrescription[],
): DayPrescription {
  return { day_num, blocks };
}

function week(
  week_num: number,
  days: DayPrescription[],
): WeekPrescription {
  return { week_num, days };
}

/**
 * Baseline well-formed 4-week × 3-day output with a single strength block
 * containing one movement on every day. Tests mutate this in-place to
 * trigger specific failure modes.
 */
function baselineOutput(daysPerWeek = 3): WriterOutput {
  const makeDay = (n: number) =>
    day(n, [block("strength", [mv("Back Squat", { weight: 200 })])]);
  const weeks: WeekPrescription[] = [];
  for (let w = 1; w <= 4; w++) {
    const days: DayPrescription[] = [];
    for (let d = 1; d <= daysPerWeek; d++) days.push(makeDay(d));
    weeks.push(week(w, days));
  }
  return {
    month_plan: {
      weekly_intent: ["build", "build", "build", "deload"],
      strength_progression: "Linear weekly load progression on Back Squat.",
      deload_placement: "Week 4.",
    },
    weeks,
  };
}

// ============================================================
// Rule 1 — block_type enum
// ============================================================

Deno.test("auditBlockTypeEnum: all canonical types → passes", () => {
  const out = baselineOutput();
  // Sprinkle additional canonical types into week 1 day 1.
  out.weeks[0].days[0].blocks.push(
    block("warm-up", [mv("Air Squat", { reps: 10 })]),
    block("metcon", [mv("Burpee", { reps: 10 })], { block_scheme: "AMRAP 10" }),
    block("cool-down", [mv("Banded Stretch", { time_seconds: 60 })]),
  );
  const result = auditBlockTypeEnum(out);
  assert(result.passed);
  assertEquals(result.violations.length, 0);
});

Deno.test("auditBlockTypeEnum: invalid block_type → fails with locator", () => {
  const out = baselineOutput();
  // deno-lint-ignore no-explicit-any
  (out.weeks[0].days[0].blocks[0] as any).block_type = "other";
  const result = auditBlockTypeEnum(out);
  assert(!result.passed);
  assertEquals(result.violations.length, 1);
  assert(result.violations[0].includes("Week 1 Day 1"));
  assert(result.violations[0].includes('"other"'));
});

// ============================================================
// Rule 2 — strength one lift
// ============================================================

Deno.test("auditStrengthOneLift: every strength block has exactly 1 movement → passes", () => {
  const out = baselineOutput();
  // Add a non-strength block with multiple movements — must not trigger.
  out.weeks[0].days[0].blocks.push(
    block("accessory", [
      mv("Dumbbell Row", { reps: 12 }),
      mv("Barbell Curl", { reps: 12 }),
    ]),
  );
  const result = auditStrengthOneLift(out);
  assert(result.passed);
  assertEquals(result.violations.length, 0);
});

Deno.test("auditStrengthOneLift: strength block with 2 movements → fails", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks[0].movements.push(mv("Front Squat", { weight: 180 }));
  const result = auditStrengthOneLift(out);
  assert(!result.passed);
  assertEquals(result.violations.length, 1);
  assert(result.violations[0].includes("Week 1 Day 1"));
  assert(result.violations[0].includes("contains 2 movements"));
});

Deno.test("auditStrengthOneLift: strength block with 0 movements → fails", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks[0].movements = [];
  const result = auditStrengthOneLift(out);
  assert(!result.passed);
  assert(result.violations[0].includes("contains 0 movements"));
});

// ============================================================
// Rule 3 — metcon one piece (block_scheme required)
// ============================================================

Deno.test("auditMetconOnePiece: metcon block with block_scheme → passes", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks.push(
    block("metcon", [mv("Burpee", { reps: 10 })], { block_scheme: "21-15-9 for time" }),
  );
  const result = auditMetconOnePiece(out);
  assert(result.passed);
  assertEquals(result.violations.length, 0);
});

Deno.test("auditMetconOnePiece: metcon block with no scheme → fails", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks.push(
    block("metcon", [mv("Burpee", { reps: 10 })]),
  );
  const result = auditMetconOnePiece(out);
  assert(!result.passed);
  assertEquals(result.violations.length, 1);
  assert(result.violations[0].includes("Week 1 Day 1"));
  assert(result.violations[0].includes("block_scheme is missing"));
});

Deno.test("auditMetconOnePiece: metcon block with whitespace-only scheme → fails", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks.push(
    block("metcon", [mv("Burpee", { reps: 10 })], { block_scheme: "   " }),
  );
  const result = auditMetconOnePiece(out);
  assert(!result.passed);
});

Deno.test("auditMetconOnePiece: non-metcon block without scheme → does NOT trigger", () => {
  const out = baselineOutput();
  // The baseline strength block has no block_scheme — should not be flagged.
  const result = auditMetconOnePiece(out);
  assert(result.passed);
});

// ============================================================
// Rule 4 — required fields
// ============================================================

Deno.test("auditRequiredFields: every block has movements and prescriptions → passes", () => {
  const out = baselineOutput();
  const result = auditRequiredFields(out);
  assert(result.passed);
  assertEquals(result.violations.length, 0);
});

Deno.test("auditRequiredFields: block with empty movements[] → fails", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks.push(block("accessory", []));
  const result = auditRequiredFields(out);
  assert(!result.passed);
  assertEquals(result.violations.length, 1);
  assert(result.violations[0].includes("no movements"));
});

Deno.test("auditRequiredFields: movement with no prescription fields → fails", () => {
  const out = baselineOutput();
  // Movement that satisfies the schema (has `movement` name) but no prescription.
  out.weeks[0].days[0].blocks.push(
    block("accessory", [{ movement: "Dumbbell Row" }]),
  );
  const result = auditRequiredFields(out);
  assert(!result.passed);
  assert(result.violations[0].includes("Dumbbell Row"));
  assert(result.violations[0].includes("none of"));
});

Deno.test("auditRequiredFields: movement with only time_seconds counts as prescribed", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks.push(
    block("active-recovery", [{ movement: "Row", time_seconds: 600 }]),
  );
  const result = auditRequiredFields(out);
  assert(result.passed);
});

// ============================================================
// Rule 5 — day count
// ============================================================

Deno.test("auditDayCount: 4 weeks × N days with proper numbering → passes", () => {
  const out = baselineOutput(4);
  const result = auditDayCount(out, 4);
  assert(result.passed);
  assertEquals(result.violations.length, 0);
});

Deno.test("auditDayCount: only 3 weeks emitted → fails", () => {
  const out = baselineOutput();
  out.weeks.pop();
  const result = auditDayCount(out, 3);
  assert(!result.passed);
  assert(result.violations.some((v) => v.includes("3 weeks")));
});

Deno.test("auditDayCount: wrong days_per_week → fails", () => {
  const out = baselineOutput(3);
  // Drop a day from week 2 so it has 2 instead of 3.
  out.weeks[1].days.pop();
  const result = auditDayCount(out, 3);
  assert(!result.passed);
  assert(
    result.violations.some((v) =>
      v.includes("Week 2") && v.includes("2 days")
    ),
  );
});

Deno.test("auditDayCount: duplicate day_num within a week → fails", () => {
  const out = baselineOutput(3);
  out.weeks[0].days[1].day_num = 1;
  const result = auditDayCount(out, 3);
  assert(!result.passed);
  assert(
    result.violations.some((v) =>
      v.includes("Week 1") && v.includes("duplicate day_num")
    ),
  );
});

Deno.test("auditDayCount: duplicate week_num → fails", () => {
  const out = baselineOutput(3);
  out.weeks[1].week_num = 1;
  const result = auditDayCount(out, 3);
  assert(!result.passed);
  assert(result.violations.some((v) => v.includes("Duplicate week_num")));
});

// ============================================================
// Rule 6 — load sanity
// ============================================================

Deno.test("auditLoadSanity: prescribed weight ≤ 1RM → passes", () => {
  const out = baselineOutput();
  // Baseline prescribes Back Squat @ 200; athlete's 1RM = 405.
  const result = auditLoadSanity(out, { back_squat: 405 });
  assert(result.passed);
  assertEquals(result.violations.length, 0);
});

Deno.test("auditLoadSanity: prescribed weight > 1RM → fails", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks[0].movements[0].weight = 500;
  const result = auditLoadSanity(out, { back_squat: 405 });
  assert(!result.passed);
  assert(result.violations[0].includes("Back Squat"));
  assert(result.violations[0].includes("500"));
  assert(result.violations[0].includes("405"));
});

Deno.test("auditLoadSanity: 1rm_attempt scheme is an intentional exception", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks[0].movements[0].weight = 500;
  out.weeks[0].days[0].blocks[0].block_scheme = "Work up to a new 1RM";
  const result = auditLoadSanity(out, { back_squat: 405 });
  assert(result.passed);
});

Deno.test("auditLoadSanity: unmapped movement at reasonable weight passes the fallback", () => {
  const out = baselineOutput();
  // KB Swing is unmapped; 50 lbs is well under the athlete's max 1RM of 405.
  out.weeks[0].days[0].blocks[0].movements[0] = mv("Kettlebell Swing", { weight: 50 });
  const result = auditLoadSanity(out, { back_squat: 405 });
  assert(result.passed);
});

Deno.test("auditLoadSanity: unmapped movement above max 1RM trips the fallback", () => {
  const out = baselineOutput();
  // Snatch Pull is unmapped and 9999 lbs is wildly above max(lifts).
  out.weeks[0].days[0].blocks[0].movements[0] = mv("Snatch Pull", { weight: 9999 });
  const result = auditLoadSanity(out, { back_squat: 405 });
  assert(!result.passed);
  assert(result.violations[0].includes("Snatch Pull"));
  assert(result.violations[0].includes("fallback cap"));
});

Deno.test("auditLoadSanity: missing 1RM in lifts map is skipped (nothing to compare)", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks[0].movements[0].weight = 500;
  const result = auditLoadSanity(out, { back_squat: null });
  assert(result.passed);
});

Deno.test("auditLoadSanity: strict_press alias maps to press 1RM", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks[0].movements[0] = mv("Strict Press", { weight: 200 });
  const result = auditLoadSanity(out, { press: 135 });
  assert(!result.passed);
  assert(result.violations[0].includes("Strict Press"));
});

// ============================================================
// Rule 7 — vocabulary compliance
// ============================================================

Deno.test("auditVocabularyCompliance: all movements in vocab → passes", () => {
  const out = baselineOutput();
  const result = auditVocabularyCompliance(out, ["Back Squat"]);
  assert(result.passed);
  assertEquals(result.violations.length, 0);
});

Deno.test("auditVocabularyCompliance: unknown movement → fails", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks[0].movements[0] = mv("Made Up Movement", { weight: 100 });
  const result = auditVocabularyCompliance(out, ["Back Squat"]);
  assert(!result.passed);
  assert(result.violations[0].includes("Made Up Movement"));
  assert(result.violations[0].includes("not in the vocabulary"));
});

Deno.test("auditVocabularyCompliance: same unknown movement across many days dedupes to 1 violation", () => {
  const out = baselineOutput();
  // Every baseline day uses Back Squat. Make all of them unknown.
  for (const w of out.weeks) {
    for (const d of w.days) {
      d.blocks[0].movements[0] = mv("Made Up Movement", { weight: 100 });
    }
  }
  const result = auditVocabularyCompliance(out, ["Back Squat"]);
  assert(!result.passed);
  assertEquals(result.violations.length, 1);
});

Deno.test("auditVocabularyCompliance: exact-string match is required (case sensitive)", () => {
  const out = baselineOutput();
  out.weeks[0].days[0].blocks[0].movements[0].movement = "back squat"; // lowercase
  const result = auditVocabularyCompliance(out, ["Back Squat"]);
  assert(!result.passed);
});
