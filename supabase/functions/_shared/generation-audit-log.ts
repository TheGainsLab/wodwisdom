/**
 * generation-audit-log.ts
 *
 * Persistent audit trail for program generation (table: generation_audit_log).
 *
 * The doctrine (2026-08-11): audits enforce CONTRACTS; warning-tier findings
 * are DATA WITH AN OBLIGATION — a recurring warning class earns the next
 * ruling by observed collision, not by argument. That obligation needs memory,
 * and edge-function console logs expire. Every accepted violation, warning,
 * and retry event lands here as one row per stage outcome.
 *
 * Best-effort by design: a log-write failure must never fail a generation
 * (never-fail doctrine). Errors are console-logged and swallowed. Stages can
 * re-execute after a crash, so duplicate rows are possible — this is a log,
 * not state; analysis queries should tolerate them.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface GenerationAuditEntry {
  user_id: string;
  program_id?: string | null;
  month_number?: number | null;
  /** Pipeline stage that produced the finding. */
  stage: "metcons" | "fill_residual" | "soft_audit" | "duration_plan" | "skeleton_mix";
  violations?: string[];
  warnings?: string[];
  retried?: boolean;
  meta?: Record<string, unknown>;
}

/** True when the entry carries a signal worth a row — callers skip the write
 *  entirely for clean, unretried outcomes so the table stays findings-only. */
export function auditEntryHasSignal(entry: GenerationAuditEntry): boolean {
  return !!entry.retried ||
    (entry.violations?.length ?? 0) > 0 ||
    (entry.warnings?.length ?? 0) > 0;
}

/** Flatten structured audit failures ({rule, violations[]}) into the flat
 *  "rule: detail" strings the log stores. Tolerates unknown shapes — a failure
 *  we can't destructure is still worth a row, stringified. */
export function formatAuditFailuresForLog(failures: unknown[]): string[] {
  const lines: string[] = [];
  for (const f of failures) {
    const rec = f as { rule?: unknown; violations?: unknown };
    const rule = typeof rec?.rule === "string" ? rec.rule : "unknown_rule";
    const violations = Array.isArray(rec?.violations)
      ? rec.violations.filter((v): v is string => typeof v === "string")
      : [];
    if (violations.length === 0) {
      lines.push(`${rule}: ${JSON.stringify(f)}`);
    } else {
      for (const v of violations) lines.push(`${rule}: ${v}`);
    }
  }
  return lines;
}

export async function logGenerationAudit(
  supa: SupabaseClient,
  entry: GenerationAuditEntry,
): Promise<void> {
  if (!auditEntryHasSignal(entry)) return;
  try {
    const { error } = await supa.from("generation_audit_log").insert({
      user_id: entry.user_id,
      program_id: entry.program_id ?? null,
      month_number: entry.month_number ?? null,
      stage: entry.stage,
      violations: entry.violations ?? [],
      warnings: entry.warnings ?? [],
      retried: entry.retried ?? false,
      meta: entry.meta ?? {},
    });
    if (error) {
      console.warn(`[generation-audit-log] write failed (non-fatal, stage=${entry.stage}):`, error.message);
    }
  } catch (e) {
    console.warn(`[generation-audit-log] write failed (non-fatal, stage=${entry.stage}):`, e);
  }
}
