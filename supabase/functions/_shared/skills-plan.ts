/**
 * skills-plan.ts — how the SKILLS block is planned (founder, 2026-11-28).
 *
 * Before: the coach state reduced the athlete's 20 skill ratings to four
 * broad areas (gymnastics pulling, gymnastics pressing, midline, skill
 * coordination), marked each develop / maintain / set aside, and the planner
 * could only work inside that. Measured on 31 members' latest month: 18 had
 * one or two skill areas for the whole month, a set-aside area got no skills
 * time at all, and 404 low-rated skills drew 29 direct lines. Founder: "the
 * coach state worked against the athlete."
 *
 * Now, for individual programs:
 *   - the planner is NOT given the four skill areas in any list (develop,
 *     maintain or set aside), so no skill is switched off;
 *   - it IS given the athlete's own rating of every skill with what each
 *     rating means, their goal in their own words, their equipment, and how
 *     often each skill appears on the CrossFit main site;
 *   - it decides each day's skills itself. Two things matter most: a skill
 *     named in the goal and a skill rated low. Frequency is a third
 *     consideration;
 *   - each skills day NAMES its skills in a typed field (skill_names: one or
 *     two, from PLAN_SKILL_OPTIONS). The form accepts nothing else, so a
 *     broad area cannot be written there.
 *
 * Unchanged: a skills block on every training day, no barbell work in it,
 * and the writer picks the drills and the dose from the rating.
 *
 * NO EXAMPLES of an athlete here (founder, 2026-11-26). Pure, no IO.
 */

import type { FocusArea, CoachStateContent } from "./coach-state.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";
import { SKILL_RATING_MEANINGS } from "./conditioning-definitions.ts";

/** The four focus areas that used to steer the skills block. */
export const SKILL_AREAS: readonly FocusArea[] = [
  "gymnastics_pulling",
  "gymnastics_pressing",
  "midline",
  "skill_coordination",
] as FocusArea[];
const isSkillArea = (f: unknown) => (SKILL_AREAS as readonly unknown[]).includes(f);

/**
 * What a skills day may name. The profile's skills, with two differences:
 * kipping and butterfly pull-ups are one option, "Pull-Ups" (we do not use
 * those words in a plan), and "Midline" stands for general midline work
 * (allowed for now; it may move to the accessory block).
 */
export const PLAN_SKILL_OPTIONS = [
  "Pull-Ups",
  "Strict Pull-Ups",
  "Chest-to-Bar Pull-Ups",
  "Muscle-Ups",
  "Bar Muscle-Ups",
  "Strict Ring Muscle-Ups",
  "Ring Dips",
  "HSPU",
  "Strict HSPU",
  "Deficit HSPU",
  "Wall-Facing HSPU",
  "Handstand Walk",
  "Toes-to-Bar",
  "GHD Sit-Ups",
  "L-Sit",
  "Rope Climbs",
  "Legless Rope Climbs",
  "Double-Unders",
  "Pistols",
  "Midline",
] as const;
export type PlanSkill = typeof PLAN_SKILL_OPTIONS[number];

/**
 * How many of the 6,684 CrossFit main site workouts (2001-2025) contain each
 * skill. Counted 2026-11-28 from the library; the order is reliable, the
 * numbers approximate (the page text includes scaling notes). The main site
 * does not say "kipping" or "butterfly": those are inside Pull-Ups.
 */
export const MAINSITE_SKILL_FREQUENCY: Array<[PlanSkill, number]> = [
  ["Pull-Ups", 1653],
  ["HSPU", 491],
  ["Double-Unders", 400],
  ["Muscle-Ups", 381],
  ["Toes-to-Bar", 328],
  ["Rope Climbs", 319],
  ["GHD Sit-Ups", 262],
  ["L-Sit", 233],
  ["Ring Dips", 229],
  ["Strict Pull-Ups", 185],
  ["Chest-to-Bar Pull-Ups", 173],
  ["Pistols", 159],
  ["Handstand Walk", 105],
  ["Bar Muscle-Ups", 74],
  ["Strict HSPU", 64],
  ["Legless Rope Climbs", 55],
  ["Strict Ring Muscle-Ups", 38],
  ["Deficit HSPU", 22],
  ["Wall-Facing HSPU", 8],
];

/** The plan inputs without the four skill areas. Ranks are left as they are. */
export function stripSkillAreasFromTdi(tdi: TrainingDesignInput): TrainingDesignInput {
  return {
    ...tdi,
    priorities: (tdi.priorities ?? []).filter((p) => !isSkillArea(p.focus)),
    maintain: (tdi.maintain ?? []).filter((f) => !isSkillArea(f)),
    deprioritize: (tdi.deprioritize ?? []).filter((f) => !isSkillArea(f)),
  };
}

/** The coach state as the planner reads it: no decision on a skill area. */
export function coachStateForPlanner<T extends Partial<CoachStateContent>>(cs: T): T {
  return {
    ...cs,
    priorities: (cs.priorities ?? []).filter((p) => !isSkillArea(p.focus)),
    maintain: (cs.maintain ?? []).filter((m) => !isSkillArea(m.focus)),
    deprioritize: (cs.deprioritize ?? []).filter((d) => !isSkillArea(d.focus)),
  } as T;
}

/**
 * What the planner is told about the athlete's skills. Only what the athlete
 * entered, the meaning of each rating, and the main site counts.
 */
export function buildSkillsBrief(p: {
  skills?: Record<string, string | null> | null;
  goalText?: string | null;
  equipment?: Record<string, boolean> | null;
}): string {
  const skills = p.skills ?? {};
  const lines: string[] = [
    "ATHLETE'S SKILLS (for THE SKILLS BLOCK: everything you are given about this athlete's skills)",
    `Their goal, in their own words: ${(p.goalText ?? "").trim() ? `"${(p.goalText ?? "").trim()}"` : "(none given)"}`,
    "Their own rating of each skill (a rating belongs to that ONE skill and says nothing about any other):",
  ];
  const entries = Object.entries(skills);
  if (entries.length === 0) lines.push("  (no skills rated)");
  for (const [name, rating] of entries) lines.push(`  - ${name}: ${rating ?? "not rated"}`);
  lines.push(
    "What each rating means, in the wording of the athlete's profile:",
    ...(Object.entries(SKILL_RATING_MEANINGS) as Array<[string, string]>).map(([r, m]) => `  - ${r}: ${m}`),
    'On the skill list, "Pull-Ups" covers the Kipping Pull-Ups and Butterfly Pull-Ups ratings.',
  );
  const lack = Object.entries(p.equipment ?? {}).filter(([, v]) => v === false).map(([k]) => k.replace(/_/g, " "));
  lines.push(`Equipment they do NOT have: ${lack.length ? lack.join(", ") : "(nothing missing)"}`);
  lines.push(
    "How often each skill appears on the CrossFit main site (workouts containing it, of 6,684):",
    "  " + MAINSITE_SKILL_FREQUENCY.map(([s, n]) => `${s} ${n}`).join(" · "),
  );
  return lines.join("\n");
}

interface SkillsDay { day_num: number; block_types?: string[]; skill_names?: unknown }
/** Skills days that name no skill, or name something off the list. One line
 *  each. Sent back to the planner once with the metcon mix; never fails a job. */
export function auditSkeletonSkillNames(
  skeleton: { weeks?: Array<{ week_num: number; days?: SkillsDay[] }> },
  fromWeek = 1,
): string[] {
  const out: string[] = [];
  for (const wk of skeleton.weeks ?? []) {
    if (wk.week_num < fromWeek) continue;
    for (const d of wk.days ?? []) {
      if (!(d.block_types ?? []).includes("skills")) continue;
      const names = Array.isArray(d.skill_names) ? d.skill_names : [];
      const bad = names.filter((n) => !(PLAN_SKILL_OPTIONS as readonly unknown[]).includes(n));
      if (names.length === 0) {
        out.push(`Week ${wk.week_num} Day ${d.day_num}: the skills block names no skill — set skill_names (one or two skills from the list).`);
      } else if (names.length > 2) {
        out.push(`Week ${wk.week_num} Day ${d.day_num}: skill_names has ${names.length} skills — one or two.`);
      } else if (bad.length) {
        out.push(`Week ${wk.week_num} Day ${d.day_num}: skill_names has a value that is not on the list (${bad.join(", ")}).`);
      }
    }
  }
  return out;
}
