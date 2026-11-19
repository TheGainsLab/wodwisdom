/**
 * "Test yourself" on /calculators: the athlete's number against CrossFit
 * Games athletes' results on the same test (founder's data, 2026-11-18 —
 * a mix of recent seasons).
 *
 * Score = percent of the Games MEAN. Higher-is-better tests (lifts, the
 * handstand hold): yours ÷ mean. Lower-is-better tests (the row, the
 * muscle-ups for time): mean ÷ yours, so a slower time is a smaller percent.
 *
 * Placement is one line on where the number would sit in the Games field.
 * Where the data has quartiles it uses them (P25–P75), which the two outlier
 * results in the women's back squat and deadlift cannot distort the way a
 * minimum would. The 1,000 m row has no quartiles, so it uses the fastest
 * and slowest results instead.
 *
 * Weights are stored in POUNDS, as supplied. A kilo entry is converted
 * before comparing; the data is never changed. Times are in seconds.
 *
 * The 2,000 m and 5,000 m rows are MODELLED (founder, 2026-11-19: include
 * them): each athlete's time is extrapolated from their measured 1,000 m,
 * so they are estimates, not Games performances. A test with `modelled` set
 * says so on its result.
 *
 * To add a test: one entry in GAMES_TESTS.
 */

import type { LiftKey } from './liftRatios';

export type Sex = 'men' | 'women';
export type WeightUnit = 'lb' | 'kg';

export const LB_PER_KG = 2.20462;

export interface GamesStat {
  /** Athletes behind the mean. */
  n: number;
  mean: number;
  /** Quartiles of the field, in the test's own unit (pounds or seconds). */
  p25?: number;
  p75?: number;
  /** Extremes, used for placement only where there are no quartiles. */
  min?: number;
  max?: number;
  /** Shown under the result, e.g. who was left out of the mean. */
  note?: string;
}

export interface GamesTest {
  id: string;
  label: string;
  group: 'lifts' | 'rowing' | 'gymnastics';
  kind: 'weight' | 'time';
  higherIsBetter: boolean;
  /** Lifts share their box with the ratio calculators. */
  liftKey?: LiftKey;
  /** Set when the figures are estimates, not measured results; shown on the
   *  result in place of nothing. */
  modelled?: string;
  stats: Record<Sex, GamesStat>;
}

export const GAMES_TESTS: GamesTest[] = [
  {
    id: 'back_squat', label: 'Back squat', group: 'lifts', kind: 'weight', higherIsBetter: true, liftKey: 'back_squat',
    stats: {
      men: { n: 30, mean: 483.3, p25: 471.3, p75: 500 },
      women: { n: 30, mean: 301.3, p25: 285, p75: 323.8 },
    },
  },
  {
    id: 'front_squat', label: 'Front squat', group: 'lifts', kind: 'weight', higherIsBetter: true, liftKey: 'front_squat',
    stats: {
      men: { n: 30, mean: 402.1, p25: 383, p75: 416 },
      women: { n: 25, mean: 264.6, p25: 246, p75: 281 },
    },
  },
  {
    id: 'strict_press', label: 'Strict press', group: 'lifts', kind: 'weight', higherIsBetter: true, liftKey: 'strict_press',
    stats: {
      men: { n: 30, mean: 221.2, p25: 215, p75: 230 },
      women: { n: 30, mean: 135.2, p25: 130, p75: 143.8 },
    },
  },
  {
    id: 'deadlift', label: 'Deadlift', group: 'lifts', kind: 'weight', higherIsBetter: true, liftKey: 'deadlift',
    stats: {
      men: { n: 30, mean: 538.2, p25: 507.5, p75: 565 },
      women: { n: 30, mean: 347.8, p25: 331.3, p75: 378.8 },
    },
  },
  {
    id: 'snatch', label: 'Snatch', group: 'lifts', kind: 'weight', higherIsBetter: true, liftKey: 'snatch',
    stats: {
      men: { n: 29, mean: 276.2, p25: 266, p75: 286 },
      women: { n: 30, mean: 185.3, p25: 175, p75: 192.5 },
    },
  },
  {
    id: 'clean_jerk', label: 'Clean & jerk', group: 'lifts', kind: 'weight', higherIsBetter: true, liftKey: 'clean_jerk',
    stats: {
      men: { n: 29, mean: 338.6, p25: 330, p75: 346 },
      women: { n: 30, mean: 230.1, p25: 226.3, p75: 239.3 },
    },
  },
  {
    id: 'row_1000m', label: '1,000 m row', group: 'rowing', kind: 'time', higherIsBetter: false,
    stats: {
      men: { n: 30, mean: 179.20, min: 168.90, max: 188.80 },
      women: { n: 25, mean: 206.07, min: 195.80, max: 216.90 },
    },
  },
  {
    id: 'row_2000m', label: '2,000 m row', group: 'rowing', kind: 'time', higherIsBetter: false,
    modelled: 'Estimated from each athlete\'s 1,000 m result, not rowed in competition.',
    stats: {
      men: { n: 30, mean: 378.82, min: 357.04, max: 399.11 },
      women: { n: 25, mean: 424.40, min: 403.24, max: 446.70 },
    },
  },
  {
    id: 'row_5000m', label: '5,000 m row', group: 'rowing', kind: 'time', higherIsBetter: false,
    modelled: 'Estimated from each athlete\'s 1,000 m result, not rowed in competition.',
    stats: {
      men: { n: 30, mean: 1013.95, min: 955.67, max: 1068.27 },
      women: { n: 25, mean: 1123.93, min: 1067.90, max: 1182.98 },
    },
  },
  {
    id: 'handstand_hold', label: 'Max handstand hold', group: 'gymnastics', kind: 'time', higherIsBetter: true,
    stats: {
      men: { n: 30, mean: 65.30, p25: 58.25, p75: 79.00 },
      women: { n: 24, mean: 90.38, p25: 73.75, p75: 111.00 },
    },
  },
  {
    id: 'ring_muscle_ups_30', label: '30 ring muscle-ups for time', group: 'gymnastics', kind: 'time', higherIsBetter: false,
    stats: {
      men: { n: 39, mean: 167.02, p25: 139.27, p75: 182.86 },
      women: { n: 28, mean: 227.77, p25: 195.79, p75: 262.47, note: '28 of 39 athletes finished under the time cap; the average is finishers only.' },
    },
  },
];

export function gamesTestsIn(group: GamesTest['group']): GamesTest[] {
  return GAMES_TESTS.filter((t) => t.group === group);
}

/** "3:45" or "3:45.2" → seconds. Null until it is a complete m:ss time, so a
 *  half-typed "3:4" is not scored as 3:04. */
export function parseTime(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2}):([0-5]\d)(\.\d+)?$/);
  if (!m) return null;
  const seconds = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) : 0);
  return seconds > 0 ? seconds : null;
}

/** Seconds → "2:59.2" (tenths only when there are any). */
export function formatTime(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  const s = Math.floor(rest / 10);
  const t = rest % 10;
  return `${m}:${String(s).padStart(2, '0')}${t ? `.${t}` : ''}`;
}

/** A stored value (pounds or seconds) as the athlete should read it. */
export function formatGamesValue(test: GamesTest, value: number, unit: WeightUnit): string {
  if (test.kind === 'time') return formatTime(value);
  return unit === 'kg' ? `${Math.round(value / LB_PER_KG)} kg` : `${Math.round(value)} lb`;
}

export type Placement = 'top' | 'middle' | 'lower' | 'beyond_best' | 'in_range' | 'outside_range';

export interface GamesResult {
  /** Fraction of the Games mean: 0.75 = 75%. */
  pct: number;
  placement: Placement;
  /** The line under the bar. */
  placementText: string;
  stat: GamesStat;
}

/** Anything past this is a typo, not a result: nobody is 50% beyond the
 *  average Games athlete. */
export const IMPLAUSIBLE_PCT = 1.5;

/**
 * `value` is in the test's stored unit: POUNDS for weights (convert a kilo
 * entry first, see toPounds), SECONDS for times. `unit` only shapes the text.
 */
export function scoreGamesTest(test: GamesTest, sex: Sex, value: number | null, unit: WeightUnit = 'lb'): GamesResult | null {
  if (value == null || !(value > 0)) return null;
  const stat = test.stats[sex];
  const pct = test.higherIsBetter ? value / stat.mean : stat.mean / value;
  const better = (a: number, b: number) => (test.higherIsBetter ? a >= b : a <= b);
  const fmt = (v: number) => formatGamesValue(test, v, unit);

  let placement: Placement;
  let placementText: string;
  if (stat.p25 != null && stat.p75 != null) {
    // For a time, P25 is the FAST end; for a weight or a hold it is the low end.
    const strongEdge = test.higherIsBetter ? stat.p75 : stat.p25;
    const weakEdge = test.higherIsBetter ? stat.p25 : stat.p75;
    const span = `${fmt(Math.min(stat.p25, stat.p75))} to ${fmt(Math.max(stat.p25, stat.p75))}`;
    if (better(value, strongEdge)) {
      placement = 'top';
      placementText = `Top quarter of the Games field. The middle half is ${span}.`;
    } else if (better(value, weakEdge)) {
      placement = 'middle';
      placementText = `Inside the middle half of the Games field (${span}).`;
    } else {
      placement = 'lower';
      placementText = `Below the middle half of the Games field (${span}).`;
    }
  } else if (stat.min != null && stat.max != null) {
    const best = test.higherIsBetter ? stat.max : stat.min;
    const worst = test.higherIsBetter ? stat.min : stat.max;
    const span = `${fmt(stat.min)} to ${fmt(stat.max)}`;
    if (better(value, best)) {
      placement = 'beyond_best';
      placementText = test.modelled
        ? `Better than every estimated Games time (${span}).`
        : `Better than every Games athlete tested (${span}).`;
    } else if (better(value, worst)) {
      placement = 'in_range';
      placementText = `Inside the ${test.modelled ? 'estimated ' : ''}range of the Games field (${span}).`;
    } else {
      placement = 'outside_range';
      placementText = `Outside the ${test.modelled ? 'estimated ' : ''}range of the Games field (${span}).`;
    }
  } else {
    placement = 'in_range';
    placementText = '';
  }
  return { pct, placement, placementText, stat };
}

export function toPounds(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value * LB_PER_KG : value;
}

/** A coarse band for usage tracking — never the number itself. */
export function pctBucket(pct: number): string {
  if (pct >= 1) return '100_plus';
  if (pct >= 0.9) return '90_99';
  if (pct >= 0.75) return '75_89';
  if (pct >= 0.5) return '50_74';
  return 'under_50';
}
