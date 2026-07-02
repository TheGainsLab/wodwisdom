/**
 * domain-packs/types.ts — the DomainPack interface.
 *
 * A domain pack is the SPORT-COUPLED CONTENT the sport-agnostic Engine consumes:
 * prompts, tool schemas, audit rules, recovery helpers, and the movement/archetype
 * vocabulary. The Engine core imports ONLY this interface (type-only — erased at
 * runtime) and receives a concrete pack as a parameter; it never imports a sport
 * module directly. A new sport = a new pack behind this interface, no Engine change
 * (docs/portfolio/ENGINE_EXTRACTION.md, ENGINE_API_CONTRACT.md `domain_pack`).
 *
 * All imports below are `import type` — signatures only, no runtime coupling.
 */

import type { runAudits, runSoftAudits } from "../audit-runner.ts";
import type {
  runSkeletonAudits,
  formatSkeletonViolationsForRetry,
  summarizeSkeletonAuditRun,
} from "../v3-skeleton-audits.ts";
import type { surgicallyRewriteBlock, spliceBlock } from "../surgical-block-fix.ts";
import type { clampLoadSanity } from "../programmatic-fixes.ts";
import type { attachBenchmarksToWriterOutput } from "../compute-block-benchmark.ts";

export interface DomainPack {
  /** Versioned id, e.g. "crossfit@3". The contract's `domain_pack` value. */
  id: string;
  /** Sport slug, e.g. "crossfit". */
  sport: string;
  /** Pack version, e.g. "3". */
  version: string;

  /** Writer inputs — the LLM system prompts + tool schemas. */
  writer: {
    skeletonSystemPrompt: string;
    weekFillSystemPrompt: string;
    buildSkeletonTool: (daysPerWeek: number) => unknown;
    buildWeekTool: (daysPerWeek: number, units: "lbs" | "kg", sessionLen: number | null) => unknown;
  };

  /** Deterministic audit rules (sport-specific logic lives inside these). */
  audits: {
    runHard: typeof runAudits;
    runSoft: typeof runSoftAudits;
    runSkeleton: typeof runSkeletonAudits;
    formatSkeletonViolationsForRetry: typeof formatSkeletonViolationsForRetry;
    summarizeSkeleton: typeof summarizeSkeletonAuditRun;
  };

  /** Recovery + benchmarking — the surgical LLM rewrite, splicing, load clamp,
   *  and cohort benchmark attach. Sport-coupled (metcon math, vocab, physics). */
  recovery: {
    surgicallyRewriteBlock: typeof surgicallyRewriteBlock;
    spliceBlock: typeof spliceBlock;
    clampLoadSanity: typeof clampLoadSanity;
    attachBenchmarks: typeof attachBenchmarksToWriterOutput;
  };
}
