import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const SYSTEM_PROMPT = `You are an expert CrossFit coach. Give concise, practical analysis. Coach-to-coach voice. 150-200 words max. No bullet lists—use short paragraphs.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function formatProfile(profile: {
  lifts?: Record<string, number> | null;
  skills?: Record<string, string> | null;
  conditioning?: Record<string, string | number> | null;
  bodyweight?: number | null;
  units?: string | null;
}): string {
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

function formatConditioningOnly(profile: {
  conditioning?: Record<string, string | number> | null;
  bodyweight?: number | null;
  units?: string | null;
}): string {
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
    const analysisType = type === "skills" ? "skills" : type === "engine" ? "engine" : type === "full" ? "full" : "lifts";

    const { data: athleteProfile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, conditioning, bodyweight, units")
      .eq("user_id", user.id)
      .maybeSingle();

    const profileData = athleteProfile || {};
    const profileStr = formatProfile(profileData);

    const hasLifts =
      profileData.lifts && Object.keys(profileData.lifts).length > 0 && Object.values(profileData.lifts).some((v: unknown) => (v as number) > 0);
    const hasSkills =
      profileData.skills && Object.keys(profileData.skills).length > 0 && Object.entries(profileData.skills).some(([, v]) => v && v !== "none");
    const hasConditioning =
      profileData.conditioning && Object.keys(profileData.conditioning).length > 0 && Object.values(profileData.conditioning).some((v) => v !== "" && v != null);

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
      userPrompt = `Analyze this athlete's strength profile:\n\n${profileStr}\n\nSummarize their strength—what stands out? Identify any imbalances (e.g. squat vs deadlift, press vs bench). Give one clear priority to focus on.`;
    } else if (analysisType === "skills") {
      if (!hasSkills) {
        return new Response(
          JSON.stringify({
            analysis: "Add your skill levels to get an analysis. Fill out the skills section above and try again.",
          }),
          { headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      userPrompt = `Analyze this athlete's skills:\n\n${profileStr}\n\nBased on their levels, what should they focus on next? Suggest 1–2 skills and a simple progression.`;
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
      userPrompt = `Analyze this athlete's conditioning/engine. Focus ONLY on these benchmarks:\n\n${conditioningStr}\n\nAssess their work capacity based on these times and calories. What's strong? What limits them? How do running, rowing, and bike compare? One clear priority for conditioning. Do NOT discuss lifts or strength.`;
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
      userPrompt = `Analyze this athlete's full profile:\n\n${profileStr}\n\nInclude each of these sections when the data exists:\n${sections.join("\n")}\n\nBe concise. Cover strength, skills, and conditioning as separate sections where data is present.`;
    }

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
        system: SYSTEM_PROMPT,
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

    return new Response(
      JSON.stringify({ analysis }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
