// signature-program-variation — how varied is a SET of workouts (a week, a
// month, a cycle), read from their signatures. Pure functions, no IO, no
// storage, no callers yet (variation work, step 2).
//
// NOT VALIDATED. Everything here is built on the pairwise mix distance,
// which has not yet been checked against a coach's blind judgment. Treat
// the output as numbers to look at, not as findings, until that is done.
//
// SCOPE: scored metcons only. Only metcons carry signatures, so nothing
// here speaks for strength, skill or accessory work. Unscored pieces
// (format rounds_ntf or steady — recovery, "not for time") are left out and
// counted, because intensity is the recorded score and they have none.
//
// HOW TO READ IT
//   - The caller chooses the window: pass one week's pieces, or one month's.
//     Only compare windows of the same length. A week (5–6 pieces) is too
//     few for coverage; read consecutive distance and near-duplicates there,
//     dispersion and label coverage at a month, axis coverage and
//     recurrence gaps at a cycle.
//   - The measures are separate numbers on purpose. Nothing here blends
//     them into one score, and nothing says how much variation is enough —
//     that needs a reference this module does not have. The fair
//     comparisons today are one window against another of the same length,
//     and the real order against the shuffled one.
//
// THE MEASURES
//   coverage    WHAT got trained: the average weight vector and how evenly
//               it fills the twelve axes — counted both per piece and per
//               minute. Draft noise mostly cancels here (a consistent bias
//               does not). The same reading is applied to two labels the
//               weights cannot see: format and duration.
//   dispersion  HOW DIFFERENT the pieces are from each other. The same
//               balanced chipper every day has full coverage and zero
//               dispersion. Draft noise INFLATES this, most for the closest
//               pairs, so it is reported raw beside the noise floor the
//               caller supplies — never corrected.
//   spacing     WHETHER THE ORDER MATTERS: consecutive pieces against the
//               same pieces in shuffled order, plus how long each axis goes
//               between appearances.

import {
  AXIS_CLASS,
  AXIS_CLASSES,
  type AxisClass,
  mixDistance,
  type SignatureLike,
  type Weights,
} from "./signature-distance.ts";

export type VectorKind = "demand" | "discrimination" | "stimulus";

export interface ProgramPiece {
  /** Where the piece falls in the program — any increasing number. Pieces
   *  are ordered by it; ties keep input order. */
  position: number;
  /** Optional calendar day number (any unit where +1 = the next day). When
   *  EVERY measured piece has one, recurrence gaps are also given in days,
   *  so rest days count. */
  day?: number;
  signature: SignatureLike;
  /** Optional label carried into the output (workout name, hash, date). */
  label?: string;
}

export interface VariationOptions {
  /** Which weight vector to read. Default "demand": stimulus has not been
   *  shown to differ measurably from demand (review 2026-11-21). */
  vector?: VectorKind;
  /** Draft noise on the pairwise distance; echoed beside dispersion, with
   *  the count of pairs at or below it. */
  noiseFloor?: number;
  /** Shuffles behind every "shuffled" figure. Default 2000; seeded, so
   *  results are reproducible. */
  shuffles?: number;
  seed?: number;
  /** Keep unscored pieces in. Default false. */
  includeUnscored?: boolean;
}

const AXES = Object.keys(AXIS_CLASS);
const round = (n: number) => Math.round(n * 1000) / 1000;

// ============================================================
// Piece shape: format and duration, from the typed scheme
// ============================================================

/** Formats a metcon can take. rounds_ntf and steady are the unscored ones. */
export const SCORED_FORMATS = ["amrap", "emom", "rft", "for_time", "intervals"] as const;
const UNSCORED_FORMATS = new Set(["rounds_ntf", "steady"]);

/** Duration bins. FIXED (2026-11-21) — do not move the edges after seeing
 *  data. Lower edge inclusive: exactly 2:00 is "2_to_5". Roughly a factor
 *  of two apart, matching the ratio-based dose term. */
export const DURATION_BINS = [
  { key: "under_2", min: 0 },
  { key: "2_to_5", min: 120 },
  { key: "5_to_10", min: 300 },
  { key: "10_to_20", min: 600 },
  { key: "20_to_40", min: 1200 },
  { key: "over_40", min: 2400 },
] as const;

export function durationBin(seconds: number): string {
  let key: string = DURATION_BINS[0].key;
  for (const b of DURATION_BINS) if (seconds >= b.min) key = b.key;
  return key;
}

export type DurationBasis = "scheme_format" | "scheme_text" | "measured_median" | "time_cap";

export interface PieceShape {
  format: string;
  /** "scheme_format" = the typed field the header was rendered from (no
   *  parsing); "scheme_text" = read back from header text (library rows). */
  format_source: "scheme_format" | "scheme_text" | "none";
  /** One continuous work bout. Intervals: one work window. Everything else:
   *  the whole piece (an EMOM counts by its full clock). */
  bout_seconds: number | null;
  /** All work in the piece. Intervals: rounds × work window. */
  total_work_seconds: number | null;
  /** Intervals only: work window ÷ rest window. 8 × 2:00/0:30 (ratio 4) is
   *  nearly continuous; 4 × 2:00/4:00 (ratio 0.5) is not — bout length
   *  alone cannot tell them apart. */
  work_rest_ratio: number | null;
  /** Where the duration came from. "time_cap" OVERSTATES it: the piece is
   *  for time and has no measured median, so the cap stood in. */
  duration_basis: DurationBasis | null;
  scored: boolean;
}

function clockToSeconds(s: string): number {
  if (s.endsWith("s")) return parseInt(s, 10);
  const [m, sec] = s.split(":");
  return parseInt(m, 10) * 60 + parseInt(sec, 10);
}

const INTERVAL_TEXT = /(\d+)\s*rounds?\s*:\s*(\d+:\d{2}|\d+s)\s*on\s*\/\s*(\d+:\d{2}|\d+s)\s*off/i;

/** Header text → format, for rows with no typed scheme_format. Separate
 *  from signature-hash's canonicalScheme on purpose: that one feeds the
 *  workout hash and cannot change, and it reads interval headers as "other"
 *  or "amrap" and "not for time" as for_time. */
export function formatFromSchemeText(scheme: string | null | undefined): string {
  const t = (scheme ?? "").toLowerCase();
  if (!t.trim()) return "unknown";
  if (/not\s+for\s+time/.test(t)) return "rounds_ntf";
  if (/\bon\s*\/.*\boff\b/.test(t) || /\binterval/.test(t)) return "intervals";
  if (/\bemom\b|every\s+\d+\s*min/.test(t)) return "emom";
  if (/\bamrap\b/.test(t)) return "amrap";
  if (/rounds?\s+for\s+time|\brft\b/.test(t)) return "rft";
  if (/for\s*time/.test(t)) return "for_time";
  return "other";
}

export function pieceShape(sig: SignatureLike): PieceShape {
  const w = sig.workout ?? {};
  const sf = w.scheme_format ?? null;
  const text = w.block_scheme ?? null;
  const pos = (n: number | null | undefined) => (typeof n === "number" && n > 0 ? n : null);

  let format: string;
  let format_source: PieceShape["format_source"];
  if (sf?.format) {
    format = sf.format;
    format_source = "scheme_format";
  } else if (text?.trim()) {
    format = formatFromSchemeText(text);
    format_source = "scheme_text";
  } else {
    format = "unknown";
    format_source = "none";
  }

  let bout: number | null = null;
  let total: number | null = null;
  let ratio: number | null = null;
  let basis: DurationBasis | null = null;

  if (format === "intervals") {
    let rounds = pos(sf?.rounds), work = pos(sf?.work_seconds), rest = pos(sf?.rest_seconds);
    if (work) basis = "scheme_format";
    else {
      const m = (text ?? "").match(INTERVAL_TEXT);
      if (m) {
        rounds = parseInt(m[1], 10);
        work = clockToSeconds(m[2]);
        rest = pos(clockToSeconds(m[3]));
        basis = "scheme_text";
      }
    }
    if (work) {
      bout = work;
      total = rounds ? rounds * work : null;
      ratio = rest ? round(work / rest) : null;
    }
  } else if (format === "amrap" || format === "emom") {
    const typed = pos(sf?.minutes);
    const fromText = (text ?? "").match(/\b(?:amrap|emom)\s*-?\s*(\d+)/i);
    if (typed) [bout, basis] = [typed * 60, "scheme_format"];
    else if (pos(w.time_cap_seconds)) [bout, basis] = [w.time_cap_seconds!, "time_cap"];
    else if (fromText) [bout, basis] = [parseInt(fromText[1], 10) * 60, "scheme_text"];
    // For a fixed clock the cap IS the duration — not an overstatement.
    if (basis === "time_cap") basis = "scheme_format";
    total = bout;
  } else {
    const median = pos(sig.measured?.median_seconds);
    if (median) [bout, basis] = [median, "measured_median"];
    else if (pos(w.time_cap_seconds)) [bout, basis] = [w.time_cap_seconds!, "time_cap"];
    total = bout;
  }

  return {
    format,
    format_source,
    bout_seconds: bout,
    total_work_seconds: total,
    work_rest_ratio: ratio,
    duration_basis: basis,
    scored: !UNSCORED_FORMATS.has(format),
  };
}

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
   *  (1–12): "this month used about 6 of 12 axes". */
  effective_axes: number;
  /** Axes with no share in any piece. */
  untouched: string[];
  top: { axis: string; share: number };
}

function entropyOf(shares: number[]): number {
  let h = 0;
  for (const p of shares) if (p > 0) h -= p * Math.log(p);
  return h;
}

function axisCoverage(vectors: Weights[], weights: number[]): Coverage {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const raw: Record<string, number> = {};
  for (const axis of AXES) {
    let acc = 0;
    vectors.forEach((v, i) => acc += (v[axis] ?? 0) * weights[i]);
    raw[axis] = acc / totalWeight;
  }
  const entropy = entropyOf(AXES.map((a) => raw[a] / 100));
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

export interface LabelCoverage {
  /** Pieces per category. EVERY defined category is listed, zeros included,
   *  so an empty one reads as a gap instead of vanishing. */
  counts: Record<string, number>;
  /** Pieces whose label could not be determined (not in `counts`). */
  unknown: number;
  /** The number of equally-used categories that would give the same spread. */
  effective: number;
  /** 0–1 against ALL defined categories. */
  evenness: number;
  empty: string[];
  top: { category: string; share: number } | null;
}

function labelCoverage(categories: readonly string[], labels: Array<string | null>): LabelCoverage {
  const counts: Record<string, number> = {};
  for (const c of categories) counts[c] = 0;
  let unknown = 0;
  for (const l of labels) {
    if (l === null || l === "unknown") unknown++;
    else counts[l] = (counts[l] ?? 0) + 1; // a category outside the list still shows
  }
  const known = labels.length - unknown;
  const keys = Object.keys(counts);
  const entropy = known > 0 ? entropyOf(keys.map((k) => counts[k] / known)) : 0;
  let top: LabelCoverage["top"] = null;
  for (const k of keys) {
    if (known > 0 && (top === null || counts[k] / known > top.share)) {
      top = { category: k, share: counts[k] / known };
    }
  }
  return {
    counts,
    unknown,
    effective: known > 0 ? round(Math.exp(entropy)) : 0,
    evenness: round(Math.min(1, entropy / Math.log(keys.length))),
    empty: keys.filter((k) => counts[k] === 0),
    top: top ? { category: top.category, share: round(top.share) } : null,
  };
}

export interface CoverageReport {
  /** Every piece counts once. */
  per_piece: Coverage;
  /** Pieces count in proportion to total work time; computed over the
   *  pieces that have one. Null when none does. */
  per_minute: Coverage | null;
  /** Pieces left out of per_minute (no duration). */
  without_duration: string[];
  format: LabelCoverage;
  /** Duration read two ways, because for interval pieces they differ and
   *  which one matches a coach's judgment is not settled. */
  duration_by_bout: LabelCoverage;
  duration_by_total_work: LabelCoverage;
  /** For-time pieces whose duration is the CAP (no measured median) — an
   *  overstatement; their bins may be one too long. */
  duration_from_cap: string[];
  /** Every interval piece with the three values that describe it. */
  intervals: Array<{
    label: string;
    bout_seconds: number | null;
    total_work_seconds: number | null;
    work_rest_ratio: number | null;
  }>;
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
  /** The noise floor the caller supplied (null if none) and how many pairs
   *  sit at or below it. Read `mean` beside these, never alone. */
  noise_floor: number | null;
  pairs_within_noise: number | null;
  /** Each piece's closest other piece — near-duplicates show here even
   *  when the overall mean is high. In program order. */
  nearest: Array<{ label: string; nearest: string; distance: number }>;
  mean_nearest: number;
}

// ============================================================
// Spacing
// ============================================================

/** Shares at which an axis counts as "present" in a piece. Three, because a
 *  draft moves an axis by about one 5-point step on noise alone, so a
 *  single threshold could be deciding the result. */
export const RECURRENCE_THRESHOLDS = [10, 15, 20] as const;

export type RecurrenceVerdict = "more_regular" | "as_random" | "less_regular";

export interface RecurrenceGaps {
  /** Pieces in which the axis is present at this threshold. */
  occurrences: number;
  /** Average gap between consecutive appearances, in sessions (1 = back to
   *  back). Null with fewer than two appearances. */
  mean_gap: number | null;
  /** The longest stretch from one appearance to the next, in sessions,
   *  with the start and end of the window counted as boundaries. Null when
   *  the axis never appears at this threshold. */
  longest_gap: number | null;
  /** The longest gap the same pieces give on average in shuffled order. */
  shuffled_longest_gap: number | null;
  /** longest ÷ shuffled: ≤0.9 more_regular, ≥1.1 less_regular. */
  verdict: RecurrenceVerdict | null;
  /** The same in days — only when every piece carries `day`. */
  longest_gap_days: number | null;
  shuffled_longest_gap_days: number | null;
}

export interface AxisRecurrence {
  /** Keyed by threshold ("10", "15", "20"). */
  at: Record<string, RecurrenceGaps>;
  /** True when the verdict differs between thresholds: the conclusion for
   *  this axis depends on where "present" is drawn — do not rely on it. */
  threshold_sensitive: boolean;
}

export interface Spacing {
  /** Mean distance between consecutive pieces, in program order. */
  adjacent_mean: number;
  /** What that mean is on average in random order — exactly the mean
   *  pairwise distance. */
  shuffled_mean: number;
  /** adjacent ÷ shuffled. >1 alternated, <1 clumped, ~1 random. Null when
   *  every piece is identical. */
  ratio: number | null;
  /** Share of shuffled orders whose adjacent mean is at or below the real
   *  one (0–1). Near 1 = more alternated than almost any random order;
   *  near 0 = more clumped; the middle = not distinguishable from random. */
  shuffle_percentile: number;
  /** The same ratio per axis (axes that vary). Needs no threshold, so it
   *  cross-checks the recurrence gaps: below 1 = that axis comes in runs. */
  by_axis: Record<string, number>;
  /** How long each axis goes between appearances. */
  recurrence: Record<string, AxisRecurrence>;
  /** Whether the day-based gap figures are filled in. */
  has_days: boolean;
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

/** Longest stretch from one appearance to the next, with the start and end
 *  of the window counted as boundaries — so three appearances bunched at
 *  the front of a month read as a long gap, not a short one. Null when the
 *  axis never appears. `slots[s]` is the slot's coordinate (session index
 *  or day); `order[s]` is the piece sitting in it. */
function longestGap(present: boolean[], order: number[], slots: number[]): number | null {
  let last = slots[0] - 1;
  let longest = 0;
  let seen = false;
  for (let s = 0; s < order.length; s++) {
    if (!present[order[s]]) continue;
    longest = Math.max(longest, slots[s] - last);
    last = slots[s];
    seen = true;
  }
  if (!seen) return null;
  return Math.max(longest, slots[slots.length - 1] + 1 - last);
}

function verdictOf(longest: number | null, shuffled: number | null): RecurrenceVerdict | null {
  if (longest === null || shuffled === null || shuffled <= 0) return null;
  const r = longest / shuffled;
  return r <= 0.9 ? "more_regular" : r >= 1.1 ? "less_regular" : "as_random";
}

function spacing(
  vectors: Weights[],
  d: number[][],
  pairwiseMean: number,
  days: number[] | null,
  shuffles: number,
  seed: number,
): Spacing {
  const n = vectors.length;
  const identity = vectors.map((_, i) => i);
  const sessions = identity.slice();
  const observed = adjacentMean(identity, d);

  const rand = mulberry32(seed);
  const perms: number[][] = [];
  const order = identity.slice();
  let atOrBelow = 0;
  for (let s = 0; s < shuffles; s++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    perms.push(order.slice());
    if (adjacentMean(order, d) <= observed + 1e-9) atOrBelow++;
  }

  const by_axis: Record<string, number> = {};
  const recurrence: Record<string, AxisRecurrence> = {};
  for (const axis of AXES) {
    const xs = vectors.map((v) => v[axis] ?? 0);
    let adj = 0;
    for (let i = 1; i < n; i++) adj += Math.abs(xs[i] - xs[i - 1]);
    adj /= n - 1;
    let pair = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pair += Math.abs(xs[i] - xs[j]);
    pair /= (n * (n - 1)) / 2;
    if (pair > 1e-9) by_axis[axis] = round(adj / pair);

    const at: Record<string, RecurrenceGaps> = {};
    const verdicts = new Set<RecurrenceVerdict>();
    for (const threshold of RECURRENCE_THRESHOLDS) {
      const present = xs.map((x) => x >= threshold);
      const occurrences = present.filter(Boolean).length;
      const shuffledMean = (slots: number[]): number | null => {
        if (occurrences < 1) return null;
        let acc = 0;
        for (const p of perms) acc += longestGap(present, p, slots)!;
        return round(acc / perms.length);
      };
      const longest = longestGap(present, identity, sessions);
      let mean_gap: number | null = null;
      if (occurrences >= 2) {
        const idx = identity.filter((i) => present[i]);
        mean_gap = round((idx[idx.length - 1] - idx[0]) / (occurrences - 1));
      }
      const shuffled = shuffledMean(sessions);
      const verdict = verdictOf(longest, shuffled);
      if (verdict) verdicts.add(verdict);
      at[String(threshold)] = {
        occurrences,
        mean_gap,
        longest_gap: longest,
        shuffled_longest_gap: shuffled,
        verdict,
        longest_gap_days: days ? longestGap(present, identity, days) : null,
        shuffled_longest_gap_days: days ? shuffledMean(days) : null,
      };
    }
    if (xs.some((x) => x >= RECURRENCE_THRESHOLDS[0])) {
      recurrence[axis] = { at, threshold_sensitive: verdicts.size > 1 };
    }
  }

  return {
    adjacent_mean: round(observed),
    shuffled_mean: round(pairwiseMean),
    ratio: pairwiseMean > 1e-9 ? round(observed / pairwiseMean) : null,
    shuffle_percentile: round(atOrBelow / shuffles),
    by_axis,
    recurrence,
    has_days: days !== null,
  };
}

// ============================================================
// The whole reading
// ============================================================

export interface ProgramVariation {
  vector: VectorKind;
  /** Pieces the measures rest on. Carry this wherever a number is quoted. */
  n: number;
  /** Unscored pieces left out (recovery, not for time). */
  excluded_unscored: { count: number; labels: string[] };
  /** Scored pieces left out because they lack the chosen vector. */
  skipped: string[];
  coverage: CoverageReport;
  /** Null with fewer than two pieces. */
  dispersion: Dispersion | null;
  /** Null with fewer than three pieces (order cannot matter). */
  spacing: Spacing | null;
}

/** Variation across one window of a program. Throws when no scored piece
 *  carries the chosen vector. */
export function programVariation(
  pieces: ProgramPiece[],
  options: VariationOptions = {},
): ProgramVariation {
  const vector = options.vector ?? "demand";
  const ordered = pieces
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.position - b.p.position || a.i - b.i)
    .map(({ p, i }) => ({ ...p, label: p.label ?? `#${i + 1}`, shape: pieceShape(p.signature) }));

  const excluded: string[] = [];
  const skipped: string[] = [];
  const used: typeof ordered = [];
  for (const p of ordered) {
    if (!p.shape.scored && !options.includeUnscored) excluded.push(p.label);
    else if (!p.signature[vector]) skipped.push(p.label);
    else used.push(p);
  }
  if (used.length === 0) throw new Error(`no scored piece carries a ${vector} vector`);

  const n = used.length;
  const vectors = used.map((u) => u.signature[vector]!);

  // Pairwise distances (also validates every vector).
  const d: number[][] = vectors.map(() => new Array(n).fill(0));
  const between: number[] = [];
  const all: number[] = [];
  if (n === 1) mixDistance(vectors[0], vectors[0]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const m = mixDistance(vectors[i], vectors[j]);
      d[i][j] = d[j][i] = m.total;
      between.push(m.between_class);
      all.push(m.total);
    }
  }

  // ── coverage ──
  const timed = used.filter((u) => u.shape.total_work_seconds !== null);
  const coverage: CoverageReport = {
    per_piece: axisCoverage(vectors, vectors.map(() => 1)),
    per_minute: timed.length > 0
      ? axisCoverage(timed.map((u) => u.signature[vector]!), timed.map((u) => u.shape.total_work_seconds!))
      : null,
    without_duration: used.filter((u) => u.shape.total_work_seconds === null).map((u) => u.label),
    format: labelCoverage(SCORED_FORMATS, used.map((u) => u.shape.format)),
    duration_by_bout: labelCoverage(
      DURATION_BINS.map((b) => b.key),
      used.map((u) => (u.shape.bout_seconds === null ? null : durationBin(u.shape.bout_seconds))),
    ),
    duration_by_total_work: labelCoverage(
      DURATION_BINS.map((b) => b.key),
      used.map((u) => (u.shape.total_work_seconds === null ? null : durationBin(u.shape.total_work_seconds))),
    ),
    duration_from_cap: used.filter((u) => u.shape.duration_basis === "time_cap").map((u) => u.label),
    intervals: used.filter((u) => u.shape.format === "intervals").map((u) => ({
      label: u.label,
      bout_seconds: u.shape.bout_seconds,
      total_work_seconds: u.shape.total_work_seconds,
      work_rest_ratio: u.shape.work_rest_ratio,
    })),
  };

  // ── dispersion ──
  let dispersion: Dispersion | null = null;
  let pairwiseMean = 0;
  if (n >= 2) {
    const sorted = all.slice().sort((a, b) => a - b);
    pairwiseMean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const nearest = used.map((u, i) => {
      let best = -1;
      for (let j = 0; j < n; j++) if (j !== i && (best < 0 || d[i][j] < d[i][best])) best = j;
      return { label: u.label, nearest: used[best].label, distance: d[i][best] };
    });
    const floor = typeof options.noiseFloor === "number" ? options.noiseFloor : null;
    dispersion = {
      pairs: sorted.length,
      mean: round(pairwiseMean),
      median: round(median),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean_between_class: round(between.reduce((a, b) => a + b, 0) / between.length),
      noise_floor: floor,
      pairs_within_noise: floor === null ? null : sorted.filter((x) => x <= floor).length,
      nearest,
      mean_nearest: round(nearest.reduce((a, b) => a + b.distance, 0) / n),
    };
  }

  const days = used.every((u) => typeof u.day === "number") ? used.map((u) => u.day!) : null;

  return {
    vector,
    n,
    excluded_unscored: { count: excluded.length, labels: excluded },
    skipped,
    coverage,
    dispersion,
    spacing: n >= 3
      ? spacing(vectors, d, pairwiseMean, days, options.shuffles ?? 2000, options.seed ?? 1)
      : null,
  };
}
