/**
 * parse-injuries-constraints/index.ts
 *
 * Async pre-pass that converts an athlete's free-text injuries_constraints
 * field into a structured machine-readable form. Runs after profile save
 * (fire-and-forget from the client). Result stored on athlete_profiles:
 *
 *   injuries_structured: jsonb
 *     {
 *       summary: text,
 *       do_not_program: text[],
 *       suggested_subs: [{ instead_of, use }]
 *     }
 *   injuries_constraints_hash: SHA-256 of the text it was parsed against
 *
 * Hash check: if the row's hash matches the text's hash, skip — already
 * parsed. Otherwise call Claude with a focused tool_use, write back the
 * structured result + new hash.
 *
 * Empty text → empty list + summary "No injury constraints."
 *
 * Caller pattern: invoke({ body: {} }) — the function reads the athlete's
 * current text from athlete_profiles using the auth context.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You are parsing a CrossFit athlete's stated injuries and movement constraints into a structured machine-readable form for downstream program generation.

Read the text carefully and emit three fields via the emit_injury_constraints tool:

1. summary — one sentence capturing the constraint(s). Coach voice, plain English. If text is empty or says no injuries / nothing, return "No injury constraints."

2. do_not_program — list of canonical CrossFit movement names the athlete should NOT be programmed. Use display-name conventions (Title Case, hyphenated where appropriate). Be EXPLICIT and EXHAUSTIVE: if the text says "no overhead pressing", enumerate every overhead movement (Snatch, Power Snatch, Squat Snatch, Hang Snatch, Jerk, Push Jerk, Split Jerk, Push Press, Strict Press, Press, HSPU, Strict HSPU, Deficit HSPU, Wall-Facing HSPU, Handstand Walk, Overhead Squat, Thruster, Wall Ball, Bar Muscle-Ups, Muscle-Ups). If text mentions a body region (knee, low back, shoulder), enumerate movements that load that region. Err on the side of LISTING MORE rather than fewer.

3. suggested_subs — optional list of common substitutions for the most-frequent contraindicated movements. Each entry: { instead_of: "Snatch", use: "Sumo Deadlift High Pull (chest-height)" }. Use canonical names. Limit to ~5–10 high-value subs (don't enumerate every possible sub).

Edge cases:
- Empty text or "none" / "no injuries" → do_not_program: [], suggested_subs: [], summary: "No injury constraints."
- "Tweaked my back yesterday, taking it easy" → list spinal-loading movements; suggested_subs with lower-impact alternatives.
- Vague text ("bad shoulder") → still list overhead + heavy pressing; better to over-list than miss something.`;

const EMIT_INJURY_CONSTRAINTS_TOOL = {
  name: "emit_injury_constraints",
  description: "Emit the structured form of the athlete's free-text injuries/constraints.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        minLength: 1,
        maxLength: 400,
        description: "One-sentence summary of the constraint(s). Coach voice.",
      },
      do_not_program: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 100 },
        description: "Canonical movement names the athlete must not be programmed. Display-name conventions. Be exhaustive.",
      },
      suggested_subs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            instead_of: { type: "string", minLength: 1, maxLength: 100 },
            use: { type: "string", minLength: 1, maxLength: 200 },
          },
          required: ["instead_of", "use"],
          additionalProperties: false,
        },
        description: "Optional high-value substitutions (5–10 entries max).",
      },
    },
    required: ["summary", "do_not_program", "suggested_subs"],
    additionalProperties: false,
  },
};

interface ClaudeContentBlock {
  type?: string;
  name?: string;
  input?: unknown;
}

interface ClaudeResponse {
  content?: ClaudeContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface StructuredInjuries {
  summary: string;
  do_not_program: string[];
  suggested_subs: { instead_of: string; use: string }[];
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function callParser(text: string): Promise<StructuredInjuries> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      stream: false,
      system: SYSTEM_PROMPT,
      tools: [EMIT_INJURY_CONSTRAINTS_TOOL],
      tool_choice: { type: "tool", name: "emit_injury_constraints" },
      messages: [{ role: "user", content: `ATHLETE INJURIES TEXT:\n${text}` }],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = (await resp.json()) as ClaudeResponse;
  const toolUse = (data.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === "emit_injury_constraints",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    throw new Error(
      `Claude response missing emit_injury_constraints tool_use. stop_reason=${data.stop_reason}`,
    );
  }
  console.log(
    `[parse-injuries-constraints] Claude usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens}`,
  );
  return toolUse.input as StructuredInjuries;
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

    // 2. Read current text + cached hash from the profile.
    const { data: profile, error: profileErr } = await supa
      .from("athlete_profiles")
      .select("injuries_constraints, injuries_constraints_hash")
      .eq("user_id", user.id)
      .maybeSingle<{ injuries_constraints: string | null; injuries_constraints_hash: string | null }>();
    if (profileErr) throw new Error(`Profile fetch: ${profileErr.message}`);
    if (!profile) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_profile" }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const text = (profile.injuries_constraints ?? "").trim();
    const newHash = await sha256Hex(text);

    // 3. Skip if hash unchanged (already parsed against this exact text).
    if (newHash === profile.injuries_constraints_hash) {
      return new Response(JSON.stringify({ ok: true, skipped: "hash_match" }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 4. Empty text → empty structured form, no Claude call.
    let structured: StructuredInjuries;
    if (text === "" || /^(none|no|nothing|no injuries|n\/a)$/i.test(text)) {
      structured = {
        summary: "No injury constraints.",
        do_not_program: [],
        suggested_subs: [],
      };
    } else {
      structured = await callParser(text);
    }

    // 5. Write back.
    const { error: updateErr } = await supa
      .from("athlete_profiles")
      .update({
        injuries_structured: structured,
        injuries_constraints_hash: newHash,
      })
      .eq("user_id", user.id);
    if (updateErr) throw new Error(`Profile update: ${updateErr.message}`);

    return new Response(
      JSON.stringify({ ok: true, structured }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[parse-injuries-constraints]", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return new Response(
      JSON.stringify({ error: "PARSE_FAILED", message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
