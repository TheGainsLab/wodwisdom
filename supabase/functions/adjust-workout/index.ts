/**
 * adjust-workout: AI-assisted single-workout editing.
 *
 * Input:
 *   workout_id  — the program_workouts row to adjust
 *   request     — user's natural language request (e.g. "swap snatch for clean & jerk")
 *
 * Process:
 *   1. Fetch the workout, adjacent days, and athlete profile
 *   2. RAG-retrieve context for movements mentioned
 *   3. Call Claude to produce modified block text
 *
 * Output:
 *   { blocks: { label: string; content: string }[], rationale: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "../_shared/call-claude.ts";
import {
  searchChunks,
  deduplicateChunks,
  formatChunksAsContext,
} from "../_shared/rag.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are an expert CrossFit programming coach. An athlete has a workout they want to adjust. They will describe what they want changed in plain language.

Your job is to modify the workout to satisfy their request while preserving the session's overall intent, time domain, and stimulus.

You have access to:
- The athlete's profile (1RM lifts, skill levels, equipment)
- The workouts on adjacent days (to avoid movement pattern conflicts)
- CrossFit methodology reference material

Rules:
- Modify only the blocks that need to change. Leave unchanged blocks exactly as they are.
- When substituting movements, pick alternatives that preserve the intended stimulus.
- Prescribe weights using the athlete's 1RMs where applicable. Use M/F Rx format (e.g. 185/125).
- If the request doesn't make sense or would compromise the session, explain why in the rationale and suggest an alternative.
- Keep the same block structure (Warm-up, Skills, Strength, Metcon, Cool down). Do not add or remove block headers.
- If changing the strength block, adjust the warm-up to match (e.g. if swapping to cleans, warm-up should include clean prep).

Return JSON only. No preamble, no markdown fences, no explanation outside the JSON.

Format:
{
  "blocks": [
    { "label": "Warm-up", "content": "..." },
    { "label": "Skills", "content": "..." },
    { "label": "Strength", "content": "..." },
    { "label": "Metcon", "content": "..." },
    { "label": "Cool down", "content": "..." }
  ],
  "rationale": "1-2 sentences explaining what was changed and why"
}

Include ALL blocks from the original workout in your response, even ones you did not change.`;

interface ProfileData {
  lifts?: Record<string, number> | null;
  skills?: Record<string, string> | null;
  conditioning?: Record<string, string | number> | null;
  equipment?: Record<string, boolean> | null;
  bodyweight?: number | null;
  units?: string | null;
}

function formatProfile(profile: ProfileData): string {
  const parts: string[] = [];
  const u = profile.units === "kg" ? "kg" : "lbs";
  if (profile.bodyweight && profile.bodyweight > 0)
    parts.push(`Bodyweight: ${profile.bodyweight} ${u}`);
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
  if (profile.equipment && Object.keys(profile.equipment).length > 0) {
    const unavailable = Object.entries(profile.equipment)
      .filter(([, v]) => v === false)
      .map(([k]) => k.replace(/_/g, " "));
    if (unavailable.length > 0) {
      parts.push(
        "Equipment NOT available — " + unavailable.join(", ")
      );
    }
  }
  return parts.join("\n") || "No profile data.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { workout_id, request: userRequest } = await req.json();
    if (!workout_id || !userRequest) {
      return new Response(
        JSON.stringify({ error: "workout_id and request are required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Fetch the target workout and its program
    const { data: workout, error: wErr } = await supa
      .from("program_workouts")
      .select("id, program_id, workout_text, sort_order")
      .eq("id", workout_id)
      .single();

    if (wErr || !workout) {
      return new Response(
        JSON.stringify({ error: "Workout not found" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Verify ownership
    const { data: program, error: pErr } = await supa
      .from("programs")
      .select("id, user_id")
      .eq("id", workout.program_id)
      .single();

    if (pErr || !program || program.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Not authorized" }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Fetch adjacent days for context (previous and next by sort_order)
    const { data: adjacentWorkouts } = await supa
      .from("program_workouts")
      .select("workout_text, sort_order")
      .eq("program_id", workout.program_id)
      .in("sort_order", [workout.sort_order - 1, workout.sort_order + 1])
      .order("sort_order");

    const prevDay = adjacentWorkouts?.find(
      (w) => w.sort_order === workout.sort_order - 1
    );
    const nextDay = adjacentWorkouts?.find(
      (w) => w.sort_order === workout.sort_order + 1
    );

    // Fetch athlete profile
    const { data: profile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, conditioning, equipment, bodyweight, units")
      .eq("user_id", user.id)
      .single();

    const profileStr = profile ? formatProfile(profile as ProfileData) : "No profile data.";

    // RAG retrieval based on the user's request + workout content
    let ragContext = "";
    if (OPENAI_API_KEY) {
      const queries = [
        searchChunks(
          supa,
          `CrossFit programming ${userRequest}`,
          "journal",
          OPENAI_API_KEY,
          3,
          0.25
        ),
        searchChunks(
          supa,
          `${userRequest} ${workout.workout_text.slice(0, 200)}`,
          "strength-science",
          OPENAI_API_KEY,
          2,
          0.25
        ),
      ];

      const results = await Promise.all(queries);
      const allChunks = results.flat();
      const unique = deduplicateChunks(allChunks);
      if (unique.length > 0) {
        ragContext =
          "\n\nREFERENCE MATERIAL:\n" + formatChunksAsContext(unique, 6);
      }
    }

    // Build the user prompt
    const adjacentContext = [
      prevDay
        ? `Previous day (Day ${workout.sort_order}):\n${prevDay.workout_text}`
        : null,
      nextDay
        ? `Next day (Day ${workout.sort_order + 2}):\n${nextDay.workout_text}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const userPrompt = `ATHLETE PROFILE:
${profileStr}

CURRENT WORKOUT (Day ${workout.sort_order + 1}):
${workout.workout_text}

${adjacentContext ? `ADJACENT DAYS (avoid movement pattern conflicts):\n${adjacentContext}\n` : ""}
ATHLETE'S REQUEST:
${userRequest}
${ragContext}

Modify the workout to satisfy the athlete's request. Return JSON only.`;

    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const raw = await callClaude({
      apiKey: ANTHROPIC_API_KEY,
      system: SYSTEM_PROMPT,
      userContent: userPrompt,
      maxTokens: 2048,
    });

    // Parse JSON response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : raw;
    const parsed = JSON.parse(jsonStr);

    if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
      throw new Error("Invalid response format from AI");
    }

    return new Response(
      JSON.stringify({
        blocks: parsed.blocks,
        rationale: parsed.rationale || "",
      }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("adjust-workout error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
