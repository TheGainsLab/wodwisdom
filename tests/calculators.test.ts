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
  assert.equal(bandFor(2.31, 2.2), 'on_target'); // exactly +5%
  assert.equal(bandFor(2.42, 2.2), 'above'); //     exactly +10%
  assert.equal(bandFor(1.98, 2.2), 'below'); //     exactly −10%
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
  assert.equal(toWatts(echo, 'meters', 300, 30), null);
  assert.equal(toWatts(assault, 'meters', 300, 30), null);
  assert.deepEqual(echo.units, ['watts', 'calories']);
  assert.deepEqual(assault.units, ['watts', 'calories']);
});

test('machines: the five asked for, in order', () => {
  assert.deepEqual(ENERGY_MACHINES.map((m) => m.id), ['c2_row_erg', 'c2_bike_erg', 'c2_ski_erg', 'assault_bike', 'echo_bike']);
});

test('watts: fan-bike calories are proportional to watts — Echo ÷20, Assault ÷24.75', () => {
  // Rows from the founder's monitor tables (calories/minute against watts).
  for (const [watts, calPerMin] of [[243, 12.2], [549, 27.5], [1030, 51.5], [1635, 81.8]]) {
    near(toWatts(echo, 'calories', calPerMin, 60), watts, 2);
  }
  for (const [watts, calPerMin] of [[288, 11.6], [644, 26], [896, 36.2]]) {
    near(toWatts(assault, 'calories', calPerMin, 60), watts, 2.5);
  }
  // Totals over the two efforts: 30 s at 20 cal, 10 min at 150 cal on an Echo.
  near(toWatts(echo, 'calories', 20, 30), 800, 0.01); //   40 cal/min × 20
  near(toWatts(echo, 'calories', 150, 600), 300, 0.01); // 15 cal/min × 20
  // The same calories mean more watts on an Assault.
  near(toWatts(assault, 'calories', 20, 30), 990, 0.01);
});

test('energy system: a fan-bike calorie ratio is the watts ratio', () => {
  // Echo: 30 s for 22 cal (44/min), 10 min for 200 cal (20/min) → 2.2 exactly.
  const cal = computeEnergySystem(echo, 'calories', 22, 200);
  const w = computeEnergySystem(echo, 'watts', 880, 400);
  assert.ok(cal.ok && w.ok);
  near(cal.result.ratio, 2.2, 0.0001);
  near(cal.result.ratio, w.result.ratio, 0.0001);
  assert.equal(cal.result.reading.label, 'Balanced');
  // The bike's constant cancels: the same calories give the same ratio on an Assault.
  const a = computeEnergySystem(assault, 'calories', 22, 200);
  assert.ok(a.ok);
  near(a.result.ratio, 2.2, 0.0001);
});

test('energy system: 2.2 is balanced; bands at 5% and 10%', () => {
  assert.equal(BALANCED_RATIO, 2.2);
  const label = (sprint: number, trial: number) => {
    const o = computeEnergySystem(echo, 'watts', sprint, trial);
    return o.ok ? o.result.reading.label : o.reason;
  };
  assert.equal(label(440, 200), 'Balanced'); //            2.20
  assert.equal(label(462, 200), 'Balanced'); //            2.31 (+5%)
  assert.equal(label(418, 200), 'Balanced'); //            2.09 (−5%)
  assert.equal(label(454, 200), 'Balanced'); //            2.27, this base's median
  assert.equal(label(476, 200), 'Slightly glycolytic'); // 2.38 (+8.2%)
  assert.equal(label(484, 200), 'Slightly glycolytic'); // 2.42 (+10%)
  assert.equal(label(404, 200), 'Slightly oxidative'); //  2.02 (−8.2%)
  assert.equal(label(396, 200), 'Slightly oxidative'); //  1.98 (−10%)
  assert.equal(label(520, 200), 'Glycolytic bias'); //     2.60
  assert.equal(label(380, 200), 'Oxidative bias'); //      1.90
});

test('energy system: metres are converted before dividing', () => {
  // Row 30 s: 162 m → 440.9 W. Row 10 min: 2500 m → 202.5 W. Ratio 2.18.
  const o = computeEnergySystem(row, 'meters', 162, 2500);
  assert.ok(o.ok);
  near(o.result.sprintWatts, 440.9, 1);
  near(o.result.trialWatts, 202.5);
  near(o.result.ratio, 2.18, 0.01);
  assert.equal(o.result.reading.label, 'Balanced');
  // 170 m is 509.5 W: 2.52, well past balanced.
  const fast = computeEnergySystem(row, 'meters', 170, 2500);
  assert.ok(fast.ok);
  assert.equal(fast.result.reading.label, 'Glycolytic bias');
});

test('energy system: incomplete, unconvertible and implausible inputs are refused', () => {
  assert.deepEqual(computeEnergySystem(row, 'watts', null, 200), { ok: false, reason: 'incomplete' });
  assert.deepEqual(computeEnergySystem(row, 'watts', 500, null), { ok: false, reason: 'incomplete' });
  assert.deepEqual(computeEnergySystem(row, 'calories', 1, 20), { ok: false, reason: 'unconvertible' });
  assert.deepEqual(computeEnergySystem(row, 'watts', 200, 500), { ok: false, reason: 'sprint_not_higher' });
  assert.deepEqual(computeEnergySystem(echo, 'meters', 300, 5000), { ok: false, reason: 'unconvertible' });
});

// ── Test yourself: Games benchmarks ─────────────────────────────────────────
import {
  GAMES_TESTS,
  IMPLAUSIBLE_PCT,
  formatGamesValue,
  formatTime,
  parseTime,
  pctBucket,
  scoreGamesTest,
  toPounds,
} from '../src/lib/calculators/gamesBenchmarks';

const gamesTest = (id: string) => {
  const t = GAMES_TESTS.find((x) => x.id === id);
  assert.ok(t, `no Games test ${id}`);
  return t;
};

test('games: the tests, lifts first; only the two longer rows are modelled', () => {
  assert.deepEqual(GAMES_TESTS.map((t) => t.id), [
    'back_squat', 'front_squat', 'strict_press', 'deadlift', 'snatch', 'clean_jerk',
    'row_1000m', 'row_2000m', 'row_5000m', 'handstand_hold', 'ring_muscle_ups_30',
  ]);
  assert.deepEqual(GAMES_TESTS.filter((t) => t.modelled).map((t) => t.id), ['row_2000m', 'row_5000m']);
});

test('games: the modelled rows score like the measured one and say they are estimates', () => {
  const r2k = scoreGamesTest(gamesTest('row_2000m'), 'men', 420); // 7:00 vs 6:18.82
  assert.ok(r2k);
  near(r2k.pct * 100, 90.2, 0.1);
  assert.equal(r2k.placementText, 'Outside the estimated range of the Games field (5:57 to 6:39.1).');
  const r5k = scoreGamesTest(gamesTest('row_5000m'), 'women', parseTime('18:30'));
  assert.ok(r5k);
  near(r5k.pct * 100, 101.3, 0.1); // 1123.93 / 1110
  assert.equal(r5k.placement, 'in_range');
  assert.equal(formatTime(1013.95), '16:54');
  assert.equal(scoreGamesTest(gamesTest('row_1000m'), 'men', 180)?.placementText, 'Inside the range of the Games field (2:48.9 to 3:08.8).');
});

test('games: every test has a mean, a count, and a way to place a result, for men and women', () => {
  for (const t of GAMES_TESTS) {
    for (const sex of ['men', 'women'] as const) {
      const s = t.stats[sex];
      assert.ok(s.mean > 0 && s.n > 0, `${t.id} ${sex}`);
      assert.ok((s.p25 != null && s.p75 != null) || (s.min != null && s.max != null), `${t.id} ${sex} placement`);
      if (s.p25 != null && s.p75 != null) assert.ok(s.p25 < s.p75, `${t.id} ${sex} quartile order`);
    }
  }
});

test('games: the founder\'s example — a 300 lb front squat is 75% of the men\'s average', () => {
  const r = scoreGamesTest(gamesTest('front_squat'), 'men', 300);
  assert.ok(r);
  near(r.pct * 100, 74.6, 0.1); // 300 / 402.1
  assert.equal(Math.round(r.pct * 100), 75);
  assert.equal(r.placement, 'lower');
  assert.equal(r.placementText, 'Below the middle half of the Games field (383 lb to 416 lb).');
});

test('games: lifts place by quartile, men and women separately', () => {
  const bs = gamesTest('back_squat');
  assert.equal(scoreGamesTest(bs, 'men', 480)?.placement, 'middle'); //  471.3–500
  assert.equal(scoreGamesTest(bs, 'men', 500)?.placement, 'top'); //     at P75
  assert.equal(scoreGamesTest(bs, 'men', 471.3)?.placement, 'middle'); // at P25
  assert.equal(scoreGamesTest(bs, 'men', 470)?.placement, 'lower');
  assert.equal(scoreGamesTest(bs, 'women', 330)?.placement, 'top'); //   women's P75 is 323.8
  near((scoreGamesTest(bs, 'women', 301.3)?.pct ?? 0) * 100, 100, 0.01);
});

test('games: a timed test flips the division — slower is a smaller percent', () => {
  const row = gamesTest('row_1000m');
  const slow = scoreGamesTest(row, 'men', 225); // 3:45 vs 2:59.2
  assert.ok(slow);
  near(slow.pct * 100, 79.6, 0.1);
  assert.equal(slow.placement, 'outside_range');
  assert.equal(slow.placementText, 'Outside the range of the Games field (2:48.9 to 3:08.8).');
  assert.equal(scoreGamesTest(row, 'men', 180)?.placement, 'in_range');
  const fast = scoreGamesTest(row, 'men', 165);
  assert.ok(fast && fast.pct > 1);
  assert.equal(fast.placement, 'beyond_best');
});

test('games: muscle-ups place by quartile with the fast end on top', () => {
  const mu = gamesTest('ring_muscle_ups_30');
  assert.equal(scoreGamesTest(mu, 'men', 130)?.placement, 'top'); //    faster than P25 2:19.27
  assert.equal(scoreGamesTest(mu, 'men', 160)?.placement, 'middle');
  assert.equal(scoreGamesTest(mu, 'men', 200)?.placement, 'lower'); //  slower than P75 3:02.86
  assert.match(mu.stats.women.note ?? '', /28 of 39/);
  assert.equal(mu.stats.men.note, undefined);
});

test('games: the handstand hold is a time where longer is better', () => {
  const hs = gamesTest('handstand_hold');
  const r = scoreGamesTest(hs, 'men', 45);
  assert.ok(r);
  near(r.pct * 100, 68.9, 0.1); // 45 / 65.3
  assert.equal(r.placement, 'lower');
  assert.equal(scoreGamesTest(hs, 'men', 80)?.placement, 'top');
  assert.equal(scoreGamesTest(hs, 'women', 80)?.placement, 'middle'); // 1:13.75–1:51
});

test('games: kilos are converted before comparing, and shown as kilos', () => {
  const fs = gamesTest('front_squat');
  const lb = scoreGamesTest(fs, 'men', 300, 'lb');
  const kg = scoreGamesTest(fs, 'men', toPounds(136.078, 'kg'), 'kg'); // 300 lb
  assert.ok(lb && kg);
  near(kg.pct, lb.pct, 0.0001);
  assert.equal(formatGamesValue(fs, 402.1, 'kg'), '182 kg');
  assert.equal(formatGamesValue(fs, 402.1, 'lb'), '402 lb');
  assert.equal(kg.placementText, 'Below the middle half of the Games field (174 kg to 189 kg).');
  assert.equal(toPounds(300, 'lb'), 300);
});

test('games: times parse only when complete, and format back', () => {
  assert.equal(parseTime('3:45'), 225);
  assert.equal(parseTime('0:45'), 45);
  assert.equal(parseTime(' 2:59.2 '), 179.2);
  assert.equal(parseTime('3:4'), null); //  half-typed
  assert.equal(parseTime('3'), null);
  assert.equal(parseTime('3:75'), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime('0:00'), null);
  assert.equal(formatTime(179.2), '2:59.2');
  assert.equal(formatTime(65.3), '1:05.3');
  assert.equal(formatTime(79), '1:19');
  assert.equal(formatTime(188.8), '3:08.8');
});

test('games: missing input gives nothing; absurd input is flagged, not scored', () => {
  const fs = gamesTest('front_squat');
  assert.equal(scoreGamesTest(fs, 'men', null), null);
  assert.equal(scoreGamesTest(fs, 'men', 0), null);
  const typo = scoreGamesTest(fs, 'men', 3000);
  assert.ok(typo && typo.pct > IMPLAUSIBLE_PCT);
});

test('games: usage buckets never carry the number', () => {
  assert.equal(pctBucket(0.3), 'under_50');
  assert.equal(pctBucket(0.5), '50_74');
  assert.equal(pctBucket(0.75), '75_89');
  assert.equal(pctBucket(0.9), '90_99');
  assert.equal(pctBucket(1), '100_plus');
  assert.equal(pctBucket(1.2), '100_plus');
});

test('games: lifts share their box with the ratio calculators', () => {
  const liftKeys = new Set(GAMES_TESTS.filter((t) => t.group === 'lifts').map((t) => t.liftKey));
  for (const c of LIFT_RATIO_CALCULATORS) {
    assert.ok(liftKeys.has(c.liftAKey) && liftKeys.has(c.liftBKey), c.id);
  }
});
