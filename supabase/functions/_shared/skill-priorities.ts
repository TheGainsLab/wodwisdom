/**
 * Deterministic skill priority ranking from athlete profile data
 * and the movements table.
 *
 * Produces a scored, sorted list used by build-skill-schedule.ts
 * to assign skills to each training day.
 */

import type { MovementsRow } from "./build-movements-context.ts";

// ── Level helpers ──────────────────────────────────────────────

const LEVEL_NUMERIC: Record<string, number> = {
  none: 0,
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

// ── Profile skill key → movements.canonical_name ───────────────
// Most are 1:1. Where they differ, map explicitly.

const SKILL_TO_CANONICAL: Record<string, string[]> = {
  muscle_ups: ["muscle_up", "ring_muscle_up"],
  bar_muscle_ups: ["bar_muscle_up"],
  strict_ring_muscle_ups: ["ring_muscle_up"],
  toes_to_bar: ["toes_to_bar"],
  strict_pull_ups: ["pull_up"],
  kipping_pull_ups: ["pull_up"],
  butterfly_pull_ups: ["pull_up"],
  chest_to_bar_pull_ups: ["chest_to_bar"],
  rope_climbs: ["rope_climb"],
  legless_rope_climbs: ["legless_rope_climb"],
  wall_facing_hspu: ["handstand_push_up"],
  hspu: ["handstand_push_up"],
  strict_hspu: ["strict_hspu"],
  deficit_hspu: ["deficit_hspu"],
  ring_dips: ["ring_dip"],
  l_sit: ["l_sit"],
  handstand_walk: ["handstand_walk"],
  double_unders: ["double_under"],
  pistols: ["pistol"],
};

// ── Display names for prompt injection ─────────────────────────

export const SKILL_DISPLAY_NAMES: Record<string, string> = {
  muscle_ups: "Ring Muscle-Ups",
  bar_muscle_ups: "Bar Muscle-Ups",
  strict_ring_muscle_ups: "Strict Ring Muscle-Ups",
  toes_to_bar: "Toes-to-Bar",
  strict_pull_ups: "Strict Pull-Ups",
  kipping_pull_ups: "Kipping Pull-Ups",
  butterfly_pull_ups: "Butterfly Pull-Ups",
  chest_to_bar_pull_ups: "Chest-to-Bar Pull-Ups",
  rope_climbs: "Rope Climbs",
  legless_rope_climbs: "Legless Rope Climbs",
  wall_facing_hspu: "Wall-Facing HSPU",
  hspu: "HSPU (kipping)",
  strict_hspu: "Strict HSPU",
  deficit_hspu: "Deficit HSPU",
  ring_dips: "Ring Dips",
  l_sit: "L-Sit",
  handstand_walk: "Handstand Walk",
  double_unders: "Double-Unders",
  pistols: "Pistols",
};

// ── Prerequisite table ─────────────────────────────────────────
// { skill: [prereqSkill, minimumLevel] }
// If the athlete doesn't meet the prereq, trainability = 0 for
// that skill and the prereq gets a priority boost instead.

const PREREQUISITES: Record<string, [string, number][]> = {
  muscle_ups: [
    ["chest_to_bar_pull_ups", LEVEL_NUMERIC.intermediate],
    ["ring_dips", LEVEL_NUMERIC.intermediate],
  ],
  bar_muscle_ups: [
    ["chest_to_bar_pull_ups", LEVEL_NUMERIC.intermediate],
  ],
  strict_ring_muscle_ups: [
    ["muscle_ups", LEVEL_NUMERIC.intermediate],
  ],
  chest_to_bar_pull_ups: [
    ["kipping_pull_ups", LEVEL_NUMERIC.beginner],
  ],
  kipping_pull_ups: [
    ["strict_pull_ups", LEVEL_NUMERIC.beginner],
  ],
  butterfly_pull_ups: [
    ["kipping_pull_ups", LEVEL_NUMERIC.intermediate],
  ],
  toes_to_bar: [
    ["kipping_pull_ups", LEVEL_NUMERIC.beginner],
  ],
  hspu: [
    ["wall_facing_hspu", LEVEL_NUMERIC.beginner],
  ],
  strict_hspu: [
    ["hspu", LEVEL_NUMERIC.intermediate],
  ],
  deficit_hspu: [
    ["strict_hspu", LEVEL_NUMERIC.intermediate],
  ],
  handstand_walk: [
    ["wall_facing_hspu", LEVEL_NUMERIC.intermediate],
  ],
  legless_rope_climbs: [
    ["rope_climbs", LEVEL_NUMERIC.intermediate],
  ],
};

// ── Trainability base values ───────────────────────────────────
// How addressable is this skill in a 12-week cycle?
// High (3) = coordination / can progress fast
// Medium (2) = needs strength + skill combo
// Low (1) = requires significant strength base

const TRAINABILITY: Record<string, number> = {
  double_unders: 3,
  toes_to_bar: 3,
  kipping_pull_ups: 3,
  strict_pull_ups: 2,
  chest_to_bar_pull_ups: 2,
  butterfly_pull_ups: 2,
  wall_facing_hspu: 3,
  hspu: 2,
  strict_hspu: 2,
  deficit_hspu: 1,
  rope_climbs: 2,
  legless_rope_climbs: 1,
  ring_dips: 2,
  l_sit: 2,
  handstand_walk: 2,
  pistols: 2,
  muscle_ups: 1,
  bar_muscle_ups: 1,
  strict_ring_muscle_ups: 1,
};

// ── Competition tier from raw count ────────────────────────────

function compTier(count: number): number {
  if (count >= 15) return 3;
  if (count >= 8) return 2;
  if (count >= 1) return 1;
  return 0;
}

// ── Main export ────────────────────────────────────────────────

export interface SkillPriority {
  skill: string;        // profile key (e.g. "toes_to_bar")
  displayName: string;  // prompt-friendly name
  level: string;        // current proficiency ("none" | "beginner" | ...)
  score: number;        // raw priority score
  maxPerWeek: number;   // 2 for top priorities, 1 for others
}

/**
 * Rank all non-advanced skills by priority.
 * Returns a sorted array (highest priority first).
 */
export function rankSkillPriorities(
  skills: Record<string, string>,
  movementRows: MovementsRow[],
): SkillPriority[] {
  if (!skills || Object.keys(skills).length === 0) return [];

  // Build a lookup: canonical_name → max competition_count
  const compCounts = new Map<string, number>();
  for (const row of movementRows) {
    compCounts.set(row.canonical_name, row.competition_count ?? 0);
  }

  // Resolve the best competition_count for a profile skill key
  function bestCompCount(skillKey: string): number {
    const canonicals = SKILL_TO_CANONICAL[skillKey];
    if (!canonicals) return 0;
    return Math.max(...canonicals.map((c) => compCounts.get(c) ?? 0));
  }

  // Check if prereqs are met for a skill
  function prereqsMet(skillKey: string): boolean {
    const prereqs = PREREQUISITES[skillKey];
    if (!prereqs) return true;
    return prereqs.every(([prereqSkill, minLevel]) => {
      const athleteLevel = LEVEL_NUMERIC[skills[prereqSkill] ?? "none"] ?? 0;
      return athleteLevel >= minLevel;
    });
  }

  // Track prereq boosts — if a skill is blocked, its prereqs get a bonus
  const prereqBoost = new Map<string, number>();

  const entries: SkillPriority[] = [];

  for (const [skillKey, levelStr] of Object.entries(skills)) {
    const level = LEVEL_NUMERIC[levelStr] ?? 0;
    const needScore = 3 - level;

    // Skip advanced skills — they go to maintenance, not priority
    if (needScore <= 0) continue;

    const trainability = TRAINABILITY[skillKey] ?? 2;
    const tier = compTier(bestCompCount(skillKey));

    if (!prereqsMet(skillKey)) {
      // Blocked — boost the prereqs instead
      const prereqs = PREREQUISITES[skillKey] ?? [];
      for (const [prereqSkill] of prereqs) {
        prereqBoost.set(prereqSkill, (prereqBoost.get(prereqSkill) ?? 0) + needScore * (tier + 1));
      }
      continue; // don't add blocked skill
    }

    const score = needScore * (tier + 1) * trainability;
    entries.push({
      skill: skillKey,
      displayName: SKILL_DISPLAY_NAMES[skillKey] ?? skillKey.replace(/_/g, " "),
      level: levelStr,
      score,
      maxPerWeek: 2, // will be capped later based on rank
    });
  }

  // Apply prereq boosts
  for (const entry of entries) {
    const boost = prereqBoost.get(entry.skill) ?? 0;
    if (boost > 0) entry.score += boost;
  }

  // Sort descending by score, tie-break by competition count then alphabetical
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const compA = bestCompCount(a.skill);
    const compB = bestCompCount(b.skill);
    if (compB !== compA) return compB - compA;
    return a.skill.localeCompare(b.skill);
  });

  // Top 2 get 2x/week, rest get 1x/week
  for (let i = 0; i < entries.length; i++) {
    entries[i].maxPerWeek = i < 2 ? 2 : 1;
  }

  return entries;
}
