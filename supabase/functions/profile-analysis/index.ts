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

const SYSTEM_PROMPT = `You are an expert CrossFit coach giving a direct, honest profile evaluation. Write like a coach talking to their athlete — clear, specific, no filler. Ground your advice in the reference material when relevant.`;

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

/** Build RAG context across all domains */
async function retrieveRAGContext(
  supa: ReturnType<typeof createClient>,
  profileData: ProfileData
): Promise<string> {
  if (!OPENAI_API_KEY) return "";

  try {
    const promises: Promise<import("../_shared/rag.ts").RAGChunk[]>[] = [];

    // Strength
    const liftNames = profileData.lifts
      ? Object.keys(profileData.lifts).map((k) => k.replace(/_/g, " ")).join(", ")
      : "";
    promises.push(
      searchChunks(supa, `strength training programming periodization ${liftNames}`, "journal", OPENAI_API_KEY, 4, 0.25)
    );
    promises.push(
      searchChunks(supa, liftNames ? `strength training periodization load prescription ${liftNames}` : "strength training periodization load prescription squat deadlift", "strength-science", OPENAI_API_KEY, 2, 0.25)
    );

    // Skills
    const skillNames = profileData.skills
      ? Object.entries(profileData.skills)
          .filter(([, v]) => v && v !== "none")
          .map(([k]) => k.replace(/_/g, " "))
          .join(", ")
      : "";
    promises.push(
      searchChunks(supa, `CrossFit gymnastics skill progression ${skillNames}`, "journal", OPENAI_API_KEY, 4, 0.25)
    );

    // Conditioning
    promises.push(
      searchChunks(supa, "CrossFit conditioning engine aerobic capacity work capacity rowing running", "journal", OPENAI_API_KEY, 4, 0.25)
    );

    const results = await Promise.all(promises);
    const allChunks = results.flat();
    const unique = deduplicateChunks(allChunks);
    if (unique.length === 0) return "";

    return "\n\nREFERENCE MATERIAL (Journal and Strength Science — use to ground your advice):\n" + formatChunksAsContext(unique, 10);
  } catch (err) {
    console.error("RAG retrieval error:", err);
    return "";
  }
}

/** Build a comparison string if a previous evaluation exists */
function buildComparisonContext(
  previousEval: { profile_snapshot: ProfileData; created_at: string } | null,
  currentProfile: ProfileData
): string {
  if (!previousEval) return "";

  const prev = previousEval.profile_snapshot;
  const changes: string[] = [];
  const u = currentProfile.units === "kg" ? "kg" : "lbs";
  const date = new Date(previousEval.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Compare lifts
  if (currentProfile.lifts && prev.lifts) {
    for (const [key, val] of Object.entries(currentProfile.lifts)) {
      const prevVal = prev.lifts[key];
      if (prevVal && val > 0 && prevVal > 0 && val !== prevVal) {
        const diff = val - prevVal;
        changes.push(`${key.replace(/_/g, " ")}: ${prevVal} → ${val} ${u} (${diff > 0 ? "+" : ""}${diff})`);
      }
    }
  }

  // Compare skills
  if (currentProfile.skills && prev.skills) {
    const levelOrder: Record<string, number> = { none: 0, beginner: 1, intermediate: 2, advanced: 3 };
    for (const [key, val] of Object.entries(currentProfile.skills)) {
      const prevVal = prev.skills[key];
      if (prevVal && val !== prevVal) {
        const direction = (levelOrder[val] || 0) > (levelOrder[prevVal] || 0) ? "↑" : "↓";
        changes.push(`${key.replace(/_/g, " ")}: ${prevVal} → ${val} ${direction}`);
      }
    }
  }

  // Compare conditioning
  if (currentProfile.conditioning && prev.conditioning) {
    for (const [key, val] of Object.entries(currentProfile.conditioning)) {
      const prevVal = prev.conditioning?.[key];
      if (prevVal != null && val != null && String(val) !== String(prevVal)) {
        changes.push(`${key.replace(/_/g, " ")}: ${prevVal} → ${val}`);
      }
    }
  }

  if (changes.length === 0) return "";

  return `\n\nCHANGES SINCE LAST EVALUATION (${date}):\n${changes.join("\n")}\n\nAcknowledge meaningful progress or regressions. Be specific about what improved.`;
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

    // Fetch current profile
    const { data: athleteProfile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, conditioning, equipment, bodyweight, units, age, height, gender")
      .eq("user_id", user.id)
      .maybeSingle();

    const profileData: ProfileData = athleteProfile || {};
    const profileStr = formatProfile(profileData);

    const hasLifts =
      profileData.lifts && Object.keys(profileData.lifts).length > 0 && Object.values(profileData.lifts).some((v: unknown) => (v as number) > 0);
    const hasSkills =
      profileData.skills && Object.keys(profileData.skills).length > 0 && Object.entries(profileData.skills).some(([, v]) => v && v !== "none");
    const hasConditioning =
      profileData.conditioning && Object.keys(profileData.conditioning).length > 0 && Object.values(profileData.conditioning).some((v) => v !== "" && v != null);

    if (!hasLifts && !hasSkills && !hasConditioning) {
      return new Response(
        JSON.stringify({
          analysis: "Add your lifts, skills, or conditioning to get a profile analysis. Fill out the sections above and try again.",
        }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Fetch previous evaluation for comparison
    const { data: prevEval } = await supa
      .from("profile_evaluations")
      .select("profile_snapshot, created_at, analysis")
      .eq("user_id", user.id)
      .not("analysis", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Build RAG context, comparison, and recent training in parallel
    const [ragContext, comparisonContext, recentTraining] = await Promise.all([
      retrieveRAGContext(supa, profileData),
      Promise.resolve(buildComparisonContext(prevEval, profileData)),
      fetchAndFormatRecentHistory(supa, user.id),
    ]);
    const trainingBlock = recentTraining ? `\n\n${recentTraining}` : "";

    const userPrompt = `Here is an athlete's full profile:\n\n${profileStr}${trainingBlock}\n\nGive this athlete a comprehensive profile evaluation. Cover all domains they have data for — strength, skills, and conditioning — in a single cohesive assessment.\n\nYour evaluation should:\n- Identify their strongest areas and their biggest limiters\n- Use bodyweight ratios for lifts (e.g. back squat ~1.5-2x BW), lift-to-lift ratios (e.g. front squat ~85% of back squat, snatch ~60-65% of back squat), and standard CrossFit benchmarks\n- For skills, consider prerequisite chains (strict before kipping, kipping before butterfly) and competition frequency\n- For conditioning, assess work capacity and compare across modalities (run vs row vs bike)\n- Connect the dots across domains — how do their strengths and weaknesses in one area affect another?\n- End with 2-3 clear priorities for improvement, ranked by impact\n\nWrite like a coach talking to the athlete. Be direct, specific, and concise. No bullet-point tier lists — write in short paragraphs.${comparisonContext}`;

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
      throw new Error("Failed to generate analysis");
    }

    const data = await resp.json();
    const analysis = data.content?.[0]?.text?.trim() || "Unable to generate analysis.";

    // Save evaluation
    const evalRow = {
      user_id: user.id,
      analysis,
      profile_snapshot: {
        lifts: profileData.lifts || {},
        skills: profileData.skills || {},
        conditioning: profileData.conditioning || {},
        equipment: profileData.equipment || {},
        bodyweight: profileData.bodyweight ?? null,
        units: profileData.units || "lbs",
        age: profileData.age ?? null,
        height: profileData.height ?? null,
        gender: profileData.gender ?? null,
      },
    };

    const { data: savedEval, error: insertErr } = await supa
      .from("profile_evaluations")
      .insert(evalRow)
      .select("id, created_at")
      .single();

    if (insertErr) {
      console.error("Failed to save evaluation:", insertErr);
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
