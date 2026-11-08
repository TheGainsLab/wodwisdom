// Plain-language description of an Engine day's structure — rounds, work and
// rest, flux/burst patterns — read straight off the workout row's block
// params. Used BEFORE equipment is chosen (the day screen's header block and
// the month list), so it deliberately says nothing about pace: targets need
// a modality + baseline and live on the preview. Minutes of work come from
// calculateWorkDurationMinutes (engineService), which callers already use.
//
// Two forms per block: `long` for the day screen ("4 rounds · 3:00 work /
// 1:30 rest") and `compact` for the month list ("4 × 3:00 / 1:30").
import type { EngineWorkout } from './engineService';

interface BlockParamsLite {
  rounds?: number | number[] | string;
  workDuration?: number | number[] | string;
  restDuration?: number | number[] | string;
  workProgression?: string;
  paceProgression?: string;
  baseDuration?: number | number[];
  fluxDuration?: number | number[];
  burstTiming?: string;
  burstDuration?: number;
  workDurationOptions?: number[];
  restDurationOptions?: number[];
  workDurationIncrement?: number;
  restDurationIncrement?: number;
}

export interface BlockDescription { long: string; compact: string }

export interface WorkoutStructure {
  blockCount: number;
  blocks: BlockDescription[];
  /** All blocks joined for a one-line list row, e.g. "4 × 3:00 / 1:30 · 6 × 1:00 / 1:00". */
  compact: string;
}

/** m:ss clock form — 180 → "3:00", 30 → "0:30", 1260 → "21:00". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function num(v: number | number[] | string | undefined, fallback = 0): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  return fallback;
}

// Mirrors resolveRest on the training day page so the two never disagree.
function rest(v: number | number[] | string | undefined, work: number): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v[0];
  switch (v) {
    case 'equal_to_work': return work;
    case 'five_times_work': return work * 5;
    case 'half_work': return Math.round(work / 2);
    case 'half_to_two_thirds_work': return Math.round(work * 0.58);
    case 'double_work': return work * 2;
    case 'one_third_work': return Math.round(work / 3);
    case 'two_to_three_times_work': return Math.round(work * 2.5);
    case 'one_to_one_point_five_times_work': return Math.round(work * 1.25);
    case 'one_point_five_to_three_times_work': return Math.round(work * 2.25);
    default: return 0;
  }
}

function burstInterval(timing: string): number {
  const m = timing.match(/every_(\d+)_minutes/);
  return m ? parseInt(m[1], 10) * 60 : 300;
}

function describeBlock(bp: BlockParamsLite, isTimeTrial: boolean): BlockDescription | null {
  const rounds = num(bp.rounds, 1);
  const work = num(bp.workDuration, 0) || (bp.workDurationOptions?.[0] ?? 0);
  if (!work) return null;
  const restDur = rest(bp.restDuration, work) || (bp.restDurationOptions?.[0] ?? 0);

  if (isTimeTrial) {
    const s = `All-out effort for ${clock(work)}`;
    return { long: s, compact: s };
  }

  // Flux: base pace with a faster flux segment, alternating through the block.
  if (bp.workProgression === 'alternating_paces' && bp.baseDuration && bp.fluxDuration) {
    const base = num(bp.baseDuration, 300);
    const flux = num(bp.fluxDuration, 60);
    return {
      long: `${clock(work)} · ${clock(base)} base / ${clock(flux)} flux, alternating`,
      compact: `${clock(work)} · ${clock(base)} base / ${clock(flux)} flux`,
    };
  }

  // Polarized: continuous with short max bursts on a fixed interval.
  if (bp.workProgression === 'continuous_with_bursts' && bp.burstTiming && bp.burstDuration) {
    const every = burstInterval(bp.burstTiming);
    return {
      long: `${clock(work)} continuous · ${bp.burstDuration}s burst every ${clock(every)}`,
      compact: `${clock(work)} · ${bp.burstDuration}s burst / ${clock(every)}`,
    };
  }

  // Flux stages: same shape as flux, flux intensity climbs each round.
  if (bp.workProgression === 'progressive_flux_intensity' && bp.baseDuration && bp.fluxDuration) {
    const base = num(bp.baseDuration, 300);
    const flux = num(bp.fluxDuration, 60);
    return {
      long: `${clock(work)} · ${clock(base)} base / ${clock(flux)} flux, building each round`,
      compact: `${clock(work)} · ${clock(base)} base / ${clock(flux)} flux ↑`,
    };
  }

  // Single unbroken effort (endurance, threshold, atomic/towers continuous).
  const continuous = (bp.workProgression === 'continuous' && bp.paceProgression !== 'increasing') || (rounds <= 1 && restDur <= 0);
  if (continuous) {
    const s = `${clock(work * Math.max(1, rounds))} continuous`;
    return { long: s, compact: s };
  }

  // Intervals, possibly with work/rest changing each round.
  const workInc = bp.workDurationIncrement ?? 0;
  const restInc = bp.restDurationIncrement ?? 0;
  const workEnd = Math.max(0, work + (rounds - 1) * workInc);
  const restEnd = Math.max(0, restDur + (rounds - 1) * restInc);
  const w = workInc ? `${clock(work)} → ${clock(workEnd)}` : clock(work);
  const r = restDur <= 0 ? '' : restInc ? `${clock(restDur)} → ${clock(restEnd)}` : clock(restDur);
  if (rounds <= 1) {
    return { long: `${w} work${r ? ` / ${r} rest` : ''}`, compact: `1 × ${w}${r ? ` / ${r}` : ''}` };
  }
  return {
    long: `${rounds} rounds · ${w} work${r ? ` / ${r} rest` : ''}`,
    compact: `${rounds} × ${w}${r ? ` / ${r}` : ''}`,
  };
}

export function describeWorkout(workout: EngineWorkout): WorkoutStructure {
  const raw = [workout.block_1_params, workout.block_2_params, workout.block_3_params, workout.block_4_params];
  const count = workout.block_count ?? 1;
  const isTimeTrial = workout.day_type === 'time_trial';
  const blocks: BlockDescription[] = [];
  for (let i = 0; i < count; i++) {
    const bp = raw[i];
    if (!bp) continue;
    const d = describeBlock(bp as unknown as BlockParamsLite, isTimeTrial);
    if (d) blocks.push(d);
  }
  return {
    blockCount: blocks.length,
    blocks,
    compact: blocks.map((b) => b.compact).join(' · '),
  };
}
