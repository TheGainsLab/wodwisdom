/**
 * Which Training Log card a logged entry belongs on.
 *
 * The entry carries `counts_toward`: the profile lift or skill the AI said
 * the movement counts toward when it wrote it (or "none"). The card is read
 * from that. The movement's NAME is used only for an entry nobody has
 * labelled yet (`byName`, the page's older keyword sorter), so those entries
 * land where they always did.
 *
 * Before 2026-11-25 every entry was sorted by keywords in its name: "Military
 * Press" fell into Other Strength, a "Snatch Grip Deadlift" onto the Snatch
 * card, a "Clean Pull" onto Clean & Jerk.
 */
import { isLabelled, liftCountedToward, skillCountedToward } from '../../supabase/functions/_shared/counts-toward.ts';

/** Profile lift key → the lift card that shows it. The Olympic variations
 *  share the Snatch and Clean & Jerk cards, as they always have. */
export const LIFT_CARD_OF: Record<string, string> = {
  back_squat: 'back_squat',
  front_squat: 'front_squat',
  overhead_squat: 'overhead_squat',
  deadlift: 'deadlift',
  bench_press: 'bench_press',
  press: 'press',
  push_press: 'push_press',
  snatch: 'snatch',
  power_snatch: 'snatch',
  clean: 'clean_and_jerk',
  power_clean: 'clean_and_jerk',
  clean_and_jerk: 'clean_and_jerk',
  jerk: 'clean_and_jerk',
  push_jerk: 'clean_and_jerk',
};

/** Profile skill key → the skill card that shows it. */
export const SKILL_CARD_OF: Record<string, string> = {
  strict_pull_ups: 'strict_pull_up',
  kipping_pull_ups: 'pull_up',
  butterfly_pull_ups: 'pull_up',
  chest_to_bar_pull_ups: 'pull_up',
  bar_muscle_ups: 'muscle_up',
  muscle_ups: 'muscle_up',
  strict_ring_muscle_ups: 'muscle_up',
  wall_facing_hspu: 'hspu',
  hspu: 'hspu',
  strict_hspu: 'hspu',
  deficit_hspu: 'hspu',
  handstand_walk: 'handstand',
  toes_to_bar: 'toes_to_bar',
  double_unders: 'double_under',
  rope_climbs: 'rope_climb',
  legless_rope_climbs: 'rope_climb',
  ring_dips: 'ring_dip',
  l_sit: 'l_sit',
  pistols: 'pistol',
  // ghd_sit_ups has no card of its own: it shows under Other Skills.
};

type Entry = { movement: string; counts_toward?: string | null };

export function liftCardFor(e: Entry, byName: (movement: string) => string): string {
  if (!isLabelled(e.counts_toward)) return byName(e.movement);
  const lift = liftCountedToward(e.counts_toward);
  return (lift && LIFT_CARD_OF[lift]) || 'other';
}

export function skillCardFor(e: Entry, byName: (movement: string) => string): string {
  if (!isLabelled(e.counts_toward)) return byName(e.movement);
  const skill = skillCountedToward(e.counts_toward);
  return (skill && SKILL_CARD_OF[skill]) || 'other_skills';
}
