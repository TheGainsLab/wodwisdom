/**
 * generate-program-v3/index.ts
 *
 * v3 chained-generation edge function — the production generator for all
 * programming users (v1/v2 retired). First-cycle generation is open to any
 * authenticated user; entitlement gating happens upstream. Continuation +
 * v1→v3 migration are driven by trusted service callers (generate-next-month).
 *
 * RESUMABLE PER-STAGE DISPATCHER. Generation runs ONE stage per edge
 * invocation, persisting full resume state on the program_jobs row and
 * self-re-triggering the next stage. The clock resets each hop, so a heavy
 * (6-day) run that used to die mid-fill at the ~400s wall-clock now completes
 * across invocations. An atomic DB lease + fencing token (see v3-dispatcher.ts)
 * guarantees a stage never double-runs even under at-least-once dispatch, and a
 * reaper cron (job-reaper) re-dispatches any stage whose worker vanished.
 *
 * Stages: payload_building → skeleton → fill_week_1..4 → benchmark_audit →
 *         surgical (one pass per invocation, re-enters itself) → safety_review →
 *         saving → complete.
 *
 * Kickoff creates the job at next_stage='payload_building' (resume_state.
 * continuation seeded) and fires stage 1; the client polls program-job-status.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { buildWriterPayload, type WriterPayload } from "../_shared/build-writer-payload.ts";
import { generateAndPersistCoachState } from "../_shared/generate-coach-state.ts";
import { buildTrainingDesignInput } from "../_shared/training-design-input.ts";
import { type SkeletonOutput } from "../_shared/v3-output-schema.ts";
import {
  type WriterOutput,
  type WeekPrescription,
} from "../_shared/v2-output-schema.ts";
import {
  runSoftAudits,
  summarizeAuditRun,
  classifyFailuresByKind,
} from "../_shared/audit-runner.ts";
import { stripInternalMarkers, enforceNoLabelOnCoachedBlocks } from "../_shared/programmatic-fixes.ts";
import { reviewSafety } from "../_shared/safety-review.ts";
import { saveProgramV3 } from "../_shared/save-program-v3.ts";
import { type BlockLocation } from "../_shared/compute-block-benchmark.ts";
// Engine core — the extracted generation pipeline. This function now CONSUMES the
// Engine (payload -> skeleton -> audits -> fill -> audit suite -> recovery)
// instead of inlining it. See _shared/engine/pipeline.ts.
import {
  generateSkeletonWithAudits,
  callWeekFill,
  resolveGender,
  auditOutput,
  applyProgrammaticFixes,
  applySurgicalFixes,
  recomputeBenchmarks,
  STALL_HALT_PASSES,
} from "../_shared/engine/pipeline.ts";
import { getDomainPack } from "../_shared/domain-packs/registry.ts";
import {
  runStageWithLease,
  type ProgramJobRow,
  type ResumeState,
  type Stage,
  type StageOutcome,
} from "../_shared/v3-dispatcher.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTION_NAME = "generate-program-v3";

// Injury-confirmation generation guard (handoff 1.3). FLAG-GATED enforcement:
// stays observability-only (logs a would-block) until the show-back UI (1.1) and
// the existing-user one-time show-back (1.5 / ticket T6) ship — otherwise every
// existing injury-having user would be blocked with no way to confirm. Flip
// INJURY_CONFIRMATION_ENFORCED=true once those land.
const INJURY_CONFIRMATION_ENFORCED =
  Deno.env.get("INJURY_CONFIRMATION_ENFORCED") === "true";
// Mirrors the "no injuries" sentinels in parse-injuries-constraints.
const NO_INJURY_RE = /^(none|no|nothing|no injuries|n\/a)$/i;

/** SHA-256 hex of `text`. Byte-identical to parse-injuries-constraints.sha256Hex and
 *  the client's confirm hash, so a confirmation's confirmed_against_hash computed on
 *  any of the three matches here. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generation guard (handoff 1.3): an athlete with non-empty injuries text but no
 * VALID confirmation must not silently generate with missing/partial injury
 * protection. A confirmation is valid only for the CURRENT text. We hash the current
 * text OURSELVES rather than trust injuries_constraints_hash (which only a successful
 * parse updates) — so an edited-but-unparsed note reads as unconfirmed even if the
 * parse refresh failed, closing the silent-stale-protection gap and making the guard
 * independent of parse-service health. When enforced and the check fails, THROW — the
 * dispatcher marks the job failed (no reaper re-roll) and the message surfaces to the
 * athlete via program-job-status.
 */
async function enforceInjuryConfirmationGuard(
  supa: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supa
    .from("athlete_profiles")
    .select("injuries_constraints, injuries_avoidance_confirmed")
    .eq("user_id", userId)
    .maybeSingle<{
      injuries_constraints: string | null;
      injuries_avoidance_confirmed: { confirmed_against_hash?: string } | null;
    }>();
  // Best-effort read: a guard-read failure must not brick generation — the payload
  // read applies the same confirmed-or-fallback rule regardless. Log and proceed.
  if (error) {
    console.warn("[generate-program-v3] injury guard read failed (skipping guard):", error.message);
    return;
  }

  const text = (data?.injuries_constraints ?? "").trim();
  const hasInjuries = text !== "" && !NO_INJURY_RE.test(text);
  if (!hasInjuries) return;

  const confirmed = data?.injuries_avoidance_confirmed ?? null;
  const currentHash = await sha256Hex(text);
  const confirmationValid =
    confirmed != null && confirmed.confirmed_against_hash === currentHash;
  if (confirmationValid) return;

  if (INJURY_CONFIRMATION_ENFORCED) {
    throw new Error(
      "Your injury notes need review before we generate your program. Open your " +
        "profile and confirm the movements we'll avoid, then try again.",
    );
  }
  console.warn(
    `[generate-program-v3] injury guard WOULD BLOCK user ${userId} (non-empty injuries, ` +
      "no valid confirmation) — enforcement off (rollout window before 1.1/T6)",
  );
}
// wodwisdom is the first Engine consumer; it pins the CrossFit pack. The Engine
// core is sport-agnostic — the pack supplies all sport-coupled content.
const PACK = getDomainPack("crossfit@3");

/** Transition from surgical (or benchmark_audit) into safety_review: drop the
 *  surgical cursor, persist the final output + residual failures. */
function toSafety(rs: ResumeState, output: WriterOutput, residualFailures: unknown[]): ResumeState {
  const { surgical: _drop, ...rest } = rs;
  return { ...rest, output, residualFailures };
}

// ============================================================
// Stages — each runs in its own invocation via runStageWithLease.
// ============================================================

async function stagePayloadBuilding(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const userId = job.user_id;
  const monthNumber = rs.continuation.monthNumber;

  // Ensure free-text injuries are parsed into injuries_structured.do_not_program
  // BEFORE building the payload (hash-guarded no-op when current). No longer blind:
  // check the response so a parse HTTP failure is visible rather than silently
  // proceeding on a stale/null list. The parse refresh itself stays non-fatal — the
  // confirmation guard below is the actual gate.
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/parse-injuries-constraints`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "x-webhook-user-id": userId,
      },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      // Structured tag for log-based monitoring (no dedicated alert channel — a
      // persistent parse failure is almost always a global Claude/model issue that
      // also fails generation itself). Queryable in fn Logs by tag.
      console.error(JSON.stringify({
        tag: "injury_parse_failed", at: "generate-program-v3.refresh",
        user_id: userId, http_status: resp.status,
      }));
    }
  } catch (e) {
    console.error(JSON.stringify({
      tag: "injury_parse_failed", at: "generate-program-v3.refresh",
      user_id: userId, error: e instanceof Error ? e.message : String(e),
    }));
  }

  // Guard (handoff 1.3): block generation past a non-empty-but-unconfirmed injury
  // note. Flag-gated — observability-only until 1.1/T6 ship (see the helper).
  await enforceInjuryConfirmationGuard(supa, userId);

  const payload = await buildWriterPayload(supa, userId, {
    includeAllResults: false,
    includeEvaluations: true,
    monthNumber,
  });
  console.log(
    `[generate-program-v3] payload built (days_per_week=${payload.training_context.days_per_week} competition_linked=${payload.competition != null} vocabulary_size=${payload.vocabulary.length})`,
  );

  return {
    next: "coach_state",
    resumeState: { ...rs, payload, startedAtMs: rs.startedAtMs ?? Date.now() },
    displayStage: "payload_built",
  };
}

/**
 * coach_state stage (Step 3) — the judgment layer in the pipeline. Reuse-if-
 * current by (athlete_model_version, coach_state_builder_version); generate +
 * persist on a miss. Then project the FIXED CoachState into the TrainingDesign
 * contract the skeleton + week-fill consume. Re-entry is safe (reuse-if-current
 * returns the cached snapshot), so the 2-attempt retry only guards transient
 * LLM errors before this writer stage gives up.
 */
async function stageCoachState(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const payload = rs.payload!;

  let result: Awaited<ReturnType<typeof generateAndPersistCoachState>> | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      result = await generateAndPersistCoachState(supa, job.user_id, payload);
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`[generate-program-v3] coach_state attempt ${attempt}/2 failed:`, e);
    }
  }
  if (!result) throw lastErr ?? new Error("coach_state generation failed");

  const coachState = result.coach_state;
  console.log(
    `[generate-program-v3] coach_state v${result.version} (reused=${result.reused}, refs AM v${payload.athlete_model.version})`,
  );

  const trainingDesignInput = buildTrainingDesignInput(coachState, {
    days_per_week: payload.training_context.days_per_week,
    session_length_minutes: payload.training_context.session_length_minutes,
    equipment: payload.equipment,
    do_not_program: payload.training_context.injuries_structured?.do_not_program ?? [],
    vocabulary: payload.vocabulary,
    lifts: payload.lifts,
    previous_cycle: payload.previous_cycle,
  });

  return {
    next: "skeleton",
    resumeState: { ...rs, coachState, trainingDesignInput },
    displayStage: "coach_state_done",
  };
}

async function stageSkeleton(
  _supa: SupabaseClient,
  _job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  // The skeleton consumes the TrainingDesignInput CONTRACT — the FIXED plan,
  // with decision-data stripped — never the raw payload. Allocate, don't reinterpret.
  const tdi = rs.trainingDesignInput!;
  const skeleton = await generateSkeletonWithAudits(tdi, PACK);
  console.log("[generate-program-v3] skeleton passed audits");
  return {
    next: "fill_week_1",
    resumeState: { ...rs, skeleton, weeks: [] },
    displayStage: "skeleton_done",
    // Mirror to skeleton_json for the admin V3 panel.
    extraPatch: { skeleton_json: skeleton },
  };
}

async function stageFillWeek(
  _supa: SupabaseClient,
  _job: ProgramJobRow,
  rs: ResumeState,
  weekNum: number,
): Promise<StageOutcome> {
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const priorWeeks = rs.weeks ?? [];
  const wk = await callWeekFill(payload, skeleton, weekNum, priorWeeks, "", PACK);
  const weeks = [...priorWeeks, wk];
  const next: Stage = weekNum < 4 ? (`fill_week_${weekNum + 1}` as Stage) : "benchmark_audit";
  return { next, resumeState: { ...rs, weeks }, displayStage: next };
}

async function stageBenchmarkAudit(
  _supa: SupabaseClient,
  _job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const gender = resolveGender(payload);
  const output: WriterOutput = { month_plan: skeleton.month_plan, weeks: rs.weeks ?? [] };

  // Full benchmark pass (every metcon — the rate-limit-prone one) in its own
  // invocation, then the first hard audit + any programmatic patches.
  let pendingFailures = await recomputeBenchmarks(output, gender, [], PACK);

  let auditResult = auditOutput(output, payload, skeleton, PACK);
  console.log(`[generate-program-v3] audits: ${summarizeAuditRun(auditResult)}`);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };

  let byKind = classifyFailuresByKind(auditResult.failures);

  // Programmatic patches (no LLM call).
  if (byKind["programmatic-fix"].length > 0) {
    const patch = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload, PACK);
    if (patch.patched > 0) {
      console.log(`[generate-program-v3] programmatic patches applied: ${patch.patched}`);
      for (const line of patch.log) console.log(`  - ${line}`);
      pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, PACK, []);
      auditResult = auditOutput(output, payload, skeleton, PACK);
      console.log(`[generate-program-v3] audits after patch: ${summarizeAuditRun(auditResult)}`);
      if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
      byKind = classifyFailuresByKind(auditResult.failures);
    }
  }

  if (byKind["block-local"].length > 0) {
    // Hand off to surgical with an initialized cursor.
    return {
      next: "surgical",
      resumeState: { ...rs, surgical: { output, pendingFailures, recentCounts: [], pass: 0 } },
      displayStage: "surgical_fix",
    };
  }

  // Only structural failures remain — surgical can't fix those. Ship with
  // residuals logged (the athlete still gets a program; operators see what
  // slipped through in the admin panel).
  const residual = auditResult.failures;
  if (residual.length > 0) {
    console.warn(`[generate-program-v3] shipping with ${residual.length} unresolved (non-block-local) audit failure(s)`);
  }
  return { next: "safety_review", resumeState: toSafety(rs, output, residual), displayStage: "safety_review" };
}

async function stageSurgical(
  _supa: SupabaseClient,
  _job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const gender = resolveGender(payload);
  const cursor = rs.surgical!;
  const output = cursor.output;
  let pendingFailures = cursor.pendingFailures;
  const pass = cursor.pass + 1;

  // Re-derive current failures (audits are pure + cheap — no LLM).
  let auditResult = auditOutput(output, payload, skeleton, PACK);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
  let byKind = classifyFailuresByKind(auditResult.failures);
  if (byKind["block-local"].length === 0) {
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  // ONE surgical pass this invocation (fresh wall-clock). Each block ~30s,
  // sequential. A killed pass persists nothing → the reaper redoes it from the
  // last clean state.
  const sg = await applySurgicalFixes(output, byKind["block-local"], payload, skeleton, PACK);
  console.log(`[generate-program-v3] surgical pass ${pass}: rewritten=${sg.rewritten} failed=${sg.failed}`);
  if (sg.rewritten === 0) {
    // LLM call(s) failed — stall, ship with residuals.
    console.log(`[generate-program-v3] surgical stalled at pass ${pass} (LLM call(s) failed); shipping residuals`);
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, PACK, sg.locations);
  auditResult = auditOutput(output, payload, skeleton, PACK);
  console.log(`[generate-program-v3] audits after surgical pass ${pass}: ${summarizeAuditRun(auditResult)}`);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
  byKind = classifyFailuresByKind(auditResult.failures);

  // Programmatic patches may resurface between passes.
  if (byKind["programmatic-fix"].length > 0) {
    const patch2 = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload, PACK);
    if (patch2.patched > 0) {
      for (const line of patch2.log) console.log(`  - ${line}`);
      pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, PACK, []);
      auditResult = auditOutput(output, payload, skeleton, PACK);
      if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
      byKind = classifyFailuresByKind(auditResult.failures);
    }
  }

  const blockLocalCount = byKind["block-local"].length;
  const recentCounts = [...cursor.recentCounts, blockLocalCount];

  // Stall: failing-block count stable for STALL_HALT_PASSES consecutive passes
  // (the count is monotonically non-increasing, so a plateau means oscillation).
  if (recentCounts.length >= STALL_HALT_PASSES) {
    const window = recentCounts.slice(-STALL_HALT_PASSES);
    if (window.every((c) => c === window[0])) {
      console.log(
        `[generate-program-v3] surgical stalled at pass ${pass}: failing-block count stable at ${window[0]} for ${STALL_HALT_PASSES} passes; shipping residuals`,
      );
      return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
    }
  }

  if (blockLocalCount === 0) {
    // Only structural failures remain — surgical is done.
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  // Another pass — re-enter surgical with the updated cursor.
  return {
    next: "surgical",
    resumeState: { ...rs, surgical: { output, pendingFailures, recentCounts, pass } },
    displayStage: "surgical_retry",
  };
}

async function stageSafetyReview(
  _supa: SupabaseClient,
  _job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  // ADVISORY ONLY — never regenerates. Runs once, logs any flagged violations,
  // ships the program unchanged. (Injury-contraindicated movements are already
  // filtered structurally via injuries_structured.do_not_program.)
  const payload = rs.payload!;
  const output = rs.output!;
  const safety = await reviewSafety(
    output,
    payload.training_context.goal_text,
    payload.training_context.injuries_constraints_text,
  );

  if (safety.errored) {
    console.warn("[generate-program-v3] safety-review errored; proceeding:", safety.reasoning);
  } else if (!safety.safe && safety.violations.length > 0) {
    console.warn(
      `[generate-program-v3] safety review flagged ${safety.violations.length} violation(s) — LOGGED ONLY, no regeneration:`,
    );
    for (const v of safety.violations) console.warn(`  - ${v}`);
  }

  return {
    next: "saving",
    resumeState: { ...rs, safety: { safe: safety.safe, reasoning: safety.reasoning, errored: !!safety.errored } },
    displayStage: "saving",
  };
}

async function stageSaving(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const userId = job.user_id;
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const output = rs.output!;
  const monthNumber = rs.continuation.monthNumber;
  const safety = rs.safety ?? { safe: true, reasoning: "", errored: true };

  // Always-run sanitize: strip internal Track/week/deload markers the writer
  // leaks into athlete-facing block_label / block_scheme. Runs after surgical
  // (which can also leak), right before save. Deterministic, idempotent.
  const stripped = stripInternalMarkers(output);
  if (stripped.patched > 0) {
    console.log(`[generate-program-v3] stripped ${stripped.patched} internal marker(s) from labels/schemes`);
  }
  // Coached blocks (strength/metcon/skills/accessory) must have NO block_label —
  // the block_scheme is their header. Warm-up/cool-down keep their label.
  const labelFix = enforceNoLabelOnCoachedBlocks(output);
  if (labelFix.patched > 0) {
    console.log(`[generate-program-v3] dropped ${labelFix.patched} redundant block_label(s) from coached blocks`);
  }

  // Resolve the target program id:
  //  - continuation: the existing program (append).
  //  - first-cycle resumed: the shell created on a prior saving attempt.
  //  - first-cycle fresh: create the shell now so the dispatcher always saves in
  //    append mode and the program_months marker can dedup every case.
  let programId = rs.continuation.programId ?? rs.programId ?? null;
  let createdShell = false;
  if (!programId) {
    const { data: shell, error: shellErr } = await supa
      .from("programs")
      .insert({
        user_id: userId,
        name: "My GAINS Program",
        program_version: "v3",
        month_plan: output.month_plan ?? null,
        source: "generated",
      })
      .select("id")
      .single();
    if (shellErr || !shell) {
      throw new Error(`[generate-program-v3] program shell insert failed: ${shellErr?.message ?? "unknown"}`);
    }
    programId = shell.id as string;
    createdShell = true;
  }

  // Idempotency gate: claim this (program, month). A unique-violation means a
  // prior attempt (or a concurrent worker) already saved this month — treat as
  // an idempotent success and skip the write. This is what stops the automated
  // continuation paths (webhook + cron) silently appending two month-2s.
  const { error: markerErr } = await supa
    .from("program_months")
    .insert({ program_id: programId, month_number: monthNumber });
  const alreadySaved = markerErr != null &&
    (markerErr.code === "23505" || /duplicate key|already exists/i.test(markerErr.message ?? ""));
  if (markerErr && !alreadySaved) {
    throw new Error(`[generate-program-v3] program_months marker insert failed: ${markerErr.message}`);
  }

  if (!alreadySaved) {
    try {
      await saveProgramV3(supa, userId, output, {
        name: "My GAINS Program",
        skeleton,
        programId, // always append mode in the dispatcher (shell pre-created for first-cycle)
        monthNumber,
      });
      console.log(`[generate-program-v3] saved program ${programId} (month ${monthNumber})`);

      // Per-generation avoidance record (handoff 1.5 / T6): persist the effective
      // avoidance list that gated THIS cycle, WITH T5 provenance tags — the
      // defensible artifact. Best-effort: a log-write failure must never fail a
      // program that saved. Idempotent via the (program_id, month_number) unique.
      const avoid = payload.training_context.injuries_structured;
      if (avoid) {
        const { error: avErr } = await supa
          .from("program_generation_avoidances")
          .upsert({
            program_id: programId,
            user_id: userId,
            month_number: monthNumber,
            avoidances: {
              do_not_program: avoid.do_not_program,
              blocked_by: avoid.blocked_by ?? {},
            },
          }, { onConflict: "program_id,month_number", ignoreDuplicates: true });
        if (avErr) {
          console.warn("[generate-program-v3] avoidance record write failed (non-fatal):", avErr.message);
        }
      }
    } catch (saveErr) {
      // Undo the marker so a legitimate retry can proceed; delete a fresh shell
      // so a failed first-cycle save doesn't leave an empty program behind.
      await supa.from("program_months").delete()
        .eq("program_id", programId).eq("month_number", monthNumber)
        .then(() => {}, () => {});
      if (createdShell) {
        await supa.from("programs").delete().eq("id", programId).then(() => {}, () => {});
      }
      throw saveErr;
    }
  } else {
    console.log(`[generate-program-v3] month ${monthNumber} already saved for ${programId}; idempotent skip`);
  }

  // Reveal this month's coaching evaluations (non-fatal, scoped to user+month).
  try {
    await Promise.allSettled([
      supa.from("profile_evaluations").update({ visible: true }).eq("user_id", userId).eq("month_number", monthNumber),
      supa.from("training_evaluations").update({ visible: true }).eq("user_id", userId).eq("month_number", monthNumber),
      supa.from("nutrition_evaluations").update({ visible: true }).eq("user_id", userId).eq("month_number", monthNumber),
    ]);
  } catch (visErr) {
    console.warn("[generate-program-v3] eval visibility flip failed (non-fatal):", visErr);
  }

  // Soft audits — log-only safety net.
  try {
    const soft = runSoftAudits({
      output,
      daysPerWeek: payload.training_context.days_per_week,
      lifts: payload.lifts,
      vocabulary: payload.vocabulary,
    });
    if (!soft.passed) {
      for (const failure of soft.failures) {
        console.warn(`[generate-program-v3] SOFT AUDIT FAIL [${failure.rule}]:`);
        for (const v of failure.violations) console.warn(`  - ${v}`);
      }
    } else {
      console.log(`[generate-program-v3] soft audits: ${summarizeAuditRun(soft)}`);
    }
  } catch (softErr) {
    console.warn("[generate-program-v3] soft audit error (non-fatal):", softErr);
  }

  const elapsedMs = rs.startedAtMs ? Date.now() - rs.startedAtMs : null;
  console.log(`[generate-program-v3] complete: program ${programId} month ${monthNumber} (elapsed ${elapsedMs}ms) safe=${safety.safe} errored=${safety.errored}`);

  return {
    next: "complete",
    resumeState: { ...rs, programId },
    complete: {
      programId,
      resultJson: {
        output,
        safety,
        elapsed_ms: elapsedMs,
        // block-local audits surgical couldn't resolve; empty on a clean run.
        residual_audit_failures: rs.residualFailures ?? [],
      },
    },
  };
}

// ============================================================
// runStage — the dispatcher. Routes the job's current next_stage to its stage
// function through runStageWithLease (claim → heartbeat → run → commit →
// self-retrigger). Invoked at kickoff (stage 1) and by every self-retrigger /
// reaper re-dispatch.
// ============================================================

async function runStage(jobId: string): Promise<void> {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: job } = await supa
    .from("program_jobs")
    .select("next_stage, user_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job?.next_stage) return; // complete / failed / no stage — nothing to do
  const stage = job.next_stage as Stage;
  const userId = job.user_id as string;

  switch (stage) {
    case "payload_building":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stagePayloadBuilding(supa, j, rs));
    case "coach_state":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageCoachState(supa, j, rs));
    case "skeleton":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageSkeleton(supa, j, rs));
    case "fill_week_1":
    case "fill_week_2":
    case "fill_week_3":
    case "fill_week_4": {
      const weekNum = parseInt(stage.slice("fill_week_".length), 10);
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageFillWeek(supa, j, rs, weekNum));
    }
    case "benchmark_audit":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageBenchmarkAudit(supa, j, rs));
    case "surgical":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageSurgical(supa, j, rs));
    case "safety_review":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageSafetyReview(supa, j, rs));
    case "saving":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageSaving(supa, j, rs));
    default:
      console.error(`[generate-program-v3] unknown stage: ${stage}`);
  }
}

// Exported for the job-reaper to re-dispatch a stale job in-process if it ever
// runs co-located; the normal re-dispatch path is an HTTP self-retrigger.
export { runStage };

// ============================================================
// HTTP handler — kickoff (auth + month resolution + job row + fire stage 1) OR
// a service-authed resume (self-retrigger / reaper) of an in-flight job.
// ============================================================

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");

    const jsonErr = (status: number, error: string, message?: string) =>
      new Response(JSON.stringify({ error, ...(message ? { message } : {}) }), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    const body = await req.json().catch(() => ({}));

    // ── Resume path: a self-retrigger or reaper re-dispatch of an in-flight job.
    // Service-only (the service key); runs the job's current stage. The stage's
    // atomic claim makes a duplicate/late resume a safe no-op.
    const resumeJobId: string | null = body?.resume_job_id ?? null;
    if (resumeJobId) {
      if (token !== SUPABASE_SERVICE_KEY) return jsonErr(401, "Unauthorized");
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(runStage(resumeJobId));
      return new Response(
        JSON.stringify({ ok: true, resumed: resumeJobId }),
        { status: 202, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const reqProgramId: string | null = body?.program_id ?? null;
    const reqMonthNumber: number | null =
      typeof body?.month_number === "number" ? body.month_number : null;

    // Auth: internal server-to-server (generate-next-month / webhook / cron pass
    // x-webhook-user-id + the service-role key) OR a user JWT.
    const webhookUserId = req.headers.get("x-webhook-user-id");
    const isServiceCall = !!webhookUserId && token === SUPABASE_SERVICE_KEY;
    let userId: string;
    if (isServiceCall) {
      userId = webhookUserId!;
    } else {
      const { data: { user }, error: authErr } = await supa.auth.getUser(token);
      if (authErr || !user) return jsonErr(401, "Unauthorized");
      userId = user.id;
    }

    // Resolve which month to generate.
    //   - Continuation (program_id present): validate ownership + v3, then the
    //     next month is generated_months + 1. Service callers may pass it
    //     explicitly; user callers get the derived value and CANNOT override it.
    //   - New program (no program_id): users ALWAYS start at month 1. Only a
    //     trusted service caller may seed a new program at month > 1 (migration).
    let monthNumber: number;
    if (reqProgramId) {
      const { data: prog } = await supa
        .from("programs")
        .select("id, generated_months, program_version")
        .eq("id", reqProgramId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!prog) return jsonErr(404, "Program not found");
      if (prog.program_version !== "v3") {
        return jsonErr(400, "Bad Request", "Continuation requires a v3 program.");
      }
      const nextMonth = (prog.generated_months || 1) + 1;
      if (isServiceCall) {
        monthNumber = reqMonthNumber ?? nextMonth;
      } else {
        if (reqMonthNumber != null && reqMonthNumber !== nextMonth) {
          return jsonErr(400, "Bad Request", `Can only generate month ${nextMonth} next for this program.`);
        }
        monthNumber = nextMonth;
      }
      if (monthNumber < 2) {
        return jsonErr(400, "Bad Request", "Continuation month must be ≥ 2.");
      }
    } else {
      monthNumber = isServiceCall ? (reqMonthNumber ?? 1) : 1;
    }

    // Create the job already at stage 1, with continuation seeded into
    // resume_state (payload_building needs monthNumber). status='processing' so
    // the first claim succeeds; locked_at null so it's immediately claimable.
    const initialResume: ResumeState = {
      continuation: { programId: reqProgramId, monthNumber },
    };
    const { data: job, error: jobErr } = await supa
      .from("program_jobs")
      .insert({
        user_id: userId,
        status: "processing",
        stage: "payload_building",
        next_stage: "payload_building",
        resume_state: initialResume,
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      console.error("[generate-program-v3] failed to create job:", jobErr);
      return jsonErr(500, "Failed to start v3 program generation");
    }

    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(runStage(job.id));

    return new Response(
      JSON.stringify({ ok: true, job_id: job.id }),
      { status: 202, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[generate-program-v3] unhandled:", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return new Response(
      JSON.stringify({ error: "GENERATION_FAILED", message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
