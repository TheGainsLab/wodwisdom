// signature-profile-fit — the athlete profile model, ported from the
// validated research pipeline (Workout Signatures design doc, phase-3
// validation + post-validation diagnostics, 2026-11-01/02).
//
// What this module is: the pure math that turns a set of evidence rows
// (field-relative scores on signed workouts) into an athlete profile —
// level, twelve relative axis dials with uncertainty, a ranked limiter
// posterior — and runs the forward prediction (expected score ± calibrated
// interval, gate-clamped) for any signed workout.
//
// What it deliberately is NOT: data access. Callers load evidence from
// signature_evidence, params from signature_model_params, and persist
// results to athlete_capability_vectors. Everything here is deterministic
// (seeded RNG) and side-effect free, so the research harness's numbers are
// reproducible against it.
//
// The model (doc: "how does this change our model", 2026-11-02):
//   score = level + W_row · delta + gate clamp + noise
//   delta ~ N(0, Sigma)  — the correlated prior (soft rank-4: the loading
//     matrix's covariance), NOT independent ridge. This is what makes a
//     3-score athlete inherit the population's shape and a 30-score athlete
//     earn departure from it.
//   Each observation carries its own noise variance (leaderboard percentile
//     vs structure-estimated — the score-scale model's error lands per row)
//     and an evidence-age weight (the year-holdout aging curve).
//   Predictive sd is inflated by the measured calibration constant before
//     anything user-facing is computed from it (raw posterior is
//     overconfident ×1.35; doc ruling 2026-11-02).
//   Limiter output is a posterior over axes (Bayesian naming): at zero
//     depth it reproduces the population prior and departs only on
//     evidence. Product shows the ranked top-2 (top-1 is not earned; doc
//     ruling 2026-11-02).

export interface SignatureModelParams {
  axes: string[]; // canonical axis order for every matrix/vector below
  prior_cov_pct: number[][]; // Sigma, percentile units
  noise_var_pct: number; // per-score noise variance (repeat-measured)
  calibration_sd_inflation: number; // multiply predictive sd by this
  evidence_age_weight: Record<string, number>; // years-of-gap -> weight
}

export interface EvidenceObservation {
  /** worldwide percentile, 0..100 */
  percentile: number;
  /** discrimination weights {axis: percent}; need not be normalized */
  discrimination: Record<string, number>;
  /** whole years between this observation and "now" (0 = current block) */
  yearsAgo?: number;
  /** per-observation noise variance override (structure-estimated scores
   *  are wider than leaderboard ones); defaults to params.noise_var_pct */
  obsNoiseVar?: number;
}

export interface AxisPosterior {
  mean: number; // deviation from own level, percentile points (RELATIVE dial)
  sd: number;
}

export interface FittedProfile {
  level: { mean: number; sd: number };
  axes: Record<string, AxisPosterior>;
  /** P(axis is the limiter), summing to ~1 across axes */
  limiterPosterior: Record<string, number>;
  /** axes ranked by limiter probability, most likely first */
  limiterRanked: string[];
  nEvidence: number;
}

export interface GateContext {
  /** does the athlete possess the gated movement? */
  possessed: boolean | null; // null = unknown
  /** probability of possession when unknown (population rate for the gate) */
  possessionProb?: number;
  /** the wall's percentile for this workout/cohort (pile location) */
  wallPercentile: number;
}

export interface ScorePrediction {
  mean: number;
  sd: number; // calibrated (inflation already applied)
  /** present when a gate clamps or blends the prediction */
  gateClamped?: boolean;
}

// ---------------------------------------------------------------- linalg
// 12x12 is small; plain arrays beat pulling in a dependency.

function matAdd(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((v, j) => v + b[i][j]));
}

function matScale(a: number[][], s: number): number[][] {
  return a.map((row) => row.map((v) => v * s));
}

function matVec(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((acc, x, j) => acc + x * v[j], 0));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((acc, x, i) => acc + x * b[i], 0);
}

function outer(a: number[], b: number[]): number[][] {
  return a.map((x) => b.map((y) => x * y));
}

/** Cholesky decomposition of a symmetric positive-definite matrix. */
export function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 0) s = 1e-9; // numerical floor; prior is PD by construction
        L[i][i] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

/** Solve A x = b for symmetric positive-definite A via Cholesky. */
function solveSPD(a: number[][], b: number[]): number[] {
  const L = cholesky(a);
  const n = b.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

// deterministic RNG (mulberry32) + standard normal, so fits are reproducible
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussPair(rng: () => number): [number, number] {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  const m = Math.sqrt(-2 * Math.log(u));
  return [m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v)];
}

// ---------------------------------------------------------------- fitting

/** Normalize a discrimination jsonb ({axis: percent}) into a unit-sum row
 *  vector in the params' canonical axis order. Unknown axes are ignored. */
export function signatureRow(
  discrimination: Record<string, number>,
  axes: string[],
): number[] {
  const row = axes.map((a) => Math.max(discrimination[a] ?? 0, 0));
  const total = row.reduce((a, b) => a + b, 0);
  if (total <= 0) return row.map(() => 0);
  return row.map((v) => v / total);
}

function ageWeight(params: SignatureModelParams, yearsAgo: number): number {
  const keys = Object.keys(params.evidence_age_weight)
    .map(Number)
    .sort((a, b) => a - b);
  let w = params.evidence_age_weight[String(keys[0])] ?? 1;
  for (const k of keys) {
    if (yearsAgo >= k) w = params.evidence_age_weight[String(k)] ?? w;
  }
  return Math.max(w, 0.1);
}

const LIMITER_DRAWS = 512;

/**
 * Fit an athlete profile from evidence.
 *
 * Level is the precision-weighted mean of the observations (age-weighted);
 * the axis posterior is the Gaussian-process update of the correlated prior
 * on the residuals. With zero or thin evidence the posterior IS the prior:
 * wide sds, limiter posterior = the population's (the Bayesian-naming
 * behavior the limiter validation required).
 */
export function fitProfile(
  evidence: EvidenceObservation[],
  params: SignatureModelParams,
  opts: { seed?: number } = {},
): FittedProfile {
  const axes = params.axes;
  const A = axes.length;
  const Sigma = params.prior_cov_pct;

  // ---- level: precision-weighted mean under per-obs noise + age weight
  let wSum = 0;
  let wy = 0;
  for (const e of evidence) {
    const noise = (e.obsNoiseVar ?? params.noise_var_pct) /
      ageWeight(params, e.yearsAgo ?? 0);
    const w = 1 / noise;
    wSum += w;
    wy += w * e.percentile;
  }
  // diffuse prior on level centered at the field median
  const LEVEL_PRIOR_MEAN = 50;
  const LEVEL_PRIOR_VAR = 625; // sd 25: covers the field, dominated quickly
  const levelPrec = wSum + 1 / LEVEL_PRIOR_VAR;
  const levelMean = (wy + LEVEL_PRIOR_MEAN / LEVEL_PRIOR_VAR) / levelPrec;
  const levelVar = 1 / levelPrec;

  // ---- axis posterior on residuals r = percentile - level
  // posterior: M = Sigma X' (X Sigma X' + N)^-1 r ; C = Sigma - Sigma X' K^-1 X Sigma
  // computed in information form to stay at A x A:
  //   C = (Sigma^-1 + X' N^-1 X)^-1 ; M = C X' N^-1 r
  const SigmaInv = invSPD(Sigma);
  let info = SigmaInv;
  const xtNr = new Array(A).fill(0);
  for (const e of evidence) {
    const x = signatureRow(e.discrimination, axes);
    const noise = (e.obsNoiseVar ?? params.noise_var_pct) /
      ageWeight(params, e.yearsAgo ?? 0);
    info = matAdd(info, matScale(outer(x, x), 1 / noise));
    const r = e.percentile - levelMean;
    for (let j = 0; j < A; j++) xtNr[j] += (x[j] * r) / noise;
  }
  const C = invSPD(info);
  const M = matVec(C, xtNr);

  const axisOut: Record<string, AxisPosterior> = {};
  for (let j = 0; j < A; j++) {
    axisOut[axes[j]] = { mean: M[j], sd: Math.sqrt(Math.max(C[j][j], 0)) };
  }

  // ---- limiter posterior: P(axis j has the most negative delta), by draws
  const rng = mulberry32(opts.seed ?? 42);
  const L = cholesky(C);
  const counts = new Array(A).fill(0);
  for (let d = 0; d < LIMITER_DRAWS; d++) {
    const zRaw: number[] = [];
    while (zRaw.length < A) {
      const [g1, g2] = gaussPair(rng);
      zRaw.push(g1, g2);
    }
    let worst = 0;
    let worstVal = Infinity;
    for (let i = 0; i < A; i++) {
      let v = M[i];
      for (let k = 0; k <= i; k++) v += L[i][k] * zRaw[k];
      if (v < worstVal) {
        worstVal = v;
        worst = i;
      }
    }
    counts[worst]++;
  }
  const limiterPosterior: Record<string, number> = {};
  for (let j = 0; j < A; j++) limiterPosterior[axes[j]] = counts[j] / LIMITER_DRAWS;
  const limiterRanked = [...axes].sort(
    (a, b) => limiterPosterior[b] - limiterPosterior[a],
  );

  return {
    level: { mean: levelMean, sd: Math.sqrt(levelVar) },
    axes: axisOut,
    limiterPosterior,
    limiterRanked,
    nEvidence: evidence.length,
  };
}

function invSPD(a: number[][]): number[][] {
  const n = a.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    cols.push(solveSPD(a, e));
  }
  // cols[j] is column j; assemble (symmetric, so transpose-safe)
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
}

// ------------------------------------------------------------- prediction

/**
 * Forward prediction for a signed workout: level + W_row · delta, predictive
 * sd calibrated by the measured inflation constant, clamped/blended by the
 * gate when one applies (gate doctrine: the dot product answers "how much",
 * the gate answers "whether at all").
 */
export function predictScore(
  profile: FittedProfile,
  discrimination: Record<string, number>,
  params: SignatureModelParams,
  axisCov?: number[][], // posterior C from the fit; omit for sd from axis sds only
  gate?: GateContext,
): ScorePrediction {
  const axes = params.axes;
  const x = signatureRow(discrimination, axes);
  const deltas = axes.map((a) => profile.axes[a]?.mean ?? 0);
  let mean = profile.level.mean + dot(x, deltas);

  let varSum = params.noise_var_pct + profile.level.sd ** 2;
  if (axisCov) {
    varSum += dot(x, matVec(axisCov, x));
  } else {
    for (let j = 0; j < axes.length; j++) {
      varSum += (x[j] * (profile.axes[axes[j]]?.sd ?? 0)) ** 2;
    }
  }
  let sd = Math.sqrt(varSum) * params.calibration_sd_inflation;

  let gateClamped = false;
  if (gate) {
    if (gate.possessed === false) {
      mean = Math.min(mean, gate.wallPercentile);
      gateClamped = true;
    } else if (gate.possessed === null && gate.possessionProb !== undefined) {
      const p = gate.possessionProb;
      const clamped = Math.min(mean, gate.wallPercentile);
      mean = p * mean + (1 - p) * clamped;
      gateClamped = clamped < mean + 1e-9;
    }
  }

  mean = Math.min(Math.max(mean, 0), 100);
  return { mean, sd, gateClamped };
}
