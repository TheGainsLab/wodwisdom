/**
 * Standalone workout analysis: paste any workout, get structured coaching.
 * Completely independent of programs. Uses athlete profile if available.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are an expert CrossFit coach providing a pre-workout briefing. Analyze the workout and return a JSON object with exactly these keys:

{
  "warm_up": "A specific warm-up tailored to the movements in this workout. 8-10 minutes. Include mobility, activation, and build-up sets where applicable.",
  "movement_tips": "Technical cues and tips for each movement in the workout. Be specific — name each movement and give 1-2 actionable cues per movement.",
  "scaling": "Scaling options for each movement and load. Provide beginner, intermediate, and Rx+ options. If athlete profile data is provided, personalize recommendations based on their strength levels and skill proficiency.",
  "pacing": "Pacing strategy and break recommendations. Include when to push, when to hold back, suggested set breaks (e.g. 'break thrusters into 7-7-7 after round 2'), and target time or round count.",
  "stimulus": "What this workout is designed to test (e.g. aerobic capacity, grip endurance, heavy cycling). Explain the intended intensity and feel so the athlete doesn't accidentally turn a sprint into a grind or vice versa."
}

Rules:
- Return ONLY valid JSON. No markdown, no code fences, no preamble.
- Each value should be a plain text string (no nested JSON).
- Keep each section concise but actionable — 3-6 sentences per section.
- If athlete profile data is provided, use their 1RM numbers for scaling recommendations (e.g. "Your clean 1RM is 185 — 135 is 73%, good for this rep scheme").
- If no profile data is provided, give generic scaling recommendations.`;

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

    const body = await req.json();
    const workoutText = (body?.workout_text || "").trim();

    if (!workoutText || workoutText.length < 10) {
      return new Response(
        JSON.stringify({ error: "Provide a workout to analyze (at least 10 characters)." }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Workout analysis is not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Fetch athlete profile if available (optional)
    let profileBlock = "";
    const { data: profile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, conditioning, bodyweight, units, age, height, gender")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile) {
      const parts: string[] = [];
      const u = profile.units === "kg" ? "kg" : "lbs";
      if (profile.age) parts.push(`Age: ${profile.age}`);
      if (profile.bodyweight) parts.push(`Bodyweight: ${profile.bodyweight} ${u}`);
      if (profile.gender) parts.push(`Gender: ${profile.gender}`);
      if (profile.lifts && Object.keys(profile.lifts).length > 0) {
        const liftStr = Object.entries(profile.lifts)
          .filter(([, v]) => (v as number) > 0)
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
      if (parts.length > 0) {
        profileBlock = "\n\nATHLETE PROFILE:\n" + parts.join("\n");
      }
    }

    const userPrompt = `WORKOUT:\n${workoutText}${profileBlock}`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        stream: false,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.json().catch(() => ({}));
      console.error("Claude API error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to analyze workout" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeResp.json();
    let rawText = claudeData.content?.[0]?.text?.trim() || "";

    // Strip markdown code fences if present
    const codeMatch = rawText.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (codeMatch) rawText = codeMatch[1].trim();

    let analysis: Record<string, string>;
    try {
      analysis = JSON.parse(rawText);
    } catch {
      console.error("Failed to parse analysis JSON:", rawText.slice(0, 200));
      return new Response(
        JSON.stringify({ error: "Failed to parse analysis response" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Save to database
    const { data: saved, error: saveErr } = await supa
      .from("workout_analyses")
      .insert({
        user_id: user.id,
        workout_text: workoutText,
        analysis,
      })
      .select("id, created_at")
      .single();

    if (saveErr) {
      console.error("Save error:", saveErr);
    }

    return new Response(
      JSON.stringify({
        id: saved?.id || null,
        workout_text: workoutText,
        analysis,
        created_at: saved?.created_at || new Date().toISOString(),
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("analyze-workout error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
