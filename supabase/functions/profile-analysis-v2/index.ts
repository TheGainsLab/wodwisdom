/**
 * profile-analysis-v2/index.ts
 *
 * The v2 profile-analysis edge function — admin-gated for Phase 1.
 * Produces a structured coaching evaluation of the athlete's profile,
 * not a 4-week program.
 *
 * Pipeline (simpler than generate-program-v2 — no audit loop, no
 * safety review):
 *
 *   1. Auth + admin gate.
 *   2. buildWriterPayload(supa, userId) — same shared payload.
 *   3. Call Claude with V2_PROFILE_ANALYSIS_SYSTEM_PROMPT +
 *      EMIT_EVALUATION_TOOL forced via tool_choice.
 *   4. Parse the tool_use response into EvaluationOutput.
 *   5. Save to profile_evaluations (evaluation_version='v2',
 *      structured_evaluation jsonb).
 *   6. Return the evaluation + saved row id.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { buildWriterPayload, type WriterPayload } from "../_shared/build-writer-payload.ts";
import { V2_PROFILE_ANALYSIS_SYSTEM_PROMPT } from "../_shared/v2-profile-analysis-prompt.ts";
import { EMIT_EVALUATION_TOOL, type EvaluationOutput } from "../_shared/v2-output-schema.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

async function callEvaluator(payload: WriterPayload): Promise<EvaluationOutput> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
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
      system: V2_PROFILE_ANALYSIS_SYSTEM_PROMPT,
      tools: [EMIT_EVALUATION_TOOL],
      tool_choice: { type: "tool", name: "emit_evaluation" },
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
    (b) => b.type === "tool_use" && b.name === "emit_evaluation",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    throw new Error(
      `Claude response missing emit_evaluation tool_use. stop_reason=${data.stop_reason}`,
    );
  }
  console.log(
    `[profile-analysis-v2] Claude usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens}`,
  );
  return toolUse.input as EvaluationOutput;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // 1. Auth.
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

    // 2. Admin gate — Phase 1 admins-only.
    const { data: adminProfile } = await supa
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (adminProfile?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden", message: "v2 is admin-only during Phase 1 testing." }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const t0 = Date.now();

    // 3. Build the writer payload (same shared module).
    console.log(`[profile-analysis-v2] building payload for user ${user.id}`);
    const payload = await buildWriterPayload(supa, user.id);
    console.log(
      `[profile-analysis-v2] payload built (competition_linked=${payload.competition != null} vocabulary_size=${payload.vocabulary.length})`,
    );

    // 4. Call evaluator LLM.
    const evaluation = await callEvaluator(payload);

    // 5. Save to profile_evaluations.
    let evaluationId: string | null = null;
    try {
      const { data: row, error: insErr } = await supa
        .from("profile_evaluations")
        .insert({
          user_id: user.id,
          evaluation_version: "v2",
          structured_evaluation: evaluation,
          profile_snapshot: {
            basics: payload.basics,
            training_context: payload.training_context,
            competition_linked: payload.competition != null,
          },
        })
        .select("id")
        .single();
      if (insErr || !row) {
        console.error("[profile-analysis-v2] save failed:", insErr);
      } else {
        evaluationId = row.id as string;
        console.log(`[profile-analysis-v2] persisted evaluation ${evaluationId}`);
      }
    } catch (saveErr) {
      // Permissive — admin can still inspect the output JSON in Phase 1.
      console.error("[profile-analysis-v2] save threw:", saveErr);
    }

    const elapsedMs = Date.now() - t0;
    console.log(`[profile-analysis-v2] success in ${elapsedMs}ms`);

    return new Response(
      JSON.stringify({
        ok: true,
        elapsed_ms: elapsedMs,
        evaluation_id: evaluationId,
        evaluation,
        // Admin-only response; safe to echo what the writer saw so the
        // admin can verify Tier 4 data + canonical-key hydration.
        payload,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[profile-analysis-v2] unhandled:", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return new Response(
      JSON.stringify({ error: "EVALUATION_FAILED", message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
