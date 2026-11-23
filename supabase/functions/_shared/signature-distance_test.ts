/**
 * Unit tests for signature-distance. Run with:
 *   deno test supabase/functions/_shared/signature-distance_test.ts --no-check
 *
 * The library fixtures are real approved rows (2026-11-01), so the expected
 * numbers are the ones worked by hand in the variation review.
 */

import { assertEquals, assertThrows } from "jsr:@std/assert";

import {
  AXIS_CLASS,
  doseDistance,
  gateDistance,
  mixDistance,
  movementDistance,
  signatureDistance,
  type SignatureLike,
} from "./signature-distance.ts";

// 18.4 and 20.3 are the same workout, signed twice.
const D_18_4 = { posterior_chain: 20, skill_coordination: 20, gymnastics_pressing: 25, powerlifting_strength: 35 };
const D_20_3 = {
  aerobic_capacity: 10,
  anaerobic_capacity: 10,
  skill_coordination: 15,
  gymnastics_pressing: 30,
  powerlifting_strength: 30,
  mixed_modal_conditioning: 5,
};
// 22.3 and 25.2: also one workout, signed twice.
const D_22_3 = {
  squat_cycling: 20,
  anaerobic_capacity: 10,
  gymnastics_pulling: 30,
  skill_coordination: 10,
  powerlifting_strength: 25,
  mixed_modal_conditioning: 5,
};
const D_25_2 = {
  squat_cycling: 10,
  aerobic_capacity: 15,
  anaerobic_capacity: 10,
  gymnastics_pulling: 30,
  skill_coordination: 15,
  powerlifting_strength: 20,
};

Deno.test("the class map covers the twelve axes, four per class", () => {
  assertEquals(Object.keys(AXIS_CLASS).length, 12);
  for (const c of ["strength", "gymnastics_skill", "conditioning"]) {
    assertEquals(Object.values(AXIS_CLASS).filter((x) => x === c).length, 4);
  }
});

Deno.test("identical vectors are 0 apart", () => {
  const d = mixDistance(D_18_4, { ...D_18_4 });
  assertEquals(d.total, 0);
  assertEquals(d.by_axis, {});
  assertEquals(d.between_class, 0);
  assertEquals(d.within_class, 0);
});

Deno.test("vectors with no axis in common are 100 apart", () => {
  const d = mixDistance({ aerobic_capacity: 100 }, { olympic_lifting: 60, midline: 40 });
  assertEquals(d.total, 100);
  assertEquals(d.between_class, 100);
});

Deno.test("18.4 vs 20.3: 30 apart, 25 of it strength → conditioning", () => {
  const d = mixDistance(D_18_4, D_20_3);
  assertEquals(d.total, 30);
  assertEquals(d.class_totals.a, { strength: 55, gymnastics_skill: 45, conditioning: 0 });
  assertEquals(d.class_totals.b, { strength: 30, gymnastics_skill: 45, conditioning: 25 });
  assertEquals(d.between_class, 25);
  assertEquals(d.within_class, 5);
  assertEquals(d.by_axis, {
    powerlifting_strength: -5,
    posterior_chain: -20,
    gymnastics_pressing: 5,
    skill_coordination: -5,
    aerobic_capacity: 10,
    anaerobic_capacity: 10,
    mixed_modal_conditioning: 5,
  });
});

Deno.test("22.3 vs 25.2: 20 apart, mostly a reshuffle inside classes", () => {
  const d = mixDistance(D_22_3, D_25_2);
  assertEquals(d.total, 20);
  assertEquals(d.between_class, 5);
  assertEquals(d.within_class, 15);
});

Deno.test("the total is symmetric; by_axis flips sign", () => {
  const ab = mixDistance(D_18_4, D_20_3);
  const ba = mixDistance(D_20_3, D_18_4);
  assertEquals(ab.total, ba.total);
  assertEquals(ab.between_class, ba.between_class);
  assertEquals(ab.by_axis.posterior_chain, -20);
  assertEquals(ba.by_axis.posterior_chain, 20);
});

Deno.test("averaged (non-5%-step) vectors are valid input", () => {
  const avg = { aerobic_capacity: 33.3333, squat_cycling: 33.3333, midline: 33.3334 };
  const d = mixDistance(avg, { aerobic_capacity: 50, squat_cycling: 50 });
  assertEquals(d.total, 33.333);
});

Deno.test("bad vectors are refused, not silently measured", () => {
  assertThrows(() => mixDistance({ aerobic_capacity: 90 }, D_18_4), Error, "must sum to 100");
  assertThrows(() => mixDistance({ cardio: 100 }, D_18_4), Error, "not a signature axis");
  assertThrows(
    () => mixDistance({ aerobic_capacity: 120, midline: -20 }, D_18_4),
    Error,
    "non-negative",
  );
});

Deno.test("dose is a ratio: 5 vs 10 minutes reads the same as 20 vs 40", () => {
  const sig = (s: number): SignatureLike => ({ demand: D_18_4, measured: { median_seconds: s } });
  const short = doseDistance(sig(300), sig(600))!;
  const long = doseDistance(sig(2400), sig(1200))!;
  assertEquals(short.ratio, 2);
  assertEquals(long.ratio, 2);
  assertEquals(short.log2_ratio, 1);
  assertEquals(doseDistance(sig(540), sig(540))!.log2_ratio, 0);
});

Deno.test("dose falls back to the time cap, and is null without either", () => {
  const amrap: SignatureLike = { demand: D_18_4, measured: { median_seconds: null }, workout: { time_cap_seconds: 900 } };
  const timed: SignatureLike = { demand: D_18_4, measured: { median_seconds: 450 } };
  const d = doseDistance(amrap, timed)!;
  assertEquals(d.basis_a, "time_cap");
  assertEquals(d.basis_b, "measured_median");
  assertEquals(d.ratio, 2);
  assertEquals(doseDistance(amrap, { demand: D_18_4 }), null);
});

Deno.test("movement overlap normalizes names and counts a repeated movement once", () => {
  const a: SignatureLike = {
    demand: D_18_4,
    workout: {
      movements: [{ movement: "Deadlift" }, { movement: "Handstand Push-Up" }, { movement: "Deadlift" }, {
        movement: "Handstand Walk",
      }],
    },
  };
  const b: SignatureLike = {
    demand: D_18_4,
    workout: { movements: [{ movement: "deadlift" }, { movement: "handstand push up" }, { movement: "Row" }] },
  };
  const d = movementDistance(a, b);
  assertEquals(d.shared, ["deadlift", "handstand push up"]);
  assertEquals(d.only_a, ["handstand walk"]);
  assertEquals(d.only_b, ["row"]);
  assertEquals(d.jaccard_distance, 0.5);
  assertEquals(movementDistance({ demand: D_18_4 }, { demand: D_18_4 }).jaccard_distance, 0);
});

Deno.test("gates compare on movement and kind", () => {
  const a: SignatureLike = { demand: D_18_4, gates: [{ movement: "Bar Muscle-Up", kind: "skill" }] };
  const b: SignatureLike = { demand: D_18_4, gates: [] };
  const d = gateDistance(a, b);
  assertEquals(d.only_a, ["bar muscle up (skill)"]);
  assertEquals(d.jaccard_distance, 1);
  assertEquals(gateDistance(a, a).jaccard_distance, 0);
});

Deno.test("signatureDistance returns every component and nulls what is missing", () => {
  const a: SignatureLike = {
    demand: D_18_4,
    discrimination: D_18_4,
    stimulus: null,
    format: "for_time",
    time_domain: "short",
    measured: { median_seconds: 480 },
    workout: { movements: [{ movement: "Deadlift" }] },
  };
  const b: SignatureLike = {
    demand: D_20_3,
    discrimination: D_20_3,
    stimulus: D_20_3,
    format: "for_time",
    time_domain: null,
    measured: { median_seconds: 480 },
    workout: { movements: [{ movement: "Deadlift" }] },
  };
  const d = signatureDistance(a, b);
  assertEquals(d.demand.total, 30);
  assertEquals(d.discrimination?.total, 30);
  assertEquals(d.stimulus, null);
  assertEquals(d.dose?.ratio, 1);
  assertEquals(d.movements.jaccard_distance, 0);
  assertEquals(d.same_format, true);
  assertEquals(d.same_time_domain, null);
});
