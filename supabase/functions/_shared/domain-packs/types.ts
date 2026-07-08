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
import type {
  clampLoadSanity,
  stripInternalMarkers,
  enforceNoLabelOnCoachedBlocks,
} from "../programmatic-fixes.ts";
import type { attachBenchmarksToWriterOutput } from "../compute-block-benchmark.ts";
import type { reviewSafety } from "../safety-review.ts";
import type { TrainingDesignInput } from "../training-design-input.ts";

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
    /** The skeleton call's KEY-RULES recap (day-composition template). Moved
     *  from a pipeline hardcode to the pack so a variant pack can supply a
     *  different day shape (e.g. the 60-min class template) without touching
     *  the Engine core. The crossfit pack returns the pre-seam string
     *  byte-for-byte. */
    skeletonRuleRecap: (daysPerWeek: number, tdi: TrainingDesignInput) => string;
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

  /** Advisory safety review (LLM; injury-contraindication prompt is sport-coupled). */
  safety: {
    review: typeof reviewSafety;
  };

  /** Always-run save-path sanitizers (the internal-marker + label vocab is
   *  sport-coupled). The Engine runs these on every generated program before it
   *  is persisted — identical to generate-program-v3's finish step. */
  finish: {
    stripInternalMarkers: typeof stripInternalMarkers;
    enforceNoLabelOnCoachedBlocks: typeof enforceNoLabelOnCoachedBlocks;
  };

  /** Cohort scaling primitives — sport-coupled (barbell 1RM basis + plate math).
   *  Keeps the Engine core free of any sport movement/load knowledge (no runtime
   *  sport import). A different sport supplies its own map + increments. */
  scaling: {
    /** Exact display-name → canonical 1RM lift key. NO fuzzy/substring matching:
     *  an unmapped movement resolves to no basis (never a wrong-lift guess that
     *  could prescribe a dangerous overload). */
    displayToLiftKey: Record<string, string>;
    /** Load-rounding increment for a unit (barbell plate math; not barbell-only
     *  assumed at the core — the pack owns it). */
    loadIncrement: (unit: "lbs" | "kg") => number;
  };
}
