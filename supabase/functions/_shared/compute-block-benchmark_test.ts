// Pure-helper tests for the scoring engine's reading rules — the three
// misreads the first acceptance audit caught (2026-11-03), pinned so they
// stay fixed: box height in inches is not travel volume, a varying ladder
// is not endless 3-rep rounds, and a capped piece whose predicted finish
// exceeds the cap scores reps, not a time. The service-dependent pipeline
// is exercised by the scorescale_acceptance action against live data; the
// rules here are the parts that must hold with no service at all.
//
// Run with:
//   deno test supabase/functions/_shared/compute-block-benchmark_test.ts --no-check

import {
  composeEngineVersion,
  isVaryingLadder,
  repsAtCap,
  SCORE_ENGINE_CODE_VERSION,
  toWorkCalcMovement,
} from "./compute-block-benchmark.ts";
import type { BlockPrescription, MovementPrescription } from "./v2-output-schema.ts";

function expectEq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: got ${a}, wanted ${e}`);
}

Deno.test("inches are a box height, not travel volume: falls through to reps", () => {
  // 11.2's box jump — distance 24 "in" plus rep_scheme [15]. Run 1 of the
  // audit nulled the whole block on the unmappable unit.
  const m = { movement: "Box Jump", distance: 24, distance_unit: "in", rep_scheme: [15] } as unknown as MovementPrescription;
  expectEq(toWorkCalcMovement(m, "amrap")?.reps_per_round, 15, "amrap reps_per_round");
  expectEq(toWorkCalcMovement(m, "for_time")?.reps_total, 15, "for_time reps_total");
  expectEq(toWorkCalcMovement(m, "for_time")?.distance_value, undefined, "no distance leaks");
});

Deno.test("mappable distance units still win over reps", () => {
  const m = { movement: "Row", distance: 300, distance_unit: "m" } as unknown as MovementPrescription;
  const out = toWorkCalcMovement(m, "for_time")!;
  expectEq(out.distance_value, 300, "meters value");
  expectEq(out.distance_unit, "meters", "meters unit");
  const lunge = {
    movement: "Dumbbell Front-Rack Walking Lunge",
    distance_scheme: [50, 50, 50, 50],
    distance_unit: "ft",
  } as unknown as MovementPrescription;
  expectEq(toWorkCalcMovement(lunge, "amrap")?.distance_value, 200, "distance_scheme sums");
});

Deno.test("calorie schemes sum; no volume at all is null", () => {
  const row = { movement: "Row", cal_scheme: [27, 21, 15, 9] } as unknown as MovementPrescription;
  expectEq(toWorkCalcMovement(row, "for_time")?.calories, 72, "cal_scheme sums");
  const bare = { movement: "Burpee" } as unknown as MovementPrescription; // 12.1's row
  expectEq(toWorkCalcMovement(bare, "amrap"), null, "volume-less movement is null");
});

Deno.test("varying ladder detection: 3-6-9 yes, fixed rounds no", () => {
  const mk = (rs: number[]): BlockPrescription =>
    ({
      block_type: "metcon",
      movements: [{ movement: "Thruster", rep_scheme: rs }],
    }) as unknown as BlockPrescription;
  expectEq(isVaryingLadder(mk([3, 6, 9, 12, 15, 18, 21])), true, "ascending ladder");
  expectEq(isVaryingLadder(mk([8, 8, 8, 8])), false, "fixed rounds");
  expectEq(isVaryingLadder(mk([15])), false, "single set");
});

Deno.test("reps-at-cap: linear-in-time conversion, only past the cap", () => {
  // predicted 14:50 (890 s) on a 12:00 cap over 300 total reps
  expectEq(repsAtCap(300, 720, 890), 242, "capped prediction converts");
  expectEq(repsAtCap(300, 720, 700), null, "finisher stays a time");
  expectEq(repsAtCap(0, 720, 890), null, "no reps, no conversion");
});

Deno.test("engine version composes code + curve generation", () => {
  expectEq(
    composeEngineVersion("2026-10-30"),
    `${SCORE_ENGINE_CODE_VERSION}+calc:2026-10-30`,
    "with calc_version",
  );
  expectEq(
    composeEngineVersion(null),
    `${SCORE_ENGINE_CODE_VERSION}+calc:unknown`,
    "without calc_version",
  );
});
