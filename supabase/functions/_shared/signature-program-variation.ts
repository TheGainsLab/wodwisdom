// signature-program-variation — how varied is a SET of workouts (a week, a
// month, a cycle), read from their signatures. Pure functions, no IO, no
// storage, no callers yet (variation work, step 2).
//
// SCOPE: metcons only. Only metcons carry signatures, so a score here says
// nothing about strength, skill or accessory work. The caller chooses the
// window (pass one week's pieces, or one month's) and leaves out unscored
// recovery pieces.
//
// Three measures, deliberately separate — each answers a different question
// and a program can pass one while failing another:
//
//   coverage    WHAT got trained: the average weight vector across the set,
//               and how evenly it fills the twelve axes. Per-workout draft
//               noise mostly cancels here, so this is trustworthy first.
//   dispersion  HOW DIFFERENT the pieces are from each other: the pairwise
//               distances. The same balanced chipper every day has full
//               coverage and zero dispersion. Draft noise INFLATES this
//               (noise adds distance to every pair, most to the closest),
//               so it is reported raw with an optional count of pairs that
//               sit inside a caller-supplied noise floor — never corrected.
//   spacing     WHETHER THE ORDER MATTERS: consecutive pieces compared with
//               the same pieces in shuffled order. Above 1 = neighbours are
//               more different than chance (deliberately alternated); below
//               1 = similar pieces are clumped together; near 1 = the order
//               is indistinguishable from random.
//
// Sequence only: spacing reads the ORDER of pieces, not calendar gaps.

import {
  AXIS_CLASS,
  AXIS_CLASSES,
  type AxisClass,
  type DoseBasis,
  mixDistance,
  type SignatureLike,
  type Weights,
} from "./signature-distance.ts";

export type VectorKind = "demand" | "discrimination" | "stimulus";

export interface ProgramPiece {
  /** Where the piece falls in the program — any increasing number (day
   *  index, week*10+day). Pieces are ordered by it; ties keep input order. */
  position: number;
  signature: SignatureLike;
  /** Optional label carried into the output (workout name, hash, date). */
  label?: string;
}

export interface VariationOptions {
  /** Which weight vector to read. Default "demand": stimulus has not been
   *  shown to differ measurably from demand (review 2026-11-21). */
  vector?: VectorKind;
  /** "equal" (default): every piece counts once in coverage. "dose": pieces
   *  count in proportion to their duration (measured median, else time
   *  cap); every piece must then have one. */
  weight?: "equal" | "dose";
  /** Pairs at or below this distance are counted as within draft noise. */
  noiseFloor?: number;
  /** Shuffles for the spacing percentile. Default 2000; seeded, so results
   *  are reproducible. */
  shuffles?: number;
  seed?: number;
}

const AXES = Object.keys(AXIS_CLASS);
const round = (n: number) => Math.round(n * 1000) / 1000;

// ============================================================
// Coverage
// ============================================================

export interface Coverage {
  /** Average share per axis across the set (sums to 100). */
  mean: Weights;
  class_totals: Record<AxisClass, number>;
  /** 0–1: 1 = all twelve axes equally filled, 0 = one axis only. */
  evenness: number;
  /** The number of equally-filled axes that would give the same evenness
   *  (1–12). Easier to read than evenness: "this month trained about 6". */
  effective_axes: number;
  /** Axes with no share in any piece. */
  untouched: string[];
  /** The largest average share and its axis. */
  top: { axis: string; share: number };
}

function pieceSeconds(s: SignatureLike): { seconds: number; basis: DoseBasis } | null {
  const median = s.measured?.median_seconds;
  if (typeof median === "number" && median > 0) return { seconds: median, basis: "measured_median" };
  const cap = s.workout?.time_cap_seconds;
  if (typeof cap === "number" && cap > 0) return { seconds: cap, basis: "time_cap" };
  return null;
}

function coverage(vectors: Weights[], weights: number[]): Coverage {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const raw: Record<string, number> = {};
  for (const axis of AXES) {
    let acc = 0;
    vectors.forEach((v, i) => acc += (v[axis] ?? 0) * weights[i]);
    raw[axis] = acc / totalWeight;
  }
  let entropy = 0;
  for (const axis of AXES) {
    const p = raw[axis] / 100;
    if (p > 0) entropy -= p * Math.log(p);
  }
  const mean: Weights = {};
  const class_totals: Record<AxisClass, number> = { strength: 0, gymnastics_skill: 0, conditioning: 0 };
  const untouched: string[] = [];
  let top = { axis: AXES[0], share: -1 };
  for (const axis of AXES) {
    if (raw[axis] > 1e-9) mean[axis] = round(raw[axis]);
    else untouched.push(axis);
    class_totals[AXIS_CLASS[axis]] += raw[axis];
    if (raw[axis] > top.share) top = { axis, share: raw[axis] };
  }
  for (const c of AXIS_CLASSES) class_totals[c] = round(class_totals[c]);
  return {
    mean,
    class_totals,
    evenness: round(entropy / Math.log(AXES.length)),
    effective_axes: round(Math.exp(entropy)),
    untouched,
    top: { axis: top.axis, share: round(top.share) },
  };
}

// ============================================================
// Dispersion
// ============================================================

export interface Dispersion {
  pairs: number;
  /** Mean / median / min / max of all pairwise mix distances (0–100). */
  mean: number;
  median: number;
  min: number;
  max: number;
  /** Mean of the between-class part of each pairwise distance. */
  mean_between_class: number;
  /** Each piece's distance to its closest other piece, averaged. Low when
   *  the set contains repeats, even if the overall mean is high. */
  mean_nearest: number;
  /** The closest pair in the set. */
  closest: { a: string; b: string; distance: number };
  /** Pairs at or below options.noiseFloor; null when no floor was given. */
  pairs_within_noise: number | null;
}

// ============================================================
// Spacing
// ============================================================

export interface Spacing {
  /** Mean distance between consecutive pieces, in program order. */
  adjacent_mean: number;
  /** What that mean would be on average if the order were random — exactly
   *  the mean pairwise distance. */
  shuffled_mean: number;
  /** adjacent_mean / shuffled_mean. >1 alternated, <1 clumped, ~1 random.
   *  Null when every piece is identical. */
  ratio: number | null;
  /** Share of shuffled orders whose adjacent mean is at or below the
   *  observed one (0–1). Near 1 = more alternated than almost any random
   *  order; near 0 = more clumped; the middle = not distinguishable. */
  shuffle_percentile: number;
  /** The same ratio per axis (only axes that vary across the set): below 1
   *  means that axis's emphasis comes in runs. */
  by_axis: Record<string, number>;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function adjacentMean(order: number[], d: number[][]): number {
  let acc = 0;
  for (let i = 1; i < order.length; i++) acc += d[order[i - 1]][order[i]];
  return acc / (order.length - 1);
}

function spacing(
  vectors: Weights[],
  d: number[][],
  pairwiseMean: number,
  shuffles: number,
  seed: number,
): Spacing {
  const n = vectors.length;
  const identity = vectors.map((_, i) => i);
  const observed = adjacentMean(identity, d);

  const rand = mulberry32(seed);
  let atOrBelow = 0;
  const order = identity.slice();
  for (let s = 0; s < shuffles; s++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (adjacentMean(order, d) <= observed + 1e-9) atOrBelow++;
  }

  const by_axis: Record<string, number> = {};
  for (const axis of AXES) {
    const xs = vectors.map((v) => v[axis] ?? 0);
    let adj = 0;
    for (let i = 1; i < n; i++) adj += Math.abs(xs[i] - xs[i - 1]);
    adj /= n - 1;
    let pair = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pair += Math.abs(xs[i] - xs[j]);
    pair /= (n * (n - 1)) / 2;
    if (pair > 1e-9) by_axis[axis] = round(adj / pair);
  }

  return {
    adjacent_mean: round(observed),
    shuffled_mean: round(pairwiseMean),
    ratio: pairwiseMean > 1e-9 ? round(observed / pairwiseMean) : null,
    shuffle_percentile: round(atOrBelow / shuffles),
    by_axis,
  };
}

// ============================================================
// The whole reading
// ============================================================

export interface ProgramVariation {
  vector: VectorKind;
  /** Pieces measured. */
  n: number;
  /** Pieces left out because they lack the chosen vector (labels). */
  skipped: string[];
  coverage: Coverage;
  /** Null with fewer than two pieces. */
  dispersion: Dispersion | null;
  /** Null with fewer than three pieces (order cannot matter). */
  spacing: Spacing | null;
}

/** Variation across one window of a program. Throws when no piece carries
 *  the chosen vector, or when weight:"dose" meets a piece with no duration. */
export function programVariation(
  pieces: ProgramPiece[],
  options: VariationOptions = {},
): ProgramVariation {
  const vector = options.vector ?? "demand";
  const ordered = pieces
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.position - b.p.position || a.i - b.i)
    .map(({ p, i }) => ({ ...p, label: p.label ?? `#${i + 1}` }));

  const used: Array<{ label: string; weights: Weights; signature: SignatureLike }> = [];
  const skipped: string[] = [];
  for (const p of ordered) {
    const w = p.signature[vector];
    if (w) used.push({ label: p.label, weights: w, signature: p.signature });
    else skipped.push(p.label);
  }
  if (used.length === 0) throw new Error(`no piece carries a ${vector} vector`);

  const n = used.length;
  const vectors = used.map((u) => u.weights);

  // Pairwise distances (also validates every vector).
  const d: number[][] = vectors.map(() => new Array(n).fill(0));
  const between: number[] = [];
  const all: Array<{ i: number; j: number; distance: number }> = [];
  if (n === 1) mixDistance(vectors[0], vectors[0]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const m = mixDistance(vectors[i], vectors[j]);
      d[i][j] = d[j][i] = m.total;
      between.push(m.between_class);
      all.push({ i, j, distance: m.total });
    }
  }

  let coverageWeights = vectors.map(() => 1);
  if (options.weight === "dose") {
    coverageWeights = used.map((u) => {
      const dose = pieceSeconds(u.signature);
      if (!dose) throw new Error(`weight "dose": piece ${u.label} has no duration`);
      return dose.seconds;
    });
  }

  let dispersion: Dispersion | null = null;
  let pairwiseMean = 0;
  if (n >= 2) {
    const sorted = all.map((x) => x.distance).sort((a, b) => a - b);
    pairwiseMean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    let nearestAcc = 0;
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (let j = 0; j < n; j++) if (j !== i && d[i][j] < best) best = d[i][j];
      nearestAcc += best;
    }
    const closest = all.reduce((a, b) => (b.distance < a.distance ? b : a));
    dispersion = {
      pairs: sorted.length,
      mean: round(pairwiseMean),
      median: round(median),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean_between_class: round(between.reduce((a, b) => a + b, 0) / between.length),
      mean_nearest: round(nearestAcc / n),
      closest: { a: used[closest.i].label, b: used[closest.j].label, distance: closest.distance },
      pairs_within_noise: typeof options.noiseFloor === "number"
        ? sorted.filter((x) => x <= options.noiseFloor!).length
        : null,
    };
  }

  return {
    vector,
    n,
    skipped,
    coverage: coverage(vectors, coverageWeights),
    dispersion,
    spacing: n >= 3
      ? spacing(vectors, d, pairwiseMean, options.shuffles ?? 2000, options.seed ?? 1)
      : null,
  };
}
