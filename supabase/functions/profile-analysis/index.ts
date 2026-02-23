import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  searchChunks,
  deduplicateChunks,
  formatChunksAsContext,
} from "../_shared/rag.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const SYSTEM_PROMPT = `You are an expert CrossFit coach. Give concise, practical analysis. Coach-to-coach voice. 150-200 words max. No bullet lists—use short paragraphs.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AnalysisType = "lifts" | "skills" | "engine" | "full";

interface ProfileData {
  lifts?: Record<string, number> | null;
  skills?: Record<string, string> | null;
  conditioning?: Record<string, string | number> | null;
  bodyweight?: number | null;
  units?: string | null;
}

function formatProfile(profile: ProfileData): string {
  const parts: string[] = [];
  const u = profile.units === "kg" ? "kg" : "lbs";
  if (profile.bodyweight && profile.bodyweight > 0) {
    parts.push(`Bodyweight: ${profile.bodyweight} ${u}`);
  }
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

function formatConditioningOnly(profile: ProfileData): string {
  const parts: string[] = [];
  const u = profile.units === "kg" ? "kg" : "lbs";
  if (profile.bodyweight && profile.bodyweight > 0) {
    parts.push(`Bodyweight: ${profile.bodyweight} ${u}`);
  }
  if (profile.conditioning && Object.keys(profile.conditioning).length > 0) {
    const condStr = Object.entries(profile.conditioning)
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(", ");
    if (condStr) parts.push("Conditioning — " + condStr);
  }
  return parts.join("\n") || "No conditioning data.";
}

/** Build a RAG context string for a given analysis type */
async function retrieveRAGContext(
  supa: ReturnType<typeof createClient>,
  analysisType: AnalysisType,
  profileData: ProfileData
): Promise<string> {
  if (!OPENAI_API_KEY) return "";

  try {
    const allChunks: import("../_shared/rag.ts").RAGChunk[] = [];

    if (analysisType === "lifts" || analysisType === "full") {
      const liftNames = profileData.lifts
        ? Object.keys(profileData.lifts).map((k) => k.replace(/_/g, " ")).join(", ")
        : "";
      const chunks = await searchChunks(
        supa,
        `strength training programming periodization ${liftNames}`,
        "journal",
        OPENAI_API_KEY,
        4,
        0.25
      );
      allChunks.push(...chunks);
    }

    if (analysisType === "skills" || analysisType === "full") {
      const skillNames = profileData.skills
        ? Object.entries(profileData.skills)
            .filter(([, v]) => v && v !== "none")
            .map(([k]) => k.replace(/_/g, " "))
            .join(", ")
        : "";
      const chunks = await searchChunks(
        supa,
        `CrossFit gymnastics skill progression ${skillNames}`,
        "journal",
        OPENAI_API_KEY,
        4,
        0.25
      );
      allChunks.push(...chunks);
    }

    if (analysisType === "engine" || analysisType === "full") {
      const chunks = await searchChunks(
        supa,
        "CrossFit conditioning engine aerobic capacity work capacity rowing running",
        "journal",
        OPENAI_API_KEY,
        4,
        0.25
      );
      allChunks.push(...chunks);
    }

    const unique = deduplicateChunks(allChunks);
    if (unique.length === 0) return "";

    return "\n\nREFERENCE MATERIAL (use to ground your advice):\n" + formatChunksAsContext(unique, 10);
  } catch (err) {
    console.error("RAG retrieval error:", err);
    return "";
  }
}

/** Build a comparison string if a previous evaluation exists */
function buildComparisonContext(
  previousEval: { profile_snapshot: ProfileData; created_at: string; lifting_analysis?: string; skills_analysis?: string; engine_analysis?: string } | null,
  currentProfile: ProfileData,
  analysisType: AnalysisType
): string {
  if (!previousEval) return "";

  const prev = previousEval.profile_snapshot;
  const changes: string[] = [];
  const u = currentProfile.units === "kg" ? "kg" : "lbs";
  const date = new Date(previousEval.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Compare lifts
  if ((analysisType === "lifts" || analysisType === "full") && currentProfile.lifts && prev.lifts) {
    for (const [key, val] of Object.entries(currentProfile.lifts)) {
      const prevVal = prev.lifts[key];
      if (prevVal && val > 0 && prevVal > 0 && val !== prevVal) {
        const diff = val - prevVal;
        changes.push(`${key.replace(/_/g, " ")}: ${prevVal} → ${val} ${u} (${diff > 0 ? "+" : ""}${diff})`);
      }
    }
  }

  // Compare skills
  if ((analysisType === "skills" || analysisType === "full") && currentProfile.skills && prev.skills) {
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
  if ((analysisType === "engine" || analysisType === "full") && currentProfile.conditioning && prev.conditioning) {
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

    const { type } = await req.json();
    const analysisType: AnalysisType = type === "skills" ? "skills" : type === "engine" ? "engine" : type === "full" ? "full" : "lifts";

    // Fetch current profile
    const { data: athleteProfile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, conditioning, bodyweight, units")
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

    // Fetch most recent evaluation for comparison
    const { data: prevEval } = await supa
      .from("profile_evaluations")
      .select("profile_snapshot, created_at, lifting_analysis, skills_analysis, engine_analysis")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Build RAG context and comparison in parallel
    const [ragContext, comparisonContext] = await Promise.all([
      retrieveRAGContext(supa, analysisType, profileData),
      Promise.resolve(buildComparisonContext(prevEval, profileData, analysisType)),
    ]);

    let userPrompt: string;
    if (analysisType === "lifts") {
      if (!hasLifts) {
        return new Response(
          JSON.stringify({
            analysis: "Add your 1RM lifts and bodyweight to get a strength analysis. Fill out the lifts section above and try again.",
          }),
          { headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      userPrompt = `Analyze this athlete's strength profile:\n\n${profileStr}\n\nSummarize their strength—what stands out? Identify any imbalances (e.g. squat vs deadlift, press vs bench). Give one clear priority to focus on.${comparisonContext}`;
    } else if (analysisType === "skills") {
      if (!hasSkills) {
        return new Response(
          JSON.stringify({
            analysis: "Add your skill levels to get an analysis. Fill out the skills section above and try again.",
          }),
          { headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      userPrompt = `Analyze this athlete's skills:\n\n${profileStr}\n\nBased on their levels, what should they focus on next? Suggest 1–2 skills and a simple progression.${comparisonContext}`;
    } else if (analysisType === "engine") {
      if (!hasConditioning) {
        return new Response(
          JSON.stringify({
            analysis: "Add your conditioning benchmarks to get an engine analysis. Fill out the conditioning section above and try again.",
          }),
          { headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      const conditioningStr = formatConditioningOnly(profileData);
      userPrompt = `Analyze this athlete's conditioning/engine. Focus ONLY on these benchmarks:\n\n${conditioningStr}\n\nAssess their work capacity based on these times and calories. What's strong? What limits them? How do running, rowing, and bike compare? One clear priority for conditioning. Do NOT discuss lifts or strength.${comparisonContext}`;
    } else {
      if (!hasLifts && !hasSkills && !hasConditioning) {
        return new Response(
          JSON.stringify({
            analysis: "Add your lifts, skills, or conditioning to get a full profile analysis. Fill out the sections above and try again.",
          }),
          { headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      const sections: string[] = [];
      if (hasLifts) sections.push("1. Strength snapshot and one priority");
      if (hasSkills) sections.push("2. Skill focus and one priority");
      if (hasConditioning) sections.push("3. Engine/conditioning assessment and one priority");
      userPrompt = `Analyze this athlete's full profile:\n\n${profileStr}\n\nInclude each of these sections when the data exists:\n${sections.join("\n")}\n\nBe concise. Cover strength, skills, and conditioning as separate sections where data is present.${comparisonContext}`;
    }

    const systemPrompt = SYSTEM_PROMPT + ragContext;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        stream: false,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.json().catch(() => ({}));
      console.error("Claude API error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to generate analysis" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeResp.json();
    const analysis =
      claudeData.content?.[0]?.text?.trim() ||
      claudeData.content?.[0]?.input?.trim() ||
      "Unable to generate analysis.";

    // Build the evaluation row — populate whichever column matches the type
    const evalRow: Record<string, unknown> = {
      user_id: user.id,
      profile_snapshot: {
        lifts: profileData.lifts || {},
        skills: profileData.skills || {},
        conditioning: profileData.conditioning || {},
        bodyweight: profileData.bodyweight || null,
        units: profileData.units || "lbs",
      },
    };

    if (analysisType === "lifts") {
      evalRow.lifting_analysis = analysis;
    } else if (analysisType === "skills") {
      evalRow.skills_analysis = analysis;
    } else if (analysisType === "engine") {
      evalRow.engine_analysis = analysis;
    } else {
      // Full — store in all applicable columns
      evalRow.lifting_analysis = hasLifts ? analysis : null;
      evalRow.skills_analysis = hasSkills ? analysis : null;
      evalRow.engine_analysis = hasConditioning ? analysis : null;
    }

    const { data: savedEval, error: insertErr } = await supa
      .from("profile_evaluations")
      .insert(evalRow)
      .select("id, created_at")
      .single();

    if (insertErr) {
      console.error("Failed to save evaluation:", insertErr);
      // Still return analysis even if save fails
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
