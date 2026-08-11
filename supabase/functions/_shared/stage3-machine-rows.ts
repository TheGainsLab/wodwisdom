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

import { FOCUS_BEARING_BLOCK_TYPES, type SkeletonOutput } from "./v3-output-schema.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";
import type { FocusArea, RecoveryStance } from "./coach-state.ts";
import { normalizeMovementKey } from "./athlete-model.ts";
import { auditSkeletonDayCount, auditSkeletonStructural } from "./v3-skeleton-audits.ts";
import { checkAllocationInvariants } from "./training-design-invariants.ts";

export type MachineRowId = "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M8";

export interface MachineRowResult {
  id: MachineRowId;
  passed: boolean;
  violations: string[];
  /** Non-failing observations (e.g. M4 cross-block-type dose inversions). */
  warnings?: string[];
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

/** Develop-dose per (block_type → focus). */
function doseByBlockTypeAndFocus(skeleton: SkeletonOutput): Map<string, Map<FocusArea, number>> {
  const out = new Map<string, Map<FocusArea, number>>();
  for (const i of flattenIntents(skeleton)) {
    if (i.purpose !== "develop") continue;
    let m = out.get(i.block_type);
    if (!m) out.set(i.block_type, (m = new Map()));
    m.set(i.focus, (m.get(i.focus) ?? 0) + 1);
  }
  return out;
}

/** M4 (composite, 2026-08-10) — a lower rank hard-fails ONLY when it out-doses
 *  a higher rank BOTH in total across block types AND within a shared block
 *  type. Either signal alone is a WARNING:
 *    - total-only inversion may be letter-prescribed dose shape (a strength
 *      day is a bigger chunk than a skill touch — run 1's false positive);
 *    - within-type-only inversion may be legitimate placement (midline's
 *      canonical home is the accessory block — run 2's false positive).
 *  Placement across block types is coaching vocabulary, not drift; only
 *  unambiguous starvation of a higher rank fails. */
export function machineRowM4(
  skeleton: SkeletonOutput,
  tdi: TrainingDesignInput,
): MachineRowResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const ranked = [...tdi.priorities].sort((a, b) => a.rank - b.rank);
  const total = doseByFocus(skeleton);
  const byType = doseByBlockTypeAndFocus(skeleton);

  for (let i = 1; i < ranked.length; i++) {
    for (let j = 0; j < i; j++) {
      const hi = ranked[j];
      const lo = ranked[i];
      const totalInverted = (total.get(lo.focus) ?? 0) > (total.get(hi.focus) ?? 0);
      const sharedTypeInversions: string[] = [];
      for (const [blockType, doses] of byType) {
        const hiDose = doses.get(hi.focus);
        const loDose = doses.get(lo.focus);
        if (hiDose != null && loDose != null && loDose > hiDose) {
          sharedTypeInversions.push(`${blockType} ${loDose}>${hiDose}`);
        }
      }
      const pair = `rank ${lo.rank} (${lo.focus}) vs rank ${hi.rank} (${hi.focus})`;
      if (totalInverted && sharedTypeInversions.length > 0) {
        violations.push(
          `${pair}: out-dosed in total (${total.get(lo.focus)}>${total.get(hi.focus)}) AND within shared block type(s) [${sharedTypeInversions.join(", ")}].`,
        );
      } else if (totalInverted) {
        warnings.push(
          `${pair}: total dose inverted (${total.get(lo.focus)}>${total.get(hi.focus)}) but no shared-block-type inversion — may be letter-prescribed dose shape.`,
        );
      } else if (sharedTypeInversions.length > 0) {
        warnings.push(
          `${pair}: within-type inversion [${sharedTypeInversions.join(", ")}] but totals honor rank — placement choice, not starvation.`,
        );
      }
    }
  }

  return { id: "M4", passed: violations.length === 0, violations, warnings };
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

/** Canonical lift names M6 recognizes as progression labels. Longest names
 *  first so "Clean and Jerk" matches before "Clean". */
const M6_KNOWN_LIFTS = [
  "Clean and Jerk",
  "Overhead Squat",
  "Front Squat",
  "Back Squat",
  "Bench Press",
  "Strict Press",
  "Push Press",
  "Power Snatch",
  "Power Clean",
  "Push Jerk",
  "Split Jerk",
  "Deadlift",
  "Snatch",
  "Clean",
  "Jerk",
  "Press",
  "Thruster",
];

/** M6 — progression truthfulness: every lift the month plan PROMISES a
 *  progression for (a "<Lift>: ..." labeled segment in strength_progression)
 *  must appear as a primary_lift on some day. The plan text may not contradict
 *  the days. Incidental lift mentions inside prose (e.g. "EMOM tech work
 *  (Hang Power Clean variants)") are not promises and are not enforced.
 *
 *  INTENDED exemption (confirmed 2026-08-11): the label must EXACT-match a
 *  known lift, so qualified labels like "Back Squat (maintain touch):" or
 *  "Back Squat maintain touch:" do not count as promises. A maintain touch
 *  may legitimately live in an accessory block rather than as a primary_lift,
 *  so only clean "<Lift>:" dedicated-progression labels are enforced. */
export function machineRowM6(skeleton: SkeletonOutput): MachineRowResult {
  const violations: string[] = [];
  const progression = skeleton.month_plan?.strength_progression ?? "";

  // Promised lifts = segment labels of the form "<Lift>:" at the start of the
  // text or immediately after sentence/segment punctuation.
  const promised = new Set<string>();
  const labelRe = /(?:^|[.;\n]\s*)([A-Za-z][A-Za-z &+/-]{2,40}?):/g;
  for (const m of progression.matchAll(labelRe)) {
    const label = m[1].trim().toLowerCase();
    for (const lift of M6_KNOWN_LIFTS) {
      if (label === lift.toLowerCase()) {
        promised.add(lift);
        break;
      }
    }
  }

  const primaryLifts = [];
  for (const wk of skeleton.weeks ?? []) {
    for (const day of wk.days ?? []) {
      if (day.primary_lift) primaryLifts.push(day.primary_lift.toLowerCase());
    }
  }
  for (const lift of promised) {
    const needle = lift.toLowerCase();
    if (!primaryLifts.some((p) => p.includes(needle))) {
      violations.push(
        `strength_progression promises a "${lift}" progression but no day programs it as a primary_lift.`,
      );
    }
  }
  return { id: "M6", passed: violations.length === 0, violations };
}

/** M8 — block/intent reconciliation: every focus-bearing block_type a day
 *  declares must have a matching block_intents entry. Catches "phantom
 *  blocks" — a skills block declared with a written skill_focus but no
 *  intent (Fable's lower-body days, 2026-08-10 run) — whose work is
 *  invisible to allocation accounting. */
export function machineRowM8(skeleton: SkeletonOutput): MachineRowResult {
  const violations: string[] = [];
  const focusBearing = new Set<string>(FOCUS_BEARING_BLOCK_TYPES);
  for (const wk of skeleton.weeks ?? []) {
    for (const day of wk.days ?? []) {
      const intentTypes = new Set((day.block_intents ?? []).map((bi) => bi.block_type));
      for (const bt of day.block_types ?? []) {
        if (focusBearing.has(bt) && !intentTypes.has(bt)) {
          violations.push(
            `Week ${wk.week_num} Day ${day.day_num}: block_types declares "${bt}" but block_intents has no entry for it.`,
          );
        }
      }
    }
  }
  return { id: "M8", passed: violations.length === 0, violations };
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
    const rows: MachineRowResult[] = (["M1", "M2", "M3", "M4", "M5", "M6", "M8"] as MachineRowId[]).map(
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
    machineRowM6(skeleton),
    machineRowM8(skeleton),
  ];
  return { passed: rows.every((r) => r.passed), rows, structural_failure: false };
}

/** One-line summary for the shadow-run log, e.g. "M1=ok M4=ok(2 warn) M6=FAIL(1)". */
export function summarizeMachineRows(result: MachineRowsRunResult): string {
  return result.rows
    .map((r) => {
      const warn = r.warnings?.length ? `(${r.warnings.length} warn)` : "";
      return `${r.id}=${r.passed ? `ok${warn}` : `FAIL(${r.violations.length})`}`;
    })
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
