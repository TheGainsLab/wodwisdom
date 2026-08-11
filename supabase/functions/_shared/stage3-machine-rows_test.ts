/**
 * stage3-machine-rows_test.ts
 *
 * Unit tests for the Stage 3 shadow-test machine rows (M1–M5). Fixtures are
 * hand-built minimal skeletons — each test isolates one row's contract from
 * the frozen rubric.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SkeletonOutput, WeekSkeleton, DaySkeleton, BlockIntent } from "./v3-output-schema.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";
import {
  crossCheckWithLiveInvariants,
  machineRowM1,
  machineRowM2,
  machineRowM3,
  machineRowM4,
  machineRowM5,
  machineRowM6,
  machineRowM7,
  machineRowM8,
  runMachineRows,
  summarizeMachineRows,
} from "./stage3-machine-rows.ts";

// ============================================================
// Fixture builders
// ============================================================

function day(num: number, overrides: Partial<DaySkeleton> = {}): DaySkeleton {
  return {
    day_num: num,
    day_intent: "heavy squat + short metcon",
    block_types: ["warm-up", "skills", "strength", "accessory", "metcon", "cool-down"],
    primary_lift: "Back Squat",
    strength_scheme: "5x5 @75%",
    metcon_focus: "short power couplet (6-8 min)",
    skill_focus: "Skill maintenance EMOM",
    block_intents: [],
    ...overrides,
  };
}

function week(num: number, days: DaySkeleton[], intent = "build"): WeekSkeleton {
  return { week_num: num, weekly_intent: intent, days };
}

/** 4 weeks × 2 days, week 4 deload-marked, placement prose naming week 4. */
function baseSkeleton(intentsPerDay: BlockIntent[]): SkeletonOutput {
  const mkWeek = (n: number, intent: string) =>
    week(n, [day(1, { block_intents: intentsPerDay }), day(2, { block_intents: intentsPerDay })], intent);
  return {
    month_plan: {
      weekly_intent: ["build", "build", "build", "deload"],
      strength_progression: "linear",
      deload_placement: "Week 4 deload — reduced volume before retest.",
    },
    weeks: [mkWeek(1, "build"), mkWeek(2, "build"), mkWeek(3, "build"), mkWeek(4, "deload")],
  };
}

function tdi(overrides: Partial<TrainingDesignInput> = {}): TrainingDesignInput {
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
    ...overrides,
  };
}

/** Intents satisfying M3/M4/M5 for the default tdi(): rank-1 dose 2 (per day ×
 *  8 days = 16 vs 8 — per-day granularity is fine, only ordering matters). */
const CONFORMING_INTENTS: BlockIntent[] = [
  { block_type: "strength", focus: "olympic_lifting", purpose: "develop", source_priority_rank: 1 },
  { block_type: "skills", focus: "olympic_lifting", purpose: "develop", source_priority_rank: 1 },
  { block_type: "metcon", focus: "gymnastics_pulling", purpose: "develop", source_priority_rank: 2 },
  { block_type: "accessory", focus: "posterior_chain", purpose: "maintain" },
];

// ============================================================
// M1 — do_not_program string scan
// ============================================================

Deno.test("M1 passes on a clean skeleton", () => {
  const r = machineRowM1(baseSkeleton(CONFORMING_INTENTS), ["Box Jumps"]);
  assertEquals(r.passed, true);
});

Deno.test("M1 catches a banned movement in metcon_focus, plural-tolerant", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.weeks[0].days[0].metcon_focus = "box jump over ladder (10 min)";
  const r = machineRowM1(s, ["Box Jumps"]);
  assertEquals(r.passed, false);
  assertEquals(r.violations.length, 1);
});

Deno.test("M1 catches a banned base movement inside a variant name", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.weeks[2].days[1].primary_lift = "Power Snatch";
  const r = machineRowM1(s, ["snatch"]);
  assertEquals(r.passed, false);
});

Deno.test("M1 does not false-flag unrelated movements", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.weeks[0].days[0].metcon_focus = "rowing intervals";
  const r = machineRowM1(s, ["overhead squat"]);
  assertEquals(r.passed, true);
});

// ============================================================
// M2 — day count + deload↔stance
// ============================================================

Deno.test("M2 passes: standard stance, week-4 deload named in placement", () => {
  const r = machineRowM2(baseSkeleton(CONFORMING_INTENTS), 2, "standard");
  assertEquals(r.passed, true);
});

Deno.test("M2 fails: conservative stance with no deload-marked week", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.month_plan.weekly_intent = ["build", "build", "build", "build"];
  s.weeks.forEach((w) => (w.weekly_intent = "build"));
  const r = machineRowM2(s, 2, "conservative");
  assertEquals(r.passed, false);
});

Deno.test("M2 passes: aggressive stance with no deload-marked week", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.month_plan.weekly_intent = ["build", "build", "build", "build"];
  s.weeks.forEach((w) => (w.weekly_intent = "build"));
  s.month_plan.deload_placement = "No formal deload; volume managed within weeks.";
  const r = machineRowM2(s, 2, "aggressive");
  assertEquals(r.passed, true);
});

Deno.test("M2 fails: placement prose names the wrong week", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.month_plan.deload_placement = "Week 2 deload after the opening push.";
  const r = machineRowM2(s, 2, "standard");
  assertEquals(r.passed, false);
});

Deno.test("M2 accepts a week-1 post-competition deload", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.month_plan.weekly_intent = ["deload", "build", "build", "build"];
  s.weeks[0].weekly_intent = "recovery";
  s.weeks[3].weekly_intent = "build";
  s.month_plan.deload_placement = "Week 1 recovery after competition, then three build weeks.";
  const r = machineRowM2(s, 2, "conservative");
  assertEquals(r.passed, true);
});

Deno.test("M2 fails on day-count mismatch", () => {
  const r = machineRowM2(baseSkeleton(CONFORMING_INTENTS), 3, "standard");
  assertEquals(r.passed, false);
});

// ============================================================
// M3 / M4 — priority dosing
// ============================================================

Deno.test("M3 fails when a priority has no develop block", () => {
  const intents = CONFORMING_INTENTS.filter((i) => i.focus !== "gymnastics_pulling");
  const r = machineRowM3(baseSkeleton(intents), tdi());
  assertEquals(r.passed, false);
  assertEquals(r.violations.length, 1);
});

Deno.test("M4 passes when rank-1 out-doses rank-2, and on equal dose", () => {
  assertEquals(machineRowM4(baseSkeleton(CONFORMING_INTENTS), tdi()).passed, true);
  const equal: BlockIntent[] = [
    { block_type: "strength", focus: "olympic_lifting", purpose: "develop", source_priority_rank: 1 },
    { block_type: "metcon", focus: "gymnastics_pulling", purpose: "develop", source_priority_rank: 2 },
  ];
  assertEquals(machineRowM4(baseSkeleton(equal), tdi()).passed, true);
});

Deno.test("M4 fails on unambiguous starvation: total AND shared-type both inverted", () => {
  const inverted: BlockIntent[] = [
    { block_type: "skills", focus: "gymnastics_pulling", purpose: "develop", source_priority_rank: 2 },
    { block_type: "skills", focus: "gymnastics_pulling", purpose: "develop", source_priority_rank: 2 },
    { block_type: "skills", focus: "olympic_lifting", purpose: "develop", source_priority_rank: 1 },
  ];
  const r = machineRowM4(baseSkeleton(inverted), tdi());
  assertEquals(r.passed, false);
  assertEquals(r.violations.length, 1);
});

Deno.test("M4 within-type-only inversion is a warning when totals honor rank (placement freedom)", () => {
  // Rank-1 midline-style routing: 1 skills + 2 accessory (total 3); rank-2
  // gets 2 skills (total 2). Skills block inverts 2>1, totals don't.
  const placement: BlockIntent[] = [
    { block_type: "skills", focus: "olympic_lifting", purpose: "develop", source_priority_rank: 1 },
    { block_type: "accessory", focus: "olympic_lifting", purpose: "develop", source_priority_rank: 1 },
    { block_type: "accessory", focus: "olympic_lifting", purpose: "develop", source_priority_rank: 1 },
    { block_type: "skills", focus: "gymnastics_pulling", purpose: "develop", source_priority_rank: 2 },
    { block_type: "skills", focus: "gymnastics_pulling", purpose: "develop", source_priority_rank: 2 },
  ];
  const r = machineRowM4(baseSkeleton(placement), tdi());
  assertEquals(r.passed, true);
  assertEquals(r.violations, []);
  assertEquals((r.warnings ?? []).some((w) => w.includes("placement choice")), true);
});

Deno.test("M4 cross-type inversion is a warning, not a violation (letter-prescribed dose shapes)", () => {
  // Rank-2 lives only in skills (2 blocks); rank-1 lives only in metcon (1
  // block). No shared block type → no violation; total inversion → warning.
  const crossType: BlockIntent[] = [
    { block_type: "skills", focus: "gymnastics_pulling", purpose: "develop", source_priority_rank: 2 },
    { block_type: "skills", focus: "gymnastics_pulling", purpose: "develop", source_priority_rank: 2 },
    { block_type: "metcon", focus: "olympic_lifting", purpose: "develop", source_priority_rank: 1 },
  ];
  const r = machineRowM4(baseSkeleton(crossType), tdi());
  assertEquals(r.passed, true);
  assertEquals(r.violations, []);
  assertEquals((r.warnings ?? []).length > 0, true);
});

// ============================================================
// M7 — session budget (advisory: warnings only, never fails)
// ============================================================

Deno.test("M7 warns (but passes) when the metcon's stated duration can't fit the session", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.weeks[2].days[1].metcon_focus = "long mixed-modal chipper (18–22 min)";
  const r = machineRowM7(s, 60); // 22 + 45 > 60
  assertEquals(r.passed, true);
  assertEquals(r.violations.length, 0);
  assertEquals(r.warnings?.length, 1);
  assertEquals(r.warnings![0].includes("Week 3 Day 2"), true);
});

Deno.test("M7 warns on every metcon day when the session is shorter than the block estimate", () => {
  // 40-min athlete: 45-min flat estimate exceeds the session before any
  // metcon — the month-4 run that demoted M7 to advisory. All stated-duration
  // metcons warn; none fail.
  const r = machineRowM7(baseSkeleton(CONFORMING_INTENTS), 40);
  assertEquals(r.passed, true);
  assertEquals(r.violations.length, 0);
  assertEquals((r.warnings ?? []).length > 0, true);
});

Deno.test("M7 is silent when metcons fit, when duration is unstated, and when session length is unknown", () => {
  // baseSkeleton metcons are "(6-8 min)" — fit a 60-min session.
  assertEquals(machineRowM7(baseSkeleton(CONFORMING_INTENTS), 60).warnings, undefined);
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.weeks[0].days[0].metcon_focus = "coach's choice conditioning";
  assertEquals(machineRowM7(s, 60).warnings, undefined);
  const long = baseSkeleton(CONFORMING_INTENTS);
  long.weeks[0].days[0].metcon_focus = "long chipper (25 min)";
  assertEquals(machineRowM7(long, null).warnings, undefined);
});

// ============================================================
// M8 — block/intent reconciliation
// ============================================================

Deno.test("M8 fails on a phantom block: declared in block_types with no matching intent", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  // Remove day 1 week 1's metcon intent while the block_type stays declared.
  s.weeks[0].days[0].block_intents = s.weeks[0].days[0].block_intents.filter(
    (bi) => bi.block_type !== "metcon",
  );
  const r = machineRowM8(s);
  assertEquals(r.passed, false);
  assertEquals(r.violations.length, 1);
  assertEquals(r.violations[0].includes('"metcon"'), true);
});

Deno.test("M8 passes when every focus-bearing block has an intent (structural blocks exempt)", () => {
  // baseSkeleton days declare warm-up + cool-down with no intents — exempt.
  assertEquals(machineRowM8(baseSkeleton(CONFORMING_INTENTS)).passed, true);
});

// ============================================================
// M6 — progression truthfulness
// ============================================================

Deno.test("M6 fails when the plan promises a lift no day programs", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.month_plan.strength_progression =
    "Back Squat: W1 5×5 @75% → W3 4×3 @82%. Deadlift: W1 4×4 @75% → W3 3×3 @85%.";
  // baseSkeleton days all have primary_lift "Back Squat" — no deadlift day.
  const r = machineRowM6(s);
  assertEquals(r.passed, false);
  assertEquals(r.violations.length, 1);
  assertEquals(r.violations[0].includes("Deadlift"), true);
});

Deno.test("M6 passes when every promised lift is programmed", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.month_plan.strength_progression = "Back Squat: W1 5×5 @75% → W3 4×3 @82%.";
  assertEquals(machineRowM6(s).passed, true);
});

Deno.test("M6 ignores incidental lift mentions that aren't progression labels", () => {
  const s = baseSkeleton(CONFORMING_INTENTS);
  s.month_plan.strength_progression =
    "Back Squat: W1 5×5 → W3 4×3. Olympic maintenance: EMOM tech work (Hang Power Clean / Power Snatch variants) at 60-70%, held flat.";
  // Power Clean / Power Snatch appear only inside prose, not as "<Lift>:" labels.
  assertEquals(machineRowM6(s).passed, true);
});

// ============================================================
// M5 — maintain / deprioritize discipline
// ============================================================

Deno.test("M5 fails when a maintain focus never appears as maintain", () => {
  const intents = CONFORMING_INTENTS.filter((i) => i.purpose !== "maintain");
  const r = machineRowM5(baseSkeleton(intents), tdi());
  assertEquals(r.passed, false);
});

Deno.test("M5 fails when a maintain focus is developed", () => {
  const intents: BlockIntent[] = [
    ...CONFORMING_INTENTS,
    { block_type: "accessory", focus: "posterior_chain", purpose: "develop", source_priority_rank: 1 },
  ];
  const r = machineRowM5(baseSkeleton(intents), tdi());
  assertEquals(r.passed, false);
});

Deno.test("M5 fails when a deprioritized focus is developed", () => {
  const intents: BlockIntent[] = [
    ...CONFORMING_INTENTS,
    { block_type: "skills", focus: "upper_body_pressing", purpose: "develop", source_priority_rank: 1 },
  ];
  const r = machineRowM5(baseSkeleton(intents), tdi());
  assertEquals(r.passed, false);
});

// ============================================================
// Runner + cross-check
// ============================================================

Deno.test("runMachineRows passes a fully conforming pair and summarizes", () => {
  const result = runMachineRows(baseSkeleton(CONFORMING_INTENTS), tdi());
  assertEquals(result.passed, true);
  assertEquals(result.structural_failure, false);
  assertEquals(summarizeMachineRows(result), "M1=ok M2=ok M3=ok M4=ok M5=ok M6=ok M7=ok M8=ok");
});

Deno.test("runMachineRows fails all rows on a structurally broken skeleton", () => {
  const result = runMachineRows({} as SkeletonOutput, tdi());
  assertEquals(result.passed, false);
  assertEquals(result.structural_failure, true);
  assertEquals(result.rows.length, 8);
  assertEquals(result.rows.every((r) => !r.passed), true);
});

Deno.test("cross-check agrees with live invariants on conforming and broken fixtures", () => {
  assertEquals(crossCheckWithLiveInvariants(baseSkeleton(CONFORMING_INTENTS), tdi()), []);
  const missingPriority = CONFORMING_INTENTS.filter((i) => i.focus !== "gymnastics_pulling");
  assertEquals(crossCheckWithLiveInvariants(baseSkeleton(missingPriority), tdi()), []);
});
