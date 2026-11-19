/**
 * Energy System Analysis for /calculators.
 *
 * Two max efforts on the SAME machine — 30 seconds and a 10-minute time
 * trial — both as average watts. Ratio = 30-s watts ÷ 10-min watts.
 * Balanced = 2.2 (founder, 2026-11-19). Within 5% either way is balanced;
 * 5–10% above is slightly glycolytic, 5–10% below slightly oxidative; beyond
 * 10% is a glycolytic / oxidative bias. The formula only works on watts, so
 * metres and calories are converted first.
 *
 * Why 2.2: the research figure of peak power ≈ 2.6× is a 10–15 s peak, so
 * the Engine's continuum (supabase/functions/_shared/engine-continuum.ts)
 * places 2.6× at 15 s and ≈ 2.2× at 30 s, where this base's median 30-s
 * Echo effort (2.27×) sits. The calculator opened at 2.6 and was brought in
 * line with the Engine. On the fan bikes calories are proportional to watts
 * (below), so the Engine's calorie figure is the watts figure too.
 *
 * Conversions (Concept2's published formulas):
 *   pace → watts      watts = 2.80 ÷ pace³, pace in seconds per metre.
 *   BikeErg           its metres are counted at 2× the rower's for the same
 *                     power (its pace is per 1000 m), so halve them first.
 *                     Confirmed against Concept2's own pace calculator,
 *                     which uses 500 for the rower/SkiErg and 1000 for the
 *                     BikeErg with the one watts formula.
 *   calories → watts  calories/hour = 4 × watts ÷ 1.1639 + 300. Concept2's
 *                     calorie calculator confirms the 300/hour base and that
 *                     every Performance Monitor uses one formula; the
 *                     watts constant is from the monitor documentation.
 *
 * Fan bikes (founder's tested monitor tables, 2026-11-19 — RPM, watts and
 * calories/minute, Echo 31–119 RPM and Assault 30–90 RPM): on both bikes
 * calories/minute is PROPORTIONAL to watts, with no fixed offset —
 *   Echo     calories/minute = watts ÷ 20      (max error 0.1 cal/min)
 *   Assault  calories/minute = watts ÷ 24.75
 * so a calorie ratio is a watts ratio. The two bikes differ (the Assault
 * shows 15–19% more watts at the same RPM), hence one rule each. RPM is not
 * offered: nobody enters it, and it has no clean formula (it would need the
 * tables themselves).
 */

import { bandFor, deviation, type Band } from './bands';

export const BALANCED_RATIO = 2.2;
export const SPRINT_SECONDS = 30;
export const TRIAL_SECONDS = 600;

export type EnergyUnit = 'watts' | 'meters' | 'calories';

export interface EnergyMachine {
  id: string;
  label: string;
  units: EnergyUnit[];
  /** Displayed metres ÷ this = rower-equivalent metres. */
  distanceScale: number;
  /** Fan bikes: watts per (calorie/minute) on the monitor — calories are
   *  proportional to watts there. Absent on Concept2, whose monitor formula
   *  has a fixed base. */
  wattsPerCalPerMin?: number;
}

const C2_UNITS: EnergyUnit[] = ['watts', 'meters', 'calories'];
const FAN_BIKE_UNITS: EnergyUnit[] = ['watts', 'calories'];

export const ENERGY_MACHINES: EnergyMachine[] = [
  { id: 'c2_row_erg', label: 'Concept2 RowErg', units: C2_UNITS, distanceScale: 1 },
  { id: 'c2_bike_erg', label: 'Concept2 BikeErg', units: C2_UNITS, distanceScale: 2 },
  { id: 'c2_ski_erg', label: 'Concept2 SkiErg', units: C2_UNITS, distanceScale: 1 },
  { id: 'assault_bike', label: 'Assault Bike', units: FAN_BIKE_UNITS, distanceScale: 1, wattsPerCalPerMin: 24.75 },
  { id: 'echo_bike', label: 'Echo Bike', units: FAN_BIKE_UNITS, distanceScale: 1, wattsPerCalPerMin: 20 },
];

export const UNIT_LABELS: Record<EnergyUnit, string> = {
  watts: 'Watts',
  meters: 'Meters',
  calories: 'Calories',
};

export function machineById(id: string): EnergyMachine {
  return ENERGY_MACHINES.find((m) => m.id === id) ?? ENERGY_MACHINES[0];
}

const C2_PACE_CONSTANT = 2.80;
const C2_CAL_PER_WATT_HOUR = 4 / 1.1639;
const C2_CAL_BASE_PER_HOUR = 300;

/** Average watts for an effort of `seconds`, from the number the athlete
 *  read off the monitor. Null when it cannot be converted (unit not offered
 *  on this machine, or a Concept2 calorie count at or under the monitor's
 *  300/hour base, which is no power at all). */
export function toWatts(machine: EnergyMachine, unit: EnergyUnit, value: number, seconds: number): number | null {
  if (!(value > 0) || !(seconds > 0)) return null;
  if (!machine.units.includes(unit)) return null;
  if (unit === 'watts') return value;
  if (unit === 'meters') {
    const pace = seconds / (value / machine.distanceScale); // seconds per rower-equivalent metre
    return C2_PACE_CONSTANT / Math.pow(pace, 3);
  }
  if (machine.wattsPerCalPerMin != null) {
    return (value * 60 / seconds) * machine.wattsPerCalPerMin;
  }
  const calPerHour = value * 3600 / seconds;
  const watts = (calPerHour - C2_CAL_BASE_PER_HOUR) / C2_CAL_PER_WATT_HOUR;
  return watts > 0 ? watts : null;
}

export interface EnergyReading {
  label: string;
  detail: string;
}

export const ENERGY_READINGS: Record<Band, EnergyReading> = {
  well_below: {
    label: 'Oxidative bias',
    detail: 'Your engine is built for the long haul: your 10-minute power is high relative to your sprint. Short, hard, high-power work is where you have the most to gain.',
  },
  below: {
    label: 'Slightly oxidative',
    detail: 'You lean toward endurance. A little more short, high-power work would round you out.',
  },
  on_target: {
    label: 'Balanced',
    detail: 'Your sprint power and your 10-minute power are in proportion. Keep training both ends.',
  },
  above: {
    label: 'Slightly glycolytic',
    detail: 'You lean toward power. A little more sustained aerobic work would round you out.',
  },
  well_above: {
    label: 'Glycolytic bias',
    detail: 'You have a big sprint relative to your 10-minute power. Sustained aerobic work is where you have the most to gain.',
  },
};

export interface EnergyResult {
  sprintWatts: number;
  trialWatts: number;
  ratio: number;
  target: number;
  deviation: number;
  band: Band;
  reading: EnergyReading;
}

export type EnergyOutcome =
  | { ok: true; result: EnergyResult }
  | { ok: false; reason: 'incomplete' | 'unconvertible' | 'sprint_not_higher' };

/** `sprint` and `trial` are the monitor readings in `unit`. */
export function computeEnergySystem(machine: EnergyMachine, unit: EnergyUnit, sprint: number | null, trial: number | null): EnergyOutcome {
  if (sprint == null || trial == null) return { ok: false, reason: 'incomplete' };
  const sprintWatts = toWatts(machine, unit, sprint, SPRINT_SECONDS);
  const trialWatts = toWatts(machine, unit, trial, TRIAL_SECONDS);
  if (sprintWatts == null || trialWatts == null) return { ok: false, reason: 'unconvertible' };
  // A 30-second max below the 10-minute average is a typo or the wrong unit.
  if (sprintWatts <= trialWatts) return { ok: false, reason: 'sprint_not_higher' };
  const ratio = sprintWatts / trialWatts;
  const band = bandFor(ratio, BALANCED_RATIO);
  return {
    ok: true,
    result: { sprintWatts, trialWatts, ratio, target: BALANCED_RATIO, deviation: deviation(ratio, BALANCED_RATIO), band, reading: ENERGY_READINGS[band] },
  };
}
