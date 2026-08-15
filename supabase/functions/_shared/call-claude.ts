/**
 * Shared Claude API helper with exponential-backoff retry and Haiku fallback.
 *
 * Usage (non-streaming):
 *   const text = await callClaude({ apiKey, system, userContent, maxTokens });
 *
 * Usage (streaming — returns the raw Response for the caller to process):
 *   const resp = await callClaudeStreaming({ apiKey, system, messages, maxTokens });
 */

import { fetchWithTimeout } from "./fetch-with-timeout.ts";
import { resolveModelProfile } from "./model-profiles.ts";

// The primary/fallback policy lives in ONE place — the "default" profile in
// model-profiles.ts — so call-claude and the future Engine model_profile wiring
// can't diverge. Ids are env-overridable there, so a model retirement is a
// config change (MODEL_SONNET / MODEL_HAIKU secrets), not a call-site edit.
const DEFAULT_PROFILE = resolveModelProfile("default");
const SONNET_MODEL = DEFAULT_PROFILE.primary;
const HAIKU_MODEL = DEFAULT_PROFILE.fallback ?? DEFAULT_PROFILE.primary;

const MAX_RETRIES = 2;
const RETRY_DELAYS = [0, 3000];
const ATTEMPT_TIMEOUT_MS = 45_000;

function isRetryable(status: number, errorBody: Record<string, unknown>): boolean {
  return (
    status === 429 ||
    status === 529 ||
    (errorBody?.error as Record<string, unknown>)?.type === "overloaded_error"
  );
}

async function attempt(
  model: string,
  apiKey: string,
  system: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  stream: boolean,
  timeoutMs: number = ATTEMPT_TIMEOUT_MS,
): Promise<Response> {
  return fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream,
      system,
      messages,
    }),
  }, timeoutMs);
}

// ---------------------------------------------------------------------------
// Non-streaming: returns the text content of the first content block.
// ---------------------------------------------------------------------------
export async function callClaude(opts: {
  apiKey: string;
  system: string;
  userContent: string;
  maxTokens: number;
  /** Per-attempt deadline. Default 45s fits short calls; size longer for
   *  big structured generations (house rule: attempts × timeout must stay
   *  inside the ~400s edge wall clock). */
  timeoutMs?: number;
  /** Default true. Set false for judgment seats where a degraded model is
   *  worse than no result — the caller (e.g. the resequence cron) simply
   *  tries again later. */
  fallbackToHaiku?: boolean;
}): Promise<string> {
  const {
    apiKey,
    system,
    userContent,
    maxTokens,
    timeoutMs = ATTEMPT_TIMEOUT_MS,
    fallbackToHaiku = true,
  } = opts;
  const msgs = [{ role: "user", content: userContent }];

  // A thrown attempt (timeout / transport abort) is as retryable as a 529 —
  // it used to escape this loop entirely and hard-fail the first slow call.
  let lastThrown = "";
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (RETRY_DELAYS[i] > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));

    let resp: Response;
    try {
      resp = await attempt(SONNET_MODEL, apiKey, system, msgs, maxTokens, false, timeoutMs);
    } catch (e) {
      lastThrown = e instanceof Error ? e.message : String(e);
      console.warn(`Claude Sonnet attempt ${i + 1}/${MAX_RETRIES} threw: ${lastThrown}`);
      continue;
    }

    if (resp.ok) {
      const data = await resp.json();
      return data.content?.[0]?.text?.trim() || "";
    }

    const err = await resp.json().catch(() => ({}));
    if (!isRetryable(resp.status, err)) {
      console.error("Claude API error (non-retryable):", err);
      throw new Error("Claude API call failed");
    }

    if (i < MAX_RETRIES - 1) {
      console.warn(`Claude Sonnet retry ${i + 1}/${MAX_RETRIES}`);
    }
  }

  if (!fallbackToHaiku) {
    throw new Error(
      `Claude API call failed: Sonnet retries exhausted${lastThrown ? ` (last: ${lastThrown})` : ""}; fallback disabled`,
    );
  }

  // Sonnet exhausted — single Haiku attempt
  console.warn("Sonnet retries exhausted, falling back to Haiku");
  let resp: Response;
  try {
    resp = await attempt(HAIKU_MODEL, apiKey, system, msgs, maxTokens, false, timeoutMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Haiku fallback also threw:", msg);
    throw new Error(`Claude API call failed (Sonnet + Haiku): ${msg}`);
  }

  if (resp.ok) {
    const data = await resp.json();
    return data.content?.[0]?.text?.trim() || "";
  }

  const err = await resp.json().catch(() => ({}));
  console.error("Haiku fallback also failed:", err);
  throw new Error("Claude API call failed (Sonnet + Haiku)");
}

// ---------------------------------------------------------------------------
// Vision: sends image(s) + optional text to Claude and returns text response.
// ---------------------------------------------------------------------------
export async function callClaudeVision(opts: {
  apiKey: string;
  system: string;
  images: { base64: string; mediaType: string }[];
  textPrompt?: string;
  maxTokens: number;
}): Promise<string> {
  const { apiKey, system, images, textPrompt, maxTokens } = opts;
  const content: { type: string; source?: { type: string; media_type: string; data: string }; text?: string }[] = [];

  for (const img of images) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.base64,
      },
    });
  }

  if (textPrompt) {
    content.push({ type: "text", text: textPrompt });
  }

  const msgs = [{ role: "user", content }];

  for (let i = 0; i < MAX_RETRIES; i++) {
    if (RETRY_DELAYS[i] > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));

    const resp = await attempt(SONNET_MODEL, apiKey, system, msgs as any, maxTokens, false);

    if (resp.ok) {
      const data = await resp.json();
      return data.content?.[0]?.text?.trim() || "";
    }

    const err = await resp.json().catch(() => ({}));
    if (!isRetryable(resp.status, err)) {
      console.error("Claude Vision API error (non-retryable):", err);
      throw new Error("Claude Vision API call failed");
    }

    if (i < MAX_RETRIES - 1) {
      console.warn(`Claude Vision retry ${i + 1}/${MAX_RETRIES}`);
    }
  }

  // Haiku fallback
  console.warn("Sonnet vision retries exhausted, falling back to Haiku");
  const resp = await attempt(HAIKU_MODEL, apiKey, system, msgs as any, maxTokens, false);

  if (resp.ok) {
    const data = await resp.json();
    return data.content?.[0]?.text?.trim() || "";
  }

  const err = await resp.json().catch(() => ({}));
  console.error("Haiku vision fallback also failed:", err);
  throw new Error("Claude Vision API call failed (Sonnet + Haiku)");
}

// ---------------------------------------------------------------------------
// Streaming: returns the raw Response so the caller can pipe the SSE body.
// ---------------------------------------------------------------------------
export async function callClaudeStreaming(opts: {
  apiKey: string;
  system: string;
  messages: { role: string; content: string }[];
  maxTokens: number;
}): Promise<Response> {
  const { apiKey, system, messages, maxTokens } = opts;

  for (let i = 0; i < MAX_RETRIES; i++) {
    if (RETRY_DELAYS[i] > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));

    const resp = await attempt(SONNET_MODEL, apiKey, system, messages, maxTokens, true);
    if (resp.ok) return resp;

    const err = await resp.json().catch(() => ({}));
    if (!isRetryable(resp.status, err)) {
      console.error("Claude streaming error (non-retryable):", err);
      throw new Error("Claude streaming call failed");
    }

    if (i < MAX_RETRIES - 1) {
      console.warn(`Claude streaming retry ${i + 1}/${MAX_RETRIES}`);
    }
  }

  console.warn("Sonnet streaming retries exhausted, falling back to Haiku");
  const resp = await attempt(HAIKU_MODEL, apiKey, system, messages, maxTokens, true);
  if (resp.ok) return resp;

  const err = await resp.json().catch(() => ({}));
  console.error("Haiku streaming fallback also failed:", err);
  throw new Error("Claude streaming call failed (Sonnet + Haiku)");
}
