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
import type { TrainingDesignInput } from "./training-design-input.ts";
import { checkAllocationInvariants } from "./training-design-invariants.ts";
import {
  machineRowM4,
  machineRowM6,
  machineRowM8,
  type MachineRowResult,
} from "./stage3-machine-rows.ts";

export interface SkeletonAuditResult {
  rule: string;
  passed: boolean;
  violations: string[];
}

export interface SkeletonAuditContext {
  skeleton: SkeletonOutput;
  daysPerWeek: number;
  /** When present, the allocation invariants run — the skeleton's declared
   *  block_intents must faithfully execute this plan (Step 3). */
  trainingDesignInput?: TrainingDesignInput;
}

/**
 * Metcon time-domain mix (athlete-match package, 2026-08-31) — the
 * deterministic mirror of the skeleton prompt's METCON TIME-DOMAIN MIX rule,
 * which was the clause that failed hardest in the 2026-08-31 review (an
 * "engine" goal produced four long slots + one medium per week, zero short).
 *
 * DELIBERATELY NOT part of runSkeletonAudits: that loop hard-fails the job on
 * exhaustion, and this is a quality rule, not a contract. The caller
 * (stageSkeleton) runs it separately — one retry, then accept-and-log — the
 * same tier as the composer's variety fence.
 *
 * Checks per week (weeks with 3+ metcon days):
 *   - every domain present (≥1 short, ≥1 medium, ≥1 long) — deload included
 *   - no domain over ceil(n/3)+1 slots (a priority moves at most ~one slot)
 */
export function auditSkeletonMetconMix(skeleton: SkeletonOutput): SkeletonAuditResult {
  const violations: string[] = [];
  const parseDomain = (focus: string): "short" | "medium" | "long" => {
    const f = (focus ?? "").toLowerCase();
    const m = f.match(/\((\d+)(?:\s*[-–—]\s*(\d+))?\s*min/);
    if (m) {
      const upper = parseInt(m[2] ?? m[1], 10);
      return upper <= 8 ? "short" : upper <= 15 ? "medium" : "long";
    }
    if (/\bshort\b/.test(f)) return "short";
    if (/\blong\b/.test(f)) return "long";
    return "medium";
  };
  for (const wk of skeleton.weeks ?? []) {
    const domains = (wk.days ?? [])
      .filter((d) => (d.block_types ?? []).includes("metcon") && d.metcon_focus)
      .map((d) => parseDomain(d.metcon_focus!));
    const n = domains.length;
    if (n < 3) continue;
    const count = { short: 0, medium: 0, long: 0 };
    for (const d of domains) count[d]++;
    for (const dom of ["short", "medium", "long"] as const) {
      if (count[dom] === 0) {
        violations.push(
          `Week ${wk.week_num}: no ${dom} metcon across ${n} conditioning days — every week spans all three time domains (a priority biases dose within a domain, never eliminates one).`,
        );
      }
    }
    const cap = Math.ceil(n / 3) + 1;
    for (const dom of ["short", "medium", "long"] as const) {
      if (count[dom] > cap) {
        violations.push(
          `Week ${wk.week_num}: ${count[dom]}/${n} metcons are ${dom} (cap ${cap}) — a conditioning priority moves at most one slot toward its domain; express the rest as dose within the domain.`,
        );
      }
    }
  }
  return { rule: "metcon_time_domain_mix", passed: violations.length === 0, violations };
}

/**
 * Part D (2026-08-31) — the ENTITLEMENT gate for dedicated cardio, applied in
 * CODE because entitlements are facts: an Engine-entitled athlete must never
 * receive a cardio block even if the skeleton emits one (Engine IS their
 * dedicated conditioning product). Removes cardio from block_types,
 * block_minutes, and block_intents on every day; returns the stripped
 * locations for the log. Mutates the skeleton.
 */
export function stripCardioBlocks(skeleton: SkeletonOutput): string[] {
  const stripped: string[] = [];
  for (const wk of skeleton.weeks ?? []) {
    for (const day of wk.days ?? []) {
      // deno-lint-ignore no-explicit-any
      const d = day as any;
      if ((d.block_types ?? []).includes("cardio")) {
        stripped.push(`W${wk.week_num}D${day.day_num}`);
        d.block_types = (d.block_types ?? []).filter((b: string) => b !== "cardio");
        if (Array.isArray(d.block_minutes)) {
          d.block_minutes = d.block_minutes.filter((b: { block_type?: string }) => b?.block_type !== "cardio");
        }
        if (Array.isArray(d.block_intents)) {
          d.block_intents = d.block_intents.filter((b: { block_type?: string }) => b?.block_type !== "cardio");
        }
      }
    }
  }
  return stripped;
}

/**
 * Part D — LOG-ONLY cardio plan check (never blocks, never retries; the
 * limits are ceilings the prompt states and this observes):
 *   - any cardio block without a typed dedicated_cardio authorization
 *   - more than 1 cardio block on a day / more than 3 in a week
 *   - a block outside 10-30 minutes (when block_minutes present)
 *   - cardio over 25% of weekly minutes (only when a session budget exists)
 *   - max-dose weeks (3 blocks) when the authorizing priority isn't rank 1
 */
export function auditCardioPlan(
  skeleton: SkeletonOutput,
  authorized: { source_priority_rank: number } | null | undefined,
  sessionLengthMinutes: number | null,
  daysPerWeek: number,
): string[] {
  const lines: string[] = [];
  const weeklyBudget = sessionLengthMinutes && sessionLengthMinutes > 0
    ? sessionLengthMinutes * daysPerWeek
    : null;
  for (const wk of skeleton.weeks ?? []) {
    let weekCount = 0;
    let weekMinutes = 0;
    for (const day of wk.days ?? []) {
      // deno-lint-ignore no-explicit-any
      const d = day as any;
      const dayCount = (d.block_types ?? []).filter((b: string) => b === "cardio").length;
      if (dayCount === 0) continue;
      weekCount += dayCount;
      if (dayCount > 1) lines.push(`W${wk.week_num}D${day.day_num}: ${dayCount} cardio blocks (cap 1/day)`);
      if (!authorized) lines.push(`W${wk.week_num}D${day.day_num}: cardio block WITHOUT typed dedicated_cardio authorization — cardio is never a default`);
      const mins = (d.block_minutes ?? []).find((b: { block_type?: string }) => b?.block_type === "cardio")?.minutes;
      if (typeof mins === "number") {
        weekMinutes += mins;
        if (mins < 10 || mins > 30) lines.push(`W${wk.week_num}D${day.day_num}: cardio block ${mins} min (band 10-30)`);
      }
    }
    if (weekCount > 3) lines.push(`Week ${wk.week_num}: ${weekCount} cardio blocks (cap 3/week)`);
    if (weekCount >= 3 && authorized && authorized.source_priority_rank > 1) {
      lines.push(`Week ${wk.week_num}: max cardio dose (${weekCount}/week) but the authorizing priority is rank ${authorized.source_priority_rank} — ceilings are for rank 1`);
    }
    if (weeklyBudget && weekMinutes > weeklyBudget * 0.25) {
      lines.push(`Week ${wk.week_num}: ${weekMinutes} cardio min of ${weeklyBudget} weekly (cap 25% = ${Math.round(weeklyBudget * 0.25)})`);
    }
  }
  return lines;
}

/** Allocation invariants — the skeleton's declared block_intents must match the
 *  TrainingDesignInput (every priority developed, no deprioritized develop, etc.).
 *  Warnings are logged via violations only when hard; soft warnings are dropped
 *  here (the runner surfaces them separately if needed). */
export function auditSkeletonAllocation(
  skeleton: SkeletonOutput,
  tdi: TrainingDesignInput,
): SkeletonAuditResult {
  const r = checkAllocationInvariants(tdi, skeleton);
  return { rule: "allocation_intent", passed: r.passed, violations: r.violations };
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
      // Active-recovery exception (2026-08-10): the prompt explicitly permits
      // dedicated recovery days "replacing strength + metcon" — the audit must
      // not contradict it. Accessory is still required (light touches remain).
      if (types.has("active-recovery")) {
        if (!types.has("accessory")) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num}: active-recovery day still requires an accessory block for light touches.`,
          );
        }
        continue;
      }
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
  // Allocation invariants — only when the plan is available to check against.
  if (ctx.trainingDesignInput) {
    all.push(auditSkeletonAllocation(ctx.skeleton, ctx.trainingDesignInput));
    // Machine rows graduated from the 2026-08 shadow-test series — each earned
    // by a real failure (M4: dose re-weighting; M6: plan text promising lifts
    // the days never program; M7: metcons that can't fit the session; M8:
    // phantom blocks invisible to allocation accounting). M4 warnings are
    // logged, never fail — placement across block types is coaching freedom.
    // M7 (session budget) was DELETED 2026-08-11: session duration is not a
    // programming concept for individual athletes (the athlete owns their
    // clock; the in-app AI Coach is the adjustment lever).
    const tdi = ctx.trainingDesignInput;
    const rows: MachineRowResult[] = [
      machineRowM4(ctx.skeleton, tdi),
      machineRowM6(ctx.skeleton),
      machineRowM8(ctx.skeleton),
    ];
    for (const row of rows) {
      if (row.warnings?.length) {
        console.log(`[skeleton audit ${row.id}] warnings: ${row.warnings.join(" | ")}`);
      }
      all.push({ rule: `machine_row_${row.id.toLowerCase()}`, passed: row.passed, violations: row.violations });
    }
  }
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
