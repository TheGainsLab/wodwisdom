/**
 * engine/run-engine.ts — the standalone Engine orchestrator.
 *
 * Turns an EngineGenerateRequest into audited artifacts, consuming the domain pack
 * and the pipeline. STATELESS about wodwisdom's DB: payload + coaching strategy
 * (TrainingDesignInput) in, audited WriterOutput (+ cohort scalings) out. The
 * caller persists. wodwisdom's generate-program-v3 uses the same pipeline via its
 * resumable dispatcher; this runs the pipeline synchronously in one invocation
 * (v1 — the contract SHAPE matters, not the parallelism/resumability).
 *
 * Adaptive: one program per athlete. Cohort: one shared program + deterministic
 * per-member scaling (zero extra LLM for the scaling).
 */

import type { WriterPayload } from "../build-writer-payload.ts";
import type { TrainingDesignInput } from "../training-design-input.ts";
import type { WriterOutput, WeekPrescription } from "../v2-output-schema.ts";
import { classifyFailuresByKind } from "../audit-runner.ts";
import { getDomainPack } from "../domain-packs/registry.ts";
import type { DomainPack } from "../domain-packs/types.ts";
import {
  generateSkeletonWithAudits,
  callWeekFill,
  resolveGender,
  auditOutput,
  applyProgrammaticFixes,
  applySurgicalFixes,
  recomputeBenchmarks,
  STALL_HALT_PASSES,
} from "./pipeline.ts";
import { computeCohortScaling } from "./cohort.ts";
import type {
  EngineGenerateRequest,
  EngineGenerateResult,
  EngineProgramResult,
  ScalingResult,
} from "./contract.ts";

const WEEKS = 4;
// Standalone safety bound on the synchronous recovery loop (the wodwisdom
// dispatcher relies on the reaper cron instead; here we cap to never hang).
const MAX_RECOVERY_PASSES = 12;

/**
 * Generate + audit ONE program from a payload + its coaching strategy (tdi).
 * Ports the benchmark_audit + surgical stages into a single synchronous flow.
 */
export async function runAdaptiveProgram(
  athleteRef: string | null,
  payload: WriterPayload,
  tdi: TrainingDesignInput,
  pack: DomainPack,
): Promise<EngineProgramResult> {
  // 1. Skeleton (structure) with its audit-retry loop.
  const skeleton = await generateSkeletonWithAudits(tdi, pack);

  // 2. Fill each week, progressing from prior weeks.
  const weeks: WeekPrescription[] = [];
  for (let w = 1; w <= WEEKS; w++) {
    weeks.push(await callWeekFill(payload, skeleton, w, weeks, "", pack));
  }
  const output: WriterOutput = { month_plan: skeleton.month_plan, weeks };

  // 3. Benchmark + audit + surgical recovery (synchronous port of the two stages).
  const gender = resolveGender(payload);
  let pending = await recomputeBenchmarks(output, gender, [], pack); // full pass
  let audit = auditOutput(output, payload, skeleton, pack);
  let residual: unknown[] = [];

  if (!audit.passed) {
    const recentCounts: number[] = [];
    let pass = 0;
    for (;;) {
      let byKind = classifyFailuresByKind(audit.failures);

      // Programmatic patches (no LLM).
      if (byKind["programmatic-fix"].length > 0) {
        const patch = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload, pack);
        if (patch.patched > 0) {
          pending = await recomputeBenchmarks(output, gender, pending, pack, []);
          audit = auditOutput(output, payload, skeleton, pack);
          if (audit.passed) break;
          byKind = classifyFailuresByKind(audit.failures);
        }
      }

      const blockLocal = byKind["block-local"];
      if (blockLocal.length === 0) { residual = audit.failures; break; }

      pass++;
      if (pass > MAX_RECOVERY_PASSES) { residual = audit.failures; break; }

      const sg = await applySurgicalFixes(output, blockLocal, payload, skeleton, pack);
      if (sg.rewritten === 0) { residual = audit.failures; break; }

      pending = await recomputeBenchmarks(output, gender, pending, pack, sg.locations);
      audit = auditOutput(output, payload, skeleton, pack);
      if (audit.passed) break;

      const blCount = classifyFailuresByKind(audit.failures)["block-local"].length;
      recentCounts.push(blCount);
      // Stall: block-local count stable for STALL_HALT_PASSES consecutive passes.
      if (recentCounts.length >= STALL_HALT_PASSES) {
        const window = recentCounts.slice(-STALL_HALT_PASSES);
        if (window.every((c) => c === window[0])) { residual = audit.failures; break; }
      }
      if (blCount === 0) { residual = audit.failures; break; }
    }
  }

  // 4. Advisory safety review (never regenerates).
  const safety = await pack.safety.review(
    output,
    payload.training_context.goal_text,
    payload.training_context.injuries_constraints_text,
  );

  return {
    athlete_ref: athleteRef,
    output,
    skeleton,
    residual_audit_failures: residual,
    safety: { safe: safety.safe, reasoning: safety.reasoning, errored: !!safety.errored },
  };
}

/**
 * Run the Engine for a full request. Adaptive = one program per athlete (v1: a
 * sequential internal loop; the contract's array shape is what matters).
 * Cohort = one shared program + deterministic per-member scaling.
 */
export async function runEngineGeneration(
  req: EngineGenerateRequest,
): Promise<EngineGenerateResult> {
  const pack = getDomainPack(req.domain_pack);

  if (req.mode === "cohort") {
    if (!req.cohort) throw new Error("cohort mode requires a `cohort` spec");
    // ONE shared program (the class path).
    const shared = await runAdaptiveProgram(
      null,
      req.cohort.shared_payload,
      req.cohort.shared_training_design_input,
      pack,
    );
    // Deterministic per-member scaling — no LLM.
    const scalings: ScalingResult[] = req.athletes.map((a) =>
      computeCohortScaling(shared.output, a)
    );
    return {
      mode: "cohort",
      tenant_id: req.tenant_id,
      domain_pack: pack.id,
      programs: [shared],
      scalings,
    };
  }

  // Adaptive.
  const programs: EngineProgramResult[] = [];
  for (const a of req.athletes) {
    programs.push(
      await runAdaptiveProgram(a.athlete_ref, a.payload, a.training_design_input, pack),
    );
  }
  return {
    mode: "adaptive",
    tenant_id: req.tenant_id,
    domain_pack: pack.id,
    programs,
  };
}
