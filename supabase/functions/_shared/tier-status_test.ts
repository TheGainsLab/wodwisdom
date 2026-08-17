/**
 * Unit tests for the tier-completeness gate. Run with:
 *   deno test supabase/functions/_shared/tier-status_test.ts --no-check
 *
 * Focus: the relaxed conditioning gate (Aug '26) — T2's conditioning section
 * requires only a 2k row plus ONE run (mile or 5k); the other benchmarks are
 * optional depth and must not block the free evaluation.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import {
  type AthleteProfileInput,
  conditioningStatus,
  getTierStatus,
  RUN_BENCHMARK_MISSING_LABEL,
} from "./tier-status.ts";

/** T1 basics + required lifts + all skills rated — everything but conditioning. */
function baseProfile(conditioning: AthleteProfileInput["conditioning"]): AthleteProfileInput {
  const skills: Record<string, string> = {};
  for (const k of [
    "muscle_ups", "bar_muscle_ups", "strict_ring_muscle_ups", "toes_to_bar",
    "strict_pull_ups", "kipping_pull_ups", "butterfly_pull_ups", "chest_to_bar_pull_ups",
    "rope_climbs", "legless_rope_climbs", "wall_facing_hspu", "hspu", "strict_hspu",
    "deficit_hspu", "ring_dips", "l_sit", "handstand_walk", "double_unders",
    "pistols", "ghd_sit_ups",
  ]) skills[k] = "none";
  return {
    age: 34,
    height: 70,
    bodyweight: 185,
    gender: "male",
    units: "lbs",
    lifts: { back_squat: 315, deadlift: 405, bench_press: 225, snatch: 155, clean_and_jerk: 205 },
    skills,
    conditioning,
  };
}

Deno.test("2k row + mile satisfies the conditioning gate (other benchmarks blank)", () => {
  const status = getTierStatus(baseProfile({ "2k_row": "7:30", "1_mile_run": "6:45" }));
  assert(status.tier2.complete);
  assert(status.canRunEval);
});

Deno.test("2k row + 5k run also satisfies the gate (either run counts)", () => {
  const status = getTierStatus(baseProfile({ "2k_row": "7:30", "5k_run": "22:30" }));
  assert(status.tier2.complete);
  assert(status.canRunEval);
});

Deno.test("2k row alone is not enough — a run time is required", () => {
  const status = getTierStatus(baseProfile({ "2k_row": "7:30" }));
  assert(!status.tier2.complete);
  assertEquals(status.tier2.missing, ["conditioning"]);
  assert(!status.canRunEval);
});

Deno.test("runs alone are not enough — the 2k row is required", () => {
  const status = getTierStatus(baseProfile({ "1_mile_run": "6:45", "5k_run": "22:30" }));
  assert(!status.tier2.complete);
  assertEquals(status.tier2.missing, ["conditioning"]);
});

Deno.test("optional benchmarks alone don't satisfy the gate", () => {
  const status = getTierStatus(baseProfile({
    "1k_row": "3:45", "5k_row": "20:00", "1min_bike_cals": 25, "10min_bike_cals": 180,
  }));
  assert(!status.tier2.complete);
});

Deno.test("blank-string and zero values don't count as filled", () => {
  const status = getTierStatus(baseProfile({ "2k_row": "  ", "1_mile_run": 0 }));
  assert(!status.tier2.complete);
});

Deno.test("conditioningStatus names the required gaps legibly", () => {
  const empty = conditioningStatus({});
  assertEquals(empty.missing, ["2k_row", RUN_BENCHMARK_MISSING_LABEL]);
  assert(!empty.complete);

  const noRun = conditioningStatus({ "2k_row": "7:30" });
  assertEquals(noRun.missing, [RUN_BENCHMARK_MISSING_LABEL]);

  const noRow = conditioningStatus({ "1_mile_run": "6:45" });
  assertEquals(noRow.missing, ["2k_row"]);

  const done = conditioningStatus({ "2k_row": "7:30", "5k_run": "22:30" });
  assert(done.complete);
  assertEquals(done.missing, []);
});

Deno.test("conditioningStatus count stays an all-benchmarks fill count", () => {
  const s = conditioningStatus({ "2k_row": "7:30", "1_mile_run": "6:45", "1k_row": "3:45" });
  assert(s.complete);
  assertEquals(s.count, 3);
  assertEquals(s.required, 7);
});
