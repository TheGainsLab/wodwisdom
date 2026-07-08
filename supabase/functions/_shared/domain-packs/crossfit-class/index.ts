/**
 * domain-packs/crossfit-class — the 60-minute GROUP CLASS variant of the
 * CrossFit pack, id "crossfit_class@1".
 *
 * Why a variant pack: the base crossfit@3 day template (strength + accessory +
 * metcon every day, enforced by prompt recap AND the cycle_coverage audit) is a
 * personal-training session — ~70-85 minutes. A gym class runs on a fixed
 * clock. The 2026-07-07 shakedown proved the conflict is unwinnable as
 * written: the session-budget audit told the writer "fewer blocks" while
 * cycle_coverage hard-failed any day missing accessory.
 *
 * The class day template (owner decision, 2026-07-07):
 *   warm-up (daily) → ONE focus block: strength OR skills (owner's weekly
 *   split) → metcon (daily; monostructural welcome) → cool-down (present but
 *   NOT counted against the class hour).
 *
 * Everything except the day-composition recap + coverage audit is inherited
 * from crossfit@3 unchanged — same writer prompts, same week-fill, same hard/
 * soft audits, same recovery/safety/finish/scaling. Retail keeps crossfit@3;
 * nothing here is reachable from the retail path.
 */

import type { DomainPack } from "../types.ts";
import type { TrainingDesignInput } from "../../training-design-input.ts";
import type { SkeletonOutput } from "../../v3-output-schema.ts";
import {
  auditSkeletonAllocation,
  auditSkeletonBackToBack,
  auditSkeletonBlockTypeEnum,
  auditSkeletonDayCount,
  auditSkeletonStrengthFields,
  auditSkeletonStructural,
  type SkeletonAuditContext,
  type SkeletonAuditResult,
  type SkeletonAuditRunResult,
} from "../../v3-skeleton-audits.ts";
import { CROSSFIT_PACK } from "../crossfit/index.ts";

/** Default weekly focus split when the owner hasn't set one: 2 skills days on
 *  a 5-6 day week, 1 below that; the rest strength. */
export function defaultClassFocusSplit(daysPerWeek: number): { strength_days: number; skills_days: number } {
  const skills = daysPerWeek >= 5 ? 2 : 1;
  return { strength_days: daysPerWeek - skills, skills_days: skills };
}

function resolveSplit(tdi: TrainingDesignInput): { strength_days: number; skills_days: number } {
  const requested = tdi.class_focus_split;
  if (!requested) return defaultClassFocusSplit(tdi.days_per_week);
  const skills = Math.min(
    Math.max(0, Math.round(requested.skills_days ?? 0)),
    Math.max(0, tdi.days_per_week - 1), // at least one strength day
  );
  return { strength_days: tdi.days_per_week - skills, skills_days: skills };
}

function classSkeletonRuleRecap(daysPerWeek: number, tdi: TrainingDesignInput): string {
  const split = resolveSplit(tdi);
  const budget = tdi.session_length_minutes;
  const budgetLine = budget
    ? `- THE CLASS CLOCK: warm-up + focus block + metcon must fit ${budget} minutes together (cool-down is NOT counted). Warm-up ≈10 min and a strength focus ≈15-20 min, so state every metcon_focus's intended minutes explicitly and keep them ≤ ${Math.max(10, Math.round(budget / 3))} min on strength-focus days; longer metcons belong on skills-focus days.`
    : "- State every metcon_focus's intended minutes explicitly.";
  return [
    "=== KEY RULES (re-check before emit) ===",
    `- Output exactly 4 weeks × ${daysPerWeek} days. day_num is 1..${daysPerWeek}.`,
    "- This is a GROUP CLASS program on a fixed clock, NOT a personal training session. Every day's block_types are exactly: warm-up, ONE focus block (strength OR skills — never both, never neither), metcon, cool-down. NO accessory blocks, NO second focus block.",
    `- Weekly focus split: ${split.strength_days} strength-focus days and ${split.skills_days} skills-focus days per week (the owner's choice). Skills-focus days carry the gymnastics/skill development.`,
    "- Every day includes a metcon. Monostructural metcons (row / bike / ski / run intervals) are welcome and count — use them for aerobic days.",
    budgetLine,
    "- Emit STRUCTURE ONLY — no sets / reps / weight / movement names. Those are filled in subsequent per-week calls.",
    "- primary_lift uses canonical display names (Back Squat, Deadlift, Snatch, Clean and Jerk, etc.) or a complex description.",
    "- ALLOCATE the given priorities/maintain/deprioritize — never invent, promote, or drop one. Every priority must appear in the structure; no block built around a deprioritized focus.",
    "- Honor do_not_program when picking primary_lift / metcon_focus / skill_focus.",
  ].join("\n");
}

/** Class coverage: warm-up + exactly one focus (strength XOR skills) + metcon;
 *  accessory is not a class block. Replaces base cycle_coverage. */
export function auditClassCoverage(skeleton: SkeletonOutput): SkeletonAuditResult {
  const violations: string[] = [];
  for (const week of skeleton.weeks ?? []) {
    for (const day of week.days ?? []) {
      const types = day.block_types ?? [];
      const set = new Set(types);
      if (!set.has("warm-up")) {
        violations.push(`Week ${week.week_num} Day ${day.day_num}: missing required warm-up block.`);
      }
      if (!set.has("metcon")) {
        violations.push(`Week ${week.week_num} Day ${day.day_num}: missing required metcon block.`);
      }
      const hasStrength = set.has("strength");
      const hasSkills = set.has("skills");
      if (hasStrength && hasSkills) {
        violations.push(
          `Week ${week.week_num} Day ${day.day_num}: has BOTH strength and skills blocks — a class day carries exactly ONE focus block.`,
        );
      }
      if (!hasStrength && !hasSkills) {
        violations.push(
          `Week ${week.week_num} Day ${day.day_num}: has neither a strength nor a skills block — a class day carries exactly ONE focus block.`,
        );
      }
      if (set.has("accessory")) {
        violations.push(
          `Week ${week.week_num} Day ${day.day_num}: accessory blocks are not part of the class day template — fold that work into the focus block or the metcon.`,
        );
      }
    }
  }
  return { rule: "class_coverage", passed: violations.length === 0, violations };
}

/** The base skeleton audit runner with cycle_coverage swapped for
 *  class_coverage. Everything else (day_count, block enum, strength fields,
 *  back-to-back lift, allocation invariants) is the base audit, reused. */
function runClassSkeletonAudits(ctx: SkeletonAuditContext): SkeletonAuditRunResult {
  const structural = auditSkeletonStructural(ctx.skeleton);
  if (!structural.passed) {
    return { passed: false, failures: [structural], all: [structural] };
  }
  const all: SkeletonAuditResult[] = [
    auditSkeletonDayCount(ctx.skeleton, ctx.daysPerWeek),
    auditSkeletonBlockTypeEnum(ctx.skeleton),
    auditClassCoverage(ctx.skeleton),
    auditSkeletonStrengthFields(ctx.skeleton),
    auditSkeletonBackToBack(ctx.skeleton),
  ];
  if (ctx.trainingDesignInput) {
    all.push(auditSkeletonAllocation(ctx.skeleton, ctx.trainingDesignInput));
  }
  const failures = all.filter((r) => !r.passed);
  return { passed: failures.length === 0, failures, all };
}

export const CROSSFIT_CLASS_PACK: DomainPack = {
  ...CROSSFIT_PACK,
  id: "crossfit_class@1",
  sport: "crossfit_class",
  version: "1",
  writer: {
    ...CROSSFIT_PACK.writer,
    skeletonRuleRecap: classSkeletonRuleRecap,
  },
  audits: {
    ...CROSSFIT_PACK.audits,
    runSkeleton: runClassSkeletonAudits,
  },
};
