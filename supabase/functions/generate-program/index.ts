/**
 * Generate a 4-week program from profile analysis.
 * Uses the specified evaluation (or most recent) to produce a personalized program.
 * Program is auto-saved; no preview step.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  searchChunks,
  deduplicateChunks,
  formatChunksAsContext,
} from "../_shared/rag.ts";
import { fetchAndFormatRecentHistory } from "../_shared/training-history.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProfileData {
  lifts?: Record<string, number> | null;
  skills?: Record<string, string> | null;
  conditioning?: Record<string, string | number> | null;
  bodyweight?: number | null;
  units?: string | null;
  age?: number | null;
  height?: number | null;
  gender?: string | null;
}

function formatProfile(profile: ProfileData): string {
  const parts: string[] = [];
  const u = profile.units === "kg" ? "kg" : "lbs";
  if (profile.age != null && profile.age > 0) parts.push(`Age: ${profile.age}`);
  if (profile.height != null && profile.height > 0) parts.push(`Height: ${profile.height} ${profile.units === "kg" ? "cm" : "in"}`);
  if (profile.bodyweight && profile.bodyweight > 0) parts.push(`Bodyweight: ${profile.bodyweight} ${u}`);
  if (profile.gender) parts.push(`Gender: ${profile.gender}`);
  if (profile.lifts && Object.keys(profile.lifts).length > 0) {
    const liftStr = Object.entries(profile.lifts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v} ${u}`)
      .join(", ");
    if (liftStr) parts.push("1RM Lifts — " + liftStr);
  }
  if (profile.skills && Object.keys(profile.skills).length > 0) {
    const skillStr = Object.entries(profile.skills)
      .filter(([, v]) => v && v !== "none")
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(", ");
    if (skillStr) parts.push("Skills — " + skillStr);
  }
  if (profile.conditioning && Object.keys(profile.conditioning).length > 0) {
    const condStr = Object.entries(profile.conditioning)
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(", ");
    if (condStr) parts.push("Conditioning — " + condStr);
  }
  return parts.join("\n") || "No profile data.";
}

const GENERATE_PROMPT = `You are an expert CrossFit coach. Generate a 4-week program for this athlete based on their profile and analysis.

OUTPUT FORMAT (strict):
- Use "Week 1", "Week 2", etc. for week headers.
- Use "Monday:", "Tuesday:", etc. (or "Mon:", "Tue:", etc.) for each training day.
- Each day has exactly 5 blocks in this order. Put each block on its own line:
  1. Warm-up: (5-8 min movement prep for that day's work)
  2. Skills: (10-15 min gymnastics/skill progressions based on analysis)
  3. Strength: (barbell work with percentages, e.g. 5x5 @ 75%)
  4. Metcon: (For Time, AMRAP, EMOM etc. - prescribe Rx weights)
  5. Cool down: (3-5 min mobility/stretch)
- Use 4-5 training days per week (Mon–Fri typical, optional Sat).
- Each block must fit on ONE line. Use commas to separate movements within a block.
- Prescribe weights using their 1RMs (e.g. 75% of back squat). Use / for M/F (e.g. 95/65).
- Make the program directly address the analysis priorities (imbalances, skill gaps, engine work).

Example format for one day:
Monday:
Warm-up: 3 rounds 400m run, 10 air squats, 5 PVC pass-throughs, 10 lunges
Skills: EMOM 10 3 kipping pull-up practice, 5s hang
Strength: Back Squat 5x5 @ 75%
Metcon: AMRAP 12 9 thrusters 95/65, 6 pull-ups, 3 burpees
Cool down: 2 min couch stretch each leg, 2 min child's pose

Output ONLY the program text. No preamble or explanation.`;

async function retrieveRAGContext(
  supa: ReturnType<typeof createClient>,
  profileData: ProfileData
): Promise<string> {
  if (!OPENAI_API_KEY) return "";

  try {
    const allChunks: import("../_shared/rag.ts").RAGChunk[] = [];
    const liftNames = profileData.lifts
      ? Object.keys(profileData.lifts).map((k) => k.replace(/_/g, " ")).join(", ")
      : "";
    const skillNames = profileData.skills
      ? Object.entries(profileData.skills)
          .filter(([, v]) => v && v !== "none")
          .map(([k]) => k.replace(/_/g, " "))
          .join(", ")
      : "";

    if (liftNames) {
      const chunks = await searchChunks(
        supa,
        `strength training programming periodization ${liftNames}`,
        "journal",
        OPENAI_API_KEY,
        3,
        0.25
      );
      allChunks.push(...chunks);
    }
    if (skillNames) {
      const chunks = await searchChunks(
        supa,
        `CrossFit gymnastics skill progression ${skillNames}`,
        "journal",
        OPENAI_API_KEY,
        3,
        0.25
      );
      allChunks.push(...chunks);
    }
    const chunks = await searchChunks(
      supa,
      "CrossFit conditioning engine metcon programming",
      "journal",
      OPENAI_API_KEY,
      3,
      0.25
    );
    allChunks.push(...chunks);

    const unique = deduplicateChunks(allChunks);
    if (unique.length === 0) return "";

    return "\n\nREFERENCE (use to ground programming):\n" + formatChunksAsContext(unique, 8);
  } catch (err) {
    console.error("RAG retrieval error:", err);
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
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

    let evaluationId: string | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      evaluationId = body?.evaluation_id ?? null;
    } catch {
      // no body
    }

    // Fetch evaluation: use provided id, or most recent
    let evalRow: {
      profile_snapshot: ProfileData;
      lifting_analysis: string | null;
      skills_analysis: string | null;
      engine_analysis: string | null;
    } | null = null;

    if (evaluationId) {
      const { data } = await supa
        .from("profile_evaluations")
        .select("profile_snapshot, lifting_analysis, skills_analysis, engine_analysis")
        .eq("id", evaluationId)
        .eq("user_id", user.id)
        .maybeSingle();
      evalRow = data;
    }

    if (!evalRow) {
      const { data } = await supa
        .from("profile_evaluations")
        .select("profile_snapshot, lifting_analysis, skills_analysis, engine_analysis")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      evalRow = data;
    }

    if (!evalRow) {
      return new Response(
        JSON.stringify({ error: "No profile analysis found. Run AI analysis first, then generate program." }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const profile = evalRow.profile_snapshot || {};
    const profileStr = formatProfile(profile);
    const analysisParts: string[] = [];
    if (evalRow.lifting_analysis) analysisParts.push("STRENGTH ANALYSIS:\n" + evalRow.lifting_analysis);
    if (evalRow.skills_analysis) analysisParts.push("SKILLS ANALYSIS:\n" + evalRow.skills_analysis);
    if (evalRow.engine_analysis) analysisParts.push("ENGINE ANALYSIS:\n" + evalRow.engine_analysis);
    const analysisStr = analysisParts.length > 0 ? analysisParts.join("\n\n") : "No detailed analysis.";

    const recentTraining = await fetchAndFormatRecentHistory(supa, user.id, { maxLines: 25 });
    const trainingBlock = recentTraining ? `\n\n${recentTraining}` : "";

    const ragContext = await retrieveRAGContext(supa, profile);

    const userPrompt = `ATHLETE PROFILE:
${profileStr}

ANALYSIS TO ADDRESS:
${analysisStr}
${trainingBlock}

Generate a 4-week program. Follow the format exactly.`;

    const systemPrompt = GENERATE_PROMPT + ragContext;

    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Program generation is not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        stream: false,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.json().catch(() => ({}));
      console.error("Claude API error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to generate program" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeResp.json();
    let programText =
      claudeData.content?.[0]?.text?.trim() || claudeData.content?.[0]?.input?.trim() || "";

    // Strip markdown code blocks if present
    const codeMatch = programText.match(/```(?:text)?\s*\n?([\s\S]*?)```/);
    if (codeMatch) programText = codeMatch[1].trim();

    if (!programText || programText.length < 100) {
      return new Response(
        JSON.stringify({ error: "Generated program was empty or too short" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Create program via preprocess-program (reuse parsing + insert logic)
    const preprocessUrl = `${SUPABASE_URL}/functions/v1/preprocess-program`;
    const monthYear = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const programName = `Profile Program — ${monthYear}`;

    const preprocessResp = await fetch(preprocessUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ text: programText, name: programName, source: "generate" }),
    });

    if (!preprocessResp.ok) {
      const errBody = await preprocessResp.text();
      let errMsg = "Failed to save program";
      try {
        const errJson = JSON.parse(errBody);
        if (errJson?.error) errMsg = errJson.error;
      } catch {
        // use default
      }
      return new Response(JSON.stringify({ error: errMsg }), {
        status: preprocessResp.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { program_id, workout_count } = await preprocessResp.json();

    return new Response(
      JSON.stringify({
        program_id,
        workout_count: workout_count ?? 0,
        name: programName,
      }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("generate-program error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
