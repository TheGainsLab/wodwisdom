/**
 * generate-program-v3/index.ts
 *
 * v3 chained-generation edge function. Admin-gated for Phase 1.
 *
 * Pipeline:
 *   1. Auth + admin gate.
 *   2. buildWriterPayload(supa, userId, { includeAllResults: false }).
 *   3. callSkeletonWriter — emit 4-week structural skeleton.
 *      Retried up to MAX_SKELETON_ATTEMPTS times with skeleton-audit
 *      violations fed back. Skeleton stored to program_jobs.skeleton_json
 *      as soon as it passes audits.
 *   4. callFullProgramWriter(payload, skeleton) — emit the full
 *      4-week movement-level program using the skeleton as planning
 *      context. (Hybrid step: still uses the v2 writer prompt for the
 *      movement-level fill. Per-week fill is a later iteration.)
 *      Retried up to MAX_AUDIT_ATTEMPTS times with v2-audit violations
 *      fed back.
 *   5. Safety review + regen loop (reuses v2's reviewSafety pipeline).
 *   6. Save to programs + program_workouts + program_blocks_v2 +
 *      program_movements_v2 with program_version='v3'.
 *
 * Background-job pattern (mirrors v2): kickoff creates a program_jobs
 * row + fires processJob via EdgeRuntime.waitUntil + returns 202 with
 * { job_id }. Client polls program-job-status for progress + result.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { buildWriterPayload, type WriterPayload } from "../_shared/build-writer-payload.ts";
import { V3_SKELETON_SYSTEM_PROMPT } from "../_shared/v3-skeleton-prompt.ts";
import { V2_GENERATE_PROGRAM_SYSTEM_PROMPT } from "../_shared/v2-system-prompt.ts";
import {
  buildEmitSkeletonTool,
  type SkeletonOutput,
} from "../_shared/v3-output-schema.ts";
import {
  buildEmitProgramTool,
  type WriterOutput,
} from "../_shared/v2-output-schema.ts";
import {
  runSkeletonAudits,
  formatSkeletonViolationsForRetry,
  summarizeSkeletonAuditRun,
  type SkeletonAuditResult,
} from "../_shared/v3-skeleton-audits.ts";
import {
  runAudits,
  formatViolationsForRetry,
  summarizeAuditRun,
} from "../_shared/audit-runner.ts";
import { reviewSafety, type SafetyReviewResult } from "../_shared/safety-review.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-20250514";
const MAX_SKELETON_ATTEMPTS = 3;
const MAX_AUDIT_ATTEMPTS = 3;
const MAX_SAFETY_ATTEMPTS = 3;

interface ClaudeContentBlock {
  type?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

interface ClaudeResponse {
  content?: ClaudeContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

// ============================================================
// Stage update helper — mirrors v2's setStage callback.
// ============================================================

type SetStage = (stage: string) => Promise<void> | void;
const NO_STAGE: SetStage = () => {};

// ============================================================
// Errors — preserve last skeleton / output on exhaustion so admin
// can inspect what the writer produced.
// ============================================================

class SkeletonLoopExhausted extends Error {
  constructor(
    public readonly lastSkeleton: SkeletonOutput,
    public readonly lastFailures: SkeletonAuditResult[],
  ) {
    super(
      `Skeleton audits persisted after ${MAX_SKELETON_ATTEMPTS} attempts. Last failures: ${lastFailures.map((f) => f.rule).join(", ")}`,
    );
    this.name = "SkeletonLoopExhausted";
  }
}

class AuditLoopExhausted extends Error {
  constructor(
    public readonly lastOutput: WriterOutput,
    public readonly lastFailures: ReturnType<typeof runAudits>["failures"],
  ) {
    super(
      `Audit failures persisted after ${MAX_AUDIT_ATTEMPTS} attempts. Last failures: ${lastFailures.map((f) => f.rule).join(", ")}`,
    );
    this.name = "AuditLoopExhausted";
  }
}

// ============================================================
// Writer calls
// ============================================================

/**
 * Call the v3 skeleton writer. Returns parsed SkeletonOutput on success.
 */
export async function callSkeletonWriter(
  payload: WriterPayload,
  retryViolations: string,
): Promise<SkeletonOutput> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const daysPerWeek = payload.training_context.days_per_week;
  const units = payload.basics.units ?? "lbs";

  const ruleRecap = [
    "=== KEY RULES (re-check before emit) ===",
    `- Output exactly 4 weeks × ${daysPerWeek} days. day_num is 1..${daysPerWeek}.`,
    "- Every training day includes strength + accessory + metcon block types. Skills 2–4 days per week.",
    "- Emit STRUCTURE ONLY — no sets / reps / weight / movement names. Those are filled in subsequent per-week calls.",
    "- primary_lift uses canonical display names (Back Squat, Deadlift, Snatch, Clean and Jerk, etc.) or a complex description.",
    `- All weights in athlete's units (${units}).`,
    "- Honor injuries_structured.do_not_program when picking primary_lift / metcon_focus / skill_focus.",
  ].join("\n");

  const payloadBlock = `ATHLETE PAYLOAD (JSON):\n${JSON.stringify(payload, null, 2)}`;
  const userMessage = retryViolations
    ? `${retryViolations}\n\n---\n\n${payloadBlock}\n\n${ruleRecap}`
    : `${payloadBlock}\n\n${ruleRecap}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      stream: false,
      system: V3_SKELETON_SYSTEM_PROMPT,
      tools: [buildEmitSkeletonTool(daysPerWeek)],
      tool_choice: { type: "tool", name: "emit_skeleton" },
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }

  const data = (await resp.json()) as ClaudeResponse;
  const toolUse = (data.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === "emit_skeleton",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    throw new Error(
      `Claude response missing emit_skeleton tool_use. stop_reason=${data.stop_reason} content=${JSON.stringify(data.content).slice(0, 500)}`,
    );
  }
  console.log(
    `[generate-program-v3 skeleton] Claude usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens} stop_reason=${data.stop_reason}`,
  );
  return toolUse.input as SkeletonOutput;
}

/**
 * Call the full-program writer with the skeleton as planning context.
 * Hybrid step — reuses the v2 writer prompt + tool but injects the
 * skeleton into the user message so movement-level decisions are
 * constrained by the structural decisions already made.
 *
 * Per-week fill is a later iteration; for now one call fills the whole
 * cycle using the skeleton as a strong-suggestion overlay.
 */
async function callFullProgramWriter(
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  retryViolations: string,
): Promise<WriterOutput> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const daysPerWeek = payload.training_context.days_per_week;
  const units = payload.basics.units ?? "lbs";

  const ruleRecap = [
    "=== KEY RULES (re-check before emit) ===",
    `- Output exactly 4 weeks × ${daysPerWeek} days. day_num is 1..${daysPerWeek}.`,
    `- All weights in ${units}.`,
    "- Honor the STRUCTURAL SKELETON below: each day's block_types, primary_lift, strength_scheme, metcon_focus, skill_focus are already decided. Your job is to fill in the movement-level prescriptions.",
    "- Prescribed barbell weight ≤ athlete's 1RM for that lift, unless block_scheme/notes mention a 1RM attempt.",
    "- At most one metcon block per day. Every metcon block must declare a block_scheme.",
    "- Every movement in strength / accessory / metcon / skills blocks must populate at least one of {sets, reps, weight, time_seconds, distance} > 0 — even when block_scheme already conveys the work pattern.",
    "- Read injuries_constraints_text + injuries_structured.do_not_program. Substitute or scale any contraindicated movement.",
  ].join("\n");

  const skeletonBlock = `STRUCTURAL SKELETON (already decided — use as planning constraint):\n${JSON.stringify(skeleton, null, 2)}`;
  const payloadBlock = `ATHLETE PAYLOAD (JSON):\n${JSON.stringify(payload, null, 2)}`;
  const baseMessage = `${skeletonBlock}\n\n${payloadBlock}\n\n${ruleRecap}`;
  const userMessage = retryViolations ? `${retryViolations}\n\n---\n\n${baseMessage}` : baseMessage;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 32000,
      stream: false,
      system: V2_GENERATE_PROGRAM_SYSTEM_PROMPT,
      tools: [buildEmitProgramTool(
        daysPerWeek,
        units,
        payload.training_context.session_length_minutes,
      )],
      tool_choice: { type: "tool", name: "emit_program" },
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }

  const data = (await resp.json()) as ClaudeResponse;
  const toolUse = (data.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === "emit_program",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    throw new Error(
      `Claude response missing emit_program tool_use. stop_reason=${data.stop_reason} content=${JSON.stringify(data.content).slice(0, 500)}`,
    );
  }
  console.log(
    `[generate-program-v3 fill] Claude usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens} stop_reason=${data.stop_reason}`,
  );
  return toolUse.input as WriterOutput;
}

// ============================================================
// Loops
// ============================================================

async function generateSkeletonWithAudits(
  payload: WriterPayload,
  setStage: SetStage = NO_STAGE,
): Promise<SkeletonOutput> {
  let retryViolations = "";
  let lastSkeleton: SkeletonOutput | null = null;
  let lastFailures: SkeletonAuditResult[] = [];

  for (let attempt = 1; attempt <= MAX_SKELETON_ATTEMPTS; attempt++) {
    console.log(`[generate-program-v3] skeleton attempt ${attempt}/${MAX_SKELETON_ATTEMPTS}`);
    await setStage(`skeleton_attempt_${attempt}`);
    const skeleton = await callSkeletonWriter(payload, retryViolations);
    lastSkeleton = skeleton;
    await setStage("skeleton_auditing");
    const auditResult = runSkeletonAudits({
      skeleton,
      daysPerWeek: payload.training_context.days_per_week,
    });
    console.log(`[generate-program-v3] skeleton audits: ${summarizeSkeletonAuditRun(auditResult)}`);
    if (auditResult.passed) return skeleton;
    lastFailures = auditResult.failures;
    retryViolations = formatSkeletonViolationsForRetry(auditResult.failures);
  }

  if (!lastSkeleton) {
    throw new Error("Skeleton loop exhausted but no skeleton was produced.");
  }
  throw new SkeletonLoopExhausted(lastSkeleton, lastFailures);
}

async function generateProgramWithSkeleton(
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  setStage: SetStage = NO_STAGE,
): Promise<WriterOutput> {
  let retryViolations = "";
  let lastOutput: WriterOutput | null = null;
  let lastFailures: ReturnType<typeof runAudits>["failures"] = [];

  for (let attempt = 1; attempt <= MAX_AUDIT_ATTEMPTS; attempt++) {
    console.log(`[generate-program-v3] writer attempt ${attempt}/${MAX_AUDIT_ATTEMPTS}`);
    await setStage(`writer_attempt_${attempt}`);
    const output = await callFullProgramWriter(payload, skeleton, retryViolations);
    lastOutput = output;
    await setStage("auditing");
    const auditResult = runAudits({
      output,
      daysPerWeek: payload.training_context.days_per_week,
      lifts: payload.lifts,
      vocabulary: payload.vocabulary,
    });
    console.log(`[generate-program-v3] audits: ${summarizeAuditRun(auditResult)}`);
    if (auditResult.passed) return output;
    lastFailures = auditResult.failures;
    retryViolations = formatViolationsForRetry(auditResult.failures);
  }

  if (!lastOutput) {
    throw new Error("Audit loop exhausted but no writer output was produced.");
  }
  throw new AuditLoopExhausted(lastOutput, lastFailures);
}

async function runSafetyLoop(
  initialOutput: WriterOutput,
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  setStage: SetStage = NO_STAGE,
): Promise<{ output: WriterOutput; safety: SafetyReviewResult }> {
  let output = initialOutput;
  await setStage("safety_review");
  let safety = await reviewSafety(
    output,
    payload.training_context.goal_text,
    payload.training_context.injuries_constraints_text,
  );

  if (safety.errored) {
    console.warn("[generate-program-v3] safety-review errored; proceeding permissively:", safety.reasoning);
    return { output, safety };
  }

  for (let attempt = 1; attempt <= MAX_SAFETY_ATTEMPTS && !safety.safe; attempt++) {
    console.log(`[generate-program-v3] safety regen ${attempt}/${MAX_SAFETY_ATTEMPTS}; violations: ${safety.violations.length}`);
    await setStage(`safety_regen_${attempt}`);
    const safetyContext = [
      "Your previous program failed the safety review against the athlete's stated injuries / constraints. Regenerate, addressing these violations:",
      "",
      ...safety.violations.map((v) => `  - ${v}`),
      "",
      "Read the injuries text carefully and substitute or scale any contraindicated movements.",
    ].join("\n");

    // Re-call the writer with the original skeleton + safety violations as
    // retry context. Skeleton's structural decisions are preserved; the
    // writer only adjusts movement-level content to honor the constraint.
    output = await callFullProgramWriter(payload, skeleton, safetyContext);

    // Re-run deterministic audits on the regen.
    const auditResult = runAudits({
      output,
      daysPerWeek: payload.training_context.days_per_week,
      lifts: payload.lifts,
      vocabulary: payload.vocabulary,
    });
    if (!auditResult.passed) {
      console.warn(`[generate-program-v3] safety-regen failed audits: ${summarizeAuditRun(auditResult)}`);
      throw new Error("Safety-regen broke deterministic audits; aborting.");
    }

    await setStage("safety_review");
    safety = await reviewSafety(
      output,
      payload.training_context.goal_text,
      payload.training_context.injuries_constraints_text,
    );
  }

  return { output, safety };
}

// ============================================================
// Save — clones v2's saveProgramV2 with program_version='v3'.
// ============================================================

interface InsertedWorkout {
  id: string;
  week_num: number;
  day_num: number;
}

async function saveProgramV3(
  supa: SupabaseClient,
  userId: string,
  output: WriterOutput,
): Promise<string> {
  // 1. programs row — mirror v2's saveProgramV2 exactly (only the
  // fields v2 uses), differ only in program_version and name.
  const { data: program, error: progErr } = await supa
    .from("programs")
    .insert({
      user_id: userId,
      name: "AI Programmer (v3)",
      program_version: "v3",
      month_plan: output.month_plan,
    })
    .select("id")
    .single();
  if (progErr || !program) {
    throw new Error(`[save-v3] programs insert failed: ${progErr?.message ?? "unknown"}`);
  }
  const programId = program.id as string;

  try {
    // 2. program_workouts — one row per day. Mirror v2's field set.
    const workoutInserts: Array<Record<string, unknown>> = [];
    for (const week of output.weeks) {
      for (const day of week.days) {
        workoutInserts.push({
          program_id: programId,
          week_num: week.week_num,
          day_num: day.day_num,
          workout_text: null,
          sort_order: (week.week_num - 1) * 10 + day.day_num,
        });
      }
    }
    const { data: workouts, error: wkErr } = await supa
      .from("program_workouts")
      .insert(workoutInserts)
      .select("id, week_num, day_num");
    if (wkErr || !workouts) {
      throw new Error(`[save-v3] program_workouts insert failed: ${wkErr?.message ?? "unknown"}`);
    }
    const workoutByDay = new Map<string, InsertedWorkout>();
    for (const w of workouts as InsertedWorkout[]) {
      workoutByDay.set(`${w.week_num}-${w.day_num}`, w);
    }

    // 3. program_blocks_v2 — one row per block per day
    const blockInserts: Array<Record<string, unknown>> = [];
    const blockKeyToDay: Array<{ key: string; weekNum: number; dayNum: number; blockIdx: number }> = [];
    for (const week of output.weeks) {
      for (const day of week.days) {
        const w = workoutByDay.get(`${week.week_num}-${day.day_num}`);
        if (!w) throw new Error(`[save-v3] missing program_workouts row for w${week.week_num}d${day.day_num}`);
        for (let bIdx = 0; bIdx < day.blocks.length; bIdx++) {
          const b = day.blocks[bIdx];
          blockInserts.push({
            program_workout_id: w.id,
            block_type: b.block_type,
            block_label: b.block_label ?? null,
            block_scheme: b.block_scheme ?? null,
            time_cap_seconds: b.time_cap_seconds ?? null,
            block_notes: b.block_notes ?? null,
            sort_order: bIdx,
          });
          blockKeyToDay.push({ key: `${week.week_num}-${day.day_num}-${bIdx}`, weekNum: week.week_num, dayNum: day.day_num, blockIdx: bIdx });
        }
      }
    }
    const { data: blocks, error: blErr } = await supa
      .from("program_blocks_v2")
      .insert(blockInserts)
      .select("id");
    if (blErr || !blocks) {
      throw new Error(`[save-v3] program_blocks_v2 insert failed: ${blErr?.message ?? "unknown"}`);
    }
    const blockIdByKey = new Map<string, string>();
    for (let i = 0; i < blocks.length; i++) {
      blockIdByKey.set(blockKeyToDay[i].key, (blocks[i] as { id: string }).id);
    }

    // 4. program_movements_v2 — one row per movement per block
    const movementInserts: Array<Record<string, unknown>> = [];
    for (const week of output.weeks) {
      for (const day of week.days) {
        for (let bIdx = 0; bIdx < day.blocks.length; bIdx++) {
          const b = day.blocks[bIdx];
          const blockId = blockIdByKey.get(`${week.week_num}-${day.day_num}-${bIdx}`);
          if (!blockId) continue;
          for (let m = 0; m < b.movements.length; m++) {
            const mv = b.movements[m];
            movementInserts.push({
              block_id: blockId,
              movement: mv.movement,
              sets: mv.sets ?? null,
              reps: mv.reps ?? null,
              weight: mv.weight ?? null,
              weight_unit: mv.weight_unit ?? null,
              rpe: mv.rpe ?? null,
              time_seconds: mv.time_seconds ?? null,
              distance: mv.distance ?? null,
              distance_unit: mv.distance_unit ?? null,
              scaling_note: mv.scaling_note ?? null,
              target_pct_1rm: mv.target_pct_1rm ?? null,
              sort_order: m,
            });
          }
        }
      }
    }
    if (movementInserts.length > 0) {
      const { error: mvErr } = await supa.from("program_movements_v2").insert(movementInserts);
      if (mvErr) throw new Error(`[save-v3] program_movements_v2 insert failed: ${mvErr.message}`);
    }

    return programId;
  } catch (err) {
    await supa.from("programs").delete().eq("id", programId).then(() => {}, () => {});
    throw err;
  }
}

// ============================================================
// processJob — full orchestration
// ============================================================

async function processJob(jobId: string, userId: string) {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const t0 = Date.now();

  const setStage: SetStage = async (stage: string) => {
    await supa
      .from("program_jobs")
      .update({ stage, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .then(() => {}, () => {});
  };

  const markFailed = async (message: string, result?: Record<string, unknown>) => {
    await supa
      .from("program_jobs")
      .update({
        status: "failed",
        stage: null,
        error: message.slice(0, 1000),
        ...(result ? { result_json: result } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .then(() => {}, () => {});
  };

  try {
    await supa
      .from("program_jobs")
      .update({ status: "processing", stage: "starting", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    await setStage("payload_building");
    console.log(`[generate-program-v3 worker] building payload for user ${userId}`);
    const payload = await buildWriterPayload(supa, userId, { includeAllResults: false });
    console.log(
      `[generate-program-v3 worker] payload built (days_per_week=${payload.training_context.days_per_week} competition_linked=${payload.competition != null} vocabulary_size=${payload.vocabulary.length} rag_chars=${payload.rag.length})`,
    );
    await setStage("payload_built");

    // SKELETON
    const skeleton = await generateSkeletonWithAudits(payload, setStage);
    console.log(`[generate-program-v3 worker] skeleton passed audits; persisting`);
    await supa
      .from("program_jobs")
      .update({ skeleton_json: skeleton, updated_at: new Date().toISOString() })
      .eq("id", jobId);

    // FILL (using skeleton as planning context)
    const auditedOutput = await generateProgramWithSkeleton(payload, skeleton, setStage);

    // SAFETY
    const { output, safety } = await runSafetyLoop(auditedOutput, payload, skeleton, setStage);

    // SAVE
    let programId: string | null = null;
    try {
      await setStage("saving");
      programId = await saveProgramV3(supa, userId, output);
      console.log(`[generate-program-v3 worker] persisted program ${programId}`);
    } catch (saveErr) {
      console.error("[generate-program-v3 worker] save failed:", saveErr);
    }

    const elapsedMs = Date.now() - t0;
    console.log(`[generate-program-v3 worker] success in ${elapsedMs}ms safe=${safety.safe} errored=${!!safety.errored}`);

    await supa
      .from("program_jobs")
      .update({
        status: "complete",
        stage: null,
        program_id: programId,
        result_json: {
          output,
          safety: { safe: safety.safe, reasoning: safety.reasoning, errored: !!safety.errored },
          elapsed_ms: elapsedMs,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[generate-program-v3 worker] failed:", err);

    if (err instanceof SkeletonLoopExhausted) {
      await markFailed(message, {
        skeleton: err.lastSkeleton,
        skeleton_failures: err.lastFailures,
        rejected_at: "skeleton",
        elapsed_ms: Date.now() - t0,
      });
      return;
    }
    if (err instanceof AuditLoopExhausted) {
      await markFailed(message, {
        output: err.lastOutput,
        audit_failures: err.lastFailures,
        rejected_at: "writer",
        elapsed_ms: Date.now() - t0,
      });
      return;
    }
    await markFailed(message);
  }
}

// ============================================================
// HTTP handler — kickoff (auth + admin gate + job row + waitUntil).
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
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Admin gate — Phase 1 admins-only.
    const { data: adminProfile } = await supa
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (adminProfile?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden", message: "v3 is admin-only during Phase 1 testing." }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { data: job, error: jobErr } = await supa
      .from("program_jobs")
      .insert({ user_id: user.id, status: "pending" })
      .select("id")
      .single();
    if (jobErr || !job) {
      console.error("[generate-program-v3] failed to create job:", jobErr);
      return new Response(
        JSON.stringify({ error: "Failed to start v3 program generation" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(processJob(job.id, user.id));

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
