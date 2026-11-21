/**
 * Unit tests for signature-program-variation. Run with:
 *   deno test supabase/functions/_shared/signature-program-variation_test.ts --no-check
 */

import { assert, assertEquals, assertThrows } from "jsr:@std/assert";

import { AXIS_CLASS } from "./signature-distance.ts";
import { programVariation, type ProgramPiece } from "./signature-program-variation.ts";

const ENGINE = { aerobic_capacity: 60, squat_cycling: 40 };
const HEAVY = { powerlifting_strength: 70, olympic_lifting: 30 };
const GYMNASTY = { gymnastics_pulling: 50, gymnastics_pressing: 50 };
const EVEN = Object.fromEntries(Object.keys(AXIS_CLASS).map((a) => [a, 100 / 12]));

const piece = (position: number, demand: Record<string, number>, extra: Partial<ProgramPiece["signature"]> = {}, label?: string): ProgramPiece => ({
  position,
  label,
  signature: { demand, ...extra },
});

Deno.test("coverage: the average vector, its evenness and what was never touched", () => {
  const v = programVariation([piece(1, ENGINE), piece(2, HEAVY)]);
  assertEquals(v.n, 2);
  assertEquals(v.coverage.mean, {
    olympic_lifting: 15,
    powerlifting_strength: 35,
    squat_cycling: 20,
    aerobic_capacity: 30,
  });
  assertEquals(v.coverage.class_totals, { strength: 50, gymnastics_skill: 0, conditioning: 50 });
  assertEquals(v.coverage.untouched.length, 8);
  assertEquals(v.coverage.top, { axis: "powerlifting_strength", share: 35 });
  assert(v.coverage.effective_axes > 3 && v.coverage.effective_axes < 4);
});

Deno.test("coverage evenness runs from 0 (one axis) to 1 (all twelve equal)", () => {
  const one = programVariation([piece(1, { midline: 100 })]);
  assertEquals(one.coverage.evenness, 0);
  assertEquals(one.coverage.effective_axes, 1);
  const all = programVariation([piece(1, EVEN)]);
  assertEquals(all.coverage.evenness, 1);
  assertEquals(all.coverage.effective_axes, 12);
  assertEquals(all.coverage.untouched, []);
});

Deno.test("the same balanced piece every day: full coverage, zero dispersion", () => {
  const v = programVariation([1, 2, 3, 4, 5].map((d) => piece(d, EVEN)));
  assertEquals(v.coverage.evenness, 1);
  assertEquals(v.dispersion?.mean, 0);
  assertEquals(v.dispersion?.mean_nearest, 0);
  assertEquals(v.spacing?.ratio, null); // nothing to space
});

Deno.test("dispersion: pairwise summary, closest pair, and repeats show in mean_nearest", () => {
  const v = programVariation(
    [piece(1, ENGINE, {}, "mon"), piece(2, HEAVY, {}, "tue"), piece(3, GYMNASTY, {}, "wed"), piece(4, ENGINE, {}, "thu")],
    { noiseFloor: 15 },
  );
  const d = v.dispersion!;
  assertEquals(d.pairs, 6);
  assertEquals(d.max, 100);
  assertEquals(d.min, 0);
  assertEquals(d.closest, { a: "mon", b: "thu", distance: 0 });
  assertEquals(d.mean, round3(500 / 6));
  assertEquals(d.mean_nearest, 50); // two repeats at 0, two singletons at 100
  assertEquals(d.pairs_within_noise, 1);
  assertEquals(programVariation([piece(1, ENGINE), piece(2, HEAVY)]).dispersion?.pairs_within_noise, null);
});

Deno.test("spacing: alternating reads above 1, blocked reads below 1, same pieces either way", () => {
  const alternating = programVariation([ENGINE, HEAVY, ENGINE, HEAVY, ENGINE, HEAVY].map((w, i) => piece(i, w)));
  const blocked = programVariation([ENGINE, ENGINE, ENGINE, HEAVY, HEAVY, HEAVY].map((w, i) => piece(i, w)));
  // Same set → same coverage and dispersion; only the order differs.
  assertEquals(alternating.coverage, blocked.coverage);
  // (the closest pair is named by position, so it is the one field that moves)
  assertEquals({ ...alternating.dispersion, closest: null }, { ...blocked.dispersion, closest: null });
  assertEquals(alternating.spacing!.shuffled_mean, 60);
  assertEquals(alternating.spacing!.adjacent_mean, 100);
  assertEquals(alternating.spacing!.ratio, round3(100 / 60));
  assertEquals(blocked.spacing!.adjacent_mean, 20);
  assertEquals(blocked.spacing!.ratio, round3(20 / 60));
  assertEquals(alternating.spacing!.shuffle_percentile, 1);
  assert(blocked.spacing!.shuffle_percentile < 0.25);
  assertEquals(alternating.spacing!.by_axis.aerobic_capacity, round3(100 / 60));
  assertEquals(blocked.spacing!.by_axis.aerobic_capacity, round3(20 / 60));
  assertEquals("midline" in alternating.spacing!.by_axis, false); // never varies
});

Deno.test("spacing is reproducible (seeded) and reads program order, not input order", () => {
  const inOrder = [ENGINE, HEAVY, GYMNASTY, ENGINE, HEAVY, GYMNASTY, EVEN].map((w, i) => piece(i, w));
  const scrambled = [inOrder[4], inOrder[0], inOrder[6], inOrder[2], inOrder[1], inOrder[5], inOrder[3]];
  const a = programVariation(inOrder);
  assertEquals(programVariation(inOrder).spacing, a.spacing);
  assertEquals(programVariation(scrambled).spacing, a.spacing);
});

Deno.test("weight by dose: a long piece counts for more in coverage", () => {
  const short = piece(1, ENGINE, { measured: { median_seconds: 300 } });
  const long = piece(2, HEAVY, { workout: { time_cap_seconds: 900 } });
  const v = programVariation([short, long], { weight: "dose" });
  assertEquals(v.coverage.class_totals, { strength: 75, gymnastics_skill: 0, conditioning: 25 });
  assertThrows(() => programVariation([short, piece(3, HEAVY)], { weight: "dose" }), Error, "no duration");
});

Deno.test("another vector can be read; pieces without it are skipped and named", () => {
  const v = programVariation(
    [piece(1, ENGINE, { discrimination: HEAVY }, "a"), piece(2, ENGINE, {}, "b"), piece(3, ENGINE, { discrimination: GYMNASTY }, "c")],
    { vector: "discrimination" },
  );
  assertEquals(v.n, 2);
  assertEquals(v.skipped, ["b"]);
  assertEquals(v.dispersion?.mean, 100);
  assertEquals(v.spacing, null); // fewer than three measured
  assertThrows(() => programVariation([piece(1, ENGINE)], { vector: "stimulus" }), Error, "no piece carries");
});

Deno.test("one piece: coverage only", () => {
  const v = programVariation([piece(1, ENGINE)]);
  assertEquals(v.dispersion, null);
  assertEquals(v.spacing, null);
  assertThrows(() => programVariation([piece(1, { aerobic_capacity: 90 })]), Error, "must sum to 100");
});

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
