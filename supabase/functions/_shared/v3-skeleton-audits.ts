/**
 * v3-skeleton-audits.ts
 *
 * Deterministic audits for the v3 skeleton-writer output. These run
 * before the per-week fill calls — catch structural problems at the
 * skeleton layer so we don't waste fill-call tokens on a bad scaffold.
 *
 * Audit set:
 *   - structural_integrity — top-level weeks + month_plan present
 *   - day_count             — exactly 4 weeks × days_per_week days, unique nums
 *   - block_type_enum       — every block_type in the canonical 8-enum
 *   - cycle_coverage        — every day has strength + accessory + metcon
 *   - strength_fields       — strength days populate primary_lift + strength_scheme
 *   - back_to_back_primary_lift — same primary lift can't repeat on consecutive days
 *
 * Pure functions. No IO. Defensive against missing arrays (Anthropic
 * tool_use schema enforcement is imperfect — see audits.ts notes).
 */

import { BLOCK_TYPES } from "./v2-output-schema.ts";
import type {
  DaySkeleton,
  SkeletonOutput,
  WeekSkeleton,
} from "./v3-output-schema.ts";

export interface SkeletonAuditResult {
  rule: string;
  passed: boolean;
  violations: string[];
}

export interface SkeletonAuditContext {
  skeleton: SkeletonOutput;
  daysPerWeek: number;
}

// ============================================================
// Defensive shape helpers
// ============================================================

function safeWeeks(s: SkeletonOutput): WeekSkeleton[] {
  return Array.isArray((s as { weeks?: unknown }).weeks) ? s.weeks : [];
}
function safeDays(w: WeekSkeleton): DaySkeleton[] {
  return Array.isArray((w as { days?: unknown }).days) ? w.days : [];
}
function safeBlockTypes(d: DaySkeleton): string[] {
  return Array.isArray((d as { block_types?: unknown }).block_types)
    ? (d.block_types as string[])
    : [];
}

// ============================================================
// Individual audits
// ============================================================

export function auditSkeletonStructural(skeleton: SkeletonOutput): SkeletonAuditResult {
  const violations: string[] = [];
  if (!Array.isArray((skeleton as { weeks?: unknown }).weeks)) {
    violations.push("Skeleton is missing the top-level `weeks` array.");
  }
  if (!skeleton.month_plan || typeof skeleton.month_plan !== "object") {
    violations.push("Skeleton is missing the top-level `month_plan` object.");
  }
  return { rule: "structural_integrity", passed: violations.length === 0, violations };
}

export function auditSkeletonDayCount(
  skeleton: SkeletonOutput,
  daysPerWeek: number,
): SkeletonAuditResult {
  const violations: string[] = [];
  const weeks = safeWeeks(skeleton);

  if (weeks.length !== 4) {
    violations.push(`Skeleton has ${weeks.length} weeks; expected exactly 4.`);
  }

  const seenWeekNums = new Set<number>();
  for (const week of weeks) {
    if (week.week_num < 1 || week.week_num > 4) {
      violations.push(`Week_num ${week.week_num} is out of range (expected 1..4).`);
    }
    if (seenWeekNums.has(week.week_num)) {
      violations.push(`Duplicate week_num: ${week.week_num}.`);
    }
    seenWeekNums.add(week.week_num);

    const days = safeDays(week);
    if (days.length !== daysPerWeek) {
      violations.push(
        `Week ${week.week_num} has ${days.length} days; expected exactly ${daysPerWeek}.`,
      );
    }

    const seenDayNums = new Set<number>();
    for (const day of days) {
      if (day.day_num < 1 || day.day_num > daysPerWeek) {
        violations.push(
          `Week ${week.week_num} day_num ${day.day_num} is out of range (expected 1..${daysPerWeek}).`,
        );
      }
      if (seenDayNums.has(day.day_num)) {
        violations.push(`Week ${week.week_num} duplicate day_num: ${day.day_num}.`);
      }
      seenDayNums.add(day.day_num);
    }
  }
  return { rule: "day_count", passed: violations.length === 0, violations };
}

export function auditSkeletonBlockTypeEnum(skeleton: SkeletonOutput): SkeletonAuditResult {
  const allowed = new Set<string>(BLOCK_TYPES);
  const violations: string[] = [];
  for (const week of safeWeeks(skeleton)) {
    for (const day of safeDays(week)) {
      for (const bt of safeBlockTypes(day)) {
        if (!allowed.has(bt)) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num}: block_type "${bt}" is not in the canonical 8-enum (${BLOCK_TYPES.join(", ")}).`,
          );
        }
      }
    }
  }
  return { rule: "block_type_enum", passed: violations.length === 0, violations };
}

export function auditSkeletonCoverage(skeleton: SkeletonOutput): SkeletonAuditResult {
  const violations: string[] = [];
  for (const week of safeWeeks(skeleton)) {
    for (const day of safeDays(week)) {
      const types = new Set(safeBlockTypes(day));
      if (!types.has("strength")) {
        violations.push(
          `Week ${week.week_num} Day ${day.day_num}: missing required strength block.`,
        );
      }
      if (!types.has("accessory")) {
        violations.push(
          `Week ${week.week_num} Day ${day.day_num}: missing required accessory block.`,
        );
      }
      if (!types.has("metcon")) {
        violations.push(
          `Week ${week.week_num} Day ${day.day_num}: missing required metcon block.`,
        );
      }
    }
  }
  return { rule: "cycle_coverage", passed: violations.length === 0, violations };
}

export function auditSkeletonStrengthFields(skeleton: SkeletonOutput): SkeletonAuditResult {
  const violations: string[] = [];
  for (const week of safeWeeks(skeleton)) {
    for (const day of safeDays(week)) {
      const types = safeBlockTypes(day);
      if (types.includes("strength")) {
        if (!day.primary_lift || day.primary_lift.trim() === "") {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num}: strength block present but primary_lift is missing or empty.`,
          );
        }
        if (!day.strength_scheme || day.strength_scheme.trim() === "") {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num}: strength block present but strength_scheme is missing or empty.`,
          );
        }
      }
    }
  }
  return { rule: "strength_fields", passed: violations.length === 0, violations };
}

export function auditSkeletonBackToBack(skeleton: SkeletonOutput): SkeletonAuditResult {
  const violations: string[] = [];
  for (const week of safeWeeks(skeleton)) {
    const days = safeDays(week).slice().sort((a, b) => a.day_num - b.day_num);
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1];
      const curr = days[i];
      if (prev.day_num + 1 !== curr.day_num) continue; // not actually consecutive
      if (!prev.primary_lift || !curr.primary_lift) continue;
      const a = prev.primary_lift.trim().toLowerCase();
      const b = curr.primary_lift.trim().toLowerCase();
      if (a === b) {
        violations.push(
          `Week ${week.week_num} Day ${prev.day_num} → Day ${curr.day_num}: same primary_lift "${prev.primary_lift}" on consecutive days. Vary the strength stimulus.`,
        );
      }
    }
  }
  return { rule: "back_to_back_primary_lift", passed: violations.length === 0, violations };
}

// ============================================================
// Runner
// ============================================================

export interface SkeletonAuditRunResult {
  passed: boolean;
  failures: SkeletonAuditResult[];
  all: SkeletonAuditResult[];
}

export function runSkeletonAudits(ctx: SkeletonAuditContext): SkeletonAuditRunResult {
  // Structural pre-check — if weeks isn't an array, downstream audits
  // can't iterate meaningfully. Short-circuit cleanly.
  const structural = auditSkeletonStructural(ctx.skeleton);
  if (!structural.passed) {
    return { passed: false, failures: [structural], all: [structural] };
  }
  const all: SkeletonAuditResult[] = [
    auditSkeletonDayCount(ctx.skeleton, ctx.daysPerWeek),
    auditSkeletonBlockTypeEnum(ctx.skeleton),
    auditSkeletonCoverage(ctx.skeleton),
    auditSkeletonStrengthFields(ctx.skeleton),
    auditSkeletonBackToBack(ctx.skeleton),
  ];
  const failures = all.filter((r) => !r.passed);
  return { passed: failures.length === 0, failures, all };
}

export function formatSkeletonViolationsForRetry(failures: SkeletonAuditResult[]): string {
  if (failures.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    "Your previous skeleton failed structural audits. Fix these violations in your regenerated skeleton. Do NOT explain — just emit a corrected skeleton via the emit_skeleton tool.",
  );
  lines.push("");
  for (const failure of failures) {
    lines.push(`[${failure.rule}]`);
    for (const v of failure.violations) {
      lines.push(`  - ${v}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function summarizeSkeletonAuditRun(result: SkeletonAuditRunResult): string {
  const parts = result.all.map(
    (r) => `${r.rule}=${r.passed ? "ok" : `FAIL(${r.violations.length})`}`,
  );
  return parts.join(" ");
}
