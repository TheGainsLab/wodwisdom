/**
 * generate-program-v3/index.ts
 *
 * v3 chained-generation edge function. Admin-gated for Phase 1.
 *
 * Pipeline (in development):
 *   1. Auth + admin gate.
 *   2. buildWriterPayload(supa, userId, { includeAllResults: false }).
 *   3. callSkeletonWriter(payload) — emit 4-week structural skeleton
 *      (month_plan + per-day block_types + primary_lift / metcon_focus
 *      / skill_focus per day; no movement-level data).
 *   4. (TODO) Skeleton audits — validate primary lifts, block-type
 *      composition, day_count, weekly_intent shape.
 *   5. (TODO) Per-week fill calls — 4 calls, each fills one week's
 *      movement-level prescriptions using the skeleton + payload.
 *   6. (TODO) Per-week audits during fill (reuse v2 audit set).
 *   7. (TODO) Final assembly + safety review + save (program_blocks_v2 +
 *      program_movements_v2 with program_version='v3').
 *
 * Currently only step 3 (callSkeletonWriter) is wired up. The Deno.serve
 * handler returns 501 to surface that the orchestration isn't complete.
 *
 * v2 stays as the production-grade monolithic path. v3 is the chained
 * rewrite we'll iterate on until it's production-ready.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { type WriterPayload } from "../_shared/build-writer-payload.ts";
import { V3_SKELETON_SYSTEM_PROMPT } from "../_shared/v3-skeleton-prompt.ts";
import { buildEmitSkeletonTool, type SkeletonOutput } from "../_shared/v3-output-schema.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-20250514";

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
 * Call the v3 skeleton writer. Returns a parsed SkeletonOutput on success,
 * throws on transport / parsing failure. Mirrors v2's callWriter shape so
 * the eventual retry-loop wiring is symmetric.
 *
 * Token budget: max_tokens 8000. Skeleton output is typically 1-2k tokens
 * (no movement-level data); the headroom covers a 4-week × 6-day cycle
 * comfortably.
 */
export async function callSkeletonWriter(
  payload: WriterPayload,
  retryViolations: string,
): Promise<SkeletonOutput> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const daysPerWeek = payload.training_context.days_per_week;
  const units = payload.basics.units ?? "lbs";

  // Trailing rule recap — fresh in the model's attention window after
  // the 21k athlete payload. Skeleton-specific reminders: 4 × N exact,
  // structure-only emit, every-day-gets-strength-accessory-metcon.
  const ruleRecap = [
    "=== KEY RULES (re-check before emit) ===",
    `- Output exactly 4 weeks × ${daysPerWeek} days. day_num is 1..${daysPerWeek}.`,
    "- Every training day includes strength + accessory + metcon block types. Skills 2–4 days per week.",
    "- Emit STRUCTURE ONLY — no sets / reps / weight / movement names. Those are filled in subsequent per-week calls.",
    "- primary_lift uses canonical display names (Back Squat, Deadlift, Snatch, Clean and Jerk, etc.) or a complex description.",
    `- All weights in athlete's units (${units}). All weight-related schemes implicitly use this unit.`,
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

// ============================================================
// Handler — stub. The full orchestration (auth + admin gate + job
// creation + skeleton → per-week fill → safety → save) lands in
// step 6 of the v3 build. For now the function exports
// callSkeletonWriter so other code can import it during development,
// and the HTTP handler returns 501 to surface the unfinished state.
// ============================================================

Deno.serve((req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({
      error: "Not Implemented",
      message: "v3 chained generation is under construction. callSkeletonWriter is wired; orchestration (audits, week-fills, save) ships in subsequent steps.",
    }),
    { status: 501, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
