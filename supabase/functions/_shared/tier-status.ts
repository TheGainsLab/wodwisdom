/**
 * Single source of truth for athlete profile tier completeness.
 *
 * Keep in sync with src/utils/tier-status.ts.
 *
 * Tiers:
 *   T1 — Basics (age, height, bodyweight, gender, units)
 *   T2 — Athletic data (required lifts, all skills rated, and the required
 *        conditioning benchmarks: a 2k row plus one run — mile or 5k. The
 *        other benchmarks are optional depth, relaxed Aug '26). Required to
 *        run the free Profile Evaluation.
 *   T3 — Training context (days/week, injuries text, goal, equipment).
 *        Required to run AI Programming. Session length was dropped as a
 *        requirement in Aug '26 — stored values still feed the writer, but
 *        new users are no longer asked for it.
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

/** All 14 canonical lift keys the intake form collects (LIFT_GROUPS in
 *  AthletePage.tsx). REQUIRED_LIFTS is a subset (5 of 14). */
export const ALL_LIFT_KEYS = [
  'back_squat',
  'front_squat',
  'overhead_squat',
  'deadlift',
  'snatch',
  'power_snatch',
  'clean',
  'clean_and_jerk',
  'jerk',
  'power_clean',
  'push_jerk',
  'press',
  'push_press',
  'bench_press',
] as const;

/** All canonical equipment keys the intake form collects
 *  (EQUIPMENT_GROUPS in AthletePage.tsx). */
export const ALL_EQUIPMENT_KEYS = [
  // Cardio
  'rower',
  'assault_bike',
  'ski_erg',
  'treadmill',
  'jump_rope',
  // Barbell & Weights
  'barbell',
  'dumbbells',
  'kettlebells',
  'bench',
  // Gymnastics
  'pull_up_bar',
  'rings',
  'rope',
  'ghd',
  'parallettes',
  'pegboard',
  // Other
  'box',
  'wall_ball',
  'sled',
  'blocks',
  'bands',
] as const;

/**
 * Hydrate a raw equipment JSONB into the canonical full-key boolean map.
 *
 * An EMPTY (or missing) record means the athlete has never done the
 * equipment review — treat as fully equipped, the same default the intake
 * form renders, so an unreviewed profile never reads as "owns nothing"
 * (which would poison evals and chat-edit vocabulary with all-blocked
 * equipment). A NON-empty record is the athlete's confirmed review and is
 * authoritative: missing keys hydrate to false.
 *
 * Note the gate above is unchanged: an empty record still leaves T3
 * incomplete, so programs stay blocked until the review is saved. This
 * default only protects the surfaces that run before that gate (the free
 * eval, chat).
 */
export function hydrateEquipment(
  raw: Record<string, unknown> | null | undefined
): Record<string, boolean> {
  const src = raw ?? {};
  const reviewed = Object.keys(src).length > 0;
  const out: Record<string, boolean> = {};
  for (const k of ALL_EQUIPMENT_KEYS) out[k] = reviewed ? src[k] === true : true;
  return out;
}

/**
 * Canonical display names for each skill key. Used by the v2 writer
 * payload so the LLM reads "Muscle-Ups" / "Toes-to-Bar" / "HSPU" /
 * "L-Sit" directly instead of having to translate from snake_case.
 */
export const SKILL_DISPLAY_NAMES: Record<string, string> = {
  muscle_ups: 'Muscle-Ups',
  bar_muscle_ups: 'Bar Muscle-Ups',
  strict_ring_muscle_ups: 'Strict Ring Muscle-Ups',
  toes_to_bar: 'Toes-to-Bar',
  strict_pull_ups: 'Strict Pull-Ups',
  kipping_pull_ups: 'Kipping Pull-Ups',
  butterfly_pull_ups: 'Butterfly Pull-Ups',
  chest_to_bar_pull_ups: 'Chest-to-Bar Pull-Ups',
  rope_climbs: 'Rope Climbs',
  legless_rope_climbs: 'Legless Rope Climbs',
  wall_facing_hspu: 'Wall-Facing HSPU',
  hspu: 'HSPU',
  strict_hspu: 'Strict HSPU',
  deficit_hspu: 'Deficit HSPU',
  ring_dips: 'Ring Dips',
  l_sit: 'L-Sit',
  handstand_walk: 'Handstand Walk',
  double_unders: 'Double-Unders',
  pistols: 'Pistols',
  ghd_sit_ups: 'GHD Sit-Ups',
};

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
  'ghd_sit_ups',
] as const;

export const MIN_CONDITIONING_BENCHMARKS = 2; // retained for external callers; matches the 2 required slots below

/** All conditioning benchmark keys the form asks about. Must match
 *  CONDITIONING_GROUPS in AthletePage.tsx. Only the REQUIRED keys below
 *  gate T2 — the rest are optional depth for the evaluation. */
export const ALL_CONDITIONING_KEYS = [
  '1_mile_run',
  '5k_run',
  '1k_row',
  '2k_row',
  '5k_row',
  '1min_bike_cals',
  '10min_bike_cals',
] as const;

/** Conditioning gate (relaxed Aug '26): a 2k row plus ONE run — whichever
 *  the athlete actually runs. Everything else in ALL_CONDITIONING_KEYS is
 *  optional; the eval prompt turns blanks into an assigned testing plan. */
export const REQUIRED_CONDITIONING_KEYS = ['2k_row'] as const;
export const RUN_BENCHMARK_KEYS = ['1_mile_run', '5k_run'] as const;
/** Human-legible label used in `missing` when neither run time is set. */
export const RUN_BENCHMARK_MISSING_LABEL = 'run (mile or 5k)';

export const REQUIRED_T3_FIELDS = [
  'days_per_week',
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

function isConditioningSet(v: string | number | null | undefined): boolean {
  if (v == null) return false;
  if (typeof v === 'number') return v > 0;
  return String(v).trim() !== '';
}

/** Required-only conditioning gaps: 2k row, plus one run (mile or 5k). */
function conditioningMissingRequired(
  conditioning: Record<string, string | number | null | undefined>
): string[] {
  const missing: string[] = [];
  for (const k of REQUIRED_CONDITIONING_KEYS) {
    if (!isConditioningSet(conditioning[k])) missing.push(k);
  }
  if (!RUN_BENCHMARK_KEYS.some((k) => isConditioningSet(conditioning[k]))) {
    missing.push(RUN_BENCHMARK_MISSING_LABEL);
  }
  return missing;
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
  const conditioningComplete = conditioningMissingRequired(conditioning).length === 0;

  const t2Missing: string[] = [];
  if (liftsMissing.length > 0) t2Missing.push('lifts');
  if (skillsMissing.length > 0) t2Missing.push('skills');
  if (!conditioningComplete) t2Missing.push('conditioning');
  const tier2: TierSection = { complete: t2Missing.length === 0, missing: t2Missing };

  // --- T3: Training context ---
  const t3Missing: string[] = [];
  if (!isNumberSet(p.days_per_week)) t3Missing.push('days_per_week');
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
  const missing = conditioningMissingRequired(c);
  // count/required are informational fill counts over ALL benchmarks (for
  // "X of Y" displays); complete/missing carry the actual (required-only) gate.
  const count = ALL_CONDITIONING_KEYS.filter((k) => isConditioningSet(c[k])).length;
  return {
    complete: missing.length === 0,
    missing,
    count,
    required: ALL_CONDITIONING_KEYS.length,
  };
}
