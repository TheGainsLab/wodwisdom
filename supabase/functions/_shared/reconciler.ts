/**
 * Profile reconciler — merges classifier outputs (goal, injuries) with
 * interpreter outputs (strength / skills / conditioning levels + experience
 * tier) into a single InterpretedProfile object the generator can consume.
 *
 * Pure data-shaping — no LLM calls. Also detects obvious hard blockers
 * (e.g., "CF competitor" + "no overhead pressing") for UI confirmation
 * before generation.
 */

import type { DomainLevels, ExperienceTier } from "./level-interpreter.ts";
import { calibrationDelta } from "./level-interpreter.ts";
import type { DayArchetype } from "./archetype-specs.ts";
import { getMonthlyPattern, normalizeDaysPerWeek } from "./weekly-patterns.ts";

export type PrimaryGoal = "fitness" | "competitor" | "strength_and_power";

export interface ParsedGoal {
  primary_goal: PrimaryGoal;
  secondary_emphasis: string[];
  time_horizon: string | null;
  named_event: string | null;
  emphasis_blocks: string[];
}

export interface ParsedInjury {
  region: string;
  side: "left" | "right" | "bilateral" | null;
  severity: "minor" | "moderate" | "severe";
  description: string;
  prohibited_movements: string[];
  caution_movements: string[];
}

export interface ParsedInjuries {
  constraints: ParsedInjury[];
  summary: string;
}

export interface Blocker {
  kind: string;
  description: string;
  suggested_resolution: string;
}

export interface InterpretedProfile {
  goal: ParsedGoal;
  injuries: ParsedInjuries;
  levels: DomainLevels;
  self_perception_level: string | null;
  calibration: {
    delta: number;
    note: string;
  };
  blockers: Blocker[];
  /** Flat list of prohibited movement strings from all injuries, for prompt use. */
  prohibited_movements: string[];
  caution_movements: string[];
  /** Tier used for generation (after upward-only ratchet). */
  effective_tier: ExperienceTier;
  /** Days per week clamped to supported range (3-6). */
  days_per_week: 3 | 4 | 5 | 6;
  /** Archetypes per week for the next month. weeks[0..2] = baseline, weeks[3] = deload. */
  weekly_pattern: { weeks: DayArchetype[][]; baseline: DayArchetype[]; deload: DayArchetype[] };
}

function detectBlockers(goal: ParsedGoal, injuries: ParsedInjuries): Blocker[] {
  const blockers: Blocker[] = [];
  const prohibited = new Set(
    injuries.constraints.flatMap((c) => c.prohibited_movements.map((m) => m.toLowerCase())),
  );

  const hasOverheadRestriction = [...prohibited].some((m) =>
    m.includes("overhead") || m.includes("press") || m.includes("snatch") || m.includes("jerk")
  );

  // CrossFit competitor goal + overhead restriction is a fundamental conflict.
  if (goal.primary_goal === "competitor" && hasOverheadRestriction) {
    blockers.push({
      kind: "goal_injury_conflict",
      description:
        "Competition-level CrossFit programming requires overhead pressing (snatch, jerk, push press, HSPU). The listed injury prohibits these movements.",
      suggested_resolution:
        "Either clear overhead movement with a medical professional and update the injury note, or change the goal to fitness or strength_and_power.",
    });
  }

  return blockers;
}

/**
 * Apply upward-only tier ratchet. If the previous tier was higher than the
 * newly-derived tier, keep the previous tier — never demote month-over-month
 * unless the athlete explicitly resets their profile.
 */
const TIER_RANK: Record<ExperienceTier, number> = {
  novice: 0,
  intermediate: 1,
  advanced: 2,
  competitor: 3,
};
const RANK_TO_TIER: ExperienceTier[] = ["novice", "intermediate", "advanced", "competitor"];

function ratchetTier(newTier: ExperienceTier, previousTier: ExperienceTier | null | undefined): ExperienceTier {
  if (!previousTier) return newTier;
  const newRank = TIER_RANK[newTier] ?? 0;
  const prevRank = TIER_RANK[previousTier] ?? 0;
  return RANK_TO_TIER[Math.max(newRank, prevRank)];
}

export function reconcileProfile(args: {
  goal: ParsedGoal;
  injuries: ParsedInjuries;
  levels: DomainLevels;
  self_perception_level: string | null;
  days_per_week: number | null | undefined;
  /** Previous month's effective tier — used for upward-only ratchet. */
  previous_tier?: ExperienceTier | null;
}): InterpretedProfile {
  const { goal, injuries, levels, self_perception_level, days_per_week, previous_tier } = args;
  const effective_tier = ratchetTier(levels.experience_tier, previous_tier ?? null);
  const calibration = calibrationDelta(self_perception_level, effective_tier);
  const blockers = detectBlockers(goal, injuries);
  const prohibited_movements = Array.from(
    new Set(injuries.constraints.flatMap((c) => c.prohibited_movements)),
  );
  const caution_movements = Array.from(
    new Set(injuries.constraints.flatMap((c) => c.caution_movements)),
  );
  const normalizedDays = normalizeDaysPerWeek(days_per_week);
  const monthlyPattern = getMonthlyPattern(goal.primary_goal, normalizedDays);
  return {
    goal,
    injuries,
    levels,
    self_perception_level,
    calibration,
    blockers,
    prohibited_movements,
    caution_movements,
    effective_tier,
    days_per_week: normalizedDays,
    weekly_pattern: {
      weeks: monthlyPattern.weeks,
      baseline: monthlyPattern.baseline,
      deload: monthlyPattern.deload,
    },
  };
}

/** Render the InterpretedProfile as a block of prompt text the generator consumes. */
export function formatInterpretedProfile(ip: InterpretedProfile): string {
  const lines: string[] = [];
  lines.push("INTERPRETED PROFILE:");
  lines.push("");
  lines.push("Goal:");
  lines.push(`  Primary: ${ip.goal.primary_goal}`);
  if (ip.goal.secondary_emphasis.length > 0) {
    lines.push(`  Secondary emphasis: ${ip.goal.secondary_emphasis.join(", ")}`);
  }
  if (ip.goal.time_horizon) lines.push(`  Time horizon: ${ip.goal.time_horizon}`);
  if (ip.goal.named_event) lines.push(`  Named event: ${ip.goal.named_event}`);
  if (ip.goal.emphasis_blocks.length > 0) {
    lines.push(`  Emphasis (most → least): ${ip.goal.emphasis_blocks.join(" → ")}`);
  }
  lines.push("");
  lines.push("Evidence-based levels:");
  lines.push(`  Strength overall: ${ip.levels.strength.overall}`);
  const liftDetails = Object.entries(ip.levels.strength.per_lift)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(", ");
  if (liftDetails) lines.push(`  By lift: ${liftDetails}`);
  lines.push(`  Skills: ${ip.levels.skills.overall} (${ip.levels.skills.proficient_count} intermediate+ of ${ip.levels.skills.total_rated} rated)`);
  lines.push(`  Conditioning: ${ip.levels.conditioning.overall} (${ip.levels.conditioning.benchmarks_present} benchmarks provided)`);
  lines.push(`  Experience tier (raw): ${ip.levels.experience_tier}`);
  if (ip.effective_tier !== ip.levels.experience_tier) {
    lines.push(`  Effective tier (after upward ratchet): ${ip.effective_tier}`);
  } else {
    lines.push(`  Effective tier: ${ip.effective_tier}`);
  }
  lines.push("");
  lines.push(`Schedule: ${ip.days_per_week} days/week`);
  lines.push(`Weekly pattern (Weeks 1-3): ${ip.weekly_pattern.baseline.map((a) => a).join(" → ")}`);
  lines.push(`Week 4 (deload): ${ip.weekly_pattern.deload.map((a) => a).join(" → ")}`);
  lines.push("");
  if (ip.self_perception_level && ip.self_perception_level !== "not_sure") {
    lines.push(`Self-perception: ${ip.self_perception_level}`);
    lines.push(`Calibration: ${ip.calibration.note}`);
    lines.push("");
  }
  if (ip.injuries.constraints.length > 0) {
    lines.push("Injury constraints:");
    lines.push(`  Summary: ${ip.injuries.summary}`);
    if (ip.prohibited_movements.length > 0) {
      lines.push(`  PROHIBITED (do NOT program): ${ip.prohibited_movements.join(", ")}`);
    }
    if (ip.caution_movements.length > 0) {
      lines.push(`  Caution (scale or choose variant): ${ip.caution_movements.join(", ")}`);
    }
    lines.push("");
  }
  if (ip.blockers.length > 0) {
    lines.push("Blockers (resolve with athlete before generating):");
    for (const b of ip.blockers) {
      lines.push(`  - ${b.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
