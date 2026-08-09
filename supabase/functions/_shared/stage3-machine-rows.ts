/**
 * stage3-machine-rows.ts
 *
 * Machine rows M1–M5 for the Stage 3 shadow test (pre-registered rubric,
 * 2026-08). Pass/fail per skeleton, run BEFORE human scoring. Implemented
 * from the frozen rubric spec — the rubric doc is the source of truth.
 *
 * STANDALONE BY DESIGN: nothing in the live pipeline imports this file.
 * It composes the live audits (day count, allocation invariants) with the
 * rows that exist only for the shadow test (do_not_program string scan,
 * deload↔stance consistency, rank-monotone dosing). If Stage 3 adopts,
 * M1/M2b/M4 graduate into v3-skeleton-audits.ts; until then this file is
 * inert.
 *
 * Rubric definitions (frozen):
 *   dose(focus) = count of block_intents entries with purpose="develop"
 *                 and that focus, across the 4-week skeleton.
 *   M1  every do_not_program movement absent from primary_lift, skill_focus,
 *       metcon_focus and day_intent strings (normalized-key match). Full
 *       movement-level enforcement is a week-fill audit, out of scope.
 *   M2  day count exactly matches budget; deload_placement consistent with
 *       recovery stance (conservative/standard → a deload-marked week exists;
 *       aggressive → optional, but the prose must agree with the marked week).
 *   M3  every priority has dose ≥ 1.
 *   M4  dose() monotone non-increasing with priority rank.
 *   M5  every maintain focus appears with purpose="maintain" and has dose = 0;
 *       every deprioritized focus has dose = 0.
 */

import type { SkeletonOutput } from "./v3-output-schema.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";
import type { FocusArea, RecoveryStance } from "./coach-state.ts";
import { normalizeMovementKey } from "./athlete-model.ts";
import { auditSkeletonDayCount, auditSkeletonStructural } from "./v3-skeleton-audits.ts";
import { checkAllocationInvariants } from "./training-design-invariants.ts";

export type MachineRowId = "M1" | "M2" | "M3" | "M4" | "M5";

export interface MachineRowResult {
  id: MachineRowId;
  passed: boolean;
  violations: string[];
}

export interface MachineRowsRunResult {
  passed: boolean;
  rows: MachineRowResult[];
  /** True when the skeleton was too malformed to score (weeks missing etc.) —
   *  reported as an all-rows failure rather than a crash. */
  structural_failure: boolean;
}

// ============================================================
// Shared helpers
// ============================================================

interface FlatIntent {
  week: number;
  day: number;
  block_type: string;
  focus: FocusArea;
  purpose: string;
}

function flattenIntents(skeleton: SkeletonOutput): FlatIntent[] {
  const out: FlatIntent[] = [];
  for (const wk of skeleton.weeks ?? []) {
    for (const day of wk.days ?? []) {
      for (const bi of day.block_intents ?? []) {
        out.push({
          week: wk.week_num,
          day: day.day_num,
          block_type: bi.block_type,
          focus: bi.focus,
          purpose: bi.purpose,
        });
      }
    }
  }
  return out;
}

/** dose(focus) per the frozen rubric: develop-purpose block_intents count. */
export function doseByFocus(skeleton: SkeletonOutput): Map<FocusArea, number> {
  const dose = new Map<FocusArea, number>();
  for (const i of flattenIntents(skeleton)) {
    if (i.purpose === "develop") dose.set(i.focus, (dose.get(i.focus) ?? 0) + 1);
  }
  return dose;
}

/** Banned-movement containment with underscore-token boundaries, tolerant of a
 *  trailing plural on the ban ("box_jumps" matches "box jump over"). Errs
 *  toward flagging — shadow-test violations are human-reviewed. */
function textContainsMovement(text: string, movementKey: string): boolean {
  const hay = `_${normalizeMovementKey(text)}_`;
  const keys = new Set([movementKey]);
  if (movementKey.endsWith("s")) keys.add(movementKey.slice(0, -1));
  else keys.add(`${movementKey}s`);
  for (const k of keys) {
    if (k && hay.includes(`_${k}_`)) return true;
  }
  return false;
}

const DELOAD_MARKER = /deload|recover|reduc|taper/i;

function deloadMarkedWeeks(skeleton: SkeletonOutput): number[] {
  const marked = new Set<number>();
  for (const wk of skeleton.weeks ?? []) {
    if (typeof wk.weekly_intent === "string" && DELOAD_MARKER.test(wk.weekly_intent)) {
      marked.add(wk.week_num);
    }
  }
  const monthIntents = skeleton.month_plan?.weekly_intent;
  if (Array.isArray(monthIntents)) {
    monthIntents.forEach((intent, idx) => {
      if (typeof intent === "string" && DELOAD_MARKER.test(intent)) marked.add(idx + 1);
    });
  }
  return [...marked].sort((a, b) => a - b);
}

// ============================================================
// Rows
// ============================================================

/** M1 — do_not_program movements absent from the skeleton's text fields. */
export function machineRowM1(
  skeleton: SkeletonOutput,
  doNotProgram: string[],
): MachineRowResult {
  const violations: string[] = [];
  const bannedKeys = doNotProgram
    .map(normalizeMovementKey)
    .filter((k) => k.length > 0);
  for (const wk of skeleton.weeks ?? []) {
    for (const day of wk.days ?? []) {
      const fields: Array<[string, string | undefined]> = [
        ["day_intent", day.day_intent],
        ["primary_lift", day.primary_lift],
        ["strength_scheme", day.strength_scheme],
        ["metcon_focus", day.metcon_focus],
        ["skill_focus", day.skill_focus],
      ];
      for (const [field, value] of fields) {
        if (!value) continue;
        for (const key of bannedKeys) {
          if (textContainsMovement(value, key)) {
            violations.push(
              `Week ${wk.week_num} Day ${day.day_num} ${field}: banned movement "${key}" appears in "${value}".`,
            );
          }
        }
      }
    }
  }
  return { id: "M1", passed: violations.length === 0, violations };
}

/** M2 — day count matches budget (live audit) + deload placement consistent
 *  with the recovery stance. */
export function machineRowM2(
  skeleton: SkeletonOutput,
  daysPerWeek: number,
  stance: RecoveryStance,
): MachineRowResult {
  const violations: string[] = [...auditSkeletonDayCount(skeleton, daysPerWeek).violations];

  const marked = deloadMarkedWeeks(skeleton);
  const placement = skeleton.month_plan?.deload_placement ?? "";

  if ((stance === "conservative" || stance === "standard") && marked.length === 0) {
    violations.push(
      `Stance is "${stance}" but no week is marked as deload/recovery in weekly_intent (month_plan: ${JSON.stringify(skeleton.month_plan?.weekly_intent ?? [])}).`,
    );
  }
  // Prose ↔ structure agreement: when a marked week exists, deload_placement
  // must name at least one of the marked week numbers. Applies to all stances.
  if (marked.length > 0 && placement) {
    const namesMarkedWeek = marked.some((w) =>
      new RegExp(`week\\s*${w}\\b`, "i").test(placement)
    );
    if (!namesMarkedWeek) {
      violations.push(
        `deload_placement ("${placement}") does not name any deload-marked week (${marked.join(", ")}).`,
      );
    }
  }
  return { id: "M2", passed: violations.length === 0, violations };
}

/** M3 — every priority has dose ≥ 1. */
export function machineRowM3(
  skeleton: SkeletonOutput,
  tdi: TrainingDesignInput,
): MachineRowResult {
  const violations: string[] = [];
  const dose = doseByFocus(skeleton);
  for (const p of tdi.priorities) {
    if ((dose.get(p.focus) ?? 0) < 1) {
      violations.push(`Priority #${p.rank} (${p.focus}) has dose 0 — no develop block.`);
    }
  }
  return { id: "M3", passed: violations.length === 0, violations };
}

/** M4 — dose monotone non-increasing with rank (rank-1 ≥ rank-2 ≥ …).
 *  Confidence modulation is within-rank per the skeleton prompt, so strict
 *  cross-rank monotonicity stands. */
export function machineRowM4(
  skeleton: SkeletonOutput,
  tdi: TrainingDesignInput,
): MachineRowResult {
  const violations: string[] = [];
  const dose = doseByFocus(skeleton);
  const ranked = [...tdi.priorities].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < ranked.length; i++) {
    const hi = ranked[i - 1];
    const lo = ranked[i];
    const hiDose = dose.get(hi.focus) ?? 0;
    const loDose = dose.get(lo.focus) ?? 0;
    if (loDose > hiDose) {
      violations.push(
        `Rank ${lo.rank} (${lo.focus}) dose ${loDose} exceeds rank ${hi.rank} (${hi.focus}) dose ${hiDose}.`,
      );
    }
  }
  return { id: "M4", passed: violations.length === 0, violations };
}

/** M5 — maintain foci appear as purpose="maintain" with dose 0; deprioritized
 *  foci have dose 0. */
export function machineRowM5(
  skeleton: SkeletonOutput,
  tdi: TrainingDesignInput,
): MachineRowResult {
  const violations: string[] = [];
  const dose = doseByFocus(skeleton);
  const intents = flattenIntents(skeleton);
  const maintainedFoci = new Set(
    intents.filter((i) => i.purpose === "maintain").map((i) => i.focus),
  );
  for (const focus of tdi.maintain) {
    if (!maintainedFoci.has(focus)) {
      violations.push(`Maintain focus ${focus} never appears with purpose="maintain".`);
    }
    const d = dose.get(focus) ?? 0;
    if (d > 0) {
      violations.push(`Maintain focus ${focus} has dose ${d} — maintain must not be developed.`);
    }
  }
  for (const focus of tdi.deprioritize) {
    const d = dose.get(focus) ?? 0;
    if (d > 0) {
      violations.push(`Deprioritized focus ${focus} has dose ${d} — must be 0.`);
    }
  }
  return { id: "M5", passed: violations.length === 0, violations };
}

// ============================================================
// Runner
// ============================================================

export function runMachineRows(
  skeleton: SkeletonOutput,
  tdi: TrainingDesignInput,
): MachineRowsRunResult {
  // A skeleton too malformed to iterate fails every row rather than crashing.
  const structural = auditSkeletonStructural(skeleton);
  if (!structural.passed) {
    const rows: MachineRowResult[] = (["M1", "M2", "M3", "M4", "M5"] as MachineRowId[]).map(
      (id) => ({ id, passed: false, violations: structural.violations }),
    );
    return { passed: false, rows, structural_failure: true };
  }

  const rows: MachineRowResult[] = [
    machineRowM1(skeleton, tdi.do_not_program),
    machineRowM2(skeleton, tdi.days_per_week, tdi.recovery_stance),
    machineRowM3(skeleton, tdi),
    machineRowM4(skeleton, tdi),
    machineRowM5(skeleton, tdi),
  ];
  return { passed: rows.every((r) => r.passed), rows, structural_failure: false };
}

/** One-line summary for the shadow-run log, e.g. "M1=ok M2=FAIL(2) …". */
export function summarizeMachineRows(result: MachineRowsRunResult): string {
  return result.rows
    .map((r) => `${r.id}=${r.passed ? "ok" : `FAIL(${r.violations.length})`}`)
    .join(" ");
}

/** Sanity cross-check: the live allocation invariants must agree with M3/M5
 *  (they encode overlapping contracts). Returns discrepancy notes, empty when
 *  consistent — run in the shadow harness as a self-test of the rows. */
export function crossCheckWithLiveInvariants(
  skeleton: SkeletonOutput,
  tdi: TrainingDesignInput,
): string[] {
  const notes: string[] = [];
  const live = checkAllocationInvariants(tdi, skeleton);
  const m3 = machineRowM3(skeleton, tdi);
  const m5 = machineRowM5(skeleton, tdi);
  const liveMissedPriority = live.violations.some((v) => v.includes("DEVELOP priority"));
  if (liveMissedPriority !== !m3.passed) {
    notes.push(
      `M3 (${m3.passed ? "pass" : "fail"}) disagrees with live invariant #1 (${liveMissedPriority ? "fail" : "pass"}).`,
    );
  }
  const liveDeprioritizedDevelop = live.violations.some((v) => v.includes("DEPRIORITIZED"));
  const m5DeprioritizedFail = m5.violations.some((v) => v.includes("Deprioritized"));
  if (liveDeprioritizedDevelop !== m5DeprioritizedFail) {
    notes.push(
      `M5 deprioritized check disagrees with live invariant #2 (live ${liveDeprioritizedDevelop ? "fail" : "pass"}, M5 ${m5DeprioritizedFail ? "fail" : "pass"}).`,
    );
  }
  return notes;
}
