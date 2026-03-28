/**
 * ailog-generate-supplement edge function
 *
 * Given gap analysis output + athlete profile, generates 1-3 supplemental
 * sessions per week to fill the identified gaps.
 *
 * Returns structured sessions (warm-up → blocks → cool-down) using the same
 * block format as the main program generator.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "../_shared/call-claude.ts";
import { checkEntitlement } from "../_shared/entitlements.ts";
import { searchChunks, deduplicateChunks, formatChunksAsContext } from "../_shared/rag.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const SUPPLEMENT_PROMPT = `You are a CrossFit coach generating supplemental training sessions.

The athlete attends a gym that has gaps in its programming. Based on the gap analysis below, generate supplemental sessions they can do ON TOP of their gym's programming.

RULES:
- Generate 1-3 sessions depending on the number and severity of gaps.
- Each session should be 30-45 minutes (shorter than a full class — these are add-ons).
- Each session targets specific gaps identified in the analysis.
- Format each session with block headers on their own lines:
  Warm-up:
  (movements, one per line)

  Skills:
  (if skill gaps exist — progressions for developing skills)

  Strength:
  (if strength gaps exist — focused lift work)

  Metcon:
  (if conditioning/time domain gaps exist)

  Cool down:
  (always include)

- Skip blocks that don't apply to the session's focus.
- Use the athlete's profile data for weights and scaling.
- For conditioning gaps, prescribe monostructural work (row, bike, run, ski).
- For skill gaps, prescribe progressions appropriate to the athlete's level.
- For strength gaps, prescribe the specific lifts that are under-programmed.
- For time domain gaps, design metcons in the missing time domain.

OUTPUT FORMAT:
Return a JSON array of sessions:
[
  {
    "title": "Session focus name",
    "focus": "conditioning" | "skills" | "strength" | "mixed",
    "estimated_minutes": 30-45,
    "workout_text": "Full session text with block headers"
  }
]

Output valid JSON only, no markdown fences.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const hasAccess = await checkEntitlement(supa, user.id, "ailog");
    if (!hasAccess) return json({ error: "AI Log subscription required" }, 403);

    const body = await req.json();
    const { gaps, profile_summary } = body;

    if (!gaps || !Array.isArray(gaps) || gaps.length === 0) {
      return json({ error: "No gaps provided" }, 400);
    }

    if (!ANTHROPIC_API_KEY) {
      return json({ error: "AI service unavailable" }, 503);
    }

    const gapText = gaps
      .map((g: { severity: string; title: string; detail: string }) =>
        `[${g.severity.toUpperCase()}] ${g.title}: ${g.detail}`
      )
      .join("\n");

    // RAG: search for relevant training science
    let ragContext = "";
    if (OPENAI_API_KEY) {
      try {
        const gapTopics = gaps.map((g: { title: string }) => g.title).join(", ");
        const searchQuery = `CrossFit supplemental training programming ${gapTopics}`;

        const [journalChunks, strengthChunks] = await Promise.all([
          searchChunks(supa, searchQuery, "journal", OPENAI_API_KEY, 3, 0.25),
          searchChunks(supa, searchQuery, "strength-science", OPENAI_API_KEY, 3, 0.25),
        ]);

        const allChunks = deduplicateChunks([...journalChunks, ...strengthChunks]);
        if (allChunks.length > 0) {
          ragContext = formatChunksAsContext(allChunks, 4);
        }
      } catch (e) {
        console.error("[ailog-generate-supplement] RAG search error:", e);
      }
    }

    const systemPrompt = ragContext
      ? SUPPLEMENT_PROMPT + "\n\nREFERENCE MATERIAL (use to inform session design):\n" + ragContext
      : SUPPLEMENT_PROMPT;

    const userContent = `ATHLETE PROFILE:
${profile_summary || "No profile data available."}

IDENTIFIED GAPS:
${gapText}

Generate supplemental sessions to address these gaps.`;

    const raw = await callClaude({
      apiKey: ANTHROPIC_API_KEY,
      system: systemPrompt,
      userContent,
      maxTokens: 4096,
    });

    const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");

    let sessions: { title: string; focus: string; estimated_minutes: number; workout_text: string }[];
    try {
      sessions = JSON.parse(cleaned);
      if (!Array.isArray(sessions)) throw new Error("Not an array");
    } catch {
      return json({ error: "Failed to parse AI response", raw: cleaned }, 500);
    }

    // Validate and cap at 3 sessions
    sessions = sessions.slice(0, 3).filter((s) =>
      s.title && s.workout_text && typeof s.workout_text === "string"
    );

    return json({ sessions });
  } catch (err) {
    console.error("ailog-generate-supplement error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
