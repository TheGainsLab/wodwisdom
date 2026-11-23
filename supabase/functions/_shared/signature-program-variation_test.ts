/**
 * Unit tests for signature-program-variation. Run with:
 *   deno test supabase/functions/_shared/signature-program-variation_test.ts --no-check
 */

import { assert, assertEquals, assertThrows } from "jsr:@std/assert";

import { AXIS_CLASS, type SignatureLike } from "./signature-distance.ts";
import {
  durationBin,
  formatFromSchemeText,
  pieceShape,
  programVariation,
  type ProgramPiece,
} from "./signature-program-variation.ts";

const ENGINE = { aerobic_capacity: 60, squat_cycling: 40 };
const HEAVY = { powerlifting_strength: 70, olympic_lifting: 30 };
const GYMNASTY = { gymnastics_pulling: 50, gymnastics_pressing: 50 };
const EVEN = Object.fromEntries(Object.keys(AXIS_CLASS).map((a) => [a, 100 / 12]));

const piece = (
  position: number,
  demand: Record<string, number>,
  extra: Partial<SignatureLike> = {},
  label?: string,
  day?: number,
): ProgramPiece => ({ position, label, day, signature: { demand, ...extra } });

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ── piece shape ──────────────────────────────────────────────────────────

Deno.test("header text → format, on the schemes the hash reducer gets wrong", () => {
  assertEquals(formatFromSchemeText("4 rounds: 4:00 on / 1:00 off"), "intervals");
  assertEquals(formatFromSchemeText("4 rounds: 4:00 on / 1:00 off, AMRAP each interval"), "intervals");
  assertEquals(formatFromSchemeText("3 rounds: 3:00 on / 2:00 off — max Chest To Bar in remaining time"), "intervals");
  assertEquals(formatFromSchemeText("1 rounds, not for time."), "rounds_ntf");
  assertEquals(formatFromSchemeText("AMRAP 15"), "amrap");
  assertEquals(formatFromSchemeText("EMOM 12 — min 1: Assault Bike; min 2: Strict Hspu"), "emom");
  assertEquals(formatFromSchemeText("5 rounds for time (14-min cap)"), "rft");
  assertEquals(formatFromSchemeText("21-15-9 for time (12-min cap)"), "for_time");
  assertEquals(formatFromSchemeText("For time (9-min cap)"), "for_time");
  assertEquals(formatFromSchemeText(""), "unknown");
});

Deno.test("the typed scheme_format wins over header text", () => {
  const s = pieceShape({
    demand: ENGINE,
    workout: {
      block_scheme: "something unparseable",
      scheme_format: { format: "intervals", rounds: 8, work_seconds: 120, rest_seconds: 30 },
    },
  });
  assertEquals(s.format, "intervals");
  assertEquals(s.format_source, "scheme_format");
  assertEquals([s.bout_seconds, s.total_work_seconds, s.work_rest_ratio], [120, 960, 4]);
  assertEquals(s.duration_basis, "scheme_format");
});

Deno.test("intervals: bout, total work and work:rest are three different facts", () => {
  const nearlyContinuous = pieceShape({ demand: ENGINE, workout: { block_scheme: "8 rounds: 2:00 on / 30s off" } });
  const trueRepeats = pieceShape({ demand: ENGINE, workout: { block_scheme: "4 rounds: 2:00 on / 4:00 off" } });
  assertEquals(nearlyContinuous.bout_seconds, trueRepeats.bout_seconds); // same bin by bout…
  assertEquals(nearlyContinuous.work_rest_ratio, 4); // …told apart by the ratio
  assertEquals(trueRepeats.work_rest_ratio, 0.5);
  assertEquals(nearlyContinuous.total_work_seconds, 960);
  assertEquals(nearlyContinuous.duration_basis, "scheme_text");
});

Deno.test("fixed clocks count in full; for-time prefers the measured median and flags the cap", () => {
  const amrap = pieceShape({ demand: ENGINE, workout: { block_scheme: "AMRAP 15", time_cap_seconds: 900 } });
  assertEquals([amrap.bout_seconds, amrap.duration_basis], [900, "scheme_format"]);
  const emom = pieceShape({ demand: ENGINE, workout: { block_scheme: "EMOM 24 — min 1: Row; min 2: Deadlift" } });
  assertEquals([emom.format, emom.bout_seconds, emom.total_work_seconds], ["emom", 1440, 1440]);
  const measured = pieceShape({
    demand: ENGINE,
    measured: { median_seconds: 300 },
    workout: { block_scheme: "21-15-9 for time (7-min cap)", time_cap_seconds: 420 },
  });
  assertEquals([measured.bout_seconds, measured.duration_basis], [300, "measured_median"]);
  const capOnly = pieceShape({
    demand: ENGINE,
    workout: { block_scheme: "21-15-9 for time (7-min cap)", time_cap_seconds: 420 },
  });
  assertEquals([capOnly.bout_seconds, capOnly.duration_basis], [420, "time_cap"]);
});

Deno.test("duration bins: six, fixed, lower edge inclusive", () => {
  assertEquals(
    [0, 119, 120, 299, 300, 600, 1199, 1200, 2399, 2400, 3600].map(durationBin),
    ["under_2", "under_2", "2_to_5", "2_to_5", "5_to_10", "10_to_20", "10_to_20", "20_to_40", "20_to_40", "over_40", "over_40"],
  );
});

// ── coverage ─────────────────────────────────────────────────────────────

Deno.test("coverage: the average vector, its evenness and what was never touched", () => {
  const v = programVariation([piece(1, ENGINE), piece(2, HEAVY)]);
  assertEquals(v.n, 2);
  const c = v.coverage.per_piece;
  assertEquals(c.mean, { olympic_lifting: 15, powerlifting_strength: 35, squat_cycling: 20, aerobic_capacity: 30 });
  assertEquals(c.class_totals, { strength: 50, gymnastics_skill: 0, conditioning: 50 });
  assertEquals(c.untouched.length, 8);
  assertEquals(c.top, { axis: "powerlifting_strength", share: 35 });
  assert(c.effective_axes > 3 && c.effective_axes < 4);
});

Deno.test("coverage evenness runs from 0 (one axis) to 1 (all twelve equal)", () => {
  const one = programVariation([piece(1, { midline: 100 })]).coverage.per_piece;
  assertEquals([one.evenness, one.effective_axes], [0, 1]);
  const all = programVariation([piece(1, EVEN)]).coverage.per_piece;
  assertEquals([all.evenness, all.effective_axes, all.untouched.length], [1, 12, 0]);
});

Deno.test("coverage is given per piece and per minute together", () => {
  const short = piece(1, ENGINE, { measured: { median_seconds: 300 } }, "short");
  const long = piece(2, HEAVY, { workout: { block_scheme: "AMRAP 15" } }, "long");
  const untimed = piece(3, HEAVY, {}, "untimed");
  const v = programVariation([short, long, untimed]);
  assertEquals(v.coverage.per_piece.class_totals.strength, round3(200 / 3));
  assertEquals(v.coverage.per_minute?.class_totals, { strength: 75, gymnastics_skill: 0, conditioning: 25 });
  assertEquals(v.coverage.without_duration, ["untimed"]);
  assertEquals(programVariation([untimed]).coverage.per_minute, null);
});

Deno.test("label coverage lists every category, so an empty one reads as a gap", () => {
  const interval = (i: number) =>
    piece(i, ENGINE, { workout: { block_scheme: "4 rounds: 4:00 on / 1:00 off" } }, `int${i}`);
  const v = programVariation([
    interval(1),
    interval(2),
    interval(3),
    piece(4, HEAVY, { workout: { block_scheme: "21-15-9 for time (7-min cap)", time_cap_seconds: 420 } }, "capped"),
    piece(5, HEAVY, { workout: { block_scheme: "AMRAP 12" } }, "amrap"),
  ]);
  const c = v.coverage;
  assertEquals(c.format.counts, { amrap: 1, emom: 0, rft: 0, for_time: 1, intervals: 3 });
  assertEquals(c.format.empty, ["emom", "rft"]);
  assertEquals(c.format.top, { category: "intervals", share: 0.6 });
  // Intervals land in different bins depending on which duration is read.
  assertEquals(c.duration_by_bout.counts, { under_2: 0, "2_to_5": 3, "5_to_10": 1, "10_to_20": 1, "20_to_40": 0, over_40: 0 });
  assertEquals(c.duration_by_total_work.counts, { under_2: 0, "2_to_5": 0, "5_to_10": 1, "10_to_20": 4, "20_to_40": 0, over_40: 0 });
  assertEquals(c.duration_by_bout.empty, ["under_2", "20_to_40", "over_40"]);
  assert(c.duration_by_bout.evenness < 1);
  assertEquals(c.duration_from_cap, ["capped"]);
  assertEquals(c.intervals.length, 3);
  assertEquals(c.intervals[0], { label: "int1", bout_seconds: 240, total_work_seconds: 960, work_rest_ratio: 4 });
});

Deno.test("unscored pieces are left out and counted", () => {
  const recovery = piece(2, ENGINE, { workout: { block_scheme: "1 rounds, not for time." } }, "flush");
  const steady = piece(3, ENGINE, { workout: { scheme_format: { format: "steady" } } }, "zone2");
  const v = programVariation([piece(1, ENGINE, {}, "a"), recovery, steady, piece(4, HEAVY, {}, "b")]);
  assertEquals(v.n, 2);
  assertEquals(v.excluded_unscored, { count: 2, labels: ["flush", "zone2"] });
  assertEquals(programVariation([piece(1, ENGINE), recovery], { includeUnscored: true }).n, 2);
  assertThrows(() => programVariation([recovery]), Error, "no scored piece");
});

// ── dispersion ───────────────────────────────────────────────────────────

Deno.test("the same balanced piece every day: full coverage, zero dispersion", () => {
  const v = programVariation([1, 2, 3, 4, 5].map((d) => piece(d, EVEN)));
  assertEquals(v.coverage.per_piece.evenness, 1);
  assertEquals(v.dispersion?.mean, 0);
  assertEquals(v.dispersion?.mean_nearest, 0);
  assertEquals(v.spacing?.ratio, null); // nothing to space
});

Deno.test("dispersion: pairwise summary beside the noise floor, nearest neighbour per piece", () => {
  const v = programVariation(
    [piece(1, ENGINE, {}, "mon"), piece(2, HEAVY, {}, "tue"), piece(3, GYMNASTY, {}, "wed"), piece(4, ENGINE, {}, "thu")],
    { noiseFloor: 15 },
  );
  const d = v.dispersion!;
  assertEquals([d.pairs, d.min, d.max, d.mean], [6, 0, 100, round3(500 / 6)]);
  assertEquals([d.noise_floor, d.pairs_within_noise], [15, 1]);
  assertEquals(d.nearest[0], { label: "mon", nearest: "thu", distance: 0 });
  assertEquals(d.nearest[3], { label: "thu", nearest: "mon", distance: 0 });
  assertEquals(d.nearest[1].distance, 100);
  assertEquals(d.mean_nearest, 50); // two repeats at 0, two singletons at 100
  const noFloor = programVariation([piece(1, ENGINE), piece(2, HEAVY)]).dispersion!;
  assertEquals([noFloor.noise_floor, noFloor.pairs_within_noise], [null, null]);
});

// ── spacing ──────────────────────────────────────────────────────────────

Deno.test("spacing: alternating reads above 1, blocked reads below 1, same pieces either way", () => {
  const alternating = programVariation([ENGINE, HEAVY, ENGINE, HEAVY, ENGINE, HEAVY].map((w, i) => piece(i, w)));
  const blocked = programVariation([ENGINE, ENGINE, ENGINE, HEAVY, HEAVY, HEAVY].map((w, i) => piece(i, w)));
  // Same set → same coverage and pairwise summary; only the order differs.
  assertEquals(alternating.coverage, blocked.coverage);
  assertEquals(alternating.dispersion!.mean, blocked.dispersion!.mean);
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

Deno.test("recurrence: the longest stretch without an axis, at three thresholds, against shuffled", () => {
  const alternating = programVariation([ENGINE, HEAVY, ENGINE, HEAVY, ENGINE, HEAVY].map((w, i) => piece(i, w)));
  const blocked = programVariation([ENGINE, ENGINE, ENGINE, HEAVY, HEAVY, HEAVY].map((w, i) => piece(i, w)));
  const alt = alternating.spacing!.recurrence.aerobic_capacity;
  const blk = blocked.spacing!.recurrence.aerobic_capacity;
  assertEquals(Object.keys(alt.at), ["10", "15", "20"]);
  assertEquals([alt.at["15"].occurrences, alt.at["15"].mean_gap, alt.at["15"].longest_gap], [3, 2, 2]);
  // Bunched at the front: back-to-back appearances, then four sessions without.
  assertEquals([blk.at["15"].mean_gap, blk.at["15"].longest_gap], [1, 4]);
  // Same pieces → the same shuffled figure, up to sampling error.
  assert(Math.abs(alt.at["15"].shuffled_longest_gap! - blk.at["15"].shuffled_longest_gap!) < 0.1);
  assertEquals(alt.at["15"].verdict, "more_regular");
  assertEquals(blk.at["15"].verdict, "less_regular");
  assertEquals(alt.threshold_sensitive, false);
  assertEquals("midline" in alternating.spacing!.recurrence, false); // never present
  assertEquals(alternating.spacing!.has_days, false);
  assertEquals(alt.at["15"].longest_gap_days, null);
});

Deno.test("recurrence flags an axis whose verdict depends on the threshold", () => {
  // aerobic sits at 15 in the early pieces and 10 in the late ones: present
  // all month at a threshold of 10, front-loaded at 15, absent at 20.
  const at15 = { aerobic_capacity: 15, midline: 85 };
  const at10 = { aerobic_capacity: 10, midline: 90 };
  const v = programVariation([at15, at15, at15, at10, at10, at10, at10, at10].map((w, i) => piece(i, w)));
  const r = v.spacing!.recurrence.aerobic_capacity;
  assertEquals(r.at["10"].occurrences, 8);
  assertEquals(r.at["15"].occurrences, 3);
  assertEquals(r.at["20"].occurrences, 0);
  assertEquals(r.at["20"].longest_gap, null);
  assertEquals(r.at["10"].verdict, "as_random");
  assertEquals(r.at["15"].verdict, "less_regular");
  assertEquals(r.threshold_sensitive, true);
});

Deno.test("with dates on every piece, gaps are also given in days (rest days count)", () => {
  // Mon Tue Wed, then the following Mon Tue Wed.
  const days = [1, 2, 3, 8, 9, 10];
  const v = programVariation(
    [ENGINE, HEAVY, HEAVY, HEAVY, HEAVY, ENGINE].map((w, i) => piece(i, w, {}, undefined, days[i])),
  );
  const r = v.spacing!.recurrence.aerobic_capacity.at["15"];
  assertEquals(v.spacing!.has_days, true);
  assertEquals(r.longest_gap, 5); // sessions
  assertEquals(r.longest_gap_days, 9); // days 1 → 10
  assert(r.shuffled_longest_gap_days !== null);
  const partial = programVariation([piece(0, ENGINE, {}, "a", 1), piece(1, HEAVY), piece(2, ENGINE)]);
  assertEquals(partial.spacing!.has_days, false);
});

Deno.test("spacing is reproducible (seeded) and reads program order, not input order", () => {
  const inOrder = [ENGINE, HEAVY, GYMNASTY, ENGINE, HEAVY, GYMNASTY, EVEN].map((w, i) => piece(i, w));
  const scrambled = [inOrder[4], inOrder[0], inOrder[6], inOrder[2], inOrder[1], inOrder[5], inOrder[3]];
  const a = programVariation(inOrder);
  assertEquals(programVariation(inOrder).spacing, a.spacing);
  assertEquals(programVariation(scrambled).spacing, a.spacing);
});

// ── edges ────────────────────────────────────────────────────────────────

Deno.test("another vector can be read; pieces without it are skipped and named", () => {
  const v = programVariation(
    [piece(1, ENGINE, { discrimination: HEAVY }, "a"), piece(2, ENGINE, {}, "b"), piece(3, ENGINE, { discrimination: GYMNASTY }, "c")],
    { vector: "discrimination" },
  );
  assertEquals([v.n, v.skipped], [2, ["b"]]);
  assertEquals(v.dispersion?.mean, 100);
  assertEquals(v.spacing, null); // fewer than three measured
  assertThrows(() => programVariation([piece(1, ENGINE)], { vector: "stimulus" }), Error, "no scored piece carries");
});

Deno.test("one piece: coverage only", () => {
  const v = programVariation([piece(1, ENGINE)]);
  assertEquals([v.dispersion, v.spacing], [null, null]);
  assertThrows(() => programVariation([piece(1, { aerobic_capacity: 90 })]), Error, "must sum to 100");
});
