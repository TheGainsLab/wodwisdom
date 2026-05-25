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
  runSoftAudits,
  formatViolationsForRetry,
  summarizeAuditRun,
  classifyFailuresByKind,
} from "../_shared/audit-runner.ts";
import { clampLoadSanity } from "../_shared/programmatic-fixes.ts";
import { surgicallyRewriteBlock, spliceBlock } from "../_shared/surgical-block-fix.ts";
import { reviewSafety, type SafetyReviewResult } from "../_shared/safety-review.ts";
import { saveProgramV3 } from "../_shared/save-program-v3.ts";

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

/** Extract (week, day, blockIdx) tuples from a set of block-local audit
 *  failures, grouping violation messages per block. One surgical call per
 *  unique block — multiple audits flagging the same block get folded into
 *  a single rewrite with all violation messages. */
function groupBlockLocalFailures(
  failures: ReturnType<typeof runAudits>["failures"],
): Array<{ week: number; day: number; blockIdx: number; violations: string[] }> {
  const map = new Map<string, { week: number; day: number; blockIdx: number; violations: string[] }>();
  const pattern = /Week (\d+) Day (\d+) block\[(\d+)\]/;
  for (const failure of failures) {
    for (const v of failure.violations) {
      const m = v.match(pattern);
      if (!m) continue;
      const week = parseInt(m[1], 10);
      const day = parseInt(m[2], 10);
      const blockIdx = parseInt(m[3], 10);
      const key = `${week}-${day}-${blockIdx}`;
      const entry = map.get(key) ?? { week, day, blockIdx, violations: [] };
      entry.violations.push(v);
      map.set(key, entry);
    }
  }
  return [...map.values()];
}

/** Apply programmatic in-place patches for any 'programmatic-fix' audit
 *  failures. Currently handles load_sanity. Returns the count of changes
 *  for logging; output is mutated in place. */
function applyProgrammaticFixes(
  output: WriterOutput,
  programmaticFailures: ReturnType<typeof runAudits>["failures"],
  payload: WriterPayload,
): { patched: number; log: string[] } {
  let totalPatched = 0;
  const log: string[] = [];
  for (const failure of programmaticFailures) {
    if (failure.rule === "load_sanity") {
      const r = clampLoadSanity(output, payload.lifts);
      totalPatched += r.patched;
      log.push(...r.log);
    }
    // Future programmatic fixes go here.
  }
  return { patched: totalPatched, log };
}

/** Run one round of surgical block rewrites for the supplied block-local
 *  failures. Each unique block gets ONE LLM call with all violation
 *  messages for that block. Splices results back into output in place.
 *  Returns the count of successful rewrites. */
async function applySurgicalFixes(
  output: WriterOutput,
  blockLocalFailures: ReturnType<typeof runAudits>["failures"],
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  setStage: SetStage,
): Promise<{ rewritten: number; failed: number }> {
  const groups = groupBlockLocalFailures(blockLocalFailures);
  if (groups.length === 0) return { rewritten: 0, failed: 0 };

  await setStage("surgical_fix");
  let rewritten = 0;
  let failed = 0;
  for (const g of groups) {
    // Find the original block by location.
    const week = (output.weeks ?? []).find((w) => w.week_num === g.week);
    const day = week?.days?.find((d) => d.day_num === g.day);
    const block = day?.blocks?.[g.blockIdx];
    if (!block) { failed++; continue; }

    const corrected = await surgicallyRewriteBlock(
      payload, skeleton, g.week, g.day, g.blockIdx, block, g.violations,
    );
    if (!corrected) { failed++; continue; }

    if (spliceBlock(output, g.week, g.day, g.blockIdx, corrected)) {
      rewritten++;
      console.log(`[generate-program-v3] surgical rewrote w${g.week}d${g.day}b${g.blockIdx} (${g.violations.length} violation${g.violations.length === 1 ? "" : "s"})`);
    } else {
      failed++;
    }
  }
  return { rewritten, failed };
}

/**
 * Generate the program with audit-failure recovery:
 *   1. Writer call (attempt 1)
 *   2. Run audits → pass: done
 *   3. Classify failures by kind
 *   4. Apply programmatic patches (load_sanity, etc.) — no LLM
 *   5. Re-audit → pass: done
 *   6. Apply surgical block rewrites for block-local failures (~30s/block)
 *   7. Re-audit → pass: done
 *   8. 1 surgical retry if remaining failures are still block-local
 *   9. Writer-retry only when structural failures remain (or surgical exhausted)
 *
 * Writer-retry is the last resort — most failures recover via 4 / 6
 * without ever burning another full writer call.
 */
async function generateProgramWithSkeleton(
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  setStage: SetStage = NO_STAGE,
): Promise<WriterOutput> {
  let retryViolations = "";
  let lastOutput: WriterOutput | null = null;
  let lastFailures: ReturnType<typeof runAudits>["failures"] = [];
  const MAX_SURGICAL_PASSES = 2; // initial + 1 retry

  for (let attempt = 1; attempt <= MAX_AUDIT_ATTEMPTS; attempt++) {
    console.log(`[generate-program-v3] writer attempt ${attempt}/${MAX_AUDIT_ATTEMPTS}`);
    await setStage(`writer_attempt_${attempt}`);
    const output = await callFullProgramWriter(payload, skeleton, retryViolations);
    lastOutput = output;
    await setStage("auditing");
    let auditResult = runAudits({
      output,
      daysPerWeek: payload.training_context.days_per_week,
      lifts: payload.lifts,
      vocabulary: payload.vocabulary,
    });
    console.log(`[generate-program-v3] audits: ${summarizeAuditRun(auditResult)}`);
    if (auditResult.passed) return output;

    // Classify and route to the cheapest recovery path that fits.
    let byKind = classifyFailuresByKind(auditResult.failures);

    // Step 1 — programmatic patches (no LLM call).
    if (byKind["programmatic-fix"].length > 0) {
      await setStage("patching");
      const patch = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload);
      if (patch.patched > 0) {
        console.log(`[generate-program-v3] programmatic patches applied: ${patch.patched}`);
        for (const line of patch.log) console.log(`  - ${line}`);
        auditResult = runAudits({
          output,
          daysPerWeek: payload.training_context.days_per_week,
          lifts: payload.lifts,
          vocabulary: payload.vocabulary,
        });
        console.log(`[generate-program-v3] audits after patch: ${summarizeAuditRun(auditResult)}`);
        if (auditResult.passed) return output;
        byKind = classifyFailuresByKind(auditResult.failures);
      }
    }

    // Step 2 — surgical block rewrites for block-local failures.
    if (byKind["block-local"].length > 0 && byKind["structural-writer"].length === 0) {
      for (let surgicalPass = 1; surgicalPass <= MAX_SURGICAL_PASSES; surgicalPass++) {
        if (surgicalPass > 1) await setStage("surgical_retry");
        const sg = await applySurgicalFixes(output, byKind["block-local"], payload, skeleton, setStage);
        console.log(`[generate-program-v3] surgical pass ${surgicalPass}: rewritten=${sg.rewritten} failed=${sg.failed}`);
        if (sg.rewritten === 0) break; // surgical produced nothing; no point retrying

        await setStage("surgical_reaudit");
        auditResult = runAudits({
          output,
          daysPerWeek: payload.training_context.days_per_week,
          lifts: payload.lifts,
          vocabulary: payload.vocabulary,
        });
        console.log(`[generate-program-v3] audits after surgical pass ${surgicalPass}: ${summarizeAuditRun(auditResult)}`);
        if (auditResult.passed) return output;

        byKind = classifyFailuresByKind(auditResult.failures);
        // If any structural failure surfaced, surgical can't fix it — break out
        // and fall through to writer-retry below.
        if (byKind["structural-writer"].length > 0) break;
        // If no block-local failures remain (only programmatic), patch again.
        if (byKind["block-local"].length === 0) {
          if (byKind["programmatic-fix"].length > 0) {
            const patch2 = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload);
            for (const line of patch2.log) console.log(`  - ${line}`);
            auditResult = runAudits({
              output,
              daysPerWeek: payload.training_context.days_per_week,
              lifts: payload.lifts,
              vocabulary: payload.vocabulary,
            });
            if (auditResult.passed) return output;
            byKind = classifyFailuresByKind(auditResult.failures);
          }
          break;
        }
      }
    }

    // Step 3 — fall through to writer-retry (next loop iteration) only if
    // any failure remains. Structural failures get here directly; block-local
    // failures arrive after surgical exhaustion.
    if (auditResult.passed) return output;
    lastFailures = auditResult.failures;
    retryViolations = formatViolationsForRetry(auditResult.failures);
    console.log(`[generate-program-v3] recovery exhausted at attempt ${attempt}, falling through to writer-retry`);
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
// Save — saveProgramV3 lives in _shared/save-program-v3.ts, shared with
// preprocess-program (freelance ingestion). Imported above.
// ============================================================

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
      programId = await saveProgramV3(supa, userId, output, { name: "AI Programmer (v3)", skeleton });
      console.log(`[generate-program-v3 worker] persisted program ${programId}`);
    } catch (saveErr) {
      console.error("[generate-program-v3 worker] save failed:", saveErr);
    }

    // SOFT AUDITS — log-only safety-net checks. Run after save so a violation
    // doesn't block the user's program; we surface it to logs for visibility.
    // Plate-math sanity lives here: roundToPlateMath at insert time should have
    // handled it; if this fires, that path regressed.
    try {
      const soft = runSoftAudits({
        output,
        daysPerWeek: payload.training_context.days_per_week,
        lifts: payload.lifts,
        vocabulary: payload.vocabulary,
      });
      if (!soft.passed) {
        for (const failure of soft.failures) {
          console.warn(`[generate-program-v3 worker] SOFT AUDIT FAIL [${failure.rule}]:`);
          for (const v of failure.violations) console.warn(`  - ${v}`);
        }
      } else {
        console.log(`[generate-program-v3 worker] soft audits: ${summarizeAuditRun(soft)}`);
      }
    } catch (softErr) {
      console.warn("[generate-program-v3 worker] soft audit error (non-fatal):", softErr);
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
