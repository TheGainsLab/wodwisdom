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

const SYSTEM_PROMPT = `You are an expert CrossFit coach. Categorize athlete abilities into clear tiers. Be direct and precise. Output only the requested format—no extra commentary.`;

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
      const journalChunks = await searchChunks(
        supa,
        `strength training programming periodization ${liftNames}`,
        "journal",
        OPENAI_API_KEY,
        4,
        0.25
      );
      allChunks.push(...journalChunks);
      const strengthScienceChunks = await searchChunks(
        supa,
        liftNames ? `strength training periodization load prescription ${liftNames}` : "strength training periodization load prescription squat deadlift",
        "strength-science",
        OPENAI_API_KEY,
        2,
        0.25
      );
      allChunks.push(...strengthScienceChunks);
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

    return "\n\nREFERENCE MATERIAL (Journal and Strength Science — use to ground your advice):\n" + formatChunksAsContext(unique, 10);
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

    // Fetch most recent evaluation that has data for the requested analysis type.
    // For "full", grab the latest eval that has ANY analysis column populated.
    // For individual types, grab the latest eval where THAT column is not null
    // (so a Feb "full" eval counts as prior context for a Mar "skills" eval).
    async function fetchPrevEval(col: "lifting_analysis" | "skills_analysis" | "engine_analysis") {
      const { data } = await supa
        .from("profile_evaluations")
        .select("profile_snapshot, created_at, lifting_analysis, skills_analysis, engine_analysis")
        .eq("user_id", user.id)
        .not(col, "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }

    const colForType: Record<AnalysisType, "lifting_analysis" | "skills_analysis" | "engine_analysis"> = {
      lifts: "lifting_analysis",
      skills: "skills_analysis",
      engine: "engine_analysis",
      full: "lifting_analysis", // for full, we fetch per-column below
    };

    // For individual types, one lookup. For full, fetch each column's history separately.
    let prevEval: Awaited<ReturnType<typeof fetchPrevEval>> = null;
    let prevEvalLifts: typeof prevEval = null;
    let prevEvalSkills: typeof prevEval = null;
    let prevEvalEngine: typeof prevEval = null;

    if (analysisType === "full") {
      [prevEvalLifts, prevEvalSkills, prevEvalEngine] = await Promise.all([
        hasLifts ? fetchPrevEval("lifting_analysis") : Promise.resolve(null),
        hasSkills ? fetchPrevEval("skills_analysis") : Promise.resolve(null),
        hasConditioning ? fetchPrevEval("engine_analysis") : Promise.resolve(null),
      ]);
      // Use whichever is most recent as the "primary" for overall comparison
      prevEval = [prevEvalLifts, prevEvalSkills, prevEvalEngine]
        .filter(Boolean)
        .sort((a, b) => new Date(b!.created_at).getTime() - new Date(a!.created_at).getTime())[0] || null;
    } else {
      prevEval = await fetchPrevEval(colForType[analysisType]);
    }

    // Build RAG context, comparison, and recent training in parallel
    const [ragContext, comparisonContext, recentTraining] = await Promise.all([
      retrieveRAGContext(supa, analysisType, profileData),
      Promise.resolve(buildComparisonContext(prevEval, profileData, analysisType)),
      fetchAndFormatRecentHistory(supa, user.id),
    ]);
    const trainingBlock = recentTraining ? `\n\n${recentTraining}` : "";

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
      userPrompt = `Analyze this athlete's strength profile:\n\n${profileStr}${trainingBlock}\n\nCategorize EVERY lift the athlete provided into exactly one of three tiers. Use bodyweight ratios, lift-to-lift relationships, and common CrossFit benchmarks to judge.\n\nYour response MUST use this exact format and nothing else:\n\nSTRENGTH PROFILE:\n\n**Strong:**\n- [Lift] — [reason]\n- [Lift] — [reason]\n\n**Intermediate:**\n- [Lift] — [reason]\n- [Lift] — [reason]\n\n**Needs Attention:**\n- [Lift] — [reason]\n- [Lift] — [reason]\n\nExample for a 180lb male:\n\n**Strong:**\n- Back Squat — 1.8x BW, competitive\n- Deadlift — 2.1x BW\n\n**Intermediate:**\n- Front Squat — 80% of back squat, typical ratio\n- Push Press — adequate for level\n\n**Needs Attention:**\n- Overhead Squat — well below front squat, mobility limiter\n- Snatch — 55% of back squat, should be 60-65%\n\nRules:\n- Every lift the athlete entered MUST appear in exactly one tier. Do not skip any.\n- Do not add lifts the athlete did not provide.\n- Each lift gets its own bullet line starting with "- ".\n- Use bodyweight ratios (e.g. back squat ~1.5-2x BW) and lift-to-lift ratios (e.g. front squat ~85% of back squat, snatch ~60-65% of back squat) to judge.\n- For CrossFit athletes, olympic lift proficiency matters more than raw posterior chain strength.\n- Keep reasons brief (under 10 words each).\n- Do NOT write a narrative or any text outside the STRENGTH PROFILE block.${comparisonContext}`;
    } else if (analysisType === "skills") {
      if (!hasSkills) {
        return new Response(
          JSON.stringify({
            analysis: "Add your skill levels to get an analysis. Fill out the skills section above and try again.",
          }),
          { headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      userPrompt = `Analyze this athlete's skill profile:\n\n${profileStr}${trainingBlock}\n\nCategorize EVERY skill the athlete provided into exactly one of three tiers. Use their current proficiency level, prerequisite chains, and competition frequency to judge.\n\nYour response MUST use this exact format and nothing else:\n\nSKILLS PROFILE:\n\n**Strong:**\n- [Skill] — [reason]\n- [Skill] — [reason]\n\n**Intermediate:**\n- [Skill] — [reason]\n- [Skill] — [reason]\n\n**Needs Attention:**\n- [Skill] — [reason]\n- [Skill] — [reason]\n\nExample:\n\n**Strong:**\n- Double-Unders — advanced, consistent\n- Kipping Pull-Ups — advanced, no limitation\n\n**Intermediate:**\n- Toes-to-Bar — intermediate, improving\n- Ring Dips — intermediate, adequate\n\n**Needs Attention:**\n- Ring Muscle-Ups — beginner, major competition limiter\n- Handstand Walk — beginner, appears in most competitions\n\nRules:\n- Every skill the athlete entered MUST appear in exactly one tier. Do not skip any.\n- Do not add skills the athlete did not provide.\n- Each skill gets its own bullet line starting with "- ".\n- Skills at "advanced" level generally go in Strong unless context suggests otherwise.\n- Skills at "beginner" or "none" generally go in Needs Attention.\n- Skills at "intermediate" could go in Intermediate or Needs Attention depending on competition importance and prerequisite chains.\n- Consider prerequisite chains (e.g. strict pull-ups before kipping, kipping before butterfly, strict HSPU before kipping HSPU).\n- Consider competition frequency — skills that appear often in CrossFit competition matter more.\n- Keep reasons brief (under 10 words each).\n- Do NOT write a narrative or any text outside the SKILLS PROFILE block.${comparisonContext}`;
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
      userPrompt = `Analyze this athlete's conditioning/engine. Focus ONLY on these benchmarks:\n\n${conditioningStr}${trainingBlock}\n\nAssess their work capacity based on these times and calories. What's strong? What limits them? How do running, rowing, and bike compare? One clear priority for conditioning. Do NOT discuss lifts or strength.${comparisonContext}`;
    } else {
      if (!hasLifts && !hasSkills && !hasConditioning) {
        return new Response(
          JSON.stringify({
            analysis: "Add your lifts, skills, or conditioning to get a full profile analysis. Fill out the sections above and try again.",
          }),
          { headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      // Full analysis: handled separately below with 3 parallel AI calls
      userPrompt = ""; // placeholder — not used for full
    }

    const systemPrompt = SYSTEM_PROMPT + ragContext;

    /** Call Claude API and return the text response */
    async function callClaude(prompt: string): Promise<string> {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          stream: false,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        console.error("Claude API error:", err);
        throw new Error("Failed to generate analysis");
      }
      const data = await resp.json();
      return data.content?.[0]?.text?.trim() || data.content?.[0]?.input?.trim() || "Unable to generate analysis.";
    }

    // Build the evaluation row
    const evalRow: Record<string, unknown> = {
      user_id: user.id,
      type: analysisType,
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

    let analysis: string;

    if (analysisType === "full") {
      // 3 separate AI calls in parallel — each column gets a clean, focused analysis
      const fullPromises: Promise<string | null>[] = [];
      const liftComparison = prevEvalLifts ? buildComparisonContext(prevEvalLifts, profileData, "lifts") : "";
      const skillComparison = prevEvalSkills ? buildComparisonContext(prevEvalSkills, profileData, "skills") : "";
      const engineComparison = prevEvalEngine ? buildComparisonContext(prevEvalEngine, profileData, "engine") : "";

      fullPromises.push(
        hasLifts
          ? callClaude(`Analyze this athlete's strength profile:\n\n${profileStr}${trainingBlock}\n\nCategorize EVERY lift the athlete provided into exactly one of three tiers. Use bodyweight ratios, lift-to-lift relationships, and common CrossFit benchmarks to judge.\n\nYour response MUST use this exact format and nothing else:\n\nSTRENGTH PROFILE:\n\n**Strong:**\n- [Lift] — [reason]\n- [Lift] — [reason]\n\n**Intermediate:**\n- [Lift] — [reason]\n- [Lift] — [reason]\n\n**Needs Attention:**\n- [Lift] — [reason]\n- [Lift] — [reason]\n\nExample for a 180lb male:\n\n**Strong:**\n- Back Squat — 1.8x BW, competitive\n- Deadlift — 2.1x BW\n\n**Intermediate:**\n- Front Squat — 80% of back squat, typical ratio\n- Push Press — adequate for level\n\n**Needs Attention:**\n- Overhead Squat — well below front squat, mobility limiter\n- Snatch — 55% of back squat, should be 60-65%\n\nRules:\n- Every lift the athlete entered MUST appear in exactly one tier. Do not skip any.\n- Do not add lifts the athlete did not provide.\n- Each lift gets its own bullet line starting with "- ".\n- Use bodyweight ratios (e.g. back squat ~1.5-2x BW) and lift-to-lift ratios (e.g. front squat ~85% of back squat, snatch ~60-65% of back squat) to judge.\n- For CrossFit athletes, olympic lift proficiency matters more than raw posterior chain strength.\n- Keep reasons brief (under 10 words each).\n- Do NOT write a narrative or any text outside the STRENGTH PROFILE block.${liftComparison}`)
          : Promise.resolve(null)
      );
      fullPromises.push(
        hasSkills
          ? callClaude(`Analyze this athlete's skill profile:\n\n${profileStr}${trainingBlock}\n\nCategorize EVERY skill the athlete provided into exactly one of three tiers. Use their current proficiency level, prerequisite chains, and competition frequency to judge.\n\nYour response MUST use this exact format and nothing else:\n\nSKILLS PROFILE:\n\n**Strong:**\n- [Skill] — [reason]\n- [Skill] — [reason]\n\n**Intermediate:**\n- [Skill] — [reason]\n- [Skill] — [reason]\n\n**Needs Attention:**\n- [Skill] — [reason]\n- [Skill] — [reason]\n\nExample:\n\n**Strong:**\n- Double-Unders — advanced, consistent\n- Kipping Pull-Ups — advanced, no limitation\n\n**Intermediate:**\n- Toes-to-Bar — intermediate, improving\n- Ring Dips — intermediate, adequate\n\n**Needs Attention:**\n- Ring Muscle-Ups — beginner, major competition limiter\n- Handstand Walk — beginner, appears in most competitions\n\nRules:\n- Every skill the athlete entered MUST appear in exactly one tier. Do not skip any.\n- Do not add skills the athlete did not provide.\n- Each skill gets its own bullet line starting with "- ".\n- Skills at "advanced" level generally go in Strong unless context suggests otherwise.\n- Skills at "beginner" or "none" generally go in Needs Attention.\n- Skills at "intermediate" could go in Intermediate or Needs Attention depending on competition importance and prerequisite chains.\n- Consider prerequisite chains (e.g. strict pull-ups before kipping, kipping before butterfly, strict HSPU before kipping HSPU).\n- Consider competition frequency — skills that appear often in CrossFit competition matter more.\n- Keep reasons brief (under 10 words each).\n- Do NOT write a narrative or any text outside the SKILLS PROFILE block.${skillComparison}`)
          : Promise.resolve(null)
      );
      fullPromises.push(
        hasConditioning
          ? callClaude(`Analyze this athlete's conditioning/engine. Focus ONLY on these benchmarks:\n\n${formatConditioningOnly(profileData)}${trainingBlock}\n\nAssess their work capacity based on these times and calories. What's strong? What limits them? How do running, rowing, and bike compare? One clear priority for conditioning. Do NOT discuss lifts or strength.${engineComparison}`)
          : Promise.resolve(null)
      );

      const [liftResult, skillResult, engineResult] = await Promise.all(fullPromises);
      evalRow.lifting_analysis = liftResult;
      evalRow.skills_analysis = skillResult;
      evalRow.engine_analysis = engineResult;

      // Build combined response for the immediate UI display
      const parts: string[] = [];
      if (liftResult) parts.push("**Strength**\n" + liftResult);
      if (skillResult) parts.push("**Skills**\n" + skillResult);
      if (engineResult) parts.push("**Engine**\n" + engineResult);
      analysis = parts.join("\n\n");
    } else {
      // Single AI call for individual type
      const claudeResp = await callClaude(userPrompt);
      analysis = claudeResp;

      if (analysisType === "lifts") {
        evalRow.lifting_analysis = analysis;
      } else if (analysisType === "skills") {
        evalRow.skills_analysis = analysis;
      } else if (analysisType === "engine") {
        evalRow.engine_analysis = analysis;
      }
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
