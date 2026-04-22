/**
 * Single source of truth for athlete profile tier completeness.
 *
 * Keep in sync with supabase/functions/_shared/tier-status.ts.
 *
 * Tiers:
 *   T1 — Basics (age, height, bodyweight, gender, units)
 *   T2 — Athletic data (required lifts, all skills rated, all conditioning
 *        benchmarks filled). Required to run the free Profile Evaluation.
 *   T3 — Training context (days/week, session length, injuries text,
 *        goal, equipment). Required to run AI Programming.
 */

export const REQUIRED_T1_FIELDS = [
  'age',
  'height',
  'bodyweight',
  'gender',
  'units',
] as const;

export const REQUIRED_LIFTS = [
  'back_squat',
  'deadlift',
  'bench_press',
  'snatch',
  'clean_and_jerk',
] as const;

export const ALL_SKILL_KEYS = [
  'muscle_ups',
  'bar_muscle_ups',
  'strict_ring_muscle_ups',
  'toes_to_bar',
  'strict_pull_ups',
  'kipping_pull_ups',
  'butterfly_pull_ups',
  'chest_to_bar_pull_ups',
  'rope_climbs',
  'legless_rope_climbs',
  'wall_facing_hspu',
  'hspu',
  'strict_hspu',
  'deficit_hspu',
  'ring_dips',
  'l_sit',
  'handstand_walk',
  'double_unders',
  'pistols',
] as const;

export const MIN_CONDITIONING_BENCHMARKS = 2; // retained for external callers; T2 now requires every key filled

/** All conditioning benchmark keys the form asks about. Must match
 *  CONDITIONING_GROUPS in AthletePage.tsx — T2 is only complete when
 *  the user has filled every one of these. */
export const ALL_CONDITIONING_KEYS = [
  '1_mile_run',
  '5k_run',
  '1k_row',
  '2k_row',
  '5k_row',
  '1min_bike_cals',
  '10min_bike_cals',
] as const;

export const REQUIRED_T3_FIELDS = [
  'days_per_week',
  'session_length_minutes',
  'injuries_constraints',
  'goal',
  'equipment',
] as const;

export type Tier = 0 | 1 | 2 | 3;

export interface TierSection {
  complete: boolean;
  /**
   * For T1 and T3: the list of missing field names.
   * For T2: the list of missing sub-sections from {'lifts', 'skills', 'conditioning'}.
   */
  missing: string[];
}

export interface TierStatus {
  tier1: TierSection;
  tier2: TierSection;
  tier3: TierSection;
  /** Highest tier that is fully complete, or 0 if none. */
  highestCompleteTier: Tier;
  /** The first incomplete tier (what the user should finish next), or null if all complete. */
  nextTier: 1 | 2 | 3 | null;
  canRunEval: boolean;
  canRunPrograms: boolean;
}

export interface AthleteProfileInput {
  age?: number | null;
  height?: number | null;
  bodyweight?: number | null;
  gender?: string | null;
  units?: string | null;
  lifts?: Record<string, number | null | undefined> | null;
  skills?: Record<string, string | null | undefined> | null;
  conditioning?: Record<string, string | number | null | undefined> | null;
  equipment?: Record<string, boolean> | null;
  days_per_week?: number | null;
  session_length_minutes?: number | null;
  injuries_constraints?: string | null;
  goal?: string | null;
  self_perception_level?: string | null;
}

function isNumberSet(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isStringSet(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '';
}


export function getTierStatus(profile: AthleteProfileInput | null | undefined): TierStatus {
  const p: AthleteProfileInput = profile ?? {};

  // --- T1: Basics ---
  const t1Missing: string[] = [];
  if (!isNumberSet(p.age)) t1Missing.push('age');
  if (!isNumberSet(p.height)) t1Missing.push('height');
  if (!isNumberSet(p.bodyweight)) t1Missing.push('bodyweight');
  if (!isStringSet(p.gender)) t1Missing.push('gender');
  if (!isStringSet(p.units)) t1Missing.push('units');
  const tier1: TierSection = { complete: t1Missing.length === 0, missing: t1Missing };

  // --- T2: Athletic data ---
  const lifts = p.lifts ?? {};
  const liftsMissing = REQUIRED_LIFTS.filter((k) => !isNumberSet(lifts[k]));

  const skills = p.skills ?? {};
  const skillsMissing = ALL_SKILL_KEYS.filter((k) => {
    const v = skills[k];
    return v == null || (typeof v === 'string' && v.trim() === '');
  });

  const conditioning = p.conditioning ?? {};
  const conditioningMissing = ALL_CONDITIONING_KEYS.filter((k) => {
    const v = conditioning[k];
    if (v == null) return true;
    if (typeof v === 'number') return !(v > 0);
    return String(v).trim() === '';
  });
  const conditioningComplete = conditioningMissing.length === 0;

  const t2Missing: string[] = [];
  if (liftsMissing.length > 0) t2Missing.push('lifts');
  if (skillsMissing.length > 0) t2Missing.push('skills');
  if (!conditioningComplete) t2Missing.push('conditioning');
  const tier2: TierSection = { complete: t2Missing.length === 0, missing: t2Missing };

  // --- T3: Training context ---
  const t3Missing: string[] = [];
  if (!isNumberSet(p.days_per_week)) t3Missing.push('days_per_week');
  if (!isNumberSet(p.session_length_minutes)) t3Missing.push('session_length_minutes');
  if (!isStringSet(p.injuries_constraints)) t3Missing.push('injuries_constraints');
  if (!isStringSet(p.goal)) t3Missing.push('goal');
  const equipment = p.equipment ?? {};
  if (Object.keys(equipment).length === 0) t3Missing.push('equipment');
  const tier3: TierSection = { complete: t3Missing.length === 0, missing: t3Missing };

  let highestCompleteTier: Tier = 0;
  if (tier1.complete) highestCompleteTier = 1;
  if (tier1.complete && tier2.complete) highestCompleteTier = 2;
  if (tier1.complete && tier2.complete && tier3.complete) highestCompleteTier = 3;

  let nextTier: 1 | 2 | 3 | null = null;
  if (!tier1.complete) nextTier = 1;
  else if (!tier2.complete) nextTier = 2;
  else if (!tier3.complete) nextTier = 3;

  return {
    tier1,
    tier2,
    tier3,
    highestCompleteTier,
    nextTier,
    canRunEval: tier1.complete && tier2.complete,
    canRunPrograms: tier1.complete && tier2.complete && tier3.complete,
  };
}

/**
 * Sub-helpers exposed for consumers that need field-level detail (e.g., the
 * profile page UI rendering per-section progress indicators).
 */

export function liftsStatus(
  lifts: Record<string, number | null | undefined> | null | undefined
): TierSection {
  const l = lifts ?? {};
  const missing = REQUIRED_LIFTS.filter((k) => !isNumberSet(l[k]));
  return { complete: missing.length === 0, missing };
}

export function skillsStatus(
  skills: Record<string, string | null | undefined> | null | undefined
): TierSection {
  const s = skills ?? {};
  const missing = ALL_SKILL_KEYS.filter((k) => {
    const v = s[k];
    return v == null || (typeof v === 'string' && v.trim() === '');
  });
  return { complete: missing.length === 0, missing };
}

export function conditioningStatus(
  conditioning: Record<string, string | number | null | undefined> | null | undefined
): TierSection & { count: number; required: number } {
  const c = conditioning ?? {};
  const missing = ALL_CONDITIONING_KEYS.filter((k) => {
    const v = c[k];
    if (v == null) return true;
    if (typeof v === 'number') return !(v > 0);
    return String(v).trim() === '';
  });
  const count = ALL_CONDITIONING_KEYS.length - missing.length;
  const complete = missing.length === 0;
  return {
    complete,
    missing: complete ? [] : missing.map((k) => String(k)),
    count,
    required: ALL_CONDITIONING_KEYS.length,
  };
}
