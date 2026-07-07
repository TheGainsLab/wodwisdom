/**
 * gym-session-budget.ts — the gym-local session-time budget audit.
 *
 * A CLASS runs on a clock. The first real generation (2026-07-07) proved the
 * skeleton prompt's session-length guidance is advisory-only: with a 60-min
 * budget it emitted 75-85 min days (28-min-cap chippers after 5×5 + skills
 * EMOM + accessory) — the structural audits never sum a day's time, so nothing
 * pushed back. This audit does: estimate each skeleton day's minutes from its
 * block list, so gym-generate can make the writer retry days that blow the
 * budget.
 *
 * Estimates are deliberately coach-conservative heuristics (a metcon_focus
 * with no stated minutes falls back by time-domain keyword); findings are
 * warnings-material, never a hard fail — a heuristic must not brick
 * generation. Kept gym-local (not in the shared pack audits) so retail is
 * untouched; graduates to the domain pack when proven (DEBT #548 altitude).
 *
 * Pure + DB-free (unit-testable): see gym-session-budget_test.ts.
 */

import type { SkeletonOutput } from "./v3-output-schema.ts";

export type SkeletonDay = SkeletonOutput["weeks"][number]["days"][number];

export const FIXED_BLOCK_MINUTES: Record<string, number> = {
  "warm-up": 8,
  "mobility": 5,
  "skills": 10,
  "accessory": 12,
  "active-recovery": 8,
  "cool-down": 5,
};

/** "5x5 @75%" → 5 working sets ≈ 2.5 min each (set + rest) + warm-up sets. */
export function estimateStrengthMinutes(scheme: string | null | undefined): number {
  const m = (scheme ?? "").match(/(\d+)\s*x\s*\d+/i);
  const sets = m ? parseInt(m[1], 10) : 4;
  return Math.round(sets * 2.5 + 4);
}

/** The skeleton usually states a range ("long aerobic chipper 20-25 min") —
 *  take the top; else fall back by time-domain keyword. */
export function estimateMetconMinutes(focus: string | null | undefined): number {
  const text = (focus ?? "").toLowerCase();
  const range = text.match(/(\d+)\s*(?:[-–—]\s*(\d+))?\s*min/);
  if (range) return parseInt(range[2] ?? range[1], 10);
  if (text.includes("long")) return 22;
  if (text.includes("short")) return 8;
  return 14;
}

export function estimateDayMinutes(day: SkeletonDay): { total: number; parts: string[] } {
  let total = 0;
  const parts: string[] = [];
  for (const bt of day.block_types ?? []) {
    let min: number;
    if (bt === "strength") min = estimateStrengthMinutes(day.strength_scheme);
    else if (bt === "metcon") min = estimateMetconMinutes(day.metcon_focus);
    else min = FIXED_BLOCK_MINUTES[bt] ?? 8;
    total += min;
    parts.push(`${bt}≈${min}`);
  }
  return { total, parts };
}

export const BUDGET_SLACK_MINUTES = 5;

export function auditSessionBudget(skeleton: SkeletonOutput, budgetMinutes: number): string[] {
  const violations: string[] = [];
  for (const week of skeleton.weeks ?? []) {
    for (const day of week.days ?? []) {
      const { total, parts } = estimateDayMinutes(day);
      if (total > budgetMinutes + BUDGET_SLACK_MINUTES) {
        violations.push(
          `Week ${week.week_num} Day ${day.day_num}: estimated ${total} min (${parts.join(", ")}) exceeds the ${budgetMinutes}-min class session.`,
        );
      }
    }
  }
  return violations;
}

export function budgetRetryMessage(violations: string[], budgetMinutes: number): string {
  return [
    "Your previous skeleton failed the SESSION-TIME BUDGET audit. These class days do not fit the session length. Fix ALL of them and emit a corrected skeleton via the emit_skeleton tool — do NOT explain.",
    "",
    ...violations.map((v) => `  - ${v}`),
    "",
    `Every day must fit a ${budgetMinutes}-minute CLASS including warm-up and cool-down. To fix: use FEWER middle blocks per day (a class day carries ONE primary focus piece — do not stack a skills block AND a full strength block AND an accessory block AND a long metcon on the same day), and keep metcon_focus time domains ≤ ${Math.max(8, Math.round(budgetMinutes / 4))} min on days that also have a strength block.`,
  ].join("\n");
}
