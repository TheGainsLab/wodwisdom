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
function baseProfile(conditioning: AthleteProfileInput["conditioning"], reviewed = true): AthleteProfileInput {
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
    // Tier 2 is complete once the athlete has REVIEWED the section
    // (2026-10-05); the data-shape gaps are informational (`missing`).
    athletic_reviewed_at: reviewed ? "2026-10-05T00:00:00.000Z" : null,
    conditioning,
  };
}

Deno.test("2k row + mile: nothing missing, and a reviewed profile can run the evaluation", () => {
  const status = getTierStatus(baseProfile({ "2k_row": "7:30", "1_mile_run": "6:45" }));
  assertEquals(status.tier2.missing, []);
  assert(status.tier2.complete);
  assert(status.canRunEval);
});

Deno.test("2k row + 5k run: either run counts", () => {
  const status = getTierStatus(baseProfile({ "2k_row": "7:30", "5k_run": "22:30" }));
  assertEquals(status.tier2.missing, []);
  assert(status.tier2.complete);
});

Deno.test("2k row alone: conditioning is listed as missing, but a reviewed profile is not blocked", () => {
  const status = getTierStatus(baseProfile({ "2k_row": "7:30" }));
  assertEquals(status.tier2.missing, ["conditioning"]);
  assert(status.tier2.complete); // gaps are informational since 2026-10-05
  assert(status.canRunEval);
});

Deno.test("runs alone: the 2k row is listed as missing", () => {
  const status = getTierStatus(baseProfile({ "1_mile_run": "6:45", "5k_run": "22:30" }));
  assertEquals(status.tier2.missing, ["conditioning"]);
});

Deno.test("optional benchmarks alone leave conditioning listed as missing", () => {
  const status = getTierStatus(baseProfile({
    "1k_row": "3:45", "5k_row": "20:00", "1min_bike_cals": 25, "10min_bike_cals": 180,
  }));
  assertEquals(status.tier2.missing, ["conditioning"]);
});

Deno.test("blank-string and zero values don't count as filled", () => {
  const status = getTierStatus(baseProfile({ "2k_row": "  ", "1_mile_run": 0 }));
  assertEquals(status.tier2.missing, ["conditioning"]);
});

Deno.test("a profile that was never reviewed is not complete, however full its data", () => {
  const status = getTierStatus(baseProfile({ "2k_row": "7:30", "1_mile_run": "6:45" }, false));
  assertEquals(status.tier2.missing, []);
  assert(!status.tier2.complete);
  assert(!status.canRunEval);
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
