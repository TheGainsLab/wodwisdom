/**
 * gym-generate/index.ts — the staged gym cohort generation worker.
 *
 * RESUMABLE PER-STAGE DISPATCHER for the gym path — the mirror of
 * generate-program-v3's fix, on gym_program_jobs (see gym-dispatcher.ts and the
 * 20260707200000 migration for why: the old synchronous cohort run could never
 * finish inside the platform wall-clock).
 *
 * Stages: skeleton → fill_week_1..4 → benchmark_audit →
 *         surgical (one pass per invocation, re-enters itself) → safety_review →
 *         saving → complete.
 *
 * Every stage's actual work is the SAME Engine pipeline code the synchronous
 * path used (generateSkeletonWithAudits, callWeekFill, auditOutput,
 * applyProgrammaticFixes/applySurgicalFixes, recomputeBenchmarks,
 * computeCohortScaling, persistCohortResult) — the stage functions are ports of
 * generate-program-v3's stages with retail's payload/tdi swapped for the cohort
 * envelope the cron seeds into resume_state. Nothing in the pipeline itself
 * changes.
 *
 * Owner-review gate: a job created with pause_after_skeleton=true parks at
 * status='awaiting_approval' after the skeleton stage (skeleton_json holds the
 * reviewable artifact). POST { approve_job_id } resumes it at fill_week_1.
 *
 * Kickoff lives in gym-cohort-cron (claims the due gym, builds envelope +
 * roster, creates the job, fires stage 1). This function accepts:
 *   - { resume_job_id }  service-key bearer — self-retrigger / reaper re-dispatch
 *   - { approve_job_id } service-key bearer OR x-cron-key — owner approval
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import type { WriterOutput } from "../_shared/v2-output-schema.ts";
import { classifyFailuresByKind, summarizeAuditRun } from "../_shared/audit-runner.ts";
import { getDomainPack } from "../_shared/domain-packs/registry.ts";
import type { SkeletonOutput } from "../_shared/v3-output-schema.ts";
import {
  applyProgrammaticFixes,
  applySurgicalFixes,
  auditOutput,
  callSkeletonWriter,
  callWeekFill,
  generateSkeletonWithAudits,
  recomputeBenchmarks,
  resolveGender,
  STALL_HALT_PASSES,
} from "../_shared/engine/pipeline.ts";
import { computeCohortScaling } from "../_shared/engine/cohort.ts";
import type { EngineGenerateResult } from "../_shared/engine/contract.ts";
import { persistCohortResult } from "../_shared/cohort/persist-cohort-result.ts";
import {
  type GymProgramJobRow,
  type GymResumeState,
  type GymStage,
  type GymStageOutcome,
  gymSelfRetrigger,
  runGymStageWithLease,
} from "../_shared/gym-dispatcher.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GYM_COHORT_CRON_KEY = Deno.env.get("GYM_COHORT_CRON_KEY");

/** Transition into safety_review: drop the surgical cursor, persist the final
 *  output + residual failures. (Port of generate-program-v3's toSafety.) */
function toSafety(rs: GymResumeState, output: WriterOutput, residualFailures: unknown[]): GymResumeState {
  const { surgical: _drop, ...rest } = rs;
  return { ...rest, output, residualFailures };
}

// ============================================================
// Session-time budget audit (gym-local — a CLASS runs on a clock).
//
// The first real generation (2026-07-07) proved the prompt's session-length
// guidance is advisory-only: with a 60-min budget it emitted 75-85 min days
// (28-min-cap chippers after 5×5 + skills EMOM + accessory). The structural
// audits never sum a day's time, so nothing pushed back. This audit does:
// estimate each skeleton day's minutes from its block list, and make the
// writer retry any day that blows the budget. Estimates are deliberately
// coach-conservative heuristics; unresolved findings after the retry budget
// are surfaced as warnings (owner review desk material), never a hard fail —
// a heuristic must not brick generation.
//
// Kept gym-local (not in the shared pack audits) so retail behavior is
// untouched; when it's proven here it can graduate to the pack (DEBT #548
// altitude).
// ============================================================

type SkeletonDay = SkeletonOutput["weeks"][number]["days"][number];

const FIXED_BLOCK_MINUTES: Record<string, number> = {
  "warm-up": 8,
  "mobility": 5,
  "skills": 10,
  "accessory": 12,
  "active-recovery": 8,
  "cool-down": 5,
};

function estimateStrengthMinutes(scheme: string | null | undefined): number {
  // "5x5 @75%" → 5 working sets ≈ 2.5 min each (set + rest) + warm-up sets.
  const m = (scheme ?? "").match(/(\d+)\s*x\s*\d+/i);
  const sets = m ? parseInt(m[1], 10) : 4;
  return Math.round(sets * 2.5 + 4);
}

function estimateMetconMinutes(focus: string | null | undefined): number {
  const text = (focus ?? "").toLowerCase();
  // The skeleton usually states a range ("long aerobic chipper 20-25 min") — take the top.
  const range = text.match(/(\d+)\s*(?:[-–—]\s*(\d+))?\s*min/);
  if (range) return parseInt(range[2] ?? range[1], 10);
  if (text.includes("long")) return 22;
  if (text.includes("short")) return 8;
  return 14;
}

function estimateDayMinutes(day: SkeletonDay): { total: number; parts: string[] } {
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

const BUDGET_SLACK_MINUTES = 5;

function auditSessionBudget(skeleton: SkeletonOutput, budgetMinutes: number): string[] {
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

function budgetRetryMessage(violations: string[], budgetMinutes: number): string {
  return [
    "Your previous skeleton failed the SESSION-TIME BUDGET audit. These class days do not fit the session length. Fix ALL of them and emit a corrected skeleton via the emit_skeleton tool — do NOT explain.",
    "",
    ...violations.map((v) => `  - ${v}`),
    "",
    `Every day must fit a ${budgetMinutes}-minute CLASS including warm-up and cool-down. To fix: use FEWER middle blocks per day (a class day carries ONE primary focus piece — do not stack a skills block AND a full strength block AND an accessory block AND a long metcon on the same day), and keep metcon_focus time domains ≤ ${Math.max(8, Math.round(budgetMinutes / 4))} min on days that also have a strength block.`,
  ].join("\n");
}

/** Extra writer attempts dedicated to the budget audit (structural audits keep
 *  their own loop inside generateSkeletonWithAudits). */
const BUDGET_RETRIES = 2;

async function generateSkeletonWithinBudget(
  rs: GymResumeState,
  pack: ReturnType<typeof getDomainPack>,
): Promise<{ skeleton: SkeletonOutput; budgetWarnings: string[] }> {
  const tdi = rs.tdi!;
  let skeleton = await generateSkeletonWithAudits(tdi, pack);

  const budget = tdi.session_length_minutes;
  if (budget == null || budget <= 0) return { skeleton, budgetWarnings: [] };

  let violations = auditSessionBudget(skeleton, budget);
  for (let attempt = 1; attempt <= BUDGET_RETRIES && violations.length > 0; attempt++) {
    console.log(
      `[gym-generate] session-budget audit: ${violations.length} day(s) over ${budget} min; retry ${attempt}/${BUDGET_RETRIES}`,
    );
    const candidate = await callSkeletonWriter(tdi, budgetRetryMessage(violations, budget), pack);
    const structural = pack.audits.runSkeleton({
      skeleton: candidate,
      daysPerWeek: tdi.days_per_week,
      trainingDesignInput: tdi,
    });
    if (!structural.passed) {
      // A budget retry must never trade a time problem for a structural one —
      // keep the last structurally-valid skeleton and try again.
      console.warn(
        `[gym-generate] budget-retry skeleton failed structural audits (${pack.audits.summarizeSkeleton(structural)}); keeping prior skeleton`,
      );
      continue;
    }
    skeleton = candidate;
    violations = auditSessionBudget(skeleton, budget);
  }

  if (violations.length > 0) {
    console.warn(`[gym-generate] session-budget audit unresolved after ${BUDGET_RETRIES} retries — shipping with warnings:`);
    for (const v of violations) console.warn(`  - ${v}`);
  } else {
    console.log(`[gym-generate] session-budget audit: all days fit ${budget} min`);
  }
  return { skeleton, budgetWarnings: violations };
}

// ============================================================
// Stages — ports of generate-program-v3's stages onto the cohort envelope.
// ============================================================

async function stageSkeleton(
  job: GymProgramJobRow,
  rs: GymResumeState,
): Promise<GymStageOutcome> {
  const pack = getDomainPack(rs.domain_pack);
  const { skeleton, budgetWarnings } = await generateSkeletonWithinBudget(rs, pack);
  console.log(`[gym-generate] skeleton passed audits (gym ${rs.gym_id})`);
  return {
    next: "fill_week_1",
    resumeState: { ...rs, skeleton, weeks: [], budgetWarnings },
    displayStage: "skeleton_done",
    // Mirror to skeleton_json — the owner review desk's artifact.
    extraPatch: { skeleton_json: skeleton },
    // The owner-review gate (thesis layer 1). False on shakedown runs.
    pause: job.pause_after_skeleton,
  };
}

async function stageFillWeek(
  _job: GymProgramJobRow,
  rs: GymResumeState,
  weekNum: number,
): Promise<GymStageOutcome> {
  const pack = getDomainPack(rs.domain_pack);
  const priorWeeks = rs.weeks ?? [];
  const wk = await callWeekFill(rs.payload!, rs.skeleton!, weekNum, priorWeeks, "", pack);
  const weeks = [...priorWeeks, wk];
  const next: GymStage = weekNum < 4 ? (`fill_week_${weekNum + 1}` as GymStage) : "benchmark_audit";
  return { next, resumeState: { ...rs, weeks }, displayStage: next };
}

async function stageBenchmarkAudit(
  _job: GymProgramJobRow,
  rs: GymResumeState,
): Promise<GymStageOutcome> {
  const pack = getDomainPack(rs.domain_pack);
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const gender = resolveGender(payload);
  const output: WriterOutput = { month_plan: skeleton.month_plan, weeks: rs.weeks ?? [] };

  let pendingFailures = await recomputeBenchmarks(output, gender, [], pack);

  let auditResult = auditOutput(output, payload, skeleton, pack);
  console.log(`[gym-generate] audits: ${summarizeAuditRun(auditResult)}`);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };

  let byKind = classifyFailuresByKind(auditResult.failures);

  if (byKind["programmatic-fix"].length > 0) {
    const patch = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload, pack);
    if (patch.patched > 0) {
      console.log(`[gym-generate] programmatic patches applied: ${patch.patched}`);
      for (const line of patch.log) console.log(`  - ${line}`);
      pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, pack, []);
      auditResult = auditOutput(output, payload, skeleton, pack);
      console.log(`[gym-generate] audits after patch: ${summarizeAuditRun(auditResult)}`);
      if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
      byKind = classifyFailuresByKind(auditResult.failures);
    }
  }

  if (byKind["block-local"].length > 0) {
    return {
      next: "surgical",
      resumeState: { ...rs, surgical: { output, pendingFailures, recentCounts: [], pass: 0 } },
      displayStage: "surgical_fix",
    };
  }

  const residual = auditResult.failures;
  if (residual.length > 0) {
    console.warn(`[gym-generate] shipping with ${residual.length} unresolved (non-block-local) audit failure(s)`);
  }
  return { next: "safety_review", resumeState: toSafety(rs, output, residual), displayStage: "safety_review" };
}

async function stageSurgical(
  _job: GymProgramJobRow,
  rs: GymResumeState,
): Promise<GymStageOutcome> {
  const pack = getDomainPack(rs.domain_pack);
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const gender = resolveGender(payload);
  const cursor = rs.surgical!;
  const output = cursor.output;
  let pendingFailures = cursor.pendingFailures;
  const pass = cursor.pass + 1;

  let auditResult = auditOutput(output, payload, skeleton, pack);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
  let byKind = classifyFailuresByKind(auditResult.failures);
  if (byKind["block-local"].length === 0) {
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  // ONE surgical pass per invocation (fresh wall-clock), like retail.
  const sg = await applySurgicalFixes(output, byKind["block-local"], payload, skeleton, pack);
  console.log(`[gym-generate] surgical pass ${pass}: rewritten=${sg.rewritten} failed=${sg.failed}`);
  if (sg.rewritten === 0) {
    console.log(`[gym-generate] surgical stalled at pass ${pass} (LLM call(s) failed); shipping residuals`);
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, pack, sg.locations);
  auditResult = auditOutput(output, payload, skeleton, pack);
  console.log(`[gym-generate] audits after surgical pass ${pass}: ${summarizeAuditRun(auditResult)}`);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
  byKind = classifyFailuresByKind(auditResult.failures);

  if (byKind["programmatic-fix"].length > 0) {
    const patch2 = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload, pack);
    if (patch2.patched > 0) {
      for (const line of patch2.log) console.log(`  - ${line}`);
      pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, pack, []);
      auditResult = auditOutput(output, payload, skeleton, pack);
      if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
      byKind = classifyFailuresByKind(auditResult.failures);
    }
  }

  const blockLocalCount = byKind["block-local"].length;
  const recentCounts = [...cursor.recentCounts, blockLocalCount];

  if (recentCounts.length >= STALL_HALT_PASSES) {
    const window = recentCounts.slice(-STALL_HALT_PASSES);
    if (window.every((c) => c === window[0])) {
      console.log(
        `[gym-generate] surgical stalled at pass ${pass}: failing-block count stable at ${window[0]} for ${STALL_HALT_PASSES} passes; shipping residuals`,
      );
      return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
    }
  }

  if (blockLocalCount === 0) {
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  return {
    next: "surgical",
    resumeState: { ...rs, surgical: { output, pendingFailures, recentCounts, pass } },
    displayStage: "surgical_retry",
  };
}

async function stageSafetyReview(
  _job: GymProgramJobRow,
  rs: GymResumeState,
): Promise<GymStageOutcome> {
  // ADVISORY ONLY — never regenerates (same rule as retail + run-engine).
  const pack = getDomainPack(rs.domain_pack);
  const payload = rs.payload!;
  const output = rs.output!;
  const safety = await pack.safety.review(
    output,
    payload.training_context.goal_text,
    payload.training_context.injuries_constraints_text,
  );

  if (safety.errored) {
    console.warn("[gym-generate] safety-review errored; proceeding:", safety.reasoning);
  } else if (!safety.safe) {
    console.warn(`[gym-generate] safety review flagged issues — LOGGED ONLY, no regeneration: ${safety.reasoning}`);
  }

  return {
    next: "saving",
    resumeState: { ...rs, safety: { safe: safety.safe, reasoning: safety.reasoning, errored: !!safety.errored } },
    displayStage: "saving",
  };
}

async function stageSaving(
  supa: SupabaseClient,
  job: GymProgramJobRow,
  rs: GymResumeState,
): Promise<GymStageOutcome> {
  const pack = getDomainPack(rs.domain_pack);
  const output = rs.output!;
  const skeleton = rs.skeleton!;
  const roster = rs.roster ?? [];
  const safety = rs.safety ?? { safe: true, reasoning: "", errored: true };

  // Save-path sanitizers — the same always-run finish steps as run-engine/v3.
  const stripped = pack.finish.stripInternalMarkers(output);
  if (stripped.patched > 0) {
    console.log(`[gym-generate] stripped ${stripped.patched} internal marker(s) from labels/schemes`);
  }
  const labelFix = pack.finish.enforceNoLabelOnCoachedBlocks(output);
  if (labelFix.patched > 0) {
    console.log(`[gym-generate] dropped ${labelFix.patched} redundant block_label(s) from coached blocks`);
  }

  // Idempotency gate (mirrors retail's program_months marker): claim this job's
  // save. cohort_program_id present on the marker = a prior attempt fully
  // persisted → reuse it. Marker present but id null = a prior worker died
  // between marker and persist → clear and redo.
  let cohortProgramId: string | null = null;
  const { error: markerErr } = await supa
    .from("gym_program_job_saves")
    .insert({ job_id: job.id });
  if (markerErr) {
    const isDup = markerErr.code === "23505" || /duplicate key|already exists/i.test(markerErr.message ?? "");
    if (!isDup) throw new Error(`gym_program_job_saves marker insert failed: ${markerErr.message}`);
    const { data: marker } = await supa
      .from("gym_program_job_saves")
      .select("cohort_program_id")
      .eq("job_id", job.id)
      .maybeSingle();
    cohortProgramId = (marker as { cohort_program_id: string | null } | null)?.cohort_program_id ?? null;
    if (cohortProgramId) {
      console.log(`[gym-generate] job ${job.id} already persisted ${cohortProgramId}; idempotent skip`);
    }
  }

  if (!cohortProgramId) {
    // Deterministic per-member scaling (no LLM) + the ONE shared persist path.
    const result: EngineGenerateResult = {
      mode: "cohort",
      tenant_id: rs.gym_id,
      domain_pack: pack.id,
      programs: [{
        athlete_ref: null,
        output,
        skeleton,
        residual_audit_failures: rs.residualFailures ?? [],
        safety,
      }],
      scalings: roster.map((a) => computeCohortScaling(output, a, pack)),
    };
    try {
      const persisted = await persistCohortResult(supa, result);
      cohortProgramId = persisted.cohort_program_id;
    } catch (persistErr) {
      // Undo the marker so a legitimate retry can redo the save.
      await supa.from("gym_program_job_saves").delete().eq("job_id", job.id).then(() => {}, () => {});
      throw persistErr;
    }
    await supa
      .from("gym_program_job_saves")
      .update({ cohort_program_id: cohortProgramId })
      .eq("job_id", job.id)
      .then(() => {}, () => {});
  }

  // Success stamp on the gym config (moved here from the old cron — only a
  // PERSISTED program counts as generated). Non-fatal, like the old cron.
  const { error: stampErr } = await supa
    .from("gym_cohort_configs")
    .update({ last_generated_at: new Date().toISOString(), attempt_count: 0, next_attempt_at: null })
    .eq("gym_id", rs.gym_id);
  if (stampErr) {
    console.error("[gym-generate] success stamp failed:", rs.gym_id, stampErr.message);
  }

  const elapsedMs = rs.startedAtMs ? Date.now() - rs.startedAtMs : null;
  console.log(
    `[gym-generate] complete: gym ${rs.gym_id} program ${cohortProgramId} members_scaled=${roster.length} elapsed=${elapsedMs}ms safe=${safety.safe}`,
  );

  return {
    next: "complete",
    resumeState: rs,
    complete: {
      cohortProgramId,
      resultJson: {
        cohort_program_id: cohortProgramId,
        members_scaled: roster.length,
        safety,
        residual_audit_failures: rs.residualFailures ?? [],
        session_budget_warnings: rs.budgetWarnings ?? [],
        elapsed_ms: elapsedMs,
      },
    },
  };
}

// ============================================================
// runStage — routes the job's current next_stage through the lease harness.
// ============================================================

async function runStage(jobId: string): Promise<void> {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: job } = await supa
    .from("gym_program_jobs")
    .select("next_stage, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!job?.next_stage || job.status !== "processing") return; // complete/failed/paused
  const stage = job.next_stage as GymStage;

  switch (stage) {
    case "skeleton":
      return runGymStageWithLease(supa, jobId, stage, (j, rs) => stageSkeleton(j, rs));
    case "fill_week_1":
    case "fill_week_2":
    case "fill_week_3":
    case "fill_week_4": {
      const weekNum = parseInt(stage.slice("fill_week_".length), 10);
      return runGymStageWithLease(supa, jobId, stage, (j, rs) => stageFillWeek(j, rs, weekNum));
    }
    case "benchmark_audit":
      return runGymStageWithLease(supa, jobId, stage, (j, rs) => stageBenchmarkAudit(j, rs));
    case "surgical":
      return runGymStageWithLease(supa, jobId, stage, (j, rs) => stageSurgical(j, rs));
    case "safety_review":
      return runGymStageWithLease(supa, jobId, stage, (j, rs) => stageSafetyReview(j, rs));
    case "saving":
      return runGymStageWithLease(supa, jobId, stage, (j, rs) => stageSaving(supa, j, rs));
    default:
      console.error(`[gym-generate] unknown stage: ${stage}`);
  }
}

// ============================================================
// HTTP handler — resume (self-retrigger / reaper) or approve (owner sign-off).
// Job CREATION lives in gym-cohort-cron.
// ============================================================

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const isService = bearer === SUPABASE_SERVICE_KEY;
    const isCronKey = !!GYM_COHORT_CRON_KEY && req.headers.get("x-cron-key") === GYM_COHORT_CRON_KEY;

    // ── Resume: self-retrigger / reaper re-dispatch. Service-only. ────────────
    const resumeJobId: string | null = body?.resume_job_id ?? null;
    if (resumeJobId) {
      if (!isService) return json({ error: "forbidden" }, 401);
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(runStage(resumeJobId));
      return json({ ok: true, resumed: resumeJobId }, 202);
    }

    // ── Approve: resume a job parked at awaiting_approval (the owner signed the
    // skeleton). Service key or the cron key (the portal's consumer-keyed
    // approve endpoint is the follow-up; this is the seam it will call).
    const approveJobId: string | null = body?.approve_job_id ?? null;
    if (approveJobId) {
      if (!isService && !isCronKey) return json({ error: "forbidden" }, 401);
      const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data, error } = await supa
        .from("gym_program_jobs")
        .update({ status: "processing", stage: "approved_resuming", updated_at: new Date().toISOString() })
        .eq("id", approveJobId)
        .eq("status", "awaiting_approval")
        .select("id, next_stage");
      if (error) return json({ error: "approve_failed", detail: error.message }, 500);
      if (!data || data.length === 0) {
        return json({ error: "not_awaiting_approval", detail: "job not found or not awaiting approval" }, 409);
      }
      await gymSelfRetrigger(approveJobId);
      return json({ ok: true, approved: approveJobId, resuming_at: data[0].next_stage }, 202);
    }

    return json({ error: "bad_request", detail: "expected resume_job_id or approve_job_id" }, 400);
  } catch (err) {
    console.error("[gym-generate] unhandled:", err);
    return json({ error: "internal", detail: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
