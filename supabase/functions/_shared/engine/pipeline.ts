/**
 * engine/pipeline.ts — the sport-agnostic generation pipeline (Engine core).
 *
 * Extracted from generate-program-v3 (writer calls + audit/surgical recovery loops
 * + benchmark recompute) so both the wodwisdom dispatcher and the standalone Engine
 * entrypoint (engine-generate) consume ONE implementation. Behavior is identical to
 * the pre-extraction generate-program-v3 (docs/portfolio/ENGINE_EXTRACTION.md).
 *
 * These functions are the CONTROL PLANE: LLM I/O, audit orchestration, surgical
 * recovery, benchmark recompute. All SPORT-COUPLED content (prompts, tool schemas,
 * audit rules, recovery helpers) arrives via the injected `DomainPack` — this file
 * imports ZERO sport modules at runtime (only the pack TYPE, which is erased). A new
 * sport is a new pack, no change here. DB-coupled glue (buildWriterPayload,
 * coach-state persistence, saveProgramV3, the program_jobs dispatcher) stays
 * surface-side in generate-program-v3.
 */

import type { WriterPayload } from "../build-writer-payload.ts";
import type { TrainingDesignInput } from "../training-design-input.ts";
import type { SkeletonOutput } from "../v3-output-schema.ts";
import type { WriterOutput, WeekPrescription } from "../v2-output-schema.ts";
import type { SkeletonAuditResult } from "../v3-skeleton-audits.ts";
import type { runAudits } from "../audit-runner.ts";
import type { BlockLocation } from "../compute-block-benchmark.ts";
import type { Gender } from "../compute-benchmarks.ts";
import type { DomainPack } from "../domain-packs/types.ts";
import { MODELS } from "../model-profiles.ts";

/** Failure list shape from a hard-audit run (type-only; erased at runtime). */
type AuditFailures = ReturnType<typeof runAudits>["failures"];

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = MODELS.sonnet;
export const MAX_SKELETON_ATTEMPTS = 3;
// The skeleton emits up to 8k tokens of Sonnet output; the LLM call sits inside the
// MAX_SKELETON_ATTEMPTS audit-retry loop (the ONLY multiplier) — keep ATTEMPTS ×
// this timeout under the ~400s edge wall-clock (3 × 120s = 360s).
const SKELETON_TIMEOUT_MS = 120_000;

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

// Stage update helper — retained as a no-op callback for the writer/audit helpers,
// which still take a setStage parameter. The dispatcher owns the human-facing
// `stage` column via each stage's displayStage.
export type SetStage = (stage: string) => Promise<void> | void;
const NO_STAGE: SetStage = () => {};

// Preserve last skeleton / failures on exhaustion so admin can inspect the writer's
// output. resultJson is picked up by the dispatcher's failure path.
export class SkeletonLoopExhausted extends Error {
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

/** Call the skeleton writer for the given pack. Returns parsed SkeletonOutput. */
export async function callSkeletonWriter(
  tdi: TrainingDesignInput,
  retryViolations: string,
  pack: DomainPack,
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
      system: pack.writer.skeletonSystemPrompt,
      tools: [pack.writer.buildSkeletonTool(daysPerWeek)],
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
    `[engine skeleton] Claude usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens} stop_reason=${data.stop_reason} fetch_ms=${Date.now() - t0}`,
  );
  return toolUse.input as SkeletonOutput;
}

// EVAL STOPGAP: a verbose week fill can need >150s of Sonnet output; no fixed
// total-duration timeout that ALSO leaves room for a retry fits under the ~400s
// edge wall-clock. ONE attempt with a generous budget; a transient blip fails the
// run and it's re-kicked.
const MAX_WEEK_FILL_ATTEMPTS = 1;
const WEEK_FILL_TIMEOUT_MS = 330_000;

/** Fill ONE week of the program. Reuses the pack's week-fill prompt + emit_week
 *  tool, with the full skeleton as context, the specific week to fill, and the
 *  already-generated prior weeks (so loads/volume progress across the cycle). */
export async function callWeekFill(
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  weekNum: number,
  priorWeeks: WeekPrescription[],
  extraContext: string,
  pack: DomainPack,
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
  // DECISION-data (athlete_model, competition, evals) is stripped from its payload.
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
          system: pack.writer.weekFillSystemPrompt,
          tools: [pack.writer.buildWeekTool(daysPerWeek, units, payload.training_context.session_length_minutes)],
          tool_choice: { type: "tool", name: "emit_week" },
          messages: [{ role: "user", content: userMessage }],
        }),
        signal: AbortSignal.timeout(WEEK_FILL_TIMEOUT_MS),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        if ((resp.status >= 500 || resp.status === 429) && attempt < MAX_WEEK_FILL_ATTEMPTS) {
          lastErr = new Error(`Claude HTTP ${resp.status}`);
          console.warn(`[engine fill week ${weekNum}] HTTP ${resp.status}; retry ${attempt}/${MAX_WEEK_FILL_ATTEMPTS}`);
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
        `[engine fill week ${weekNum}] usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens} stop_reason=${data.stop_reason} fetch_ms=${Date.now() - t0}`,
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
        console.warn(`[engine fill week ${weekNum}] transient after ${elapsed}ms (${msg}); retry ${attempt}/${MAX_WEEK_FILL_ATTEMPTS}`);
        continue;
      }
      console.warn(`[engine fill week ${weekNum}] giving up after ${elapsed}ms (${msg})`);
      throw err;
    }
  }
  throw lastErr ?? new Error(`week ${weekNum} fill failed`);
}

// ============================================================
// Loops
// ============================================================

export async function generateSkeletonWithAudits(
  tdi: TrainingDesignInput,
  pack: DomainPack,
  setStage: SetStage = NO_STAGE,
): Promise<SkeletonOutput> {
  let retryViolations = "";
  let lastSkeleton: SkeletonOutput | null = null;
  let lastFailures: SkeletonAuditResult[] = [];

  for (let attempt = 1; attempt <= MAX_SKELETON_ATTEMPTS; attempt++) {
    console.log(`[engine] skeleton attempt ${attempt}/${MAX_SKELETON_ATTEMPTS}`);
    await setStage(`skeleton_attempt_${attempt}`);
    let skeleton: SkeletonOutput;
    try {
      skeleton = await callSkeletonWriter(tdi, retryViolations, pack);
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const isTransient = err instanceof Error &&
        (err.name === "TimeoutError" ||
          /timed out|timeout|aborted/i.test(err.message) ||
          /Claude HTTP (5\d\d|429)/.test(err.message));
      if (isTransient && attempt < MAX_SKELETON_ATTEMPTS) {
        console.warn(`[engine] skeleton transient (${msg}); retry ${attempt}/${MAX_SKELETON_ATTEMPTS}`);
        continue;
      }
      throw err;
    }
    lastSkeleton = skeleton;
    await setStage("skeleton_auditing");
    const auditResult = pack.audits.runSkeleton({
      skeleton,
      daysPerWeek: tdi.days_per_week,
      trainingDesignInput: tdi,
    });
    console.log(`[engine] skeleton audits: ${pack.audits.summarizeSkeleton(auditResult)}`);
    if (auditResult.passed) return skeleton;
    lastFailures = auditResult.failures;
    retryViolations = pack.audits.formatSkeletonViolationsForRetry(auditResult.failures);
  }

  if (!lastSkeleton) {
    throw new Error("Skeleton loop exhausted but no skeleton was produced.");
  }
  throw new SkeletonLoopExhausted(lastSkeleton, lastFailures);
}

/** Extract (week, day, blockIdx) tuples from block-local audit failures,
 *  grouping violation messages per block. One surgical call per unique block. */
function groupBlockLocalFailures(
  failures: AuditFailures,
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

/** Apply programmatic in-place patches for 'programmatic-fix' audit failures.
 *  Currently handles load_sanity. Output is mutated in place. */
export function applyProgrammaticFixes(
  output: WriterOutput,
  programmaticFailures: AuditFailures,
  payload: WriterPayload,
  pack: DomainPack,
): { patched: number; log: string[] } {
  let totalPatched = 0;
  const log: string[] = [];
  for (const failure of programmaticFailures) {
    if (failure.rule === "load_sanity") {
      const r = pack.recovery.clampLoadSanity(output, payload.lifts);
      totalPatched += r.patched;
      log.push(...r.log);
    }
  }
  return { patched: totalPatched, log };
}

/** Run one round of surgical block rewrites for the supplied block-local
 *  failures. Each unique block gets ONE LLM call. Splices results back in place. */
export async function applySurgicalFixes(
  output: WriterOutput,
  blockLocalFailures: AuditFailures,
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  pack: DomainPack,
): Promise<{ rewritten: number; failed: number; locations: BlockLocation[] }> {
  const groups = groupBlockLocalFailures(blockLocalFailures);
  if (groups.length === 0) return { rewritten: 0, failed: 0, locations: [] };

  let rewritten = 0;
  let failed = 0;
  const locations: BlockLocation[] = [];
  for (const g of groups) {
    const week = (output.weeks ?? []).find((w) => w.week_num === g.week);
    const day = week?.days?.find((d) => d.day_num === g.day);
    const block = day?.blocks?.[g.blockIdx];
    if (!block) { failed++; continue; }

    const corrected = await pack.recovery.surgicallyRewriteBlock(
      payload, skeleton, g.week, g.day, g.blockIdx, block, g.violations,
    );
    if (!corrected) { failed++; continue; }

    if (pack.recovery.spliceBlock(output, g.week, g.day, g.blockIdx, corrected)) {
      rewritten++;
      locations.push({ week: g.week, day: g.day, blockIdx: g.blockIdx });
      console.log(`[engine] surgical rewrote w${g.week}d${g.day}b${g.blockIdx} (${g.violations.length} violation${g.violations.length === 1 ? "" : "s"})`);
    } else {
      failed++;
    }
  }
  return { rewritten, failed, locations };
}

// ============================================================
// Benchmark + audit helpers shared by the benchmark_audit + surgical stages.
// ============================================================

/** Resolve gender for benchmark cohort lookups (null gender → "men" at the
 *  cohort layer, matching compute-benchmarks). */
export function resolveGender(payload: WriterPayload): Gender | null {
  const genderRaw = (payload.basics.gender ?? "").toLowerCase();
  return genderRaw === "men" || genderRaw === "male" ? "men"
    : genderRaw === "women" || genderRaw === "female" ? "women"
      : null;
}

/** Run the hard audits with the standard argument set. */
export function auditOutput(
  output: WriterOutput,
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  pack: DomainPack,
) {
  return pack.audits.runHard({
    output,
    daysPerWeek: payload.training_context.days_per_week,
    lifts: payload.lifts,
    vocabulary: payload.vocabulary,
    skeleton,
    doNotProgram: payload.training_context.injuries_structured?.do_not_program ?? [],
  });
}

/**
 * Recompute metcon benchmarks. Full (changedLocations undefined) computes every
 * metcon block; targeted computes the union of previously-failed + newly-changed
 * blocks. Returns the new pendingFailures set.
 */
export async function recomputeBenchmarks(
  output: WriterOutput,
  gender: Gender | null,
  pendingFailures: BlockLocation[],
  pack: DomainPack,
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
      console.log(`[engine] benchmarks: skipped — no blocks need recompute`);
      return pendingFailures;
    }
  }
  const stats = await pack.recovery.attachBenchmarks(output.weeks ?? [], gender, targetLocations);
  const mode = targetLocations ? `targeted(n=${targetLocations.length})` : "full";
  console.log(
    `[engine] benchmarks ${mode}: computed=${stats.computed} skipped=${stats.skipped} failed=${stats.failed}`,
  );
  return stats.failedLocations;
}

/** Surgical halts when the failing-block count is stable for this many passes. */
export const STALL_HALT_PASSES = 3;
