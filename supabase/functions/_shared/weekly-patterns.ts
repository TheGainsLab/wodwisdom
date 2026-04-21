/**
 * Fixed weekly patterns by goal × days_per_week.
 *
 * Each pattern is an ordered array of archetypes. Length matches
 * days_per_week. Stored as data, not derived — we want predictability
 * and per-cohort iterability without code changes to the generator.
 *
 * Week 4 of every month is a deload — replaces 1-2 high-CNS days with
 * Recovery or Fitness so the user gets an actual recovery week, not just
 * "lighter skill volume." The Week 4 override map is keyed the same way.
 *
 * Supported days_per_week values: 3, 4, 5, 6.
 * Out-of-range values fall back to the closest supported value.
 */

import type { DayArchetype } from "./archetype-specs.ts";
import type { PrimaryGoal } from "./reconciler.ts";

type PatternMap = Record<3 | 4 | 5 | 6, DayArchetype[]>;

export const WEEKLY_PATTERNS: Record<PrimaryGoal, PatternMap> = {
  fitness: {
    3: ["fitness", "fitness", "fitness"],
    4: ["fitness", "fitness", "fitness", "fitness"],
    5: ["fitness", "metcon", "strength", "fitness", "metcon"],
    6: ["fitness", "metcon", "strength", "recovery", "fitness", "metcon"],
  },
  competitor: {
    3: ["strength", "metcon", "skill"],
    4: ["strength", "metcon", "skill", "metcon"],
    5: ["strength", "metcon", "skill", "strength", "metcon"],
    6: ["strength", "metcon", "skill", "recovery", "strength", "metcon"],
  },
  strength_and_power: {
    3: ["strength", "fitness", "strength"],
    4: ["strength", "fitness", "strength", "metcon"],
    5: ["strength", "metcon", "strength", "fitness", "strength"],
    6: ["strength", "metcon", "strength", "recovery", "strength", "fitness"],
  },
};

/**
 * Week 4 deload overrides — replaces 1-2 high-CNS days with Recovery
 * or Fitness. Same shape as WEEKLY_PATTERNS.
 *
 * Rule applied: at least 2 Recovery/Fitness days, no more than 1
 * high-CNS day (Strength or intense Metcon). Exact swaps are
 * goal-specific and tuned for the typical taxing pattern.
 */
export const WEEK4_DELOAD_PATTERNS: Record<PrimaryGoal, PatternMap> = {
  fitness: {
    3: ["fitness", "recovery", "fitness"],
    4: ["fitness", "fitness", "recovery", "fitness"],
    5: ["fitness", "metcon", "recovery", "fitness", "recovery"],
    6: ["fitness", "metcon", "recovery", "recovery", "fitness", "metcon"],
  },
  competitor: {
    3: ["fitness", "metcon", "recovery"],
    4: ["fitness", "metcon", "skill", "recovery"],
    5: ["fitness", "metcon", "recovery", "fitness", "recovery"],
    6: ["fitness", "metcon", "skill", "recovery", "fitness", "recovery"],
  },
  strength_and_power: {
    3: ["fitness", "recovery", "fitness"],
    4: ["fitness", "recovery", "strength", "fitness"],
    5: ["fitness", "metcon", "recovery", "fitness", "fitness"],
    6: ["fitness", "metcon", "recovery", "recovery", "strength", "fitness"],
  },
};

const SUPPORTED_DAYS = [3, 4, 5, 6] as const;
type SupportedDays = typeof SUPPORTED_DAYS[number];

/** Clamp an arbitrary days_per_week value to the supported range. */
export function normalizeDaysPerWeek(daysPerWeek: number | null | undefined): SupportedDays {
  if (daysPerWeek == null || !Number.isFinite(daysPerWeek)) return 5;
  if (daysPerWeek <= 3) return 3;
  if (daysPerWeek >= 6) return 6;
  return Math.round(daysPerWeek) as SupportedDays;
}

/**
 * Returns the full month's weekly patterns. Weeks 1-3 use the base pattern,
 * Week 4 uses the deload override. Result is an array of 4 weeks, each an
 * array of archetypes for that week's days.
 */
export function getMonthlyPattern(
  goal: PrimaryGoal,
  daysPerWeek: number | null | undefined,
): { weeks: DayArchetype[][]; baseline: DayArchetype[]; deload: DayArchetype[]; daysPerWeek: SupportedDays } {
  const normalized = normalizeDaysPerWeek(daysPerWeek);
  const baseline = WEEKLY_PATTERNS[goal][normalized];
  const deload = WEEK4_DELOAD_PATTERNS[goal][normalized];
  return {
    weeks: [baseline, baseline, baseline, deload],
    baseline,
    deload,
    daysPerWeek: normalized,
  };
}
