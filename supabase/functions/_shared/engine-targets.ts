/**
 * engine-targets — the pace target for one work segment (Phase 2,
 * docs/conditioning_continuum_phase2_plan.md §2–§4).
 *
 *   curve mode   target = trial × R_machine(work) × share^k × M_athlete(D(p_asked))
 *   legacy mode  target = trial × centre(paceRange) × rolling_ratio      (today's day page, verbatim)
 *
 * The share is a share of EFFORT: k converts it to this machine's pace
 * (1 for fan-bike calories, 0.30 for Concept2 metres, 0.73 C2 calories,
 * ≈0.45 running). Exceptions keep today's shape: max efforts have no target;
 * blocks without an intensityShare (zone 2, flux lifts, towers' continuous
 * blocks) are authored fractions; a machine/unit without a reference curve
 * uses the authored fraction; no current trial → no number.
 *
 * Pure. Both the targets function and its tests use this; nothing else
 * computes a target.
 */

import { balancedBout, balancedPaceMultiple, effortBandOf, type EngineCurve, mAtEffort, type PdCurvePoint } from "./engine-continuum.ts";

export type TargetBasis = "curve" | "legacy" | "authored" | "max_effort" | "no_curve" | "no_trial";

export interface TargetBlockParams {
  rounds?: number | number[] | string;
  workDuration?: number | number[] | string;
  paceRange?: number[] | string;
  basePace?: number[] | string;
  fluxPaceRange?: number[] | string;
  /** Phase 2: [min,max] share of the balanced max for the bout (a share of effort). Absent → authored fraction. */
  intensityShare?: number[];
  workProgression?: string;
  paceProgression?: string;
  paceIncrement?: number;
  fluxStartIntensity?: number;
  fluxIncrement?: number;
  [k: string]: unknown;
}

export interface TargetSegment {
  /** Work | Base | Flux | BURST | Max Effort */
  label: string;
  duration_seconds: number;
  round_index: number;
  /** rounds in the block (for per-round progressions) */
  rounds: number;
}

export interface TargetContext {
  mode: "curve" | "legacy";
  /** the current trial's pace on this machine/unit, units per minute; null = no current trial */
  trialPace: number | null;
  /** this machine/unit's reference curve; null = none authored */
  machineCurve: PdCurvePoint[] | null;
  /** exponent converting a share of effort to a share of this machine's pace */
  kEffort: number | null;
  athleteCurve: EngineCurve | null;
  /** legacy only: engine_user_performance_metrics.rolling_avg_ratio for (day_type, modality) */
  rollingRatio?: number | null;
  /** legacy only: sequenced days ('gen:' program) own their intensity — no rolling multiplier */
  isGenerated?: boolean;
  /** weekly cap (§4): the target last shown for this band on this machine within 7 days, and the trial it used */
  previous?: { band: string; target_pace: number; trial_pace: number } | null;
}

export interface SegmentTarget {
  /** units per minute; null when there is nothing to ask (max effort, no trial) */
  target_pace: number | null;
  basis: TargetBasis;
  /** the fraction of trial actually asked (curve: p_asked × M; legacy/authored: centre × rolling) */
  fraction: number | null;
  p_balanced?: number;
  share?: number;
  p_asked?: number;
  m?: number;
  band?: string;
  effort_seconds?: number;
  /** true when the weekly cap bound the number */
  capped?: boolean;
}

export const WEEKLY_CAP = 0.05;

function pair(v: unknown): [number, number] | null {
  if (Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number") return [v[0], v[1]];
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === "number") return [v[0], v[0]];
  return null;
}

/** The authored pace key for a segment, as the day page chooses it. */
function paceForSegment(block: TargetBlockParams, seg: TargetSegment): number[] | string | undefined {
  if (seg.label === "Flux") return block.fluxPaceRange ?? block.paceRange;
  if (seg.label === "Base") return block.basePace ?? block.paceRange;
  return block.paceRange;
}

function isMaxEffort(block: TargetBlockParams, seg: TargetSegment): boolean {
  const pace = paceForSegment(block, seg);
  return pace === "max_effort" || seg.label === "BURST" || seg.label === "Max Effort";
}

/** Per-round value on a rising progression: lo + r × increment, increment defaulting to the range span over the rounds. */
function progressed(range: [number, number], seg: TargetSegment, increment?: number): number {
  const inc = increment ?? (seg.rounds > 1 ? (range[1] - range[0]) / (seg.rounds - 1) : 0);
  return range[0] + seg.round_index * inc;
}

/** Today's authored fraction for the segment (centre of the range; progressions per round; flux stages by step). */
export function authoredFraction(block: TargetBlockParams, seg: TargetSegment): number | null {
  if (isMaxEffort(block, seg)) return null;
  if (seg.label === "Flux" && block.workProgression === "progressive_flux_intensity") {
    return (block.fluxStartIntensity ?? 0.75) + seg.round_index * (block.fluxIncrement ?? 0.05);
  }
  const range = pair(paceForSegment(block, seg));
  if (!range) return null;
  if (seg.label === "Work" && block.paceProgression === "increasing" && seg.rounds > 1) return progressed(range, seg, block.paceIncrement);
  return (range[0] + range[1]) / 2;
}

/** Today's target, verbatim: trial × fraction × rolling (rolling = 1 on sequenced days). */
export function legacyTarget(block: TargetBlockParams, seg: TargetSegment, ctx: TargetContext): SegmentTarget {
  if (isMaxEffort(block, seg)) return { target_pace: null, basis: "max_effort", fraction: null };
  const f = authoredFraction(block, seg);
  if (f == null) return { target_pace: null, basis: "max_effort", fraction: null };
  if (ctx.trialPace == null || ctx.trialPace <= 0) return { target_pace: null, basis: "no_trial", fraction: f };
  const rolling = ctx.isGenerated ? 1 : (ctx.rollingRatio ?? 1);
  return { target_pace: ctx.trialPace * f * rolling, basis: "legacy", fraction: f * rolling };
}

/** The share for this segment: centre of intensityShare, or per round on a rising progression. */
function shareForSegment(block: TargetBlockParams, seg: TargetSegment): number | null {
  const range = pair(block.intensityShare);
  if (!range) return null;
  if (seg.label === "Work" && block.paceProgression === "increasing" && seg.rounds > 1) return progressed(range, seg);
  return (range[0] + range[1]) / 2;
}

/** Phase 2 target for one work segment. */
export function segmentTarget(block: TargetBlockParams, seg: TargetSegment, ctx: TargetContext): SegmentTarget {
  if (ctx.mode === "legacy") return legacyTarget(block, seg, ctx);
  if (isMaxEffort(block, seg)) return { target_pace: null, basis: "max_effort", fraction: null };
  if (ctx.trialPace == null || ctx.trialPace <= 0) return { target_pace: null, basis: "no_trial", fraction: null };

  // Base / Flux segments and blocks without a share are authored fractions (zone 2 is a dose, not a max).
  const share = seg.label === "Work" ? shareForSegment(block, seg) : null;
  if (share == null) {
    const f = authoredFraction(block, seg);
    if (f == null) return { target_pace: null, basis: "max_effort", fraction: null };
    return { target_pace: ctx.trialPace * f, basis: "authored", fraction: f };
  }
  if (!ctx.machineCurve || ctx.machineCurve.length < 2) {
    const f = authoredFraction(block, seg);
    if (f == null) return { target_pace: null, basis: "max_effort", fraction: null };
    return { target_pace: ctx.trialPace * f, basis: "no_curve", fraction: f };
  }

  const work = Math.max(1, seg.duration_seconds);
  const pBalanced = balancedPaceMultiple(ctx.machineCurve, work);
  const k = ctx.kEffort ?? 1;
  const pAsked = pBalanced * Math.pow(share, k);
  const effort = balancedBout(ctx.machineCurve, pAsked);
  const band = effortBandOf(effort);
  const m = mAtEffort(ctx.athleteCurve, effort);
  let target = ctx.trialPace * pAsked * m;
  let capped = false;
  // Weekly cap (§4): ±5 % against the target shown for this band within 7 days — unless the trial changed.
  const prev = ctx.previous;
  if (prev && prev.band === band && prev.target_pace > 0 && Math.abs(prev.trial_pace - ctx.trialPace) < 1e-9) {
    const lo = prev.target_pace * (1 - WEEKLY_CAP), hi = prev.target_pace * (1 + WEEKLY_CAP);
    const bound = Math.min(hi, Math.max(lo, target));
    capped = bound !== target;
    target = bound;
  }
  return {
    target_pace: target,
    basis: "curve",
    fraction: target / ctx.trialPace,
    p_balanced: pBalanced,
    share,
    p_asked: pAsked,
    m,
    band,
    effort_seconds: effort,
    capped,
  };
}

// ─── A whole day ──────────────────────────────────────────────────────────────

import { type CatalogEngineDay, resolveSegments } from "./engine-block-resolve.ts";

export interface DaySegmentTargets {
  label: string;
  round_index: number;
  duration_seconds: number;
  curve: SegmentTarget;
  legacy: SegmentTarget;
}
export interface DayBlockTargets {
  block_index: number;
  rounds: number;
  segments: DaySegmentTargets[];
}
export interface DayTargets {
  blocks: DayBlockTargets[];
  /** duration-weighted mean fraction of trial over targeted work segments, per mode (null when nothing is targeted) */
  curve_fraction: number | null;
  legacy_fraction: number | null;
}

/** The last target shown for each band on this machine within 7 days, for the weekly cap. */
export type PreviousByBand = Record<string, { target_pace: number; trial_pace: number }>;

/** Both formulas for every work segment of a day. `base` carries everything but `mode`/`previous`. */
export function dayTargets(day: CatalogEngineDay, base: Omit<TargetContext, "mode" | "previous">, previousByBand: PreviousByBand = {}): DayTargets {
  const segs = resolveSegments(day).filter((s) => s.type === "work");
  const blockParams = [day.block_1_params, day.block_2_params, day.block_3_params, day.block_4_params] as Array<TargetBlockParams | null>;
  const roundsByBlock = new Map<number, number>();
  for (const s of segs) roundsByBlock.set(s.block_index, Math.max(roundsByBlock.get(s.block_index) ?? 0, s.round_index + 1));
  const blocks: DayBlockTargets[] = [];
  let cw = 0, cs = 0, lw = 0, ls = 0;
  for (const s of segs) {
    const bp = blockParams[s.block_index] ?? {};
    const rounds = roundsByBlock.get(s.block_index) ?? 1;
    const seg: TargetSegment = { label: s.label, duration_seconds: s.duration_seconds, round_index: s.round_index, rounds };
    // the cap needs the band first: compute once uncapped to learn it, then with its previous
    const probe = segmentTarget(bp, seg, { ...base, mode: "curve" });
    const previous = probe.band && previousByBand[probe.band] ? { band: probe.band, ...previousByBand[probe.band] } : null;
    const curve = previous ? segmentTarget(bp, seg, { ...base, mode: "curve", previous }) : probe;
    const legacy = segmentTarget(bp, seg, { ...base, mode: "legacy" });
    let b = blocks.find((x) => x.block_index === s.block_index);
    if (!b) { b = { block_index: s.block_index, rounds, segments: [] }; blocks.push(b); }
    b.segments.push({ label: s.label, round_index: s.round_index, duration_seconds: s.duration_seconds, curve, legacy });
    if (curve.fraction != null) { cw += s.duration_seconds; cs += s.duration_seconds * curve.fraction; }
    if (legacy.fraction != null) { lw += s.duration_seconds; ls += s.duration_seconds * legacy.fraction; }
  }
  return { blocks, curve_fraction: cw > 0 ? cs / cw : null, legacy_fraction: lw > 0 ? ls / lw : null };
}

/** The per-band "last shown" map from a stored snapshot (engine_workout_sessions.targets). */
export function previousFromSnapshot(snapshot: { trial?: { pace?: number | null } | null; blocks?: Array<Array<{ basis?: string; band?: string; target_pace?: number | null }>> } | null): PreviousByBand {
  const out: PreviousByBand = {};
  const trial = snapshot?.trial?.pace;
  if (!snapshot?.blocks || trial == null) return out;
  for (const block of snapshot.blocks) for (const s of block) {
    if (s.basis === "curve" && s.band && s.target_pace != null) out[s.band] = { target_pace: s.target_pace, trial_pace: trial };
  }
  return out;
}

/** The intensityShare lives on the day TYPE's envelope (engine_day_types), not on
 *  the concrete catalogue day (engine_workouts). Merge it per block before
 *  computing targets; the workout's own value wins when present (sequenced days
 *  may carry one from stage 3 on). */
export function withIntensityShares(day: CatalogEngineDay, envelope: { block_1_params?: Record<string, unknown> | null; block_2_params?: Record<string, unknown> | null; block_3_params?: Record<string, unknown> | null; block_4_params?: Record<string, unknown> | null } | null): CatalogEngineDay {
  if (!envelope) return day;
  const merge = (b: Record<string, unknown> | null, e: Record<string, unknown> | null | undefined) =>
    b && e && Array.isArray(e.intensityShare) && !Array.isArray(b.intensityShare) ? { ...b, intensityShare: e.intensityShare } : b;
  return {
    ...day,
    block_1_params: merge(day.block_1_params, envelope.block_1_params),
    block_2_params: merge(day.block_2_params, envelope.block_2_params),
    block_3_params: merge(day.block_3_params, envelope.block_3_params),
    block_4_params: merge(day.block_4_params, envelope.block_4_params),
  };
}
