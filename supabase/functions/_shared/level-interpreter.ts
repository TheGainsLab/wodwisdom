/**
 * Level interpreter — per-lift level classification used by the strength
 * diagnostic.
 *
 * Pure rule-based math. Three levels (beginner / intermediate / advanced)
 * derived from gender-specific BW bands per lift, scaled by age band.
 *
 * Only the four BW-classified lifts (back_squat, deadlift, bench_press, press)
 * have direct bands. The ten ratio-only lifts (front_squat, overhead_squat,
 * snatch, clean, etc.) get a synthetic level via the diagnostic's anchor +
 * flag-drop rule, not via direct BW math — see derive-athlete-diagnostic.ts.
 */

/**
 * Per-lift level taxonomy used by the strength diagnostic.
 */
export type PerLiftLevel = "beginner" | "intermediate" | "advanced";

interface BwBand {
  intermediate_min: number; // ratio at which beginner → intermediate
  advanced_min: number;     // ratio at which intermediate → advanced
}

const MALE_BW_BANDS_3LEVEL: Record<string, BwBand> = {
  back_squat:  { intermediate_min: 1.25, advanced_min: 1.86 },
  deadlift:    { intermediate_min: 1.41, advanced_min: 2.21 },
  bench_press: { intermediate_min: 0.91, advanced_min: 1.46 },
  press:       { intermediate_min: 0.60, advanced_min: 0.86 },
};

const FEMALE_BW_BANDS_3LEVEL: Record<string, BwBand> = {
  back_squat:  { intermediate_min: 0.86, advanced_min: 1.36 },
  deadlift:    { intermediate_min: 1.00, advanced_min: 1.76 },
  bench_press: { intermediate_min: 0.71, advanced_min: 1.06 },
  press:       { intermediate_min: 0.45, advanced_min: 0.66 },
};

// Alias map: legacy keys → canonical form keys. Pre-existing drift where the
// athlete profile form stores strict press as `press` but legacy code used
// `strict_press` is fixed here.
const LIFT_KEY_ALIASES: Record<string, string> = {
  strict_press: "press",
};

function canonicalLiftKey(key: string): string {
  return LIFT_KEY_ALIASES[key] ?? key;
}

/**
 * Scale a BW multiplier by age band. Mirrors coach's-eye scaling: under-35
 * baseline; 35-50 -5%; 50-60 -15%; 60+ -25%.
 */
function ageAdjust(multiplier: number, age: number | null | undefined): number {
  if (!age || age < 35) return multiplier;
  if (age < 50) return multiplier * 0.95;
  if (age < 60) return multiplier * 0.85;
  return multiplier * 0.75;
}

/**
 * Classify a lift into beginner / intermediate / advanced.
 *
 * Returns null when:
 *   - weight or bodyweight is missing/invalid
 *   - the lift is not BW-classified (the 10 ratio-only lifts: front_squat,
 *     overhead_squat, snatch, clean, etc.). Those get a synthetic level via
 *     the diagnostic's anchor rule, not direct BW math.
 */
export function classifyPerLiftLevel(
  lift: string,
  weight: number,
  bodyweight: number,
  gender: string | null | undefined,
  age: number | null | undefined,
): PerLiftLevel | null {
  if (!weight || weight <= 0 || !bodyweight || bodyweight <= 0) return null;
  const key = canonicalLiftKey(lift);
  const isFemale = (gender ?? "").toLowerCase() === "female";
  const bands = isFemale ? FEMALE_BW_BANDS_3LEVEL[key] : MALE_BW_BANDS_3LEVEL[key];
  if (!bands) return null;

  const intermediate_min = ageAdjust(bands.intermediate_min, age);
  const advanced_min = ageAdjust(bands.advanced_min, age);
  const ratio = weight / bodyweight;

  if (ratio >= advanced_min) return "advanced";
  if (ratio >= intermediate_min) return "intermediate";
  return "beginner";
}
