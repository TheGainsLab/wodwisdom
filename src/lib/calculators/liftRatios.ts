/**
 * Lift-ratio calculators for /calculators.
 *
 * Targets are the evaluation's own bars (THRESHOLDS_V1.ratios in
 * supabase/functions/_shared/athlete-model.ts) — keep the two in step. The
 * bands are the calculators' own (5% / 10%, see bands.ts), tighter than the
 * evaluation's 5% / 15%.
 *
 * Reading (founder, 2026-11-18): against the squat, a lift well BELOW its
 * ratio is a technical gap — the strength is there, the lift is not using
 * it; a lift ABOVE its ratio means the athlete is efficient and should
 * prioritise getting stronger. Snatch vs clean & jerk has no strength base,
 * so it reads as which lift is lagging.
 *
 * To add another ratio calculator, add one entry to LIFT_RATIO_CALCULATORS.
 */

import { bandFor, deviation, type Band } from './bands';

export interface LiftRatioReading {
  label: string;
  detail: string;
}

export interface LiftRatioCalculator {
  id: string;
  title: string;
  /** Numerator lift. */
  liftA: string;
  /** Denominator lift. */
  liftB: string;
  target: number;
  readings: Record<Band, LiftRatioReading>;
}

function squatReadings(lift: string): Record<Band, LiftRatioReading> {
  return {
    well_below: {
      label: 'Technical gap',
      detail: `You have the strength for a much bigger ${lift}. Technique and positions are the priority, not more squatting.`,
    },
    below: {
      label: 'Slight technical gap',
      detail: `Your strength is a little ahead of your ${lift}. Lean toward technique work.`,
    },
    on_target: {
      label: 'Balanced',
      detail: `Your ${lift} matches your strength. Keep building both together.`,
    },
    above: {
      label: 'Efficient lifter',
      detail: `You get a lot out of your squat. More strength will raise your ${lift}.`,
    },
    well_above: {
      label: 'Strength is the limiter',
      detail: `Your technique is outrunning your squat. Prioritize getting stronger.`,
    },
  };
}

export const LIFT_RATIO_CALCULATORS: LiftRatioCalculator[] = [
  {
    id: 'snatch_to_back_squat',
    title: 'Snatch vs Back Squat',
    liftA: 'Snatch',
    liftB: 'Back squat',
    target: 0.60,
    readings: squatReadings('snatch'),
  },
  {
    id: 'clean_jerk_to_back_squat',
    title: 'Clean & Jerk vs Back Squat',
    liftA: 'Clean & jerk',
    liftB: 'Back squat',
    target: 0.80,
    readings: squatReadings('clean & jerk'),
  },
  {
    id: 'snatch_to_clean_jerk',
    title: 'Snatch vs Clean & Jerk',
    liftA: 'Snatch',
    liftB: 'Clean & jerk',
    target: 0.76,
    readings: {
      well_below: {
        label: 'Snatch is lagging',
        detail: 'Your snatch is well behind your clean & jerk. That usually points to snatch technique or your overhead position.',
      },
      below: {
        label: 'Snatch slightly behind',
        detail: 'Your snatch trails your clean & jerk a little. Extra snatch technique work will close it.',
      },
      on_target: {
        label: 'Balanced',
        detail: 'Your two lifts are in proportion. Keep building both together.',
      },
      above: {
        label: 'Clean & jerk slightly behind',
        detail: 'Your clean & jerk trails your snatch a little. Look at the jerk and at leg strength in the clean.',
      },
      well_above: {
        label: 'Clean & jerk is lagging',
        detail: 'Your clean & jerk is well behind your snatch. That usually points to the jerk, or to leg strength in the clean.',
      },
    },
  },
];

export interface LiftRatioResult {
  ratio: number;
  target: number;
  /** Relative deviation from target, e.g. -0.08 = 8% below. */
  deviation: number;
  band: Band;
  reading: LiftRatioReading;
}

/** Both lifts in the same unit (lb or kg — the ratio is the same). Null when
 *  either number is missing or not positive. */
export function computeLiftRatio(calc: LiftRatioCalculator, liftA: number | null, liftB: number | null): LiftRatioResult | null {
  if (liftA == null || liftB == null || !(liftA > 0) || !(liftB > 0)) return null;
  const ratio = liftA / liftB;
  const band = bandFor(ratio, calc.target);
  return { ratio, target: calc.target, deviation: deviation(ratio, calc.target), band, reading: calc.readings[band] };
}
