/**
 * engine-block-resolve.ts — resolve catalog Engine days into render-ready,
 * seam-shippable form (SERVICE_API_CONTRACT v2 §2.1, the generation rule).
 *
 * PURE port of the retail runner's expansion logic (EngineTrainingDayPage.tsx:
 * generateSegments / resolveRest / calculateIntervalGoal semantics). Durations
 * land as concrete SECONDS; paces ship as FRACTIONS of the athlete's baseline
 * plus a display string — the member app multiplies by its locally stored
 * baseline (target_rpm = baseline_rpm × pace_frac), which is the whole scoring
 * formula (engine_ratio_v1: performance_ratio = actual_rpm / target_rpm).
 *
 * DRIFT NOTE: if src/pages/EngineTrainingDayPage.tsx's expansion changes,
 * mirror it here — the retail runner and the seam must resolve a catalog day
 * identically.
 */

export interface CatalogEngineDay {
  day_number: number;
  day_type: string;
  phase: number | null;
  month: number | null;
  block_count: number | null;
  set_rest_seconds: number | null;
  block_1_params: Record<string, unknown> | null;
  block_2_params: Record<string, unknown> | null;
  block_3_params: Record<string, unknown> | null;
  block_4_params: Record<string, unknown> | null;
  total_duration_minutes: number | null;
}

interface BlockParams {
  rounds?: number | number[] | string;
  workDuration?: number | number[] | string;
  restDuration?: number | number[] | string;
  workDurationOptions?: number[];
  restDurationOptions?: number[];
  workDurationIncrement?: number;
  restDurationIncrement?: number;
  paceRange?: number[] | string;
  workProgression?: string;
  paceProgression?: string;
  baseDuration?: number | number[];
  fluxDuration?: number | number[];
  fluxPaceRange?: number[] | string;
  basePace?: number[] | string;
  fluxStartIntensity?: number;
  fluxIncrement?: number;
  burstTiming?: string;
  burstDuration?: number;
}

export interface ResolvedSegment {
  type: "work" | "rest" | "block-rest";
  duration_seconds: number;
  block_index: number;
  round_index: number;
  label: string; // Work | Base | Flux | BURST | Max Effort | Rest | Block Rest
  /** Center pace as a fraction of baseline (target_rpm = baseline × this);
   *  null for max-effort / rest segments. */
  pace_frac: number | null;
  /** Human pace string ("75–85%", "MAX", "") for display without a baseline. */
  intensity: string;
}

export interface ResolvedEngineDay {
  ref: string;
  catalog_day: number;
  day_type: string;
  title: string;
  coaching_intent: string | null;
  phase: number | null;
  month: number | null;
  is_time_trial: boolean;
  total_duration_minutes: number | null;
  segments: ResolvedSegment[];
  scoring_params: {
    formula: "engine_ratio_v1";
    /** watts is a rate (logged value IS the pace); other units accumulate. */
    rate_units: string[];
    /** Work segments with their center pace fractions — the target-pace
     *  weighted mean the member app computes locally. */
    work_segments: { seconds: number; pace_frac: number | null }[];
    total_work_seconds: number;
  };
}

function resolveNum(v: number | number[] | string | undefined, fallback = 0): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "number") return v;
  if (Array.isArray(v) && typeof v[0] === "number") return v[0];
  return fallback;
}

function resolveRest(rest: number | number[] | string | undefined, workDur: number): number {
  if (rest === undefined || rest === null) return 0;
  if (typeof rest === "number") return rest;
  if (Array.isArray(rest)) return rest[0];
  if (rest === "equal_to_work") return workDur;
  if (rest === "five_times_work") return workDur * 5;
  if (rest === "half_work") return Math.round(workDur / 2);
  if (rest === "half_to_two_thirds_work") return Math.round(workDur * 0.58);
  if (rest === "double_work") return workDur * 2;
  if (rest === "one_third_work") return Math.round(workDur / 3);
  if (rest === "two_to_three_times_work") return Math.round(workDur * 2.5);
  if (rest === "one_to_one_point_five_times_work") return Math.round(workDur * 1.25);
  if (rest === "one_point_five_to_three_times_work") return Math.round(workDur * 2.25);
  return 0;
}

function parseBurstTiming(timing: string): number {
  const match = timing.match(/every_(\d+)_minutes/);
  return match ? parseInt(match[1]) * 60 : 300;
}

function paceCenter(pace: number[] | string | undefined): number | null {
  if (Array.isArray(pace) && pace.length >= 2 && typeof pace[0] === "number") {
    return (pace[0] + pace[1]) / 2;
  }
  if (Array.isArray(pace) && pace.length === 1 && typeof pace[0] === "number") return pace[0];
  return null; // max_effort / undefined
}

function formatPace(pace: number[] | string | undefined): string {
  if (pace === "max_effort") return "MAX";
  if (Array.isArray(pace) && pace.length >= 2) {
    return `${Math.round(pace[0] * 100)}–${Math.round(pace[1] * 100)}%`;
  }
  if (Array.isArray(pace) && pace.length === 1) return `${Math.round(pace[0] * 100)}%`;
  if (typeof pace === "string") return pace;
  return "";
}

function seg(
  type: ResolvedSegment["type"], duration: number, b: number, r: number,
  label: string, pace: number[] | string | undefined, intensityOverride?: string,
  paceOverride?: number | null,
): ResolvedSegment {
  return {
    type, duration_seconds: duration, block_index: b, round_index: r, label,
    pace_frac: paceOverride !== undefined ? paceOverride : paceCenter(pace),
    intensity: intensityOverride ?? formatPace(pace),
  };
}

/** Expand one catalog day's block params into the concrete segment timeline —
 *  the same shapes the retail runner plays. */
export function resolveSegments(day: CatalogEngineDay): ResolvedSegment[] {
  const segments: ResolvedSegment[] = [];
  const blockParams: (Record<string, unknown> | null)[] = [
    day.block_1_params, day.block_2_params, day.block_3_params, day.block_4_params,
  ];
  const blockCount = day.block_count ?? 1;

  for (let b = 0; b < blockCount; b++) {
    const raw = blockParams[b];
    if (!raw) continue;
    const bp = raw as unknown as BlockParams;

    const rounds = resolveNum(bp.rounds, 1);
    const workDur = resolveNum(bp.workDuration, 0) || (bp.workDurationOptions?.[0] ?? 0);
    const restDur = resolveRest(bp.restDuration, workDur) || (bp.restDurationOptions?.[0] ?? 0);
    if (workDur === 0) continue;

    if (bp.workProgression === "alternating_paces" && bp.baseDuration && bp.fluxDuration) {
      const baseDur = resolveNum(bp.baseDuration, 300);
      const fluxDur = resolveNum(bp.fluxDuration, 60);
      let remaining = workDur;
      let round = 0;
      while (remaining > 0) {
        const bSeg = Math.min(baseDur, remaining);
        segments.push(seg("work", bSeg, b, round, "Base", bp.basePace ?? bp.paceRange));
        remaining -= bSeg;
        if (remaining <= 0) break;
        const fSeg = Math.min(fluxDur, remaining);
        segments.push(seg("work", fSeg, b, round, "Flux", bp.fluxPaceRange ?? bp.paceRange));
        remaining -= fSeg;
        round++;
      }
    } else if (bp.workProgression === "continuous_with_bursts" && bp.burstTiming && bp.burstDuration) {
      const burstInterval = parseBurstTiming(bp.burstTiming);
      let remaining = workDur;
      let round = 0;
      while (remaining > 0) {
        const baseSeg = Math.min(burstInterval, remaining);
        segments.push(seg("work", baseSeg, b, round, "Base", bp.basePace));
        remaining -= baseSeg;
        if (remaining <= 0) break;
        const bSeg = Math.min(bp.burstDuration, remaining);
        segments.push(seg("work", bSeg, b, round, "BURST", undefined, "MAX", null));
        remaining -= bSeg;
        round++;
      }
    } else if (bp.workProgression === "progressive_flux_intensity" && bp.baseDuration && bp.fluxDuration) {
      const baseDur = resolveNum(bp.baseDuration, 300);
      const fluxDur = resolveNum(bp.fluxDuration, 60);
      const startIntensity = bp.fluxStartIntensity ?? 0.75;
      const increment = bp.fluxIncrement ?? 0.05;
      let remaining = workDur;
      let round = 0;
      while (remaining > 0) {
        const bSeg = Math.min(baseDur, remaining);
        segments.push(seg("work", bSeg, b, round, "Base", bp.basePace));
        remaining -= bSeg;
        if (remaining <= 0) break;
        const fSeg = Math.min(fluxDur, remaining);
        const fluxIntensity = startIntensity + round * increment;
        segments.push(seg("work", fSeg, b, round, "Flux", undefined,
          `${Math.round(fluxIntensity * 100)}%`, fluxIntensity));
        remaining -= fSeg;
        round++;
      }
    } else if (bp.workProgression === "continuous" && bp.paceProgression !== "increasing") {
      segments.push(seg("work", workDur * rounds, b, 0, "Work", bp.paceRange));
    } else {
      const workInc = bp.workDurationIncrement ?? 0;
      const restInc = bp.restDurationIncrement ?? 0;
      for (let r = 0; r < rounds; r++) {
        const roundWorkDur = Math.max(0, workDur + r * workInc);
        const roundRestDur = Math.max(0, restDur + r * restInc);
        const label = bp.paceRange === "max_effort" ? "Max Effort" : "Work";
        segments.push(seg("work", roundWorkDur, b, r, label, bp.paceRange));
        if (roundRestDur > 0 && r < rounds - 1) {
          segments.push(seg("rest", roundRestDur, b, r, "Rest", undefined, "", null));
        }
      }
    }

    if (b < blockCount - 1 && day.set_rest_seconds) {
      segments.push(seg("block-rest", day.set_rest_seconds, b, 0, "Block Rest", undefined, "", null));
    }
  }

  return segments;
}

/** Resolve a catalog day into the seam-shippable shape. */
export function resolveEngineDay(
  day: CatalogEngineDay,
  meta: { title: string; coaching_intent: string | null },
): ResolvedEngineDay {
  const segments = resolveSegments(day);
  const work = segments.filter((s) => s.type === "work");
  return {
    ref: `d${day.day_number}`,
    catalog_day: day.day_number,
    day_type: day.day_type,
    title: meta.title,
    coaching_intent: meta.coaching_intent,
    phase: day.phase,
    month: day.month,
    is_time_trial: day.day_type === "time_trial",
    total_duration_minutes: day.total_duration_minutes,
    segments,
    scoring_params: {
      formula: "engine_ratio_v1",
      rate_units: ["watts"],
      work_segments: work.map((s) => ({ seconds: s.duration_seconds, pace_frac: s.pace_frac })),
      total_work_seconds: work.reduce((sum, s) => sum + s.duration_seconds, 0),
    },
  };
}
