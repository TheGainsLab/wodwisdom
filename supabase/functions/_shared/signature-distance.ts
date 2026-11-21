// signature-distance — how different are two workouts, read from their
// signatures. Pure functions, no IO, no storage, no callers yet (variation
// work, step 1: look at numbers before deciding how to use them).
//
// The result is a set of COMPONENTS, deliberately not one blended score:
//
//   mix (per weight vector)  half the sum of absolute weight differences —
//                            0–100, "the percent of the workout allocated
//                            differently". Reported at three levels: the
//                            total, the per-axis differences, and the split
//                            into between-class and within-class movement,
//                            so a strength→conditioning disagreement can be
//                            told from a reshuffle among neighbouring axes.
//   dose                     the duration ratio. The weight vectors carry
//                            mix, not magnitude: a 5-minute and a 40-minute
//                            version of one couplet have the same weights.
//   movements                shared / unshared movement names. Two pieces
//                            can share a signature and no movements (or the
//                            reverse) — this sits alongside the mix, it is
//                            not folded into it.
//   gates, format, time domain   categorical, reported as-is.
//
// Known limits (do not read distances without them):
//   - Repeat drafts of ONE workout have measured 5–15 apart on demand within
//     a drafting batch and 20–30 across batches; small distances are noise.
//   - Loads are invisible to the mix by design (the judge sees them, the
//     vector does not carry them).

export type Weights = Record<string, number>;

export const AXIS_CLASSES = ["strength", "gymnastics_skill", "conditioning"] as const;
export type AxisClass = typeof AXIS_CLASSES[number];

/** Axis → class. Mirrors the `class` column of public.signature_axes. */
export const AXIS_CLASS: Record<string, AxisClass> = {
  olympic_lifting: "strength",
  powerlifting_strength: "strength",
  posterior_chain: "strength",
  upper_body_pressing: "strength",
  gymnastics_pulling: "gymnastics_skill",
  gymnastics_pressing: "gymnastics_skill",
  midline: "gymnastics_skill",
  skill_coordination: "gymnastics_skill",
  squat_cycling: "conditioning",
  aerobic_capacity: "conditioning",
  anaerobic_capacity: "conditioning",
  mixed_modal_conditioning: "conditioning",
};

/** Weight vectors must sum to 100. The tolerance admits averaged
 *  (non-5%-step) vectors, which are valid input here. */
const SUM_TOLERANCE = 0.01;

const round = (n: number) => Math.round(n * 1000) / 1000;

function checkWeights(w: Weights, label: string): void {
  let sum = 0;
  for (const [axis, v] of Object.entries(w)) {
    if (!(axis in AXIS_CLASS)) throw new Error(`${label}: "${axis}" is not a signature axis`);
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(`${label}.${axis}: must be a non-negative number (got ${v})`);
    }
    sum += v;
  }
  if (Math.abs(sum - 100) > SUM_TOLERANCE) {
    throw new Error(`${label}: weights sum to ${sum}, must sum to 100`);
  }
}

function classTotals(w: Weights): Record<AxisClass, number> {
  const out: Record<AxisClass, number> = { strength: 0, gymnastics_skill: 0, conditioning: 0 };
  for (const [axis, v] of Object.entries(w)) out[AXIS_CLASS[axis]] += v;
  for (const c of AXIS_CLASSES) out[c] = round(out[c]);
  return out;
}

export interface MixDistance {
  /** Half the sum of absolute differences, 0–100. */
  total: number;
  /** b − a for every axis where the two differ. */
  by_axis: Record<string, number>;
  class_totals: { a: Record<AxisClass, number>; b: Record<AxisClass, number> };
  /** The part of `total` that moved from one class to another. */
  between_class: number;
  /** The part of `total` reshuffled among axes of the same class. */
  within_class: number;
}

/** Distance between two weight vectors of the same kind. Symmetric in
 *  everything but the sign of `by_axis`. */
export function mixDistance(a: Weights, b: Weights): MixDistance {
  checkWeights(a, "a");
  checkWeights(b, "b");
  const by_axis: Record<string, number> = {};
  let l1 = 0;
  for (const axis of Object.keys(AXIS_CLASS)) {
    const d = (b[axis] ?? 0) - (a[axis] ?? 0);
    if (Math.abs(d) > 1e-9) by_axis[axis] = round(d);
    l1 += Math.abs(d);
  }
  const ca = classTotals(a);
  const cb = classTotals(b);
  let classL1 = 0;
  for (const c of AXIS_CLASSES) classL1 += Math.abs(cb[c] - ca[c]);
  const total = round(l1 / 2);
  const between_class = round(classL1 / 2);
  return {
    total,
    by_axis,
    class_totals: { a: ca, b: cb },
    between_class,
    within_class: round(total - between_class),
  };
}

// ============================================================
// Dose
// ============================================================

export type DoseBasis = "measured_median" | "time_cap";

export interface DoseDistance {
  seconds_a: number;
  seconds_b: number;
  basis_a: DoseBasis;
  basis_b: DoseBasis;
  /** Longer over shorter, always >= 1 — 5 vs 10 minutes reads the same as
   *  20 vs 40. */
  ratio: number;
  /** log2 of `ratio`: 0 = same duration, 1 = one is twice the other. */
  log2_ratio: number;
}

export interface SignatureLike {
  demand: Weights;
  discrimination?: Weights | null;
  stimulus?: Weights | null;
  gates?: Array<{ movement?: string; kind?: string }> | null;
  format?: string | null;
  time_domain?: string | null;
  workout?: {
    time_cap_seconds?: number | null;
    movements?: Array<{ movement?: string | null }> | null;
  } | null;
  measured?: { median_seconds?: number | null } | null;
}

function doseSeconds(s: SignatureLike): { seconds: number; basis: DoseBasis } | null {
  const median = s.measured?.median_seconds;
  if (typeof median === "number" && median > 0) return { seconds: median, basis: "measured_median" };
  const cap = s.workout?.time_cap_seconds;
  if (typeof cap === "number" && cap > 0) return { seconds: cap, basis: "time_cap" };
  return null;
}

/** Null when either side has no usable duration. */
export function doseDistance(a: SignatureLike, b: SignatureLike): DoseDistance | null {
  const da = doseSeconds(a);
  const db = doseSeconds(b);
  if (!da || !db) return null;
  const ratio = Math.max(da.seconds, db.seconds) / Math.min(da.seconds, db.seconds);
  return {
    seconds_a: da.seconds,
    seconds_b: db.seconds,
    basis_a: da.basis,
    basis_b: db.basis,
    ratio: round(ratio),
    log2_ratio: round(Math.log2(ratio)),
  };
}

// ============================================================
// Movements and gates
// ============================================================

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface SetDistance {
  shared: string[];
  only_a: string[];
  only_b: string[];
  /** 1 − |shared| / |union|; 0 when both sides are empty. */
  jaccard_distance: number;
}

function setDistance(a: Set<string>, b: Set<string>): SetDistance {
  const shared = [...a].filter((x) => b.has(x)).sort();
  const only_a = [...a].filter((x) => !b.has(x)).sort();
  const only_b = [...b].filter((x) => !a.has(x)).sort();
  const union = shared.length + only_a.length + only_b.length;
  return {
    shared,
    only_a,
    only_b,
    jaccard_distance: union === 0 ? 0 : round(1 - shared.length / union),
  };
}

function movementSet(s: SignatureLike): Set<string> {
  const out = new Set<string>();
  for (const m of s.workout?.movements ?? []) {
    const name = typeof m?.movement === "string" ? norm(m.movement) : "";
    if (name) out.add(name);
  }
  return out;
}

/** Overlap of normalized movement NAMES (a movement listed twice at two
 *  loads counts once). Names are compared as written — "Pull Up" and
 *  "Kipping Pull Up" are different entries. */
export function movementDistance(a: SignatureLike, b: SignatureLike): SetDistance {
  return setDistance(movementSet(a), movementSet(b));
}

function gateSet(s: SignatureLike): Set<string> {
  const out = new Set<string>();
  for (const g of s.gates ?? []) {
    const name = typeof g?.movement === "string" ? norm(g.movement) : "";
    if (name) out.add(`${name} (${g.kind ?? "?"})`);
  }
  return out;
}

export function gateDistance(a: SignatureLike, b: SignatureLike): SetDistance {
  return setDistance(gateSet(a), gateSet(b));
}

// ============================================================
// The whole comparison
// ============================================================

export interface SignatureDistance {
  demand: MixDistance;
  /** Null when either signature lacks the vector (drafts in progress). */
  discrimination: MixDistance | null;
  stimulus: MixDistance | null;
  dose: DoseDistance | null;
  movements: SetDistance;
  gates: SetDistance;
  /** Null when either side has no value. */
  same_format: boolean | null;
  same_time_domain: boolean | null;
}

function sameOrNull(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a || !b) return null;
  return a === b;
}

export function signatureDistance(a: SignatureLike, b: SignatureLike): SignatureDistance {
  const optional = (x: Weights | null | undefined, y: Weights | null | undefined) =>
    x && y ? mixDistance(x, y) : null;
  return {
    demand: mixDistance(a.demand, b.demand),
    discrimination: optional(a.discrimination, b.discrimination),
    stimulus: optional(a.stimulus, b.stimulus),
    dose: doseDistance(a, b),
    movements: movementDistance(a, b),
    gates: gateDistance(a, b),
    same_format: sameOrNull(a.format, b.format),
    same_time_domain: sameOrNull(a.time_domain, b.time_domain),
  };
}
