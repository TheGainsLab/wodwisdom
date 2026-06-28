/**
 * training-design-invariants.ts
 *
 * Step 3 — deterministic allocation invariants for the AI layers. NOT golden
 * snapshots (CoachState / programs are LLM-generated and vary); these are the
 * CONTRACTS that must hold regardless of variance, checked against the skeleton's
 * DECLARED block_intents (not inferred from movements).
 *
 * Given (TrainingDesignInput, SkeletonOutput) they assert:
 *   - every `develop` priority is declared somewhere as purpose=develop
 *   - no `deprioritize`d focus is declared develop (incidental/support is fine)
 *   - every `maintain` focus gets at least a maintenance/support touch
 *   - every focus-bearing block declares a single focus + purpose
 *   - a develop block's source_priority_rank references a real priority
 *
 * Used by the skeleton audit loop (auto-retry a non-conforming skeleton) AND the
 * golden-athlete tests (regression net). Pure — no IO.
 */

import type { TrainingDesignInput } from "./training-design-input.ts";
import type { BlockPurpose, SkeletonOutput } from "./v3-output-schema.ts";
import type { FocusArea } from "./coach-state.ts";

export interface AllocationInvariantResult {
  passed: boolean;
  /** Hard violations — these should drive a skeleton retry. */
  violations: string[];
  /** Soft notes — surfaced, not fail-worthy. */
  warnings: string[];
}

interface FlatIntent {
  week: number;
  day: number;
  block_type: string;
  focus: FocusArea;
  purpose: BlockPurpose;
  source_priority_rank?: number;
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
          source_priority_rank: bi.source_priority_rank,
        });
      }
    }
  }
  return out;
}

export function checkAllocationInvariants(
  tdi: TrainingDesignInput,
  skeleton: SkeletonOutput,
): AllocationInvariantResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  const intents = flattenIntents(skeleton);
  const developFoci = new Set(intents.filter((i) => i.purpose === "develop").map((i) => i.focus));
  const touchedFoci = new Set(intents.map((i) => i.focus)); // any purpose
  const priorityFoci = new Set(tdi.priorities.map((p) => p.focus));
  const priorityRanks = new Set(tdi.priorities.map((p) => p.rank));
  const deprioritized = new Set(tdi.deprioritize);

  // 1. Every develop priority must be represented as develop somewhere.
  for (const p of tdi.priorities) {
    if (!developFoci.has(p.focus)) {
      violations.push(
        `Priority #${p.rank} (${p.focus}) is a DEVELOP priority but no block declares purpose=develop for it.`,
      );
    }
  }

  // 2. No deprioritized focus may be declared develop (incidental/support OK).
  for (const i of intents) {
    if (i.purpose === "develop" && deprioritized.has(i.focus)) {
      violations.push(
        `Week ${i.week} Day ${i.day} ${i.block_type}: focus ${i.focus} is DEPRIORITIZED but declared purpose=develop.`,
      );
    }
  }

  // 3. develop must NOT be declared for a focus that isn't a priority at all.
  for (const i of intents) {
    if (i.purpose === "develop" && !priorityFoci.has(i.focus)) {
      violations.push(
        `Week ${i.week} Day ${i.day} ${i.block_type}: focus ${i.focus} declared purpose=develop but is not in the priorities.`,
      );
    }
  }

  // 4. A develop block's source_priority_rank (when given) must reference a real priority.
  for (const i of intents) {
    if (i.purpose === "develop" && i.source_priority_rank != null && !priorityRanks.has(i.source_priority_rank)) {
      violations.push(
        `Week ${i.week} Day ${i.day} ${i.block_type}: source_priority_rank ${i.source_priority_rank} matches no priority.`,
      );
    }
  }

  // 4b. A maintain block must NOT carry source_priority_rank — maintenance does
  //     not trace to a priority, so a rank there is meaningless and pollutes the
  //     CoachState→Program traceability the field exists for.
  for (const i of intents) {
    if (i.purpose === "maintain" && i.source_priority_rank != null) {
      violations.push(
        `Week ${i.week} Day ${i.day} ${i.block_type}: maintain block (${i.focus}) must NOT set source_priority_rank (${i.source_priority_rank}).`,
      );
    }
  }

  // 5. Every maintain focus should get at least a touch (maintain or support).
  //    Soft — a thin cycle might legitimately skip one; surface, don't fail.
  for (const focus of tdi.maintain) {
    if (!touchedFoci.has(focus)) {
      warnings.push(`Maintain focus ${focus} receives no block touch this cycle.`);
    }
  }

  // 6. Coverage: a focus-bearing day with no declared intent at all is a gap.
  for (const wk of skeleton.weeks ?? []) {
    for (const day of wk.days ?? []) {
      const hasFocusBearing = (day.block_types ?? []).some((b) =>
        b === "strength" || b === "skills" || b === "accessory" || b === "metcon"
      );
      if (hasFocusBearing && (day.block_intents ?? []).length === 0) {
        violations.push(`Week ${wk.week_num} Day ${day.day_num}: focus-bearing blocks present but block_intents is empty.`);
      }
    }
  }

  return { passed: violations.length === 0, violations, warnings };
}
