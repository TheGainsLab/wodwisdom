/**
 * generate-coach-state.ts
 *
 * Shared CoachState generation, used by BOTH the eval (profile-analysis-v2) and
 * the program generator's coach_state stage — so eval and program produce
 * CoachState identically (aligned by construction).
 *
 * PIPELINE = "always CURRENT", not "always fresh". CoachState is reused when
 * VALID BY PROVENANCE, regenerated only when its deterministic inputs change —
 * consistent with the rest of the architecture (immutable artifacts keyed by
 * deterministic inputs). Cache key:
 *
 *     (athlete_model_version, coach_state_builder_version, inputs_hash)
 *
 * Because generation is non-deterministic (LLM), reuse also makes CoachState
 * IDEMPOTENT per key: the first generation locks in the judgment; every program
 * built against that key uses the exact same CoachState (reproducibility), not a
 * re-roll. `force: true` is the deliberate override (the admin "Re-run" button).
 *
 * INPUTS HASH (2026-11-23). The athlete model does not contain the goal, days
 * per week, session length, injury text or the athlete's notes, so a stored
 * judgment was reused after any of those changed: the priorities a program
 * was built from could predate the goal. Each stored state now records a hash
 * of exactly those five inputs (coach_states.inputs_hash) and is reused only
 * when the hash also matches. A row with NO hash (every row written before
 * this) never matches, so each athlete gets one fresh judgment at their next
 * build and reuse resumes from there.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { WriterPayload } from "./build-writer-payload.ts";
import {
  COACH_STATE_SYSTEM_PROMPT,
  ENGINE_COACH_STATE_ADDENDUM,
  SIGNATURE_PROFILE_COACH_STATE_ADDENDUM,
  TWO_DAY_COACH_STATE_ADDENDUM,
} from "./coach-state-prompt.ts";
import {
  athleteModelEvidenceKeys,
} from "./athlete-model.ts";
import {
  allowedReasonCodes,
  buildEmitCoachStateTool,
  COACH_STATE_BUILDER_VERSION,
  type CoachState,
  type CoachStateContent,
} from "./coach-state.ts";
import {
  auditCoachState,
  formatCoachStateViolationsForRetry,
} from "./coach-state-audits.ts";
import { persistCoachState } from "./persist-coach-state.ts";
import { loadArchiveCutoff } from "./program-archive.ts";
import { MODELS } from "./model-profiles.ts";

// Pipeline-family key for spend attribution; falls back to the shared key.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY");
// Frontier eval (2026-08 side-by-side: Fable > Opus > Sonnet on fidelity,
// calibration, and causal reasoning; ~25¢/eval). The free eval is the
// conversion artifact — pay for judgment here. Skeleton/week-fill unaffected.
const MODEL = MODELS.fable;
// 2026-11-13: the letters (summary, metcon_guidance, month_in_review) have
// grown since 8000 was set; a cut-off tool call arrives as a partial input
// whose lists are missing, which the audit crashed on ("cs.priorities.map
// is not a function", 4 evals since 2026-09). Doubled, and the shape is
// checked before the audit (see assertCoachStateShape).
const MAX_TOKENS = 16000;

interface ClaudeResponse {
  content?: Array<{ type?: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Lists the audit maps over. A cut-off or malformed tool input leaves one
 *  undefined (or a non-array) and the audit threw a TypeError before the
 *  violation-retry path could help. Returns the names of the broken fields;
 *  empty = shape is sound. The audit still judges the CONTENT. */
export function coachStateShapeProblems(input: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const k of ["priorities", "maintain", "deprioritize"]) {
    if (!Array.isArray(input[k])) problems.push(`${k} must be a list`);
  }
  for (const k of ["recovery_posture", "strength_emphasis"]) {
    const v = input[k] as { reasons?: unknown } | undefined;
    if (!v || typeof v !== "object" || !Array.isArray(v.reasons)) problems.push(`${k}.reasons must be a list`);
  }
  return problems;
}

/** One CoachState LLM call. Consumes payload.athlete_model (Step-1 facts) +
 *  a per-athlete evidence enum (Step 1.5) + a per-athlete reason enum (v1.6 —
 *  unsupportable codes are schema-rejected). Returns content stamped with the
 *  builder version. retryViolations, when present, is prepended so the model
 *  fixes a failed audit rather than starting fresh. */
async function callCoachState(
  payload: WriterPayload,
  retryViolations = "",
): Promise<CoachStateContent> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const tool = buildEmitCoachStateTool(
    [
      ...athleteModelEvidenceKeys(payload.athlete_model),
      // the fitted capability profile is citable evidence when present
      ...(payload.signature_profile ? ["signature_profile"] : []),
    ],
    allowedReasonCodes(payload),
  );
  const payloadBlock = `ATHLETE PAYLOAD (JSON):\n${JSON.stringify(payload, null, 2)}`;
  const userMessage = retryViolations
    ? `${retryViolations}\n\n---\n\n${payloadBlock}`
    : payloadBlock;

  const doFetch = () =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        stream: false,
        // Scoped addenda, composable: ENGINE rides only with completed-
        // session Engine evidence; TWO-DAY rides only at days_per_week = 2
        // (a 2-day Engine athlete gets both). Athletes matching neither
        // get the byte-identical base prompt.
        system: COACH_STATE_SYSTEM_PROMPT +
          (payload.signature_profile ? SIGNATURE_PROFILE_COACH_STATE_ADDENDUM : "") +
          (payload.engine_training ? ENGINE_COACH_STATE_ADDENDUM : "") +
          (payload.training_context.days_per_week === 2 ? TWO_DAY_COACH_STATE_ADDENDUM : ""),
        tools: [tool],
        tool_choice: { type: "tool", name: "emit_coach_state" },
        messages: [{ role: "user", content: userMessage }],
      }),
      // v1.8 letters (metcon_guidance + month_in_review) run longer than the
      // letters 120s was sized for. Two attempts is the only multiplier —
      // 2 × 180s = 360s stays under the ~400s edge wall-clock (house rule).
      signal: AbortSignal.timeout(180_000),
    });

  let resp = await doFetch();
  // Transient API failures (5xx/429) return in seconds, not at the timeout —
  // one short-delay retry absorbs them without threatening the wall-clock
  // budget. Timeouts are NOT retried: a second 180s attempt would blow it.
  if (!resp.ok && (resp.status >= 500 || resp.status === 429)) {
    console.warn(`[generate-coach-state] Claude HTTP ${resp.status}, retrying once in 3s`);
    await new Promise((r) => setTimeout(r, 3000));
    resp = await doFetch();
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }
  const data = (await resp.json()) as ClaudeResponse;
  console.log(
    `[generate-coach-state] Claude stop_reason=${data.stop_reason} usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens} (max_tokens=${MAX_TOKENS})`,
  );
  const toolUse = (data.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === "emit_coach_state",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    throw new Error(`Claude response missing emit_coach_state tool_use. stop_reason=${data.stop_reason}`);
  }
  const problems = coachStateShapeProblems(toolUse.input as Record<string, unknown>);
  if (data.stop_reason === "max_tokens" || problems.length) {
    throw new CoachStateShapeError(
      `coach_state tool input unusable (stop_reason=${data.stop_reason}): ${problems.join("; ") || "cut off"}`,
      problems,
    );
  }
  return { ...(toolUse.input as CoachStateContent), coach_state_builder_version: COACH_STATE_BUILDER_VERSION };
}

/** A reply whose tool input cannot even be audited (cut off at max_tokens,
 *  or a required list missing). Retried once with the problems named. */
class CoachStateShapeError extends Error {
  constructor(message: string, public readonly problems: string[]) {
    super(message);
  }
}

/** One call, retried once on an unusable shape. The retry tells the model
 *  which fields were missing; a cut-off reply gets a "be concise" note. */
async function callCoachStateChecked(payload: WriterPayload, retryViolations = ""): Promise<CoachStateContent> {
  try {
    return await callCoachState(payload, retryViolations);
  } catch (e) {
    if (!(e instanceof CoachStateShapeError)) throw e;
    console.warn(`[generate-coach-state] ${e.message} — retrying once`);
    const note = e.problems.length
      ? `YOUR PREVIOUS REPLY WAS REJECTED — required fields were missing or malformed: ${e.problems.join("; ")}. Emit the complete emit_coach_state input with every required list present.`
      : "YOUR PREVIOUS REPLY WAS CUT OFF before the tool input completed. Emit the complete emit_coach_state input; keep the summary and month_in_review within their stated lengths.";
    return await callCoachState(payload, retryViolations ? `${note}\n\n${retryViolations}` : note);
  }
}

/** The five profile inputs a judgment depends on that the athlete model does
 *  not carry. Read off the payload's training_context. */
export interface CoachStateInputs {
  goal_text?: string | null;
  days_per_week?: number | null;
  session_length_minutes?: number | null;
  injuries_constraints_text?: string | null;
  coach_notes?: string[] | null;
}

/**
 * SHA-256 of exactly: goal text, days per week, session length, injury text,
 * active coach notes. Text is trimmed so whitespace alone is not a change;
 * notes are sorted so their order is not a change. Nothing else goes in —
 * adding a field here makes every stored judgment stale once.
 */
export async function coachStateInputsHash(inputs: CoachStateInputs): Promise<string> {
  const canonical = JSON.stringify({
    goal: (inputs.goal_text ?? "").trim(),
    days: inputs.days_per_week ?? null,
    session: inputs.session_length_minutes ?? null,
    injuries: (inputs.injuries_constraints_text ?? "").trim(),
    notes: (inputs.coach_notes ?? []).map((n) => n.trim()).filter(Boolean).sort(),
  });
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface GenerateCoachStateResult {
  /** The full persisted/stored snapshot (CoachState ⊃ CoachStateContent). */
  coach_state: CoachState;
  version: number;
  /** true = served from cache (no LLM call); false = freshly generated. */
  reused: boolean;
}

interface CachedRow {
  version: number;
  coach_state: CoachState;
  inputs_hash: string | null;
}

/**
 * Reuse-if-current, else generate + persist. `force` bypasses the cache (the
 * admin "Re-run" override). The cache key is (athlete_model_version,
 * coach_state_builder_version, inputs_hash) — read off the payload's Athlete
 * Model, the current builder constant and the payload's training_context.
 */
export async function generateAndPersistCoachState(
  supa: SupabaseClient,
  userId: string,
  payload: WriterPayload,
  opts: { force?: boolean } = {},
): Promise<GenerateCoachStateResult> {
  const athleteModelVersion = payload.athlete_model.version;
  const inputsHash = await coachStateInputsHash(payload.training_context);

  if (!opts.force) {
    // Programming archive (2026-11-21): a coach state written before the
    // athlete's programs were archived is the judgment behind the program
    // they left — never reused, even when their profile has not changed.
    // A returner's fresh evaluation is a fresh judgment. Null = never archived.
    const archiveCutoff = await loadArchiveCutoff(supa, userId).catch(() => null);
    let cachedQuery = supa
      .from("coach_states")
      .select("version, coach_state, inputs_hash")
      .eq("user_id", userId)
      .eq("athlete_model_version", athleteModelVersion)
      .eq("coach_state_builder_version", COACH_STATE_BUILDER_VERSION)
      // Same goal, days, session length, injury text and notes as when it was
      // written. `=` never matches NULL, so rows from before the hash existed
      // are not reused (2026-11-23).
      .eq("inputs_hash", inputsHash);
    if (archiveCutoff) cachedQuery = cachedQuery.gt("created_at", archiveCutoff);
    const { data: cached } = await cachedQuery
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle<CachedRow>();
    // Belt and braces: the row must carry this exact hash (a missing column or
    // a client that ignored the filter must not turn into a reuse).
    if (cached && cached.inputs_hash === inputsHash) {
      console.log(
        `[generate-coach-state] reuse-if-current HIT: coach_state v${cached.version} (AM v${athleteModelVersion}, builder ${COACH_STATE_BUILDER_VERSION})`,
      );
      return { coach_state: cached.coach_state, version: cached.version, reused: true };
    }
  }

  // Generate + audit, one retry on violations. Violations are quality defects,
  // not fatal: a second-attempt failure is logged and accepted (evals must
  // ship; the audit trail is the fix signal).
  let content = await callCoachStateChecked(payload);
  const audit = auditCoachState(content, payload);
  if (!audit.passed) {
    console.warn(
      `[generate-coach-state] audit violations (retrying once): ${audit.violations.join(" | ")}`,
    );
    content = await callCoachStateChecked(payload, formatCoachStateViolationsForRetry(audit.violations));
    const retryAudit = auditCoachState(content, payload);
    if (!retryAudit.passed) {
      console.warn(
        `[generate-coach-state] audit violations persist after retry (accepting): ${retryAudit.violations.join(" | ")}`,
      );
    }
  }
  const persisted = await persistCoachState(supa, userId, content, athleteModelVersion, null, inputsHash);
  console.log(
    `[generate-coach-state] generated coach_state v${persisted.version} (AM v${athleteModelVersion}, builder ${COACH_STATE_BUILDER_VERSION}, force=${!!opts.force})`,
  );
  return { coach_state: persisted.coach_state, version: persisted.version, reused: false };
}
