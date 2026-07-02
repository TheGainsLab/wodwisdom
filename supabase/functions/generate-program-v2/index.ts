/**
 * generate-program-v2/index.ts
 *
 * The v2 generate-program edge function. Admin-gated for Phase 1
 * (admins-only). Runs the rewritten pipeline:
 *
 *   1. Auth + admin gate.
 *   2. buildWriterPayload(supa, userId) — raw athlete data + Tier 4
 *      bundle + vocabulary + RAG, assembled per the locked design.
 *   3. Call Claude (sonnet-4) with the V2_GENERATE_PROGRAM_SYSTEM_PROMPT
 *      + EMIT_PROGRAM_TOOL forced via tool_choice. Output is the
 *      structured WriterOutput (4 weeks × N days × M blocks × movements).
 *   4. Parse the tool_use response.
 *   5. Run the 7 deterministic audits. If any fail, regenerate up to
 *      3 attempts with violations fed back into the writer prompt.
 *   6. After audits pass, run the LLM safety review (8th audit). If
 *      unsafe, regenerate with safety violations fed back.
 *   7. Phase 1: return the structured WriterOutput as JSON. No DB
 *      save (deferred to step 12 of the rewrite task list — Phase 1
 *      admins inspect raw output via the Compare v1 vs v2 UI).
 *
 * v1 stays untouched at supabase/functions/generate-program. This is
 * a separate function so rollback is trivial (just don't call it).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { MODELS } from "../_shared/model-profiles.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { buildWriterPayload, type WriterPayload } from "../_shared/build-writer-payload.ts";
import { V2_GENERATE_PROGRAM_SYSTEM_PROMPT } from "../_shared/v2-system-prompt.ts";
import { buildEmitProgramTool, type WriterOutput } from "../_shared/v2-output-schema.ts";
import { runAudits, formatViolationsForRetry, summarizeAuditRun } from "../_shared/audit-runner.ts";
import { reviewSafety, type SafetyReviewResult } from "../_shared/safety-review.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = MODELS.sonnet;
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

/**
 * Call the writer LLM. Returns the parsed WriterOutput on success,
 * throws on transport/parsing failure.
 */
async function callWriter(
  payload: WriterPayload,
  retryViolations: string,
): Promise<WriterOutput> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  // Trailing rule recap. Long-context attention favors the start and end
  // of input; the ~90k payload pushes the system prompt out of the model's
  // strongest attention window. Echoing the critical rules at the very
  // end of the user message gives them fresh weight at decode time.
  const daysPerWeek = payload.training_context.days_per_week;
  const units = payload.basics.units ?? "lbs";
  const distanceUnit = units === "lbs" ? "ft" : "m";
  const ruleRecap = [
    "=== KEY RULES (re-check before emit) ===",
    `- Output exactly 4 weeks × ${daysPerWeek} days. day_num is 1..${daysPerWeek}.`,
    `- All weights in ${units}. All distances in ${distanceUnit}.`,
    "- Prescribed barbell weight ≤ athlete's 1RM for that lift, unless block_scheme/notes mention a 1RM attempt.",
    "- At most one metcon block per day. Every metcon block must declare a block_scheme.",
    "- Movements in strength / accessory / metcon / skills blocks must carry at least one of {sets, reps, weight, time_seconds, distance} > 0. Warm-up / mobility / cool-down / active-recovery may be descriptive (name only is OK).",
    "- Prefer movement names from the payload's vocabulary list when one matches; otherwise pick the natural name (air squat, banded mob, dynamic stretching, etc.).",
    "- Read injuries_constraints_text carefully. Substitute or scale any contraindicated movement.",
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
      max_tokens: 32000,
      stream: false,
      system: V2_GENERATE_PROGRAM_SYSTEM_PROMPT,
      tools: [buildEmitProgramTool(
        payload.training_context.days_per_week,
        payload.basics.units ?? "lbs",
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
    `[generate-program-v2] Claude usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens} stop_reason=${data.stop_reason}`,
  );
  return toolUse.input as WriterOutput;
}

type SetStage = (stage: string) => Promise<void> | void;
const NO_STAGE: SetStage = () => {};

/**
 * Thrown when the audit loop runs through MAX_AUDIT_ATTEMPTS and never
 * passes. Carries the last attempt's output + failures so the caller
 * can persist them for admin inspection instead of discarding.
 */
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

/**
 * Generate + audit loop. Calls the writer, runs deterministic audits,
 * retries up to MAX_AUDIT_ATTEMPTS times with violation feedback.
 * Throws AuditLoopExhausted (carrying the last attempt's output) if all
 * attempts fail audits.
 */
async function generateWithAudits(payload: WriterPayload, setStage: SetStage = NO_STAGE): Promise<WriterOutput> {
  let retryViolations = "";
  let lastOutput: WriterOutput | null = null;
  let lastFailures: ReturnType<typeof runAudits>["failures"] = [];

  for (let attempt = 1; attempt <= MAX_AUDIT_ATTEMPTS; attempt++) {
    console.log(`[generate-program-v2] writer attempt ${attempt}/${MAX_AUDIT_ATTEMPTS}`);
    await setStage(`writer_attempt_${attempt}`);
    const output = await callWriter(payload, retryViolations);
    lastOutput = output;
    await setStage("auditing");
    const auditResult = runAudits({
      output,
      daysPerWeek: payload.training_context.days_per_week,
      lifts: payload.lifts,
      vocabulary: payload.vocabulary,
    });

    console.log(`[generate-program-v2] audits: ${summarizeAuditRun(auditResult)}`);

    if (auditResult.passed) {
      return output;
    }

    lastFailures = auditResult.failures;
    retryViolations = formatViolationsForRetry(auditResult.failures);
  }

  if (!lastOutput) {
    // Defensive — should never happen unless callWriter threw on every attempt.
    throw new Error("Audit loop exhausted but no writer output was produced.");
  }
  throw new AuditLoopExhausted(lastOutput, lastFailures);
}

/**
 * Run the safety-review LLM. If unsafe, regenerate the program (with
 * the safety violations fed back) up to MAX_SAFETY_ATTEMPTS times.
 */
async function runSafetyLoop(
  initialOutput: WriterOutput,
  payload: WriterPayload,
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
    console.warn("[generate-program-v2] safety-review errored; proceeding permissively:", safety.reasoning);
    return { output, safety };
  }

  for (let attempt = 1; attempt <= MAX_SAFETY_ATTEMPTS && !safety.safe; attempt++) {
    console.log(`[generate-program-v2] safety regen ${attempt}/${MAX_SAFETY_ATTEMPTS}; violations: ${safety.violations.length}`);
    await setStage(`safety_regen_${attempt}`);
    const safetyContext = [
      "Your previous program failed the safety review against the athlete's stated injuries / constraints. Regenerate, addressing these violations:",
      "",
      ...safety.violations.map((v) => `  - ${v}`),
      "",
      "Read the injuries text carefully and substitute or scale any contraindicated movements.",
    ].join("\n");

    output = await callWriter(payload, safetyContext);
    await setStage("safety_review");

    // Re-run deterministic audits on the regen — the safety fix
    // shouldn't have broken anything, but defense-in-depth.
    const auditResult = runAudits({
      output,
      daysPerWeek: payload.training_context.days_per_week,
      lifts: payload.lifts,
      vocabulary: payload.vocabulary,
    });
    if (!auditResult.passed) {
      console.warn(
        `[generate-program-v2] safety-regen failed deterministic audits: ${summarizeAuditRun(auditResult)}`,
      );
      // Don't infinite-loop. Bail out — caller surfaces as a hard fail.
      throw new Error("Safety-regen broke deterministic audits; aborting.");
    }

    safety = await reviewSafety(
      output,
      payload.training_context.goal_text,
      payload.training_context.injuries_constraints_text,
    );
  }

  return { output, safety };
}

/**
 * Persist a v2 WriterOutput to the Option-2 storage schema:
 *   programs (program_version='v2', month_plan)
 *     → program_workouts (one per day, workout_text=NULL)
 *       → program_blocks_v2 (one per block, typed columns)
 *         → program_movements_v2 (one per movement, mirrors workout_log_entries)
 *
 * On any error we cascade-delete via `programs` FK chain (best-effort) and
 * throw so the caller surfaces. RLS uses auth.uid(); since we're operating
 * with SUPABASE_SERVICE_KEY, we set user_id explicitly on `programs`.
 */
async function saveProgramV2(
  supa: SupabaseClient,
  userId: string,
  output: WriterOutput,
): Promise<string> {
  // 1. programs row.
  const { data: programRow, error: progErr } = await supa
    .from("programs")
    .insert({
      user_id: userId,
      name: "AI Programmer (v2)",
      program_version: "v2",
      month_plan: output.month_plan,
    })
    .select("id")
    .single();
  if (progErr || !programRow) {
    throw new Error(`[save-v2] programs insert failed: ${progErr?.message ?? "unknown"}`);
  }
  const programId = programRow.id as string;

  try {
    // 2. program_workouts rows (one per day).
    const workoutInserts = output.weeks.flatMap((week) =>
      week.days.map((day) => ({
        program_id: programId,
        week_num: week.week_num,
        day_num: day.day_num,
        workout_text: null,
        sort_order: (week.week_num - 1) * 10 + day.day_num,
      }))
    );
    const { data: workoutRows, error: wkErr } = await supa
      .from("program_workouts")
      .insert(workoutInserts)
      .select("id, week_num, day_num");
    if (wkErr || !workoutRows) {
      throw new Error(`[save-v2] program_workouts insert failed: ${wkErr?.message ?? "unknown"}`);
    }

    // Index workout id by (week, day) for the block insert.
    const workoutIdByDay = new Map<string, string>();
    for (const r of workoutRows) {
      workoutIdByDay.set(`${r.week_num}:${r.day_num}`, r.id as string);
    }

    // 3. program_blocks_v2 rows.
    type BlockInsert = {
      program_workout_id: string;
      block_type: string;
      block_label: string | null;
      block_scheme: string | null;
      time_cap_seconds: number | null;
      block_notes: string | null;
      sort_order: number;
    };
    const blockInserts: BlockInsert[] = [];
    // We'll need to map insert → its movement list after we get back ids.
    const blockMovementSources: { movements: WriterOutput["weeks"][number]["days"][number]["blocks"][number]["movements"] }[] = [];
    for (const week of output.weeks) {
      for (const day of week.days) {
        const pwId = workoutIdByDay.get(`${week.week_num}:${day.day_num}`);
        if (!pwId) {
          throw new Error(`[save-v2] missing program_workout for W${week.week_num}D${day.day_num}`);
        }
        for (let i = 0; i < day.blocks.length; i++) {
          const b = day.blocks[i];
          blockInserts.push({
            program_workout_id: pwId,
            block_type: b.block_type,
            block_label: b.block_label ?? null,
            block_scheme: b.block_scheme ?? null,
            time_cap_seconds: b.time_cap_seconds ?? null,
            block_notes: b.block_notes ?? null,
            sort_order: i,
          });
          blockMovementSources.push({ movements: b.movements });
        }
      }
    }
    const { data: blockRows, error: blkErr } = await supa
      .from("program_blocks_v2")
      .insert(blockInserts)
      .select("id");
    if (blkErr || !blockRows || blockRows.length !== blockInserts.length) {
      throw new Error(`[save-v2] program_blocks_v2 insert failed: ${blkErr?.message ?? "row count mismatch"}`);
    }

    // 4. program_movements_v2 rows.
    type MovementInsert = {
      block_id: string;
      movement: string;
      sets: number | null;
      reps: number | null;
      weight: number | null;
      weight_unit: string | null;
      rpe: number | null;
      time_seconds: number | null;
      distance: number | null;
      distance_unit: string | null;
      scaling_note: string | null;
      sort_order: number;
    };
    const movementInserts: MovementInsert[] = [];
    for (let b = 0; b < blockRows.length; b++) {
      const blockId = blockRows[b].id as string;
      const mvs = blockMovementSources[b].movements;
      for (let m = 0; m < mvs.length; m++) {
        const mv = mvs[m];
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
          sort_order: m,
        });
      }
    }
    if (movementInserts.length > 0) {
      const { error: mvErr } = await supa
        .from("program_movements_v2")
        .insert(movementInserts);
      if (mvErr) {
        throw new Error(`[save-v2] program_movements_v2 insert failed: ${mvErr.message}`);
      }
    }

    return programId;
  } catch (err) {
    // Cascade-delete via the parent programs row (FKs handle the rest).
    await supa.from("programs").delete().eq("id", programId).then(
      () => { /* swallow secondary errors */ },
      () => { /* swallow */ },
    );
    throw err;
  }
}

/**
 * Background worker — runs the heavy v2 generation pipeline. Updates
 * the program_jobs row as it progresses; on success writes result_json
 * + program_id, on failure writes error.
 */
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

  const markFailed = async (message: string) => {
    await supa
      .from("program_jobs")
      .update({ status: "failed", error: message.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .then(() => {}, () => {});
  };

  try {
    await supa
      .from("program_jobs")
      .update({ status: "processing", stage: "starting", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    console.log(`[generate-program-v2 worker] building payload for user ${userId}`);
    await setStage("payload_building");
    const payload = await buildWriterPayload(supa, userId, { includeAllResults: false });
    console.log(
      `[generate-program-v2 worker] payload built (days_per_week=${payload.training_context.days_per_week} competition_linked=${payload.competition != null} vocabulary_size=${payload.vocabulary.length} rag_chars=${payload.rag.length})`,
    );
    await setStage("payload_built");

    const auditedOutput = await generateWithAudits(payload, setStage);
    const { output, safety } = await runSafetyLoop(auditedOutput, payload, setStage);

    let programId: string | null = null;
    try {
      await setStage("saving");
      programId = await saveProgramV2(supa, userId, output);
      console.log(`[generate-program-v2 worker] persisted program ${programId}`);
    } catch (saveErr) {
      console.error("[generate-program-v2 worker] save failed:", saveErr);
      // Don't fail the job — admin can still inspect the output JSON.
    }

    const elapsedMs = Date.now() - t0;
    console.log(`[generate-program-v2 worker] success in ${elapsedMs}ms safe=${safety.safe} errored=${!!safety.errored}`);

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
    console.error("[generate-program-v2 worker] failed:", err);

    if (err instanceof AuditLoopExhausted) {
      // Preserve the last attempt's output + violations so the admin can
      // inspect what the writer produced even though it didn't pass.
      await supa
        .from("program_jobs")
        .update({
          status: "failed",
          stage: null,
          error: message.slice(0, 1000),
          result_json: {
            output: err.lastOutput,
            audit_failures: err.lastFailures,
            elapsed_ms: Date.now() - t0,
            rejected: true,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .then(() => {}, () => {});
      return;
    }

    await markFailed(message);
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // 1. Auth.
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

    // 2. Admin gate — Phase 1 admins-only.
    const { data: adminProfile } = await supa
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (adminProfile?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden", message: "v2 is admin-only during Phase 1 testing." }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // 3. Create the job row.
    const { data: job, error: jobErr } = await supa
      .from("program_jobs")
      .insert({ user_id: user.id, status: "pending" })
      .select("id")
      .single();
    if (jobErr || !job) {
      console.error("[generate-program-v2] failed to create job:", jobErr);
      return new Response(
        JSON.stringify({ error: "Failed to start v2 program generation" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // 4. Fire background work via EdgeRuntime.waitUntil so the function
    //    can return immediately while the writer/audits/safety/save loop
    //    runs out-of-band. Mirrors v1's pattern.
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(processJob(job.id, user.id));

    return new Response(
      JSON.stringify({ ok: true, job_id: job.id }),
      { status: 202, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[generate-program-v2] unhandled:", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return new Response(
      JSON.stringify({ error: "GENERATION_FAILED", message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
