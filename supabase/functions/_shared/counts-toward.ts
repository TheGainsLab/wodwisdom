/**
 * counts-toward.ts — which of the athlete's PROFILE lifts or skills a written
 * movement counts toward. Import-free: the server and the app both use it.
 *
 * WHY (2026-11-25): code used to work this out from the movement's spelling.
 * The profile calls a skill `chest_to_bar_pull_ups`; the movement catalogue
 * calls the same thing "Chest To Bar"; the carry-over into the next month
 * compared one with the other and never matched (236 written "Chest To Bar",
 * 192 "Pull Up", 69 "Handstand Push Up", 62 "Ring Muscle Up", 62 "Strict Ring
 * Dip" — none counted). "Clean And Jerk" missed the lift list on a capital A.
 *
 * THE RULE: the two profile lists below are the athlete's own data and stay
 * fixed. WHICH of them a movement counts toward is decided by the AI when it
 * writes the movement (`counts_toward`), and code reads that. Code never reads
 * the name to decide it.
 *
 * Stored value: one of the keys below, "none" (the AI says it counts toward
 * neither list), or null (nobody has labelled this row yet).
 */

/** The 14 lifts on the profile (athlete_profiles.lifts keys). */
export const PROFILE_LIFT_KEYS = [
  "back_squat", "front_squat", "overhead_squat",
  "deadlift",
  "clean", "power_clean", "clean_and_jerk", "jerk", "snatch", "power_snatch", "push_jerk",
  "press", "push_press", "bench_press",
] as const;

/** The 20 skills on the profile (athlete_profiles.skills keys). */
export const PROFILE_SKILL_KEYS = [
  "muscle_ups", "bar_muscle_ups", "strict_ring_muscle_ups",
  "toes_to_bar",
  "strict_pull_ups", "kipping_pull_ups", "butterfly_pull_ups", "chest_to_bar_pull_ups",
  "rope_climbs", "legless_rope_climbs",
  "wall_facing_hspu", "hspu", "strict_hspu", "deficit_hspu",
  "ring_dips", "l_sit", "handstand_walk", "double_unders", "pistols", "ghd_sit_ups",
] as const;

export const COUNTS_TOWARD_NONE = "none";

/** Every value the AI may choose. */
export const COUNTS_TOWARD_VALUES: readonly string[] = [...PROFILE_LIFT_KEYS, ...PROFILE_SKILL_KEYS, COUNTS_TOWARD_NONE];

const LIFTS: ReadonlySet<string> = new Set(PROFILE_LIFT_KEYS);
const SKILLS: ReadonlySet<string> = new Set(PROFILE_SKILL_KEYS);

/** The value as it may be stored: a known key, "none", or null (unlabelled). */
export function storedCountsToward(v: unknown): string | null {
  return typeof v === "string" && (LIFTS.has(v) || SKILLS.has(v) || v === COUNTS_TOWARD_NONE) ? v : null;
}

/** True once an AI has answered for this row (a key, or "none"). */
export function isLabelled(v: unknown): boolean {
  return storedCountsToward(v) != null;
}

/** The profile lift this counts toward, or null. */
export function liftCountedToward(v: unknown): string | null {
  return typeof v === "string" && LIFTS.has(v) ? v : null;
}

/** The profile skill this counts toward, or null. */
export function skillCountedToward(v: unknown): string | null {
  return typeof v === "string" && SKILLS.has(v) ? v : null;
}

/** The instruction given to every AI that writes or labels a movement. */
export const COUNTS_TOWARD_INSTRUCTION =
  "counts_toward: which of the athlete's PROFILE entries this movement counts toward. " +
  "A LIFT key when this is that barbell lift, or a barbell variation whose weight should be judged against that lift's one-rep max " +
  "(a Pause Back Squat counts toward back_squat, a Hang Power Clean toward power_clean, a Split Jerk toward jerk). " +
  "A SKILL key when it is that gymnastics skill or a direct form of it " +
  "(Chest To Bar counts toward chest_to_bar_pull_ups, a Ring Muscle Up toward muscle_ups, a Handstand Push Up toward hspu). " +
  "\"none\" for everything else: dumbbell, kettlebell and machine work, running, carries, accessory and core work, and scaled progressions that are not the skill itself. " +
  // 2026-11-25: a lift key makes code hold the weight under that lift's
  // ceiling. A pull is normally loaded ABOVE the lift it is named after, so
  // it must not carry the lift's key; its weight is the AI's own judgment.
  "Also \"none\": a pull or partial lift that is trained heavier than the lift it is named after (a Snatch Pull, a Clean Pull, a rack pull) — its weight is not limited by that lift's max. " +
  "You decide by what the movement IS; the name's spelling does not matter.";
