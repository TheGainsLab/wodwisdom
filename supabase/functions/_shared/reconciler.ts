/**
 * Profile reconciler — merges classifier outputs (goal, injuries) with
 * interpreter outputs (strength / skills / conditioning levels + experience
 * tier) into a single InterpretedProfile object the generator can consume.
 *
 * Pure data-shaping — no LLM calls. Also detects obvious hard blockers
 * (e.g., "CF competitor" + "no overhead pressing") for UI confirmation
 * before generation.
 */

import type { DomainLevels } from "./level-interpreter.ts";
import { calibrationDelta } from "./level-interpreter.ts";

export interface ParsedGoal {
  primary_goal: string;
  secondary_goals: string[];
  time_horizon: string | null;
  named_event: string | null;
  emphasis: string[];
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
  if (goal.primary_goal === "crossfit_competitor" && hasOverheadRestriction) {
    blockers.push({
      kind: "goal_injury_conflict",
      description:
        "Competition-level CrossFit programming requires overhead pressing (snatch, jerk, push press, HSPU). The listed injury prohibits these movements.",
      suggested_resolution:
        "Either clear overhead movement with a medical professional and update the injury note, or adjust the goal to a non-overhead-dependent track (e.g., strength_focused or hybrid).",
    });
  }

  // Competitor goal + no strict muscle-ups signaled in programming-worthy way
  // is a GAP, not a blocker — handled elsewhere. Don't block on it.

  return blockers;
}

export function reconcileProfile(args: {
  goal: ParsedGoal;
  injuries: ParsedInjuries;
  levels: DomainLevels;
  self_perception_level: string | null;
}): InterpretedProfile {
  const { goal, injuries, levels, self_perception_level } = args;
  const calibration = calibrationDelta(self_perception_level, levels.experience_tier);
  const blockers = detectBlockers(goal, injuries);
  const prohibited_movements = Array.from(
    new Set(injuries.constraints.flatMap((c) => c.prohibited_movements)),
  );
  const caution_movements = Array.from(
    new Set(injuries.constraints.flatMap((c) => c.caution_movements)),
  );
  return {
    goal,
    injuries,
    levels,
    self_perception_level,
    calibration,
    blockers,
    prohibited_movements,
    caution_movements,
  };
}

/** Render the InterpretedProfile as a block of prompt text the generator consumes. */
export function formatInterpretedProfile(ip: InterpretedProfile): string {
  const lines: string[] = [];
  lines.push("INTERPRETED PROFILE:");
  lines.push("");
  lines.push("Goal:");
  lines.push(`  Primary: ${ip.goal.primary_goal}`);
  if (ip.goal.secondary_goals.length > 0) {
    lines.push(`  Secondary: ${ip.goal.secondary_goals.join(", ")}`);
  }
  if (ip.goal.time_horizon) lines.push(`  Time horizon: ${ip.goal.time_horizon}`);
  if (ip.goal.named_event) lines.push(`  Named event: ${ip.goal.named_event}`);
  if (ip.goal.emphasis.length > 0) {
    lines.push(`  Emphasis (most → least): ${ip.goal.emphasis.join(" → ")}`);
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
  lines.push(`  Experience tier: ${ip.levels.experience_tier}`);
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
