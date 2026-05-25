/**
 * audit-runner.ts
 *
 * Dispatches the 7 deterministic audits against a parsed WriterOutput,
 * collects results, and provides a retry-prompt formatter for feeding
 * failures back into the writer on regeneration.
 *
 * The 8th audit (LLM-mediated safety review) is async and lives in its
 * own module; it can be composed by the caller after the deterministic
 * pass succeeds.
 */

import {
  ALL_AUDITS,
  SOFT_AUDITS,
  type AuditContext,
  type AuditResult,
} from "./audits.ts";

export interface AuditRunResult {
  /** True when every audit passed. */
  passed: boolean;
  /** Audits that failed — empty when passed. */
  failures: AuditResult[];
  /** Every audit's result (passed + failed). Useful for logging. */
  all: AuditResult[];
}

/**
 * Run all 7 deterministic audits against the writer output. Pure
 * function — synchronous, no IO. Caller is responsible for awaiting
 * the separate LLM safety review when appropriate.
 */
export function runAudits(ctx: AuditContext): AuditRunResult {
  // Structural pre-check: if the writer's output is missing top-level
  // weeks entirely (Anthropic tool_use occasionally lets this slip
  // through under heavy prompt load), short-circuit with a clean
  // structural violation. Individual audits also defend against missing
  // nested arrays, but failing here gives the retry loop a focused
  // message: "your output had no weeks array, regenerate."
  const structural = preflightStructural(ctx);
  if (structural) {
    return { passed: false, failures: [structural], all: [structural] };
  }
  const all = ALL_AUDITS.map((fn) => fn(ctx));
  const failures = all.filter((r) => !r.passed);
  return { passed: failures.length === 0, failures, all };
}

function preflightStructural(ctx: AuditContext): AuditResult | null {
  const out = ctx.output as { weeks?: unknown; month_plan?: unknown };
  const violations: string[] = [];
  if (!Array.isArray(out.weeks)) {
    violations.push(
      "Output is missing the top-level `weeks` array. Every output must include weeks[] with 4 entries.",
    );
  } else if (out.weeks.length === 0) {
    violations.push("Output `weeks` array is empty. Must contain 4 weeks.");
  }
  if (!out.month_plan || typeof out.month_plan !== "object") {
    violations.push("Output is missing the top-level `month_plan` object.");
  }
  if (violations.length === 0) return null;
  return { rule: "structural_integrity", passed: false, violations };
}

/**
 * Format failed audit results as a string the writer can read on its
 * retry attempt. The writer's regenerate prompt should include this
 * block above the original user message so it sees what failed and
 * fixes it.
 *
 * Returns empty string when there are no failures.
 */
export function formatViolationsForRetry(failures: AuditResult[]): string {
  if (failures.length === 0) return "";

  const lines: string[] = [];
  lines.push(
    "Your previous output failed automated audit checks. Fix these violations in your regenerated program. Do NOT explain or apologize — just emit a corrected program via the emit_program tool.",
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

/**
 * Convenience for logging — short single-line summary of which rules
 * passed and which failed.
 */
export function summarizeAuditRun(result: AuditRunResult): string {
  const parts = result.all.map((r) => `${r.rule}=${r.passed ? "ok" : `FAIL(${r.violations.length})`}`);
  return parts.join(" ");
}

/**
 * Run SOFT audits — log-only checks that never block save. Use when an
 * upstream fix (e.g., roundToPlateMath at insert time) should have caught
 * an issue but we want a safety-net check. Call this AFTER the program
 * has been saved; surface violations to logs so we can spot regressions
 * in the upstream fix.
 */
export function runSoftAudits(ctx: AuditContext): AuditRunResult {
  const all = SOFT_AUDITS.map((fn) => fn(ctx));
  const failures = all.filter((r) => !r.passed);
  return { passed: failures.length === 0, failures, all };
}
