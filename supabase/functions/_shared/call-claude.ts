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

const SONNET_MODEL = "claude-sonnet-4-20250514";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

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
  }, ATTEMPT_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Non-streaming: returns the text content of the first content block.
// ---------------------------------------------------------------------------
export async function callClaude(opts: {
  apiKey: string;
  system: string;
  userContent: string;
  maxTokens: number;
}): Promise<string> {
  const { apiKey, system, userContent, maxTokens } = opts;
  const msgs = [{ role: "user", content: userContent }];

  for (let i = 0; i < MAX_RETRIES; i++) {
    if (RETRY_DELAYS[i] > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));

    const resp = await attempt(SONNET_MODEL, apiKey, system, msgs, maxTokens, false);

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

  // Sonnet exhausted — single Haiku attempt
  console.warn("Sonnet retries exhausted, falling back to Haiku");
  const resp = await attempt(HAIKU_MODEL, apiKey, system, msgs, maxTokens, false);

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
