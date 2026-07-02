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
import { clampLoadSanity } from "../../programmatic-fixes.ts";
import { attachBenchmarksToWriterOutput } from "../../compute-block-benchmark.ts";

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
};
