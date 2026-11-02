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
  /** Sigma: prior covariance of TRUE deltas, percentile units. Must be the
   *  noise-cancelled (deconvolved) signal covariance plus slack, NEVER the
   *  raw covariance of estimated deltas — that one is estimation-noise
   *  inflated and under-shrinks (review 2026-11-02; the shallow-band
   *  limiter failure was this matrix). */
  prior_cov_pct: number[][];
  noise_var_pct: number; // per-score noise variance (repeat-measured)
  calibration_sd_inflation: number; // multiply predictive sd by this
  evidence_age_weight: Record<string, number>; // years-of-gap -> weight
  /** Level prior — PER STRATUM (committed ~p50, onboarding ~p35); params
   *  rows carry these, code holds only last-resort defaults. */
  level_prior_mean?: number;
  level_prior_var?: number;
  draft_noise_inflation?: number;
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
  /** P(axis is the limiter), summing to ~1 across axes.
   *  v1 limiter = most negative delta (unpriced). The Goal-1 target is a
   *  PRICED limiter — P(axis costs the most percentile across a target
   *  basket), i.e. the posterior over basketLoad[axis]*delta — so this
   *  surface will grow an optional basket argument; callers should not
   *  assume raw-delta semantics are permanent. */
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
  /** The wall's percentile for this workout/cohort. NOTE: the gate catalog
   *  reports the pile's assigned percentile (the tie group shares one
   *  value — effectively the pile's upper edge). Athletes lacking the
   *  movement are distributed AT that tie value by ranking construction,
   *  so clamping to it is correct for tie-scored leaderboards; if a future
   *  catalog reports an interval instead, the clamp should move inside it. */
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

function matVec(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((acc, x, j) => acc + x * v[j], 0));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((acc, x, i) => acc + x * b[i], 0);
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
 * Fit an athlete profile from evidence — ONE joint solve for level and the
 * twelve deltas (review 2026-11-02 item 1: the two-stage fit let the level
 * absorb an unbalanced menu's tilt — a weak puller logging pulling-heavy
 * class workouts read as "balanced, just unfit." Jointly, the constant
 * column competes with the signature rows and the prior allocates honestly).
 *
 * Model: percentile = level_prior_mean + [x | 1] · [delta; levelOffset] + e,
 * prior diag(Sigma, level_prior_var). With zero evidence the posterior IS
 * the prior: level at the stratum mean, wide sds, limiter posterior = the
 * population's (the Bayesian-naming behavior the limiter validation
 * requires).
 */
export function fitProfile(
  evidence: EvidenceObservation[],
  params: SignatureModelParams,
  opts: { seed?: number } = {},
): FittedProfile {
  const axes = params.axes;
  const A = axes.length;
  const D = A + 1; // + the level-offset dimension
  const LPM = params.level_prior_mean ?? 50;
  const LPV = params.level_prior_var ?? 625;

  // information form: info = blockdiag(Sigma^-1, 1/LPV) + X' N^-1 X
  const SigmaInv = invSPD(params.prior_cov_pct);
  const info: number[][] = Array.from({ length: D }, (_, i) =>
    Array.from({ length: D }, (_, j) =>
      i < A && j < A ? SigmaInv[i][j] : i === A && j === A ? 1 / LPV : 0));
  const b = new Array(D).fill(0);
  for (const e of evidence) {
    const x = [...signatureRow(e.discrimination, axes), 1];
    const noise = (e.obsNoiseVar ?? params.noise_var_pct) /
      ageWeight(params, e.yearsAgo ?? 0);
    for (let i = 0; i < D; i++) {
      if (x[i] === 0) continue;
      b[i] += (x[i] * (e.percentile - LPM)) / noise;
      for (let j = 0; j < D; j++) {
        if (x[j] !== 0) info[i][j] += (x[i] * x[j]) / noise;
      }
    }
  }
  const C = invSPD(info);
  const M = matVec(C, b);

  const axisOut: Record<string, AxisPosterior> = {};
  for (let j = 0; j < A; j++) {
    axisOut[axes[j]] = { mean: M[j], sd: Math.sqrt(Math.max(C[j][j], 0)) };
  }
  const level = { mean: LPM + M[A], sd: Math.sqrt(Math.max(C[A][A], 0)) };

  // ---- limiter posterior: P(axis j has the most negative delta), by draws
  // over the joint posterior's delta block (the level dimension rides the
  // cholesky but never competes for "limiter").
  const rng = mulberry32(opts.seed ?? 42);
  const L = cholesky(C);
  const counts = new Array(A).fill(0);
  for (let d = 0; d < LIMITER_DRAWS; d++) {
    const zRaw: number[] = [];
    while (zRaw.length < D) {
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
    (a, b2) => limiterPosterior[b2] - limiterPosterior[a],
  );

  return {
    level,
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
