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
 *     (athlete_model_version, coach_state_builder_version)
 *
 * Because generation is non-deterministic (LLM), reuse also makes CoachState
 * IDEMPOTENT per key: the first generation locks in the judgment; every program
 * built against that key uses the exact same CoachState (reproducibility), not a
 * re-roll. `force: true` is the deliberate override (the admin "Re-run" button).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { WriterPayload } from "./build-writer-payload.ts";
import { COACH_STATE_SYSTEM_PROMPT } from "./coach-state-prompt.ts";
import {
  athleteModelEvidenceKeys,
} from "./athlete-model.ts";
import {
  buildEmitCoachStateTool,
  COACH_STATE_BUILDER_VERSION,
  type CoachState,
  type CoachStateContent,
} from "./coach-state.ts";
import { persistCoachState } from "./persist-coach-state.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";

interface ClaudeResponse {
  content?: Array<{ type?: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** One CoachState LLM call. Consumes payload.athlete_model (Step-1 facts) +
 *  a per-athlete evidence enum (Step 1.5). Returns validated content stamped
 *  with the builder version. */
async function callCoachState(payload: WriterPayload): Promise<CoachStateContent> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const tool = buildEmitCoachStateTool(athleteModelEvidenceKeys(payload.athlete_model));
  const userMessage = `ATHLETE PAYLOAD (JSON):\n${JSON.stringify(payload, null, 2)}`;

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
      system: COACH_STATE_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_coach_state" },
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }
  const data = (await resp.json()) as ClaudeResponse;
  const toolUse = (data.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === "emit_coach_state",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    throw new Error(`Claude response missing emit_coach_state tool_use. stop_reason=${data.stop_reason}`);
  }
  console.log(
    `[generate-coach-state] Claude usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens}`,
  );
  return { ...(toolUse.input as CoachStateContent), coach_state_builder_version: COACH_STATE_BUILDER_VERSION };
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
}

/**
 * Reuse-if-current, else generate + persist. `force` bypasses the cache (the
 * admin "Re-run" override). The cache key is (athlete_model_version,
 * coach_state_builder_version) — both read off the payload's Athlete Model and
 * the current builder constant.
 */
export async function generateAndPersistCoachState(
  supa: SupabaseClient,
  userId: string,
  payload: WriterPayload,
  opts: { force?: boolean } = {},
): Promise<GenerateCoachStateResult> {
  const athleteModelVersion = payload.athlete_model.version;

  if (!opts.force) {
    const { data: cached } = await supa
      .from("coach_states")
      .select("version, coach_state")
      .eq("user_id", userId)
      .eq("athlete_model_version", athleteModelVersion)
      .eq("coach_state_builder_version", COACH_STATE_BUILDER_VERSION)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle<CachedRow>();
    if (cached) {
      console.log(
        `[generate-coach-state] reuse-if-current HIT: coach_state v${cached.version} (AM v${athleteModelVersion}, builder ${COACH_STATE_BUILDER_VERSION})`,
      );
      return { coach_state: cached.coach_state, version: cached.version, reused: true };
    }
  }

  const content = await callCoachState(payload);
  const persisted = await persistCoachState(supa, userId, content, athleteModelVersion);
  console.log(
    `[generate-coach-state] generated coach_state v${persisted.version} (AM v${athleteModelVersion}, builder ${COACH_STATE_BUILDER_VERSION}, force=${!!opts.force})`,
  );
  return { coach_state: persisted.coach_state, version: persisted.version, reused: false };
}
