/**
 * Unit tests for signature-profile-fit. Run with:
 *   deno test supabase/functions/_shared/signature-profile-fit_test.ts --no-check
 *
 * The suite mirrors the research harness's checks (design doc, 2026-11-02):
 * prior behavior at zero depth, recovery of a planted profile, limiter
 * naming, the relative-dial property, gate clamping, calibration inflation,
 * evidence aging, and determinism.
 */

import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert";

import {
  cholesky,
  type EvidenceObservation,
  fitProfile,
  predictScore,
  type SignatureModelParams,
  signatureRow,
} from "./signature-profile-fit.ts";

// Small 4-axis toy params: exact values don't matter, structure does.
const AXES = ["engine", "pulling", "pressing", "strength"];
const PARAMS: SignatureModelParams = {
  axes: AXES,
  prior_cov_pct: [
    [120, -60, -10, -40],
    [-60, 200, 10, -50],
    [-10, 10, 90, 5],
    [-40, -50, 5, 110],
  ],
  noise_var_pct: 99,
  calibration_sd_inflation: 1.349,
  evidence_age_weight: { "0": 1.0, "1": 1.0, "2": 0.98, "3": 0.82, "4": 0.73 },
};

const puller = { pulling: 60, engine: 25, strength: 15 };
const grinder = { engine: 55, strength: 35, pressing: 10 };
const balanced = { engine: 25, pulling: 25, pressing: 25, strength: 25 };

function obs(
  percentile: number,
  discrimination: Record<string, number>,
  extra: Partial<EvidenceObservation> = {},
): EvidenceObservation {
  return { percentile, discrimination, ...extra };
}

Deno.test("signatureRow normalizes to unit sum in canonical order", () => {
  const row = signatureRow(puller, AXES);
  assertAlmostEquals(row.reduce((a, b) => a + b, 0), 1, 1e-12);
  assertEquals(row[AXES.indexOf("pulling")], 0.6);
  assertEquals(row[AXES.indexOf("pressing")], 0);
});

Deno.test("zero evidence returns the prior: wide sds, level at field median", () => {
  const p = fitProfile([], PARAMS);
  assertAlmostEquals(p.level.mean, 50, 1e-9);
  for (const a of AXES) {
    assertAlmostEquals(p.axes[a].mean, 0, 1e-9);
    // posterior sd equals prior sd
    assertAlmostEquals(
      p.axes[a].sd,
      Math.sqrt(PARAMS.prior_cov_pct[AXES.indexOf(a)][AXES.indexOf(a)]),
      1e-6,
    );
  }
  // limiter posterior is the population's: spread across axes, none ~1
  const top = p.limiterRanked[0];
  assert(p.limiterPosterior[top] < 0.6, "no runaway limiter at zero depth");
});

Deno.test("recovers a planted puller-weak profile and names the limiter", () => {
  // Grinder-built athlete: at their level on grinder tests, far below on
  // pulling tests. 12 observations, generous depth.
  const evidence: EvidenceObservation[] = [];
  for (let i = 0; i < 6; i++) evidence.push(obs(70, grinder));
  for (let i = 0; i < 6; i++) evidence.push(obs(46, puller));
  const p = fitProfile(evidence, PARAMS);

  assert(p.axes.pulling.mean < -5, `pulling should be well negative, got ${p.axes.pulling.mean}`);
  assert(p.axes.pulling.mean < p.axes.engine.mean, "pulling below engine");
  assertEquals(p.limiterRanked[0], "pulling");
  assert(p.limiterPosterior.pulling > 0.5, "limiter posterior concentrates");
  // level lands between the two clusters
  assert(p.level.mean > 50 && p.level.mean < 70);
});

Deno.test("axis posterior sd shrinks as evidence accumulates", () => {
  const few = fitProfile([obs(60, puller)], PARAMS);
  const many = fitProfile(
    Array.from({ length: 10 }, () => obs(60, puller)),
    PARAMS,
  );
  assert(many.axes.pulling.sd < few.axes.pulling.sd);
  // and an untested axis barely moves
  assertAlmostEquals(
    many.axes.pressing.sd,
    Math.sqrt(PARAMS.prior_cov_pct[2][2]),
    2.5,
  );
});

Deno.test("prediction: dot product over the fitted dials, calibrated sd", () => {
  const evidence = [
    ...Array.from({ length: 6 }, () => obs(70, grinder)),
    ...Array.from({ length: 6 }, () => obs(46, puller)),
  ];
  const p = fitProfile(evidence, PARAMS);
  const onPulling = predictScore(p, puller, PARAMS);
  const onGrinding = predictScore(p, grinder, PARAMS);
  assert(onPulling.mean < onGrinding.mean, "puller-weak predicts lower on pulling tests");
  // calibrated sd: at least sqrt(noise) * inflation
  assert(onPulling.sd >= Math.sqrt(PARAMS.noise_var_pct) * PARAMS.calibration_sd_inflation - 1e-9);
});

Deno.test("gate clamps the prediction when the movement is lacking", () => {
  const p = fitProfile(
    Array.from({ length: 8 }, () => obs(75, balanced)),
    PARAMS,
  );
  const free = predictScore(p, puller, PARAMS);
  const walled = predictScore(p, puller, PARAMS, undefined, {
    possessed: false,
    wallPercentile: 40,
  });
  assert(free.mean > 60);
  assertAlmostEquals(walled.mean, 40, 1e-9);
  assert(walled.gateClamped === true);
  // unknown possession blends toward the wall
  const maybe = predictScore(p, puller, PARAMS, undefined, {
    possessed: null,
    possessionProb: 0.5,
    wallPercentile: 40,
  });
  assert(maybe.mean > walled.mean && maybe.mean < free.mean);
});

Deno.test("older evidence counts less (aging curve)", () => {
  const fresh = fitProfile(
    [obs(70, puller, { yearsAgo: 0 }), obs(70, puller, { yearsAgo: 0 })],
    PARAMS,
  );
  const stale = fitProfile(
    [obs(70, puller, { yearsAgo: 4 }), obs(70, puller, { yearsAgo: 4 })],
    PARAMS,
  );
  // same observations, older -> wider pulling posterior and level sd
  assert(stale.axes.pulling.sd > fresh.axes.pulling.sd);
  assert(stale.level.sd > fresh.level.sd);
});

Deno.test("per-observation noise override widens a structure-scored row's influence", () => {
  const tight = fitProfile([obs(70, puller, { obsNoiseVar: 99 })], PARAMS);
  const wide = fitProfile([obs(70, puller, { obsNoiseVar: 400 })], PARAMS);
  // a noisier observation moves the dial less
  assert(Math.abs(wide.axes.pulling.mean) < Math.abs(tight.axes.pulling.mean));
});

Deno.test("deterministic under a fixed seed", () => {
  const evidence = Array.from({ length: 7 }, (_, i) => obs(40 + i * 3, i % 2 ? puller : grinder));
  const a = fitProfile(evidence, PARAMS, { seed: 7 });
  const b = fitProfile(evidence, PARAMS, { seed: 7 });
  assertEquals(a.limiterPosterior, b.limiterPosterior);
  assertEquals(a.axes, b.axes);
});

Deno.test("cholesky round-trip on the toy prior", () => {
  const L = cholesky(PARAMS.prior_cov_pct);
  const n = AXES.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += L[i][k] * L[j][k];
      assertAlmostEquals(s, PARAMS.prior_cov_pct[i][j], 1e-8);
    }
  }
});
