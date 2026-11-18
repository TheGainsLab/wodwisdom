/**
 * Shared banding for the public calculators (/calculators).
 *
 * Every calculator here compares a measured ratio to a target and reads the
 * relative deviation in five bands (founder, 2026-11-18): within 5% either
 * way is on target, 5–10% is a slight lean, beyond 10% is a clear one. The
 * edges are inclusive toward the centre: exactly 5% is on target, exactly
 * 10% is still "slight".
 */

export type Band = 'well_below' | 'below' | 'on_target' | 'above' | 'well_above';

export const ON_TARGET_PCT = 0.05;
export const SLIGHT_PCT = 0.10;

/** Float noise guard so a ratio that is exactly on an edge lands inside it. */
const EPS = 1e-9;

/** (value − target) ÷ target. */
export function deviation(value: number, target: number): number {
  return (value - target) / target;
}

export function bandFor(value: number, target: number): Band {
  const dev = deviation(value, target);
  const abs = Math.abs(dev);
  if (abs <= ON_TARGET_PCT + EPS) return 'on_target';
  if (abs <= SLIGHT_PCT + EPS) return dev < 0 ? 'below' : 'above';
  return dev < 0 ? 'well_below' : 'well_above';
}

/** A user-typed number: positive and finite, else null. Accepts "1,250". */
export function parsePositive(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}
