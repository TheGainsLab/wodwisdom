import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  searchChunks,
  deduplicateChunks,
  formatChunksAsContext,
} from "../_shared/rag.ts";
import { fetchAndFormatRecentHistory } from "../_shared/training-history.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const SYSTEM_PROMPT = `You are an expert CrossFit coach reviewing an athlete's recent training. Write like a coach talking to their athlete — direct, specific, actionable. Ground your advice in the reference material when relevant.`;

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

async function retrieveRAGContext(
  supa: ReturnType<typeof createClient>,
  profileData: ProfileData
): Promise<string> {
  if (!OPENAI_API_KEY) return "";

  try {
    const promises: Promise<import("../_shared/rag.ts").RAGChunk[]>[] = [];

    promises.push(
      searchChunks(supa, "CrossFit training programming volume frequency recovery periodization", "journal", OPENAI_API_KEY, 4, 0.25)
    );
    promises.push(
      searchChunks(supa, "CrossFit conditioning engine aerobic capacity work capacity", "journal", OPENAI_API_KEY, 3, 0.25)
    );

    const liftNames = profileData.lifts
      ? Object.keys(profileData.lifts).map((k) => k.replace(/_/g, " ")).join(", ")
      : "";
    if (liftNames) {
      promises.push(
        searchChunks(supa, `strength training frequency volume ${liftNames}`, "strength-science", OPENAI_API_KEY, 2, 0.25)
      );
    }

    const results = await Promise.all(promises);
    const allChunks = results.flat();
    const unique = deduplicateChunks(allChunks);
    if (unique.length === 0) return "";

    return "\n\nREFERENCE MATERIAL (use to ground your advice):\n" + formatChunksAsContext(unique, 8);
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

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser(token);

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Fetch profile and recent training in parallel
    const [profileRes, recentTraining] = await Promise.all([
      supa
        .from("athlete_profiles")
        .select("lifts, skills, conditioning, equipment, bodyweight, units, age, height, gender")
        .eq("user_id", user.id)
        .maybeSingle(),
      fetchAndFormatRecentHistory(supa, user.id, { days: 14, maxLines: 40 }),
    ]);

    const profileData: ProfileData = profileRes.data || {};

    if (!recentTraining) {
      return new Response(
        JSON.stringify({
          analysis: "No recent training data found. Log some workouts first, then come back for a training analysis.",
        }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const profileStr = formatProfile(profileData);
    const ragContext = await retrieveRAGContext(supa, profileData);

    const userPrompt = `Here is an athlete's profile:\n\n${profileStr}\n\n${recentTraining}\n\nAnalyze this athlete's recent training. Your evaluation should:\n\n- Assess training volume and frequency — how many days per week, how many sessions, rest days\n- Identify movement patterns and frequency — what are they hitting often, what's missing?\n- Look at intensity and loading — are they pushing hard enough? Too hard? Any signs of overreaching?\n- Cross-reference with their profile — are they training their weaknesses or just repeating strengths?\n- Note any gaps — movements, energy systems, or skills from their profile that aren't showing up in training\n- Comment on session structure — are they doing strength + metcon? Skills work? Just metcons?\n\nEnd with 2-3 specific, actionable recommendations for what to adjust in their training.\n\nWrite like a coach. Be direct, specific, and concise. Short paragraphs, no bullet-point lists.`;

    const systemPrompt = SYSTEM_PROMPT + ragContext;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        stream: false,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error("Claude API error:", err);
      throw new Error("Failed to generate training analysis");
    }

    const data = await resp.json();
    const analysis = data.content?.[0]?.text?.trim() || "Unable to generate analysis.";

    // Save training evaluation
    const evalRow = {
      user_id: user.id,
      analysis,
      training_snapshot: recentTraining,
      profile_snapshot: {
        lifts: profileData.lifts || {},
        skills: profileData.skills || {},
        conditioning: profileData.conditioning || {},
        bodyweight: profileData.bodyweight ?? null,
        units: profileData.units || "lbs",
        age: profileData.age ?? null,
        height: profileData.height ?? null,
        gender: profileData.gender ?? null,
      },
    };

    const { data: savedEval, error: insertErr } = await supa
      .from("training_evaluations")
      .insert(evalRow)
      .select("id, created_at")
      .single();

    if (insertErr) {
      console.error("Failed to save training evaluation:", insertErr);
    }

    return new Response(
      JSON.stringify({
        analysis,
        evaluation_id: savedEval?.id || null,
        created_at: savedEval?.created_at || null,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
