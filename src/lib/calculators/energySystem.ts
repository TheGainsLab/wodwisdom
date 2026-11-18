/**
 * Energy System Analysis for /calculators.
 *
 * Two max efforts on the SAME machine — 30 seconds and a 10-minute time
 * trial — both as average watts. Ratio = 30-s watts ÷ 10-min watts.
 * Balanced = 2.6 (founder, 2026-11-18). Within 5% either way is balanced;
 * 5–10% above is slightly glycolytic, 5–10% below slightly oxidative; beyond
 * 10% is a glycolytic / oxidative bias. The formula only works on watts, so
 * metres and calories are converted first.
 *
 * NOTE: the Engine's own continuum (supabase/functions/_shared/
 * engine-continuum.ts) currently reads a balanced 30-s effort as ≈ 2.2× in
 * its native units, with 2.6× placed at 15 s. This public calculator uses
 * 2.6 by the founder's decision; change BALANCED_RATIO if the two are ever
 * brought in line.
 *
 * Conversions (Concept2's published formulas):
 *   pace → watts      watts = 2.80 ÷ pace³, pace in seconds per metre.
 *   BikeErg           its metres are counted at 2× the rower's for the same
 *                     power (its pace is per 1000 m), so halve them first.
 *   calories → watts  calories/hour = 4 × watts ÷ 1.1639 + 300 (the monitor's
 *                     formula). Confirmed for the rower; applied to the
 *                     SkiErg and BikeErg, which share the monitor — not
 *                     separately confirmed for those two.
 * Fan bikes (Assault, Echo) have no published conversion: watts only.
 */

import { bandFor, deviation, type Band } from './bands';

export const BALANCED_RATIO = 2.6;
export const SPRINT_SECONDS = 30;
export const TRIAL_SECONDS = 600;

export type EnergyUnit = 'watts' | 'meters' | 'calories';

export interface EnergyMachine {
  id: string;
  label: string;
  units: EnergyUnit[];
  /** Displayed metres ÷ this = rower-equivalent metres. */
  distanceScale: number;
}

const C2_UNITS: EnergyUnit[] = ['watts', 'meters', 'calories'];

export const ENERGY_MACHINES: EnergyMachine[] = [
  { id: 'c2_row_erg', label: 'Concept2 RowErg', units: C2_UNITS, distanceScale: 1 },
  { id: 'c2_bike_erg', label: 'Concept2 BikeErg', units: C2_UNITS, distanceScale: 2 },
  { id: 'c2_ski_erg', label: 'Concept2 SkiErg', units: C2_UNITS, distanceScale: 1 },
  { id: 'assault_bike', label: 'Assault Bike', units: ['watts'], distanceScale: 1 },
  { id: 'echo_bike', label: 'Echo Bike', units: ['watts'], distanceScale: 1 },
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
 *  on this machine, or a calorie count at or under the monitor's 300/hour
 *  base, which is no power at all). */
export function toWatts(machine: EnergyMachine, unit: EnergyUnit, value: number, seconds: number): number | null {
  if (!(value > 0) || !(seconds > 0)) return null;
  if (!machine.units.includes(unit)) return null;
  if (unit === 'watts') return value;
  if (unit === 'meters') {
    const pace = seconds / (value / machine.distanceScale); // seconds per rower-equivalent metre
    return C2_PACE_CONSTANT / Math.pow(pace, 3);
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
