/**
 * plan-fidelity — a written week is checked against the plan it was told to
 * execute (2026-11-23).
 *
 * Until now nothing compared the written days with their skeleton days: the
 * fill could drop the strength, accessory or skills block, or train a
 * different lift than the planned primary_lift, and it shipped. The only
 * presence check was "has a metcon".
 *
 * One rule, in the existing audit framework's shape (AuditResult, routed by
 * AUDIT_KIND in audits.ts):
 *
 *   plan_block_types   (structural-writer) a planned block type is missing
 *       from the day. A missing block has nothing for a block rewrite to work
 *       on (the same reason metcon_presence is structural), so it is recorded
 *       in the generation audit log as a residual.
 *
 * REMOVED 2026-11-26 (founder): plan_primary_lift, which compared the planned
 * lift's name with the strength block's first movement by word families and
 * sent a mismatch for a rewrite. It never fired, and matching by name cannot
 * tell a Clean written for a planned Clean and Jerk, or the first lift of a
 * complex, from a wrong lift. The writer is still told the planned lift is
 * decided; no code compares the names.
 *
 * WHERE IT RUNS: with the hard audits, in the benchmark_audit and surgical
 * stages of generate-program-v3 — BEFORE the fit gate and the restriction
 * gate. Those gates remove on purpose (the fit gate may drop the accessory
 * block for a session under 45 minutes). This check never sees their output,
 * so it can neither flag nor undo a deliberate removal. Do not call it after
 * the gates.
 */

import type { AuditResult } from "./audits.ts";
import type { WriterOutput } from "./v2-output-schema.ts";

interface PlanDay {
  day_num: number;
  block_types?: string[];
}
interface Plan {
  weeks?: Array<{ week_num: number; days?: PlanDay[] }>;
}

function planDay(plan: Plan | null | undefined, weekNum: number, dayNum: number): PlanDay | null {
  for (const w of plan?.weeks ?? []) {
    if (w.week_num !== weekNum) continue;
    for (const d of w.days ?? []) if (d.day_num === dayNum) return d;
  }
  return null;
}

/** A planned block type is missing from the written day. Extra blocks are not
 *  a violation; days with no plan (no skeleton, or an ingested program) pass. */
export function auditPlanBlockTypes(output: WriterOutput, plan: Plan | null | undefined): AuditResult {
  const violations: string[] = [];
  if (plan) {
    for (const week of output.weeks ?? []) {
      for (const day of week.days ?? []) {
        const planned = planDay(plan, week.week_num, day.day_num);
        if (!planned) continue;
        const written = new Set((day.blocks ?? []).map((b) => b.block_type as string));
        const missing = [...new Set(planned.block_types ?? [])].filter((t) => !written.has(t));
        if (missing.length > 0) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num}: planned block type${missing.length === 1 ? "" : "s"} missing from the written day: ${missing.join(", ")} ` +
              `(planned: ${(planned.block_types ?? []).join(", ")}; written: ${[...written].join(", ") || "nothing"}).`,
          );
        }
      }
    }
  }
  return { rule: "plan_block_types", passed: violations.length === 0, violations };
}

/** The plan check, for the stages that run the hard audits. */
export function auditWeekAgainstPlan(output: WriterOutput, plan: Plan | null | undefined): AuditResult[] {
  return [auditPlanBlockTypes(output, plan)];
}

/** An audit run with the plan checks folded in (same shape as runAudits'). */
export function withPlanChecks<R extends { passed: boolean; failures: AuditResult[]; all: AuditResult[] }>(
  run: R,
  output: WriterOutput,
  plan: Plan | null | undefined,
): R {
  const extra = auditWeekAgainstPlan(output, plan);
  const failures = [...run.failures, ...extra.filter((r) => !r.passed)];
  return { ...run, passed: failures.length === 0, failures, all: [...run.all, ...extra] };
}
