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
 *   4. fillAllWeeks(payload, skeleton) — fill the movement-level program
 *      ONE WEEK PER CALL (4 calls), each given the full skeleton + that
 *      week's structure + the already-generated prior weeks (so loads
 *      progress across the cycle). Small/fast vs. a monolithic 4-week call
 *      and individually auto-retried on transient failures, then assembled
 *      into a WriterOutput (month_plan from the skeleton). Recovery:
 *      programmatic patches first, then surgical block rewrites fed back.
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
  buildEmitWeekTool,
  type WriterOutput,
  type WeekPrescription,
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
  summarizeAuditRun,
  classifyFailuresByKind,
} from "../_shared/audit-runner.ts";
import { clampLoadSanity } from "../_shared/programmatic-fixes.ts";
import { surgicallyRewriteBlock, spliceBlock } from "../_shared/surgical-block-fix.ts";
import { reviewSafety, type SafetyReviewResult } from "../_shared/safety-review.ts";
import { saveProgramV3 } from "../_shared/save-program-v3.ts";
import { attachBenchmarksToWriterOutput, type BlockLocation } from "../_shared/compute-block-benchmark.ts";
import type { Gender } from "../_shared/compute-benchmarks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-20250514";
const MAX_SKELETON_ATTEMPTS = 3;
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

const MAX_WEEK_FILL_ATTEMPTS = 3;

/**
 * Fill ONE week of the program. Reuses the v2 writer prompt + an emit_week
 * tool, with the full skeleton as context, the specific week to fill, and the
 * already-generated prior weeks (so loads/volume progress across the cycle
 * instead of repeating). Small + fast vs. the old monolithic 4-week call, and
 * auto-retries transient failures (timeout / 5xx / 429) so a single slow call
 * doesn't fail the whole job.
 */
async function callWeekFill(
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  weekNum: number,
  priorWeeks: WeekPrescription[],
  extraContext: string,
): Promise<WeekPrescription> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const daysPerWeek = payload.training_context.days_per_week;
  const units = payload.basics.units ?? "lbs";
  const weekSkeleton = skeleton.weeks.find((w) => w.week_num === weekNum) ?? null;

  const ruleRecap = [
    "=== KEY RULES (re-check before emit) ===",
    `- Emit EXACTLY week ${weekNum}: week_num=${weekNum} with ${daysPerWeek} days (day_num 1..${daysPerWeek}).`,
    `- All weights in ${units}.`,
    "- Honor THIS WEEK's skeleton: each day's block_types, primary_lift, strength_scheme, metcon_focus, skill_focus are already decided. Fill in movement-level prescriptions only.",
    "- Prescribed barbell weight ≤ athlete's 1RM for that lift, unless block_scheme/notes mention a 1RM attempt.",
    "- At most one metcon block per day. Every metcon block must declare a block_scheme.",
    "- Every movement in strength / accessory / metcon / skills blocks must populate at least one of {sets, reps, weight, time_seconds, distance} > 0.",
    "- Read injuries_constraints_text + injuries_structured.do_not_program. Substitute or scale any contraindicated movement.",
    priorWeeks.length > 0
      ? `- PROGRESS from the prior weeks below per the month_plan's arc (add load/volume, advance schemes) — do NOT copy them verbatim.`
      : `- This is week 1 — set the cycle's opening baseline.`,
  ].join("\n");

  const thisWeekBlock = `THIS WEEK TO FILL (week ${weekNum} skeleton):\n${JSON.stringify(weekSkeleton, null, 2)}`;
  const arcBlock = `FULL 4-WEEK SKELETON (context — the whole arc + month_plan was already decided):\n${JSON.stringify(skeleton, null, 2)}`;
  const priorBlock = priorWeeks.length > 0
    ? `ALREADY-GENERATED PRIOR WEEKS (progress from these):\n${JSON.stringify(priorWeeks, null, 2)}`
    : "No prior weeks (this is week 1).";
  const payloadBlock = `ATHLETE PAYLOAD (JSON):\n${JSON.stringify(payload, null, 2)}`;
  const baseMessage = `${thisWeekBlock}\n\n${priorBlock}\n\n${arcBlock}\n\n${payloadBlock}\n\n${ruleRecap}`;
  const userMessage = extraContext ? `${extraContext}\n\n---\n\n${baseMessage}` : baseMessage;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_WEEK_FILL_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 16000,
          stream: false,
          system: V2_GENERATE_PROGRAM_SYSTEM_PROMPT,
          tools: [buildEmitWeekTool(daysPerWeek, units, payload.training_context.session_length_minutes)],
          tool_choice: { type: "tool", name: "emit_week" },
          messages: [{ role: "user", content: userMessage }],
        }),
        signal: AbortSignal.timeout(100_000),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        // Retry transient server-side / rate-limit failures.
        if ((resp.status >= 500 || resp.status === 429) && attempt < MAX_WEEK_FILL_ATTEMPTS) {
          lastErr = new Error(`Claude HTTP ${resp.status}`);
          console.warn(`[generate-program-v3 fill week ${weekNum}] HTTP ${resp.status}; retry ${attempt}/${MAX_WEEK_FILL_ATTEMPTS}`);
          continue;
        }
        throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 500)}`);
      }

      const data = (await resp.json()) as ClaudeResponse;
      const toolUse = (data.content ?? []).find(
        (b) => b.type === "tool_use" && b.name === "emit_week",
      );
      if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
        throw new Error(
          `week ${weekNum}: missing emit_week tool_use. stop_reason=${data.stop_reason} content=${JSON.stringify(data.content).slice(0, 300)}`,
        );
      }
      console.log(
        `[generate-program-v3 fill week ${weekNum}] usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens} stop_reason=${data.stop_reason}`,
      );
      const week = toolUse.input as WeekPrescription;
      week.week_num = weekNum; // enforce regardless of what the model emitted
      return week;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const isTransient = err instanceof Error &&
        (err.name === "TimeoutError" || /timed out|timeout|aborted/i.test(err.message));
      if (isTransient && attempt < MAX_WEEK_FILL_ATTEMPTS) {
        console.warn(`[generate-program-v3 fill week ${weekNum}] transient (${msg}); retry ${attempt}/${MAX_WEEK_FILL_ATTEMPTS}`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`week ${weekNum} fill failed`);
}

/**
 * Fill all 4 weeks sequentially (each progressing from the prior) and assemble
 * into a WriterOutput. month_plan comes from the skeleton (it already decided
 * the arc). extraContext is prepended to each week call (used by the safety
 * loop to pass violation feedback).
 */
async function fillAllWeeks(
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  setStage: SetStage = NO_STAGE,
  extraContext = "",
): Promise<WriterOutput> {
  const weeks: WeekPrescription[] = [];
  for (let wn = 1; wn <= 4; wn++) {
    await setStage(`fill_week_${wn}`);
    const wk = await callWeekFill(payload, skeleton, wn, weeks, extraContext);
    weeks.push(wk);
  }
  return { month_plan: skeleton.month_plan, weeks };
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
): Promise<{ rewritten: number; failed: number; locations: BlockLocation[] }> {
  const groups = groupBlockLocalFailures(blockLocalFailures);
  if (groups.length === 0) return { rewritten: 0, failed: 0, locations: [] };

  await setStage("surgical_fix");
  let rewritten = 0;
  let failed = 0;
  const locations: BlockLocation[] = [];
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
      locations.push({ week: g.week, day: g.day, blockIdx: g.blockIdx });
      console.log(`[generate-program-v3] surgical rewrote w${g.week}d${g.day}b${g.blockIdx} (${g.violations.length} violation${g.violations.length === 1 ? "" : "s"})`);
    } else {
      failed++;
    }
  }
  return { rewritten, failed, locations };
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
interface ProgramWithAudits {
  output: WriterOutput;
  /** Audits that were still failing when generation halted (surgical stalled
   *  or oscillated). Empty when everything passed cleanly. The worker attaches
   *  these to the job's result_json so operators see what slipped through. */
  residualFailures: ReturnType<typeof runAudits>["failures"];
}

async function generateProgramWithSkeleton(
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  setStage: SetStage = NO_STAGE,
): Promise<ProgramWithAudits> {
  // Resolve gender for benchmark cohort lookups. Same defaulting as
  // compute-benchmarks edge fn does for null gender (defaults to "men" with
  // a log warning) — we apply it here so server-side compute matches.
  const genderRaw = (payload.basics.gender ?? "").toLowerCase();
  const gender: Gender | null =
    genderRaw === "men" || genderRaw === "male" ? "men"
      : genderRaw === "women" || genderRaw === "female" ? "women"
      : null;

  /**
   * Compute expected benchmarks for metcon blocks. Two modes:
   *
   *   1. Full pass — `recomputeBenchmarks(output)` with no locations.
   *      Computes every metcon block. Used after the initial writer call
   *      and after a fresh writer-retry where the whole program changed.
   *
   *   2. Targeted recompute — `recomputeBenchmarks(output, changedLocations)`.
   *      Computes only the listed blocks PLUS any blocks that failed on a
   *      previous pass (tracked across calls via `pendingFailures`).
   *      Used after surgical block rewrites + after programmatic patches
   *      that could change rep counts. Slashes upstream calls — only the
   *      changed-or-still-broken blocks get retried — which is what stops
   *      the rate-limit cascade.
   *
   * Concurrency capped inside attachBenchmarksToWriterOutput (3 concurrent
   * at time of writing) so even a full pass doesn't burst past upstream's
   * rate limiter.
   */
  let pendingFailures: BlockLocation[] = [];
  async function recomputeBenchmarks(
    o: WriterOutput,
    changedLocations?: BlockLocation[],
  ): Promise<void> {
    let targetLocations: BlockLocation[] | undefined;
    if (changedLocations !== undefined) {
      // Targeted mode — union of newly-changed blocks + previously-failed blocks.
      const seen = new Set<string>();
      targetLocations = [];
      for (const loc of [...pendingFailures, ...changedLocations]) {
        const key = `${loc.week}-${loc.day}-${loc.blockIdx}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targetLocations.push(loc);
      }
      if (targetLocations.length === 0) {
        console.log(`[generate-program-v3] benchmarks: skipped — no blocks need recompute`);
        return;
      }
    }
    const stats = await attachBenchmarksToWriterOutput(o.weeks ?? [], gender, targetLocations);
    pendingFailures = stats.failedLocations;
    const mode = targetLocations ? `targeted(n=${targetLocations.length})` : "full";
    console.log(
      `[generate-program-v3] benchmarks ${mode}: computed=${stats.computed} skipped=${stats.skipped} failed=${stats.failed}`,
    );
  }

  // Linear flow — single writer attempt, then recovery tiers run until they
  // stop making progress. No writer-retry (the skeleton is the structural
  // contract; regenerating the same program from the same prompts won't
  // produce different results). No surgical-pass cap (surgical converges
  // monotonically — failures only shrink — so capping it just stops fixes
  // mid-stream). If any audit failures survive recovery, save the program
  // anyway and log them so operators can see what shipped imperfect.
  console.log(`[generate-program-v3] filling 4 weeks (one call per week)`);
  const output = await fillAllWeeks(payload, skeleton, setStage);
  await setStage("benchmarking");
  pendingFailures = [];
  await recomputeBenchmarks(output);
  await setStage("auditing");

  // deno-lint-ignore prefer-const
  let auditResult = runAudits({
    output,
    daysPerWeek: payload.training_context.days_per_week,
    lifts: payload.lifts,
    vocabulary: payload.vocabulary,
    skeleton,
  });
  console.log(`[generate-program-v3] audits: ${summarizeAuditRun(auditResult)}`);
  if (auditResult.passed) return { output, residualFailures: [] };

  let byKind = classifyFailuresByKind(auditResult.failures);

  // Step 1 — programmatic patches (no LLM call).
  if (byKind["programmatic-fix"].length > 0) {
    await setStage("patching");
    const patch = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload);
    if (patch.patched > 0) {
      console.log(`[generate-program-v3] programmatic patches applied: ${patch.patched}`);
      for (const line of patch.log) console.log(`  - ${line}`);
      await recomputeBenchmarks(output, []);
      auditResult = runAudits({
        output,
        daysPerWeek: payload.training_context.days_per_week,
        lifts: payload.lifts,
        vocabulary: payload.vocabulary,
        skeleton,
      });
      console.log(`[generate-program-v3] audits after patch: ${summarizeAuditRun(auditResult)}`);
      if (auditResult.passed) return { output, residualFailures: [] };
      byKind = classifyFailuresByKind(auditResult.failures);
    }
  }

  // Step 2 — surgical block rewrites. Loops while it's making progress.
  //
  // Halt conditions (in priority order):
  //   (a) Zero block-local failures remain   → success, return.
  //   (b) Pass produced rewritten=0          → LLM call failed (timeout / refused).
  //                                            Save with residual violations.
  //   (c) Failing-block count stable for 3   → surgical is oscillating between
  //       consecutive passes                   "fix A → introduce B → fix B →
  //                                            re-introduce A" on the same set
  //                                            of blocks. Save with residuals.
  //
  // Failing-block count is monotonically non-increasing (audits only re-flag
  // blocks that still fail; rewrites don't add new blocks). So tracking the
  // last few counts and halting when they plateau catches every non-converging
  // case without an arbitrary pass cap.
  const STALL_HALT_PASSES = 3; // count(N) == count(N-1) == count(N-2) → halt
  const recentCounts: number[] = [];

  let surgicalPass = 0;
  while (byKind["block-local"].length > 0) {
    surgicalPass++;
    if (surgicalPass > 1) await setStage("surgical_retry");
    const sg = await applySurgicalFixes(output, byKind["block-local"], payload, skeleton, setStage);
    console.log(`[generate-program-v3] surgical pass ${surgicalPass}: rewritten=${sg.rewritten} failed=${sg.failed}`);
    if (sg.rewritten === 0) {
      console.log(`[generate-program-v3] surgical stalled at pass ${surgicalPass} (LLM call(s) failed); saving with residual violations`);
      break;
    }

    await recomputeBenchmarks(output, sg.locations);
    await setStage("surgical_reaudit");
    auditResult = runAudits({
      output,
      daysPerWeek: payload.training_context.days_per_week,
      lifts: payload.lifts,
      vocabulary: payload.vocabulary,
      skeleton,
    });
    console.log(`[generate-program-v3] audits after surgical pass ${surgicalPass}: ${summarizeAuditRun(auditResult)}`);
    if (auditResult.passed) return { output, residualFailures: [] };
    byKind = classifyFailuresByKind(auditResult.failures);

    // Programmatic patches may surface again after surgical rewrites (e.g.,
    // a fresh load needs clamping). Run them between surgical passes.
    if (byKind["programmatic-fix"].length > 0) {
      const patch2 = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload);
      if (patch2.patched > 0) {
        for (const line of patch2.log) console.log(`  - ${line}`);
        await recomputeBenchmarks(output, []);
        auditResult = runAudits({
          output,
          daysPerWeek: payload.training_context.days_per_week,
          lifts: payload.lifts,
          vocabulary: payload.vocabulary,
          skeleton,
        });
        if (auditResult.passed) return { output, residualFailures: [] };
        byKind = classifyFailuresByKind(auditResult.failures);
      }
    }

    // Track the failing-block count across passes. If it's stable for
    // STALL_HALT_PASSES consecutive passes, surgical is oscillating between
    // audits on the same blocks — stop, save with residuals logged.
    const blockLocalCount = byKind["block-local"].length;
    recentCounts.push(blockLocalCount);
    if (recentCounts.length >= STALL_HALT_PASSES) {
      const window = recentCounts.slice(-STALL_HALT_PASSES);
      if (window.every((c) => c === window[0])) {
        console.log(
          `[generate-program-v3] surgical stalled at pass ${surgicalPass}: failing-block count stable at ${window[0]} for ${STALL_HALT_PASSES} passes; saving with residual violations`,
        );
        break;
      }
    }
  }

  // Save-anyway path: any failures still present (block-local that surgical
  // couldn't fix, plus any structural-writer failures from the original
  // writer call) get logged AND returned for the worker to attach to the
  // job's result_json. The athlete gets a workout; operators see what
  // slipped through in the admin panel.
  const residualFailures = auditResult.failures;
  if (residualFailures.length > 0) {
    console.warn(
      `[generate-program-v3] shipping with ${residualFailures.length} unresolved audit failure(s):`,
    );
    for (const f of residualFailures) {
      for (const v of f.violations) console.warn(`  [${f.rule}] ${v}`);
    }
  }
  return { output, residualFailures };
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

    // Re-fill all weeks with the original skeleton + safety violations as
    // context. Skeleton's structural decisions are preserved; the writer only
    // adjusts movement-level content to honor the constraint.
    output = await fillAllWeeks(payload, skeleton, setStage, safetyContext);

    // Re-run deterministic audits on the regen.
    const auditResult = runAudits({
      output,
      daysPerWeek: payload.training_context.days_per_week,
      lifts: payload.lifts,
      vocabulary: payload.vocabulary,
      skeleton,
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

async function processJob(
  jobId: string,
  userId: string,
  continuation: { programId: string | null; monthNumber: number },
) {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const t0 = Date.now();
  const isContinuation = continuation.programId != null;
  if (isContinuation) {
    console.log(`[generate-program-v3 worker] CONTINUATION month ${continuation.monthNumber} of program ${continuation.programId}`);
  }

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
    const { output: auditedOutput, residualFailures } = await generateProgramWithSkeleton(
      payload,
      skeleton,
      setStage,
    );

    // SAFETY
    const { output, safety } = await runSafetyLoop(auditedOutput, payload, skeleton, setStage);

    // SAVE — a save failure must FAIL the job (propagates to the outer catch →
    // markFailed). Swallowing it would report "complete" with no program (the
    // null-program_id bug that hid a broken continuation append).
    await setStage("saving");
    const programId = await saveProgramV3(supa, userId, output, {
      name: "AI Programmer (v3)",
      skeleton,
      // Append to the existing program when continuing; new program otherwise.
      programId: continuation.programId ?? undefined,
      monthNumber: continuation.monthNumber,
    });
    console.log(`[generate-program-v3 worker] persisted program ${programId} (month ${continuation.monthNumber})`);

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
          // residual_audit_failures: block-local audits that surgical couldn't
          // resolve (oscillation halt or LLM-call failure). Empty when the
          // program passed all hard audits cleanly. Surfaced here so admins
          // can see what shipped imperfect.
          residual_audit_failures: residualFailures,
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

    const jsonErr = (status: number, error: string, message?: string) =>
      new Response(JSON.stringify({ error, ...(message ? { message } : {}) }), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    const body = await req.json().catch(() => ({}));
    const reqProgramId: string | null = body?.program_id ?? null;
    const reqMonthNumber: number | null =
      typeof body?.month_number === "number" ? body.month_number : null;

    // Auth: internal server-to-server (generate-next-month / webhook / cron pass
    // x-webhook-user-id + the service-role key) OR a user JWT.
    const webhookUserId = req.headers.get("x-webhook-user-id");
    let userId: string;
    if (webhookUserId && token === SUPABASE_SERVICE_KEY) {
      userId = webhookUserId;
    } else {
      const { data: { user }, error: authErr } = await supa.auth.getUser(token);
      if (authErr || !user) return jsonErr(401, "Unauthorized");
      userId = user.id;
      // Admin gate applies ONLY to first-cycle generation (Phase 1 admins-only).
      // Continuation of an already-owned program is allowed for its owner.
      if (!reqProgramId) {
        const { data: adminProfile } = await supa
          .from("profiles").select("role").eq("id", userId).maybeSingle();
        if (adminProfile?.role !== "admin") {
          return jsonErr(403, "Forbidden", "v3 is admin-only during Phase 1 testing.");
        }
      }
    }

    // Continuation: validate ownership + that it's a v3 program; derive the
    // month number from generated_months when the caller didn't specify one.
    let monthNumber = reqMonthNumber ?? 1;
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
      if (reqMonthNumber == null) monthNumber = (prog.generated_months || 1) + 1;
      if (monthNumber < 2) {
        return jsonErr(400, "Bad Request", "Continuation month must be ≥ 2.");
      }
    }

    const { data: job, error: jobErr } = await supa
      .from("program_jobs")
      .insert({ user_id: userId, status: "pending" })
      .select("id")
      .single();
    if (jobErr || !job) {
      console.error("[generate-program-v3] failed to create job:", jobErr);
      return jsonErr(500, "Failed to start v3 program generation");
    }

    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(
      processJob(job.id, userId, { programId: reqProgramId, monthNumber }),
    );

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
