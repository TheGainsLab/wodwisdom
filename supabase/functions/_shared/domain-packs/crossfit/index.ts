/**
 * domain-packs/crossfit — the CrossFit domain pack, id "crossfit@3".
 *
 * Wires the existing sport-coupled modules behind the DomainPack interface. This
 * is where CrossFit lives; the Engine core imports the interface, this pack, or
 * the registry — never these modules directly. Consolidating the CrossFit content
 * that is still split across repos (competition/physics in the data service) is
 * tracked in ENGINE_EXTRACTION.md; this is the wodwisdom-side consolidation.
 *
 * Behavior-preserving: every binding here is the same module generate-program-v3
 * used before the pack seam, so routing through the pack changes nothing.
 */

import type { DomainPack } from "../types.ts";
import { V3_SKELETON_SYSTEM_PROMPT } from "../../v3-skeleton-prompt.ts";
import { V2_GENERATE_PROGRAM_SYSTEM_PROMPT } from "../../v2-system-prompt.ts";
import { buildEmitSkeletonTool } from "../../v3-output-schema.ts";
import { buildEmitWeekTool } from "../../v2-output-schema.ts";
import { runAudits, runSoftAudits } from "../../audit-runner.ts";
import {
  runSkeletonAudits,
  formatSkeletonViolationsForRetry,
  summarizeSkeletonAuditRun,
} from "../../v3-skeleton-audits.ts";
import { surgicallyRewriteBlock, spliceBlock } from "../../surgical-block-fix.ts";
import {
  clampLoadSanity,
  stripInternalMarkers,
  enforceNoLabelOnCoachedBlocks,
} from "../../programmatic-fixes.ts";
import { attachBenchmarksToWriterOutput } from "../../compute-block-benchmark.ts";
import { reviewSafety } from "../../safety-review.ts";
import { DISPLAY_TO_LIFT_KEY } from "../../audits.ts";

export const CROSSFIT_PACK: DomainPack = {
  id: "crossfit@3",
  sport: "crossfit",
  version: "3",
  writer: {
    skeletonSystemPrompt: V3_SKELETON_SYSTEM_PROMPT,
    weekFillSystemPrompt: V2_GENERATE_PROGRAM_SYSTEM_PROMPT,
    buildSkeletonTool: (daysPerWeek) => buildEmitSkeletonTool(daysPerWeek),
    buildWeekTool: (daysPerWeek, units, sessionLen) =>
      buildEmitWeekTool(daysPerWeek, units, sessionLen),
    // BYTE-FOR-BYTE the recap that lived in pipeline.callSkeletonWriter before
    // the pack seam — retail behavior is unchanged by the move.
    skeletonRuleRecap: (daysPerWeek) => [
      "=== KEY RULES (re-check before emit) ===",
      `- Output exactly 4 weeks × ${daysPerWeek} days. day_num is 1..${daysPerWeek}.`,
      "- Every training day includes strength + accessory + metcon block types. Skills 2–4 days per week.",
      "- Emit STRUCTURE ONLY — no sets / reps / weight / movement names. Those are filled in subsequent per-week calls.",
      "- primary_lift uses canonical display names (Back Squat, Deadlift, Snatch, Clean and Jerk, etc.) or a complex description.",
      "- ALLOCATE the given priorities/maintain/deprioritize — never invent, promote, or drop one. Every priority must appear in the structure; no block built around a deprioritized focus.",
      "- Honor do_not_program when picking primary_lift / metcon_focus / skill_focus.",
    ].join("\n"),
  },
  audits: {
    runHard: runAudits,
    runSoft: runSoftAudits,
    runSkeleton: runSkeletonAudits,
    formatSkeletonViolationsForRetry,
    summarizeSkeleton: summarizeSkeletonAuditRun,
  },
  recovery: {
    surgicallyRewriteBlock,
    spliceBlock,
    clampLoadSanity,
    attachBenchmarks: attachBenchmarksToWriterOutput,
  },
  safety: {
    review: reviewSafety,
  },
  finish: {
    stripInternalMarkers,
    enforceNoLabelOnCoachedBlocks,
  },
  scaling: {
    // Exact display-name → 1RM lift key (the audit's canonical map). Movements
    // not in this map get no basis_lift — never a substring-guessed wrong lift.
    displayToLiftKey: DISPLAY_TO_LIFT_KEY,
    // Barbell plate math: 2.5 kg / 5 lb rounding.
    loadIncrement: (unit) => (unit === "kg" ? 2.5 : 5),
  },
};
