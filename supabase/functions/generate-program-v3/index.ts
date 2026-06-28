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
import { buildTrainingDesignInput, type TrainingDesignInput } from "../_shared/training-design-input.ts";
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
import { clampLoadSanity, stripInternalMarkers, enforceNoLabelOnCoachedBlocks } from "../_shared/programmatic-fixes.ts";
import { surgicallyRewriteBlock, spliceBlock } from "../_shared/surgical-block-fix.ts";
import { reviewSafety } from "../_shared/safety-review.ts";
import { saveProgramV3 } from "../_shared/save-program-v3.ts";
import { attachBenchmarksToWriterOutput, type BlockLocation } from "../_shared/compute-block-benchmark.ts";
import type { Gender } from "../_shared/compute-benchmarks.ts";
import {
  runStageWithLease,
  type ProgramJobRow,
  type ResumeState,
  type Stage,
  type StageOutcome,
} from "../_shared/v3-dispatcher.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";
const MAX_SKELETON_ATTEMPTS = 3;
// The skeleton emits up to 8k tokens of Sonnet output; 60s was too tight and a
// slow call threw TimeoutError, hard-failing the job. The skeleton's LLM call
// already sits inside the MAX_SKELETON_ATTEMPTS audit-retry loop, which is the
// ONLY multiplier on the call — keep ATTEMPTS × this timeout under the ~400s
// edge wall-clock (3 × 120s = 360s) rather than nesting a second retry loop.
const SKELETON_TIMEOUT_MS = 120_000;
const FUNCTION_NAME = "generate-program-v3";

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
// Stage update helper — retained as a no-op callback for the writer/audit
// helpers below, which still take a setStage parameter. The dispatcher now owns
// the human-facing `stage` column via each stage's displayStage.
// ============================================================

type SetStage = (stage: string) => Promise<void> | void;
const NO_STAGE: SetStage = () => {};

// ============================================================
// Errors — preserve last skeleton / output on exhaustion so admin can inspect
// what the writer produced. resultJson is picked up by the dispatcher's failure
// path and stored to program_jobs.result_json.
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

  get resultJson(): Record<string, unknown> {
    return {
      skeleton: this.lastSkeleton,
      skeleton_failures: this.lastFailures,
      rejected_at: "skeleton",
    };
  }
}

// ============================================================
// Writer calls
// ============================================================

/**
 * Call the v3 skeleton writer. Returns parsed SkeletonOutput on success.
 */
export async function callSkeletonWriter(
  tdi: TrainingDesignInput,
  retryViolations: string,
): Promise<SkeletonOutput> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const daysPerWeek = tdi.days_per_week;

  const ruleRecap = [
    "=== KEY RULES (re-check before emit) ===",
    `- Output exactly 4 weeks × ${daysPerWeek} days. day_num is 1..${daysPerWeek}.`,
    "- Every training day includes strength + accessory + metcon block types. Skills 2–4 days per week.",
    "- Emit STRUCTURE ONLY — no sets / reps / weight / movement names. Those are filled in subsequent per-week calls.",
    "- primary_lift uses canonical display names (Back Squat, Deadlift, Snatch, Clean and Jerk, etc.) or a complex description.",
    "- ALLOCATE the given priorities/maintain/deprioritize — never invent, promote, or drop one. Every priority must appear in the structure; no block built around a deprioritized focus.",
    "- Honor do_not_program when picking primary_lift / metcon_focus / skill_focus.",
  ].join("\n");

  const inputBlock = `TRAINING DESIGN INPUT (JSON — the FIXED plan to allocate):\n${JSON.stringify(tdi, null, 2)}`;
  const userMessage = retryViolations
    ? `${retryViolations}\n\n---\n\n${inputBlock}\n\n${ruleRecap}`
    : `${inputBlock}\n\n${ruleRecap}`;

  const t0 = Date.now();
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
    signal: AbortSignal.timeout(SKELETON_TIMEOUT_MS),
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
    `[generate-program-v3 skeleton] Claude usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens} stop_reason=${data.stop_reason} fetch_ms=${Date.now() - t0}`,
  );
  return toolUse.input as SkeletonOutput;
}

// EVAL STOPGAP (not the long-term answer — streaming + fresh-invocation re-entry
// is, see notes). Real logs show a week fill emitting 7.7k+ tokens of Sonnet
// output takes 130s and a 6-day week can need >150s. No fixed total-duration
// timeout that ALSO leaves room for a retry fits under the ~400s edge wall-clock,
// so: ONE attempt with a single generous budget (covers a ~200s+ verbose week,
// still ~70s clear of the wall). A transient blip now fails the run and you
// re-kick — acceptable for evaluation, not for production load.
const MAX_WEEK_FILL_ATTEMPTS = 1;
const WEEK_FILL_TIMEOUT_MS = 330_000;

/**
 * Fill ONE week of the program. Reuses the v2 writer prompt + an emit_week
 * tool, with the full skeleton as context, the specific week to fill, and the
 * already-generated prior weeks (so loads/volume progress across the cycle
 * instead of repeating). Small + fast vs. the old monolithic 4-week call.
 * EVAL STOPGAP: single attempt with a generous (330s) budget — a slow-but-
 * healthy week completes; a timeout fails the run (re-kick) rather than burning
 * a second attempt the wall-clock can't afford. See the constants below.
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
  // The week-fill EXECUTES the skeleton — it must not reinterpret intent, so the
  // DECISION-data is stripped from its payload (Step 3): athlete_model (facts +
  // normatives) and competition (percentiles) are what an earlier version used to
  // re-derive priorities + ratios in block_notes; the skeleton already encoded
  // all of that. The evals are stripped too (they shape STRUCTURE, not fills, and
  // bloat every call). What remains is execution input only — basics/units, 1RMs,
  // skill levels (variant selection), conditioning baselines (pace), equipment,
  // injuries, previous_cycle (progression), vocabulary, rag.
  const {
    profile_evaluation: _pe,
    training_evaluation: _te,
    athlete_model: _am,
    competition: _comp,
    ...fillPayload
  } = payload;
  const payloadBlock = `ATHLETE PAYLOAD (JSON):\n${JSON.stringify(fillPayload, null, 2)}`;
  const baseMessage = `${thisWeekBlock}\n\n${priorBlock}\n\n${arcBlock}\n\n${payloadBlock}\n\n${ruleRecap}`;
  const userMessage = extraContext ? `${extraContext}\n\n---\n\n${baseMessage}` : baseMessage;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_WEEK_FILL_ATTEMPTS; attempt++) {
    const t0 = Date.now();
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
        signal: AbortSignal.timeout(WEEK_FILL_TIMEOUT_MS),
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
        `[generate-program-v3 fill week ${weekNum}] usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens} stop_reason=${data.stop_reason} fetch_ms=${Date.now() - t0}`,
      );
      const week = toolUse.input as WeekPrescription;
      week.week_num = weekNum; // enforce regardless of what the model emitted
      return week;
    } catch (err) {
      lastErr = err;
      const elapsed = Date.now() - t0;
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const isTransient = err instanceof Error &&
        (err.name === "TimeoutError" || /timed out|timeout|aborted/i.test(err.message));
      if (isTransient && attempt < MAX_WEEK_FILL_ATTEMPTS) {
        console.warn(`[generate-program-v3 fill week ${weekNum}] transient after ${elapsed}ms (${msg}); retry ${attempt}/${MAX_WEEK_FILL_ATTEMPTS}`);
        continue;
      }
      // Stopgap is single-attempt, so a timeout lands here and fails the stage —
      // log how long it ran so we can see how close it got to the 330s budget.
      console.warn(`[generate-program-v3 fill week ${weekNum}] giving up after ${elapsed}ms (${msg})`);
      throw err;
    }
  }
  throw lastErr ?? new Error(`week ${weekNum} fill failed`);
}

// ============================================================
// Loops
// ============================================================

async function generateSkeletonWithAudits(
  tdi: TrainingDesignInput,
  setStage: SetStage = NO_STAGE,
): Promise<SkeletonOutput> {
  let retryViolations = "";
  let lastSkeleton: SkeletonOutput | null = null;
  let lastFailures: SkeletonAuditResult[] = [];

  for (let attempt = 1; attempt <= MAX_SKELETON_ATTEMPTS; attempt++) {
    console.log(`[generate-program-v3] skeleton attempt ${attempt}/${MAX_SKELETON_ATTEMPTS}`);
    await setStage(`skeleton_attempt_${attempt}`);
    let skeleton: SkeletonOutput;
    try {
      skeleton = await callSkeletonWriter(tdi, retryViolations);
    } catch (err) {
      // Transient failure (timeout / dropped connection / 5xx / 429): consume
      // this attempt and retry with the SAME violations instead of hard-failing
      // the job. This audit loop is the only multiplier on the LLM call, so total
      // wall-clock stays bounded — no nested retry product.
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const isTransient = err instanceof Error &&
        (err.name === "TimeoutError" ||
          /timed out|timeout|aborted/i.test(err.message) ||
          /Claude HTTP (5\d\d|429)/.test(err.message));
      if (isTransient && attempt < MAX_SKELETON_ATTEMPTS) {
        console.warn(`[generate-program-v3] skeleton transient (${msg}); retry ${attempt}/${MAX_SKELETON_ATTEMPTS}`);
        continue;
      }
      throw err;
    }
    lastSkeleton = skeleton;
    await setStage("skeleton_auditing");
    const auditResult = runSkeletonAudits({
      skeleton,
      daysPerWeek: tdi.days_per_week,
      trainingDesignInput: tdi,
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
): Promise<{ rewritten: number; failed: number; locations: BlockLocation[] }> {
  const groups = groupBlockLocalFailures(blockLocalFailures);
  if (groups.length === 0) return { rewritten: 0, failed: 0, locations: [] };

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

// ============================================================
// Extracted helpers shared by the benchmark_audit + surgical stages (formerly
// closures inside the monolithic generateProgramWithSkeleton).
// ============================================================

/** Resolve gender for benchmark cohort lookups. Same defaulting as the
 *  compute-benchmarks edge fn (null gender → "men" at the cohort layer). */
function resolveGender(payload: WriterPayload): Gender | null {
  const genderRaw = (payload.basics.gender ?? "").toLowerCase();
  return genderRaw === "men" || genderRaw === "male" ? "men"
    : genderRaw === "women" || genderRaw === "female" ? "women"
      : null;
}

/** Run the hard audits with the standard argument set. */
function auditOutput(output: WriterOutput, payload: WriterPayload, skeleton: SkeletonOutput) {
  return runAudits({
    output,
    daysPerWeek: payload.training_context.days_per_week,
    lifts: payload.lifts,
    vocabulary: payload.vocabulary,
    skeleton,
    doNotProgram: payload.training_context.injuries_structured?.do_not_program ?? [],
  });
}

/**
 * Recompute metcon benchmarks. Two modes:
 *   - full (changedLocations undefined): compute every metcon block.
 *   - targeted (changedLocations supplied): compute the union of previously-
 *     failed blocks (pendingFailures) + the newly-changed blocks. Empty union →
 *     no-op, prior pendingFailures kept. Slashes upstream calls so surgical
 *     passes don't re-run every metcon (what stops the rate-limit cascade).
 * Returns the new pendingFailures set. Concurrency is capped inside
 * attachBenchmarksToWriterOutput so even a full pass doesn't burst the limiter.
 */
async function recomputeBenchmarks(
  output: WriterOutput,
  gender: Gender | null,
  pendingFailures: BlockLocation[],
  changedLocations?: BlockLocation[],
): Promise<BlockLocation[]> {
  let targetLocations: BlockLocation[] | undefined;
  if (changedLocations !== undefined) {
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
      return pendingFailures;
    }
  }
  const stats = await attachBenchmarksToWriterOutput(output.weeks ?? [], gender, targetLocations);
  const mode = targetLocations ? `targeted(n=${targetLocations.length})` : "full";
  console.log(
    `[generate-program-v3] benchmarks ${mode}: computed=${stats.computed} skipped=${stats.skipped} failed=${stats.failed}`,
  );
  return stats.failedLocations;
}

/** Surgical halts when the failing-block count is stable for this many passes
 *  (oscillation between audits on the same blocks). */
const STALL_HALT_PASSES = 3;

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
  // BEFORE building the payload (hash-guarded no-op when current; soft-fails so a
  // parse hiccup never blocks generation).
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/parse-injuries-constraints`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "x-webhook-user-id": userId,
      },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.warn("[generate-program-v3] injuries parse refresh failed (non-fatal):", e);
  }

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
  const skeleton = await generateSkeletonWithAudits(tdi);
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
  const wk = await callWeekFill(payload, skeleton, weekNum, priorWeeks, "");
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
  let pendingFailures = await recomputeBenchmarks(output, gender, []);

  let auditResult = auditOutput(output, payload, skeleton);
  console.log(`[generate-program-v3] audits: ${summarizeAuditRun(auditResult)}`);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };

  let byKind = classifyFailuresByKind(auditResult.failures);

  // Programmatic patches (no LLM call).
  if (byKind["programmatic-fix"].length > 0) {
    const patch = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload);
    if (patch.patched > 0) {
      console.log(`[generate-program-v3] programmatic patches applied: ${patch.patched}`);
      for (const line of patch.log) console.log(`  - ${line}`);
      pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, []);
      auditResult = auditOutput(output, payload, skeleton);
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
  let auditResult = auditOutput(output, payload, skeleton);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
  let byKind = classifyFailuresByKind(auditResult.failures);
  if (byKind["block-local"].length === 0) {
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  // ONE surgical pass this invocation (fresh wall-clock). Each block ~30s,
  // sequential. A killed pass persists nothing → the reaper redoes it from the
  // last clean state.
  const sg = await applySurgicalFixes(output, byKind["block-local"], payload, skeleton);
  console.log(`[generate-program-v3] surgical pass ${pass}: rewritten=${sg.rewritten} failed=${sg.failed}`);
  if (sg.rewritten === 0) {
    // LLM call(s) failed — stall, ship with residuals.
    console.log(`[generate-program-v3] surgical stalled at pass ${pass} (LLM call(s) failed); shipping residuals`);
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, sg.locations);
  auditResult = auditOutput(output, payload, skeleton);
  console.log(`[generate-program-v3] audits after surgical pass ${pass}: ${summarizeAuditRun(auditResult)}`);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
  byKind = classifyFailuresByKind(auditResult.failures);

  // Programmatic patches may resurface between passes.
  if (byKind["programmatic-fix"].length > 0) {
    const patch2 = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload);
    if (patch2.patched > 0) {
      for (const line of patch2.log) console.log(`  - ${line}`);
      pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, []);
      auditResult = auditOutput(output, payload, skeleton);
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
