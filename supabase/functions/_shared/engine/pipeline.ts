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

import { TWO_DAY_FILL_ADDENDUM } from "../v2-system-prompt.ts";
import type { WriterPayload } from "../build-writer-payload.ts";
import type { TrainingDesignInput } from "../training-design-input.ts";
import type { SkeletonOutput } from "../v3-output-schema.ts";
import type { WriterOutput, WeekPrescription } from "../v2-output-schema.ts";
import type { SkeletonAuditResult } from "../v3-skeleton-audits.ts";
import { renderBlockSchemeInPlace } from "../compose-block-scheme.ts";
import type { runAudits } from "../audit-runner.ts";
import type { BlockLocation } from "../compute-block-benchmark.ts";
import type { Gender } from "../compute-benchmarks.ts";
import type { DomainPack } from "../domain-packs/types.ts";
import type { ComposedMetcon } from "../metcon-composer.ts";
import { MODELS } from "../model-profiles.ts";
import { athleteWordsElsewhere, restrictionsForPrompt } from "../restriction-gate.ts";
import { fitProfileFromPayload, fitRulesForWriter } from "../fit-gate.ts";

/** Failure list shape from a hard-audit run (type-only; erased at runtime). */
type AuditFailures = ReturnType<typeof runAudits>["failures"];

// Pipeline-family key (program generation / evals) for spend attribution;
// falls back to the shared key so a missing secret never breaks generation.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = MODELS.sonnet;
// Week-fill seat (2026-11-14): gated move to Sonnet 5.5. Set the WEEK_FILL_MODEL
// function secret to MODELS.sonnet5's id to run the fill there; unset, the fill
// stays on MODELS.sonnet. Sonnet 5.5 rejects forced tool_choice (probe
// 2026-11-14: `tool` and `any` both 400; `auto` works and calls the tool when
// told to), so the 5.x path sends `auto` plus an instruction, and a reply with
// no tool call is retried once with a nudge. Flip the default here once the
// weekly fills on the test athlete read well; then drop the secret.
const WEEK_FILL_MODEL = Deno.env.get("WEEK_FILL_MODEL") || MODEL;
const WEEK_FILL_FORCED_TOOL_OK = WEEK_FILL_MODEL === MODEL; // 4.x accepts forced tool_choice
const WEEK_FILL_TOOL_INSTRUCTION =
  "\n\nREPLY FORMAT: your ONLY valid reply is a single call to the emit_week tool with the complete week. Never answer in prose.";
// 2026-08 adoption: the skeleton is the judgment-translation layer — it reads
// the full CoachState document and structures the cycle. Frontier model per the
// shadow-test series (clean sweeps on rules + letter fidelity); the week-fill
// stays on Sonnet (pure execution). Fable emits longer skeletons (~7-9K tokens)
// less reliably — hence the 16K budget and the structural repair below.
const SKELETON_MODEL = MODELS.fable;
export const MAX_SKELETON_ATTEMPTS = 3;
// The skeleton emits up to ~9k tokens of Fable output; the LLM call sits inside
// the MAX_SKELETON_ATTEMPTS audit-retry loop (the ONLY multiplier) — keep
// ATTEMPTS × this timeout under the ~400s edge wall-clock (3 × 130s = 390s).
const SKELETON_TIMEOUT_MS = 130_000;

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

/** Call the skeleton writer for the given pack. Returns parsed SkeletonOutput.
 *  intentDocument (optional) is the judgment layer's full written document
 *  (e.g. the CoachState document block) — pack-agnostic string, appended after
 *  the TDI so the writer reads the letter it is structurally executing. */
export async function callSkeletonWriter(
  tdi: TrainingDesignInput,
  retryViolations: string,
  pack: DomainPack,
  intentDocument = "",
): Promise<SkeletonOutput> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const daysPerWeek = tdi.days_per_week;

  // Day-composition template is pack-supplied (the crossfit pack returns the
  // pre-seam string byte-for-byte; a variant pack supplies e.g. the class shape).
  const ruleRecap = pack.writer.skeletonRuleRecap(daysPerWeek, tdi);

  const inputBlock = `TRAINING DESIGN INPUT (JSON — the FIXED plan to allocate):\n${JSON.stringify(tdi, null, 2)}`;
  const body = intentDocument
    ? `${inputBlock}\n\n${intentDocument}\n\n${ruleRecap}`
    : `${inputBlock}\n\n${ruleRecap}`;
  const userMessage = retryViolations ? `${retryViolations}\n\n---\n\n${body}` : body;

  const t0 = Date.now();
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: SKELETON_MODEL,
      max_tokens: 16000,
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
  return repairSkeletonEmission(toolUse.input as SkeletonOutput);
}

/** Anthropic tool-schema enforcement is imperfect even under forced tool-use:
 *  Fable has emitted month_plan as a JSON-STRINGIFIED object (schema-illegal —
 *  the node is strictly object-typed; observed 2026-08-10). Un-stringify when
 *  the content parses; the unparseable variant fails the structural audit and
 *  rides the existing retry loop. */
function repairSkeletonEmission(skeleton: SkeletonOutput): SkeletonOutput {
  // deno-lint-ignore no-explicit-any
  const s = skeleton as any;
  if (typeof s?.month_plan === "string") {
    try {
      const parsed = JSON.parse(s.month_plan);
      if (parsed && typeof parsed === "object") {
        console.warn(`[engine skeleton] repaired double-encoded month_plan (string → object)`);
        s.month_plan = parsed;
      }
    } catch {
      console.warn(`[engine skeleton] month_plan is a string of unparseable JSON — structural audit will retry`);
    }
  }
  return s as SkeletonOutput;
}

// A verbose week fill can need >150s of Sonnet output, so ONE attempt gets a
// generous budget. (2026-11-23) A PASSING error no longer fails the build: a
// transient failure — HTTP 429/500/502/503/504/529, a network error, or a
// timeout — is retried ONCE after a short pause, and only when enough of the
// stage's budget is left for a second attempt to have a real chance. Those
// errors usually come back within seconds, so there normally is; a timeout
// that used up the whole first window is not retried (no room under the ~400s
// edge wall-clock). Anything else (400/401/403/404, a malformed reply) throws
// at once, as before. This retry lives in callWeekFill only; the dispatcher's
// "a writer stage that throws fails the job" rule is unchanged.
const MAX_WEEK_FILL_ATTEMPTS = 2;
const WEEK_FILL_TIMEOUT_MS = 330_000;
/** All attempts, the pause included, finish inside this. */
export const WEEK_FILL_BUDGET_MS = 360_000;
export const WEEK_FILL_RETRY_PAUSE_MS = 5_000;
/** Below this a second attempt could not finish a week: do not start one. */
export const WEEK_FILL_MIN_RETRY_WINDOW_MS = 120_000;

export const TRANSIENT_HTTP_STATUSES = [429, 500, 502, 503, 504, 529];

/** A non-2xx reply from the model API, with its status kept for the retry decision. */
export class ClaudeHttpError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`Claude HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "ClaudeHttpError";
  }
}

/** Pure: is this failure one that passes by itself? */
export function isTransientFillError(err: unknown): boolean {
  if (err instanceof ClaudeHttpError) return TRANSIENT_HTTP_STATUSES.includes(err.status);
  if (!(err instanceof Error)) return false;
  // A timeout (AbortSignal.timeout) or an aborted request. Decided by the
  // error's NAME, never by words in its message: our own "malformed reply"
  // errors quote the model's text, which can say anything.
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  // A network failure: fetch rejects with a TypeError (connection refused or
  // reset, DNS, TLS, a body cut off mid-read). Other TypeErrors are bugs.
  return err.name === "TypeError" &&
    /fetch|request|network|connect|dns|tls|socket|body|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(err.message);
}

/**
 * Run `attempt` and, when it fails with a transient error, run it once more
 * after a pause — if the budget still has room. `attempt` is told the time by
 * which it must be done. Exported for the test; callWeekFill is the only user.
 */
export async function withOneTransientRetry<T>(
  attempt: (deadlineMs: number, attemptNo: number) => Promise<T>,
  opts: {
    budgetMs: number;
    attemptTimeoutMs: number;
    pauseMs: number;
    minRetryWindowMs: number;
    maxAttempts?: number;
    isTransient?: (err: unknown) => boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (err: unknown, attemptNo: number, elapsedMs: number) => void;
    onGiveUp?: (err: unknown, attemptNo: number, elapsedMs: number, why: string) => void;
  },
): Promise<T> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const isTransient = opts.isTransient ?? isTransientFillError;
  const maxAttempts = opts.maxAttempts ?? 2;
  const start = now();
  const hardStop = start + opts.budgetMs;
  for (let n = 1; ; n++) {
    const deadline = Math.min(now() + opts.attemptTimeoutMs, hardStop);
    try {
      return await attempt(deadline, n);
    } catch (err) {
      const elapsed = now() - start;
      const why = !isTransient(err)
        ? "not a transient error"
        : n >= maxAttempts
        ? "already retried"
        : hardStop - (now() + opts.pauseMs) < opts.minRetryWindowMs
        ? "no time left in the stage's budget"
        : "";
      if (why) { opts.onGiveUp?.(err, n, elapsed, why); throw err; }
      opts.onRetry?.(err, n, elapsed);
      await sleep(opts.pauseMs);
    }
  }
}

/** Fill ONE week of the program. Reuses the pack's week-fill prompt + emit_week
 *  tool, with the full skeleton as context, the specific week to fill, and the
 *  already-generated prior weeks (so loads/volume progress across the cycle). */
/** Structural problems in an emit_week input that the audits would otherwise
 *  trip over (a cut-off or prose-shaped reply): the days list, its length,
 *  and that every day has a blocks list. Content is the audits' job. */
export function weekShapeProblems(week: unknown, daysPerWeek: number): string[] {
  const problems: string[] = [];
  const w = week as { days?: unknown } | null;
  if (!w || !Array.isArray(w.days)) return ["days must be a list"];
  if (w.days.length !== daysPerWeek) problems.push(`expected ${daysPerWeek} days, got ${w.days.length}`);
  w.days.forEach((d, i) => {
    const day = d as { blocks?: unknown } | null;
    if (!day || !Array.isArray(day.blocks) || day.blocks.length === 0) problems.push(`day ${i + 1} has no blocks`);
  });
  return problems;
}

export async function callWeekFill(
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  weekNum: number,
  priorWeeks: WeekPrescription[],
  extraContext: string,
  pack: DomainPack,
  // 2026-08 composer split: this week's pre-composed metcons. When present the
  // fill TRANSCRIBES each piece (movements/scheme/format as given) and its job
  // shrinks to exact loads, calories/distances, and typed fields.
  composedMetcons?: ComposedMetcon[],
): Promise<WeekPrescription> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const daysPerWeek = payload.training_context.days_per_week;
  const units = payload.basics.units ?? "lbs";
  const weekSkeleton = skeleton.weeks.find((w) => w.week_num === weekNum) ?? null;
  const hasComposed = (composedMetcons?.length ?? 0) > 0;

  const ruleRecap = [
    "=== KEY RULES (re-check before emit) ===",
    `- Emit EXACTLY week ${weekNum}: week_num=${weekNum} with ${daysPerWeek} days (day_num 1..${daysPerWeek}).`,
    `- All weights in ${units}.`,
    "- Honor THIS WEEK's skeleton: each day's block_types, primary_lift, strength_scheme, metcon_focus, skill_focus are already decided. Fill in movement-level prescriptions only.",
    "- Prescribed barbell weight ≤ athlete's 1RM for that lift, unless block_scheme/notes mention a 1RM attempt.",
    "- At most one metcon block per day. Every metcon block must declare a block_scheme.",
    "- Every movement in strength / accessory / metcon / skills blocks must populate at least one of {sets, reps, weight, time_seconds, distance} > 0.",
    // The athlete's restrictions, in their own words, stated as an absolute
    // (2026-11-23): the old one-line "substitute or scale" let an easy run
    // into the cool-downs of an athlete who wrote "runner's knee".
    fitRulesForWriter(fitProfileFromPayload(payload, skeleton, []), weekNum),
    restrictionsForPrompt(
      payload.training_context.injuries_constraints_text,
      payload.training_context.injuries_structured?.do_not_program,
      athleteWordsElsewhere(payload.athlete_model?.self_report, payload.training_context.coach_notes),
    ) || "- The athlete has stated no injury, pain or physical limit, and has no avoid list.",
    // Session-budget phase: honor the skeleton's time allocation when it
    // emitted one. Guidance only — nothing checks or enforces it.
    ...((payload.training_context.session_length_minutes ?? 0) > 0
      ? [
        "- The skeleton's block_minutes (when present on a day) is that day's time allocation and part of each block's PURPOSE: size the work — interval lengths, set counts, secondary movements, rest — so the block genuinely occupies about its allotted minutes. A large allocation is deliberate: a 28-minute strength slot carries more than a lone 5x5 (add working sets or a secondary movement); working sets plus realistic rest should approach the allocation.",
        "- PRECEDENCE: skill volume caps beat time-fill. When a block's minutes exceed what tier-appropriate skill volume supports, fill the remainder with monostructural work, rest structure, or low-skill movements — never more reps of a capped skill.",
      ]
      : []),
    hasComposed
      ? "- Metcons for days listed in COMPOSED METCONS are PRE-COMPOSED: emit each EXACTLY — same movements, same scheme, same format, same duration. Your job on those is exact loads from the athlete's 1RMs, calories/distances from their pacing, and the typed per-movement fields. NEVER redesign, swap, add, or drop a composed movement. If a metcon day is NOT in the list (its piece was removed), compose that day's metcon YOURSELF from the skeleton's metcon_focus and the athlete's allowed movements — distinct from the composed pieces, expected time inside the focus window."
      : "- The metcon's EXPECTED completion time must land inside the skeleton's stated metcon_focus window; a time cap may sit above it as a ceiling, never below.",
    priorWeeks.length > 0
      ? `- PROGRESS from the prior weeks below per the month_plan's arc (add load/volume, advance schemes) — do NOT copy them verbatim. ` +
        `When a WHAT THE ATHLETE ACTUALLY DID block is present above, it OUTRANKS the prior weeks as written: progress from the loads ` +
        `that were lifted and the results that were logged; do not progress from a day or block that was not done.`
      : `- This is week 1 — set the cycle's opening baseline.`,
    ...((payload.training_context.coach_notes ?? []).length > 0
      ? [`- ATHLETE'S NOTES FOR THEIR COACH (honour within the skeleton's day types and the composed metcons — emphasis, volume and movement choice, never day count, never over an injury): ${(payload.training_context.coach_notes ?? []).map((n) => `"${n}"`).join("; ")}`]
      : []),
  ].join("\n");

  const composedBlock = hasComposed
    ? `COMPOSED METCONS FOR THIS WEEK (transcribe each EXACTLY as this day's metcon block — assign loads, don't redesign):\n${JSON.stringify(composedMetcons, null, 2)}`
    : "";
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
  const baseMessage = [thisWeekBlock, composedBlock, priorBlock, arcBlock, payloadBlock, ruleRecap]
    .filter(Boolean).join("\n\n");
  const userMessage = extraContext ? `${extraContext}\n\n---\n\n${baseMessage}` : baseMessage;

  // 2-day athletes get the scoped addendum; 3-6 day prompts are
  // byte-identical to before two-day support. The 5.x path appends the
  // reply-format instruction that replaces the forced tool_choice.
  const systemPrompt = (daysPerWeek === 2
    ? pack.writer.weekFillSystemPrompt + TWO_DAY_FILL_ADDENDUM
    : pack.writer.weekFillSystemPrompt) + (WEEK_FILL_FORCED_TOOL_OK ? "" : WEEK_FILL_TOOL_INSTRUCTION);
  const weekTool = pack.writer.buildWeekTool(daysPerWeek, units, payload.training_context.session_length_minutes ?? null);
  // Thinking-on models spend part of the budget before the tool call; a full
  // 5-day week is ~10-12K tokens of JSON on its own.
  const maxTokens = WEEK_FILL_FORCED_TOOL_OK ? 16000 : 32000;

  const describe = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  return await withOneTransientRetry(async (deadlineMs) => {
    // One nudge when a non-forced reply carries no tool call (text instead).
    // The nudge is not a retry: it shares this attempt's deadline.
    let nudge = "";
    for (;;) {
      const t0 = Date.now();
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: WEEK_FILL_MODEL,
          max_tokens: maxTokens,
          stream: false,
          system: systemPrompt,
          tools: [weekTool],
          tool_choice: WEEK_FILL_FORCED_TOOL_OK ? { type: "tool", name: "emit_week" } : { type: "auto" },
          messages: [{ role: "user", content: nudge ? `${nudge}\n\n---\n\n${userMessage}` : userMessage }],
        }),
        signal: AbortSignal.timeout(Math.max(1_000, deadlineMs - Date.now())),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new ClaudeHttpError(resp.status, body);
      }

      const data = (await resp.json()) as ClaudeResponse;
      console.log(
        `[engine fill week ${weekNum}] model=${WEEK_FILL_MODEL} usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens} stop_reason=${data.stop_reason} fetch_ms=${Date.now() - t0}`,
      );
      const toolUse = (data.content ?? []).find(
        (b) => b.type === "tool_use" && b.name === "emit_week",
      );
      if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
        // Non-forced model answered in prose (or was cut off): nudge once.
        if (!WEEK_FILL_FORCED_TOOL_OK && !nudge && data.stop_reason !== "max_tokens") {
          nudge = "YOUR PREVIOUS REPLY DID NOT CALL emit_week. Reply ONLY with one emit_week tool call carrying the complete week.";
          console.warn(`[engine fill week ${weekNum}] no tool call in reply (stop_reason=${data.stop_reason}); nudging once`);
          continue;
        }
        throw new Error(
          `week ${weekNum}: missing emit_week tool_use. stop_reason=${data.stop_reason} content=${JSON.stringify(data.content).slice(0, 300)}`,
        );
      }
      const week = toolUse.input as WeekPrescription;
      const shape = weekShapeProblems(week, daysPerWeek);
      if (shape.length) {
        throw new Error(`week ${weekNum}: emit_week input malformed (stop_reason=${data.stop_reason}): ${shape.join("; ")}`);
      }
      week.week_num = weekNum; // enforce regardless of what the model emitted
      return week;
    }
  }, {
    budgetMs: WEEK_FILL_BUDGET_MS,
    attemptTimeoutMs: WEEK_FILL_TIMEOUT_MS,
    pauseMs: WEEK_FILL_RETRY_PAUSE_MS,
    minRetryWindowMs: WEEK_FILL_MIN_RETRY_WINDOW_MS,
    maxAttempts: MAX_WEEK_FILL_ATTEMPTS,
    onRetry: (err, n, elapsed) =>
      console.warn(`[engine fill week ${weekNum}] transient after ${elapsed}ms (${describe(err)}); retrying once (attempt ${n + 1}/${MAX_WEEK_FILL_ATTEMPTS})`),
    onGiveUp: (err, _n, elapsed, why) =>
      console.warn(`[engine fill week ${weekNum}] giving up after ${elapsed}ms (${describe(err)}) — ${why}`),
  });
}

// ============================================================
// Loops
// ============================================================

export async function generateSkeletonWithAudits(
  tdi: TrainingDesignInput,
  pack: DomainPack,
  setStage: SetStage = NO_STAGE,
  intentDocument = "",
): Promise<SkeletonOutput> {
  let retryViolations = "";
  let lastSkeleton: SkeletonOutput | null = null;
  let lastFailures: SkeletonAuditResult[] = [];

  for (let attempt = 1; attempt <= MAX_SKELETON_ATTEMPTS; attempt++) {
    console.log(`[engine] skeleton attempt ${attempt}/${MAX_SKELETON_ATTEMPTS}`);
    await setStage(`skeleton_attempt_${attempt}`);
    let skeleton: SkeletonOutput;
    try {
      skeleton = await callSkeletonWriter(tdi, retryViolations, pack, intentDocument);
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
    // Corrected blocks carry scheme_format; render the header before splicing
    // so re-audit and save see the final string.
    renderBlockSchemeInPlace(corrected);

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
