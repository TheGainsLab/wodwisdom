// Tests for the gate splice — the arithmetic is simple enough to get
// wrong silently, and it will sit on every gated workout's percentile.
//
// Run with:
//   deno test supabase/functions/_shared/signature-gate-splice_test.ts --no-check

import {
  conditionalQuartiles,
  type CurvePoint,
  percentileAtScore,
  scoreAtPercentile,
  spliceGatedPercentile,
  unspliceGatedPercentile,
  wallMassFromCurve,
} from "./signature-gate-splice.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: got ${a}, wanted ${e}`);
}
function close(actual: number | null | undefined, expected: number, tol: number, msg: string) {
  if (actual == null || Math.abs(actual - expected) > tol) {
    throw new Error(`${msg}: got ${actual}, wanted ~${expected}`);
  }
}

Deno.test("splice: wall mass compresses conditional placement into the top band", () => {
  // 20.5 F shape: ~72% of the field at the ring-MU wall. A median
  // possessor (conditional p50) is worldwide p86.
  close(spliceGatedPercentile(50, 0.72), 86, 1e-9, "median possessor");
  close(spliceGatedPercentile(0, 0.72), 72, 1e-9, "worst possessor sits at the wall top");
  close(spliceGatedPercentile(100, 0.72), 100, 1e-9, "best is best");
  close(spliceGatedPercentile(50, 0), 50, 1e-9, "no wall = identity");
});

Deno.test("unsplice inverts splice above the wall, floors below it", () => {
  for (const w of [0, 0.3, 0.72]) {
    for (const c of [0, 25, 50, 90, 100]) {
      close(unspliceGatedPercentile(spliceGatedPercentile(c, w), w), c, 1e-9, `round trip w=${w} c=${c}`);
    }
  }
  close(unspliceGatedPercentile(30, 0.72), 0, 1e-9, "below the wall there is no conditional rank");
});

const GRID: CurvePoint[] = [
  { p: 10, s: 60, fin: null },
  { p: 30, s: 120, fin: null },
  { p: 50, s: 180, fin: null },
  { p: 70, s: 200, fin: null }, // pile at 200 spans 70..90 (tie group)
  { p: 90, s: 200, fin: null },
  { p: 95, s: 260, fin: null },
];

Deno.test("scoreAtPercentile interpolates within units, clamps at ends", () => {
  close(scoreAtPercentile(GRID, 40)?.s ?? null, 150, 1e-9, "midpoint interpolation");
  close(scoreAtPercentile(GRID, 5)?.s ?? null, 60, 1e-9, "clamp low");
  close(scoreAtPercentile(GRID, 99)?.s ?? null, 260, 1e-9, "clamp high");
});

Deno.test("scoreAtPercentile never interpolates across a finisher boundary", () => {
  const mixed: CurvePoint[] = [
    { p: 50, s: 160, fin: false }, // reps (capped)
    { p: 75, s: 700, fin: true }, // seconds (finisher)
  ];
  // halfway: nearer point wins verbatim, units intact
  eq(scoreAtPercentile(mixed, 60), { s: 160, fin: false }, "below midpoint keeps reps");
  eq(scoreAtPercentile(mixed, 70), { s: 700, fin: true }, "above midpoint keeps seconds");
});

Deno.test("wallMassFromCurve finds the TOP of the tie group", () => {
  close(wallMassFromCurve(GRID, 200), 0.9, 1e-9, "pile 200 tops out at p90");
  close(wallMassFromCurve(GRID, 60), 0.1, 1e-9, "pile at the bottom point");
  eq(wallMassFromCurve(GRID, 10), null, "grid never reaches a lower pile");
});

Deno.test("conditionalQuartiles read the above-wall segment", () => {
  // wall at 0.9: conditional p50 = field p95 → score 230 (interpolated
  // between the 200 tie top at p90 and 260 at p95... field 95 exactly = 260?
  // field percentile = 90 + 0.5*10 = 95 → grid point 260)
  const q = conditionalQuartiles(GRID, 0.9);
  close(q.p50?.s ?? null, 260, 1e-9, "conditional median of the top decile");
  close(q.p25?.s ?? null, 230, 1e-9, "conditional p25 interpolates 92.5");
});

Deno.test("percentileAtScore inverts the grid, unit-filtered", () => {
  const g: CurvePoint[] = [
    { p: 10, s: 60, fin: false },
    { p: 50, s: 180, fin: false },
    { p: 70, s: 900, fin: true }, // finishers take over: seconds, descending
    { p: 90, s: 700, fin: true },
  ];
  close(percentileAtScore(g, 120, false), 30, 1e-9, "reps midpoint");
  close(percentileAtScore(g, 800, true), 80, 1e-9, "time midpoint");
  close(percentileAtScore(g, 40, false), 10, 1e-9, "worse than worst clamps low");
  close(percentileAtScore(g, 600, true), 90, 1e-9, "faster than fastest clamps high");
  eq(percentileAtScore([{ p: 50, s: 100, fin: false }], 100, false), null, "one point is no grid");
});

Deno.test("wall is a plateau: one-rep-past athletes are still walled (20.5 F shape)", () => {
  const g205: CurvePoint[] = [
    { p: 10, s: 200, fin: false },
    { p: 40, s: 200, fin: false },
    { p: 45, s: 201, fin: false }, // one ring muscle-up, then parked
    { p: 80, s: 201, fin: false },
    { p: 85, s: 207, fin: false },
    { p: 95, s: 227, fin: false },
  ];
  // tolerance max(1, 4) = 4 → plateau extends through 201 at p80
  close(wallMassFromCurve(g205, 200), 0.8, 1e-9, "plateau top, not pile top");
  // conditional median now reads real possessor territory
  const q = conditionalQuartiles(g205, 0.8);
  if ((q.p50?.s ?? 0) <= 204) throw new Error(`conditional p50 still on the wall: ${q.p50?.s}`);
});

Deno.test("plateau requires reaching the pile first", () => {
  const g: CurvePoint[] = [
    { p: 10, s: 150, fin: false },
    { p: 50, s: 199, fin: false }, // within tolerance of 200 but pile never reached
    { p: 90, s: 240, fin: false },
  ];
  close(wallMassFromCurve(g, 200), 0.5, 1e-9, "199 <= pile counts as reaching");
  eq(wallMassFromCurve([{ p: 50, s: 240, fin: false }], 200), null, "never reached");
});
