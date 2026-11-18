/**
 * Tests for the public calculators' maths (src/lib/calculators).
 * Run: npm run test:calculators
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, parsePositive } from '../src/lib/calculators/bands';
import { LIFT_RATIO_CALCULATORS, computeLiftRatio } from '../src/lib/calculators/liftRatios';
import {
  BALANCED_RATIO,
  ENERGY_MACHINES,
  computeEnergySystem,
  machineById,
  toWatts,
} from '../src/lib/calculators/energySystem';

const near = (actual: number | null, expected: number, tol = 0.5) => {
  assert.ok(actual != null && Math.abs(actual - expected) <= tol, `expected ≈${expected}, got ${actual}`);
};

test('bands: 5% and 10% edges are inclusive toward the centre', () => {
  assert.equal(bandFor(100, 100), 'on_target');
  assert.equal(bandFor(105, 100), 'on_target');
  assert.equal(bandFor(95, 100), 'on_target');
  assert.equal(bandFor(105.1, 100), 'above');
  assert.equal(bandFor(94.9, 100), 'below');
  assert.equal(bandFor(110, 100), 'above');
  assert.equal(bandFor(90, 100), 'below');
  assert.equal(bandFor(110.1, 100), 'well_above');
  assert.equal(bandFor(89.9, 100), 'well_below');
});

test('bands: decimal targets land on the right side of each edge', () => {
  assert.equal(bandFor(0.63, 0.60), 'on_target'); // exactly +5%
  assert.equal(bandFor(0.57, 0.60), 'on_target'); // exactly −5%
  assert.equal(bandFor(0.66, 0.60), 'above'); //     exactly +10%
  assert.equal(bandFor(0.54, 0.60), 'below'); //     exactly −10%
  assert.equal(bandFor(2.73, 2.6), 'on_target');
  assert.equal(bandFor(2.86, 2.6), 'above');
  assert.equal(bandFor(2.34, 2.6), 'below');
});

test('parsePositive: accepts numbers and thousands commas, rejects the rest', () => {
  assert.equal(parsePositive('185'), 185);
  assert.equal(parsePositive(' 92.5 '), 92.5);
  assert.equal(parsePositive('2,500'), 2500);
  assert.equal(parsePositive(''), null);
  assert.equal(parsePositive('0'), null);
  assert.equal(parsePositive('-5'), null);
  assert.equal(parsePositive('abc'), null);
});

test('lift ratios: targets match the evaluation (0.60 / 0.80 / 0.76)', () => {
  const targets = Object.fromEntries(LIFT_RATIO_CALCULATORS.map((c) => [c.id, c.target]));
  assert.deepEqual(targets, {
    snatch_to_back_squat: 0.60,
    clean_jerk_to_back_squat: 0.80,
    snatch_to_clean_jerk: 0.76,
  });
});

test('lift ratios: snatch vs back squat reads technical gap below, strength above', () => {
  const calc = LIFT_RATIO_CALCULATORS[0];
  assert.equal(computeLiftRatio(calc, 180, 300)?.reading.label, 'Balanced');
  assert.equal(computeLiftRatio(calc, 165, 300)?.reading.label, 'Slight technical gap'); // 0.55, −8.3%
  assert.equal(computeLiftRatio(calc, 150, 300)?.reading.label, 'Technical gap'); //        0.50, −16.7%
  assert.equal(computeLiftRatio(calc, 195, 300)?.reading.label, 'Efficient lifter'); //     0.65, +8.3%
  assert.equal(computeLiftRatio(calc, 210, 300)?.reading.label, 'Strength is the limiter'); // 0.70, +16.7%
});

test('lift ratios: snatch vs clean & jerk names the lagging lift', () => {
  const calc = LIFT_RATIO_CALCULATORS[2];
  assert.equal(computeLiftRatio(calc, 76, 100)?.reading.label, 'Balanced');
  assert.equal(computeLiftRatio(calc, 65, 100)?.reading.label, 'Snatch is lagging');
  assert.equal(computeLiftRatio(calc, 90, 100)?.reading.label, 'Clean & jerk is lagging');
});

test('lift ratios: missing or non-positive input gives no result', () => {
  const calc = LIFT_RATIO_CALCULATORS[0];
  assert.equal(computeLiftRatio(calc, null, 300), null);
  assert.equal(computeLiftRatio(calc, 180, null), null);
  assert.equal(computeLiftRatio(calc, 180, 0), null);
});

test('every reading has a label and a detail', () => {
  for (const calc of LIFT_RATIO_CALCULATORS) {
    for (const r of Object.values(calc.readings)) {
      assert.ok(r.label.length > 0 && r.detail.length > 0);
    }
  }
});

const row = machineById('c2_row_erg');
const ski = machineById('c2_ski_erg');
const bike = machineById('c2_bike_erg');
const echo = machineById('echo_bike');
const assault = machineById('assault_bike');

test('watts: Concept2 pace formula — 2:00/500 m is 202.5 W', () => {
  near(toWatts(row, 'meters', 125, 30), 202.5); //   30 s at 2:00/500 m
  near(toWatts(row, 'meters', 2500, 600), 202.5); // 10 min at 2:00/500 m
  near(toWatts(ski, 'meters', 2500, 600), 202.5);
  near(toWatts(row, 'meters', 3000, 600), 350, 0.5); // 1:40/500 m = 350 W
});

test('watts: BikeErg metres count double for the same power', () => {
  near(toWatts(bike, 'meters', 250, 30), 202.5);
  near(toWatts(bike, 'meters', 5000, 600), 202.5);
});

test('watts: Concept2 calories — cal/hour = 4·W/1.1639 + 300', () => {
  // 200 W for 10 minutes: (4·200/1.1639 + 300) / 6 = 164.56 cal
  near(toWatts(row, 'calories', 164.56, 600), 200, 0.1);
  // 600 W for 30 seconds: (4·600/1.1639 + 300) / 120 = 19.68 cal
  near(toWatts(row, 'calories', 19.68, 30), 600, 1);
  // At or under the 300 cal/hour base there is no power to report.
  assert.equal(toWatts(row, 'calories', 50, 600), null);
});

test('watts: watts pass through; fan bikes take nothing else', () => {
  assert.equal(toWatts(echo, 'watts', 412, 30), 412);
  assert.equal(toWatts(echo, 'calories', 20, 30), null);
  assert.equal(toWatts(assault, 'meters', 300, 30), null);
  assert.deepEqual(echo.units, ['watts']);
  assert.deepEqual(assault.units, ['watts']);
});

test('machines: the five asked for, in order', () => {
  assert.deepEqual(ENERGY_MACHINES.map((m) => m.id), ['c2_row_erg', 'c2_bike_erg', 'c2_ski_erg', 'assault_bike', 'echo_bike']);
});

test('energy system: 2.6 is balanced; bands at 5% and 10%', () => {
  assert.equal(BALANCED_RATIO, 2.6);
  const label = (sprint: number, trial: number) => {
    const o = computeEnergySystem(echo, 'watts', sprint, trial);
    return o.ok ? o.result.reading.label : o.reason;
  };
  assert.equal(label(520, 200), 'Balanced'); //            2.60
  assert.equal(label(546, 200), 'Balanced'); //            2.73 (+5%)
  assert.equal(label(494, 200), 'Balanced'); //            2.47 (−5%)
  assert.equal(label(560, 200), 'Slightly glycolytic'); // 2.80 (+7.7%)
  assert.equal(label(572, 200), 'Slightly glycolytic'); // 2.86 (+10%)
  assert.equal(label(480, 200), 'Slightly oxidative'); //  2.40 (−7.7%)
  assert.equal(label(468, 200), 'Slightly oxidative'); //  2.34 (−10%)
  assert.equal(label(600, 200), 'Glycolytic bias'); //     3.00
  assert.equal(label(440, 200), 'Oxidative bias'); //      2.20
});

test('energy system: metres are converted before dividing', () => {
  // Row 30 s: 170 m → 509.5 W. Row 10 min: 2500 m → 202.5 W. Ratio 2.52.
  const o = computeEnergySystem(row, 'meters', 170, 2500);
  assert.ok(o.ok);
  near(o.result.sprintWatts, 509.5, 1);
  near(o.result.trialWatts, 202.5);
  near(o.result.ratio, 2.52, 0.01);
  assert.equal(o.result.reading.label, 'Balanced');
});

test('energy system: incomplete, unconvertible and implausible inputs are refused', () => {
  assert.deepEqual(computeEnergySystem(row, 'watts', null, 200), { ok: false, reason: 'incomplete' });
  assert.deepEqual(computeEnergySystem(row, 'watts', 500, null), { ok: false, reason: 'incomplete' });
  assert.deepEqual(computeEnergySystem(row, 'calories', 1, 20), { ok: false, reason: 'unconvertible' });
  assert.deepEqual(computeEnergySystem(row, 'watts', 200, 500), { ok: false, reason: 'sprint_not_higher' });
  assert.deepEqual(computeEnergySystem(echo, 'meters', 300, 5000), { ok: false, reason: 'unconvertible' });
});
