/**
 * profileValidation.ts — input guards for the profile form.
 *
 * Keeps garbage out of the self-reported "facts" the coaching state consumes:
 *  - 1RM lifts clamped to a sane ceiling (no 3,000 lb squats).
 *  - conditioning time benchmarks restricted to time characters + validated /
 *    normalized to mm:ss (no "banana", "5;10", or "6:99").
 *
 * Time format is a CONTROLLED/structural input, so a small parser is the right
 * tool here (unlike the free-text goals/injuries, which we AI-parse).
 */

// Sane upper bounds — comfortably above any real single lift (WR deadlift ~1100 lb),
// so no legitimate entry is rejected, but 3,000 lb is not.
export const MAX_LIFT_LBS = 1500;
export const MAX_LIFT_KG = 700;

export function maxLift(units: 'lbs' | 'kg'): number {
  return units === 'kg' ? MAX_LIFT_KG : MAX_LIFT_LBS;
}

/** Parse a lift input and clamp to [0, cap]. Returns NaN for un-parseable input. */
export function clampLift(value: string, units: 'lbs' | 'kg'): number {
  const n = value === '' ? 0 : parseInt(value, 10);
  if (Number.isNaN(n)) return NaN;
  return Math.min(Math.max(n, 0), maxLift(units));
}

// m:ss / mm:ss / mmm:ss — minutes 1–3 digits, seconds 0–59 (1–2 digits).
const TIME_RE = /^(\d{1,3}):([0-5]?\d)$/;

/** Strip anything that isn't a digit or colon (blocks "5;10", "banana"). */
export function filterTimeChars(v: string): string {
  return v.replace(/[^0-9:]/g, '');
}

export function isValidTimeStr(v: string): boolean {
  return TIME_RE.test(v.trim());
}

/** Normalize a valid time to canonical mm:ss (2-digit seconds). Non-time strings
 *  pass through unchanged. */
export function normalizeTimeStr(v: string): string {
  const m = TIME_RE.exec(v.trim());
  return m ? `${parseInt(m[1], 10)}:${m[2].padStart(2, '0')}` : v.trim();
}
