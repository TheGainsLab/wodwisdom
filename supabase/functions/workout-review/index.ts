import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAndFormatRecentHistory } from "../_shared/training-history.ts";
import { searchChunks, deduplicateChunks, formatChunksAsContext } from "../_shared/rag.ts";
import { callClaude } from "../_shared/call-claude.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const FREE_LIMIT = 3;
const DAILY_LIMIT = 75;

interface AthleteProfileData {
  lifts?: Record<string, number> | null;
  skills?: Record<string, string> | null;
  conditioning?: Record<string, string | number> | null;
  bodyweight?: number | null;
  units?: string | null;
  age?: number | null;
  height?: number | null;
  gender?: string | null;
}

function formatAthleteProfile(profile: AthleteProfileData | null): string {
  if (!profile) return "No profile data. Give general advice and suggest they add lifts/skills on their Profile for personalized scaling.";
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
  if (parts.length === 0) return "No profile data. Give general advice and suggest they add lifts/skills on their Profile for personalized scaling.";
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Focused prompts for parallel per-block coaching calls
// ---------------------------------------------------------------------------

const INTENT_PROMPT = `You are an expert CrossFit coach. Given a multi-block training session, explain the overall session design in 2-3 sentences: why these blocks are combined, what energy systems or adaptations are targeted across the session, and how the blocks build on each other.

Output valid JSON only, no markdown or extra text:
{ "intent": "2-3 sentences about the session design." }

Rules:
- Tie the entire session together — don't just describe one block.
- Reference specific energy systems, adaptations, or periodization goals.
- Use recent training to note fatigue or progression context.
- Be concise and practical. Athlete-focused voice.`;

const METCON_PROMPT = `You are an expert CrossFit coach preparing an athlete for a conditioning workout. Focus ONLY on the Metcon / Conditioning portion of the workout below. Ignore strength, skills, warm-up, and cool-down blocks.

Output valid JSON only, no markdown or extra text:
{
  "block_type": "metcon",
  "block_label": "Metcon",
  "time_domain": "Expected duration for this athlete. What will be the primary limiter. Pacing strategy.",
  "cues_and_faults": [
    { "movement": "Movement name", "cues": ["Cue 1", "Cue 2", "Cue 3"], "common_faults": ["Fault 1", "Fault 2"] }
  ]
}

Rules:
- Provide cues_and_faults for EVERY movement in the metcon.
- Cues: 2-3 actionable points of performance per movement. Personalize using athlete profile (e.g. specific loads from their 1RMs, scaling based on their skill level).
- Common faults: 1-2 most common errors at the prescribed intensity/volume.
- time_domain must include pacing strategy and what will limit this specific athlete.
- Ground advice in the provided reference material when available.
- Use recent training to account for fatigue or similar recent volume.
- Be concise and practical. Athlete-focused voice.`;

const STRENGTH_PROMPT = `You are an expert strength & conditioning coach preparing an athlete for their strength work. Focus ONLY on the Strength portion of the workout below. Ignore metcon, skills, warm-up, and cool-down blocks.

Output valid JSON only, no markdown or extra text:
{
  "block_type": "strength",
  "block_label": "Strength",
  "time_domain": "Rest intervals between sets, total block duration, tempo if prescribed.",
  "cues_and_faults": [
    { "movement": "Movement name", "cues": ["Cue 1", "Cue 2", "Cue 3"], "common_faults": ["Fault 1", "Fault 2"] }
  ]
}

Rules:
- Provide cues_and_faults for EVERY lift in the strength block.
- Cues: 2-3 actionable points of performance per lift. Personalize using athlete profile — calculate specific working weights from their 1RMs (e.g. "75% of 300lb back squat = 225lb").
- Common faults: 1-2 most common errors at the prescribed intensity.
- time_domain must include recommended rest intervals and RPE expectations.
- Ground advice in the provided reference material when available (periodization, load management, biomechanics).
- Use recent training to account for fatigue or similar recent volume.
- Be concise and practical. Athlete-focused voice.`;

const SKILLS_PROMPT = `You are an expert gymnastics and skills coach preparing an athlete for their skill work. Focus ONLY on the Skills portion of the workout below. Ignore metcon, strength, warm-up, and cool-down blocks.

Output valid JSON only, no markdown or extra text:
{
  "block_type": "skills",
  "block_label": "Skills",
  "time_domain": "Format/tempo (e.g. EMOM structure), total duration.",
  "cues_and_faults": [
    { "movement": "Movement name", "cues": ["Cue 1", "Cue 2", "Cue 3"], "common_faults": ["Fault 1", "Fault 2"] }
  ]
}

Rules:
- Provide cues_and_faults for EVERY movement in the skills block.
- Cues: 2-3 actionable points of performance per movement. Personalize using athlete profile — if the athlete can't do the movement as written, provide a progression path and scaling option.
- Common faults: 1-2 most common errors for that movement.
- time_domain should describe the practice format and total duration.
- Ground advice in the provided reference material when available (progressions, skill transfer, quality metrics).
- Use recent training to account for recent practice or fatigue.
- Be concise and practical. Athlete-focused voice.`;

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const WORKOUT_REVIEW_SYSTEM_PROMPT = `You are an expert CrossFit coach reviewing this workout for a specific athlete. Give personalized scaling, warm-up, and cues based on their profile and recent training. Ground advice in the provided CrossFit Journal articles when available.

Output valid JSON only, no markdown or extra text, with this exact structure:
{
  "intent": "1-2 sentences: the training purpose of this workout — what energy system, stimulus, or adaptation it targets and why it's valuable.",
  "time_domain": "Expected duration for this athlete given their capacity. What will limit them.",
  "scaling": [
    { "movement": "Movement name", "suggestions": "Personalized scaling for this athlete with specific loads/options based on their profile" }
  ],
  "warm_up": "5-7 min warm-up tailored to this workout and athlete.",
  "cues": [
    { "movement": "Movement name", "cues": ["Cue 1", "Cue 2", "Cue 3"] }
  ],
  "class_prep": "Equipment and setup. Brief notes for executing this workout.",
  "sources": []
}

Rules:
- Personalize scaling using their lifts (e.g. "65% of back squat = X lbs"), skills (scale gymnastics they can't Rx), and conditioning.
- Use recent training to account for fatigue or similar volume.
- Be concise and practical. Athlete-focused voice.
- Ground advice in the provided article context when available.
- Extract movements from the workout and provide scaling/cues for each.
- If the input is not a recognizable workout, set time_domain to "I couldn't parse this as a workout. Try pasting a complete workout (e.g. 4 RFT: 20 wall balls, 10 T2B, 5 power cleans 135/95)."
- Do not include sources in the JSON - we will add them separately. Leave sources as empty array.`;

// callClaude imported from _shared/call-claude.ts (retry + Haiku fallback)

function parseJSON(raw: string): Record<string, unknown> | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : raw);
  } catch {
    return null;
  }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const { workout_text, source_type, source_id } = await req.json();
    if (!workout_text || typeof workout_text !== "string") {
      return new Response(JSON.stringify({ error: "Missing workout_text" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const trimmed = workout_text.trim();
    if (trimmed.length < 10) {
      return new Response(JSON.stringify({ error: "Paste a complete workout to analyze" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Fetch subscription tier, athlete profile, and recent training in parallel
    const [profileRes, athleteRes, recentTraining] = await Promise.all([
      supa.from("profiles").select("subscription_status").eq("id", user.id).single(),
      supa.from("athlete_profiles").select("lifts, skills, conditioning, bodyweight, units, age, height, gender").eq("user_id", user.id).maybeSingle(),
      fetchAndFormatRecentHistory(supa, user.id, { days: 14, maxLines: 25 }),
    ]);

    const profile = profileRes.data;
    const athleteProfile = athleteRes.data as AthleteProfileData | null;
    const profileStr = formatAthleteProfile(athleteProfile);
    const recentStr = recentTraining || "No recent workouts logged.";

    const isFreeTier = !profile || profile.subscription_status !== "active";

    // Usage limits: count chat_messages + workout_reviews
    if (isFreeTier) {
      const [{ count: chatCount }, { count: reviewCount }] = await Promise.all([
        supa.from("chat_messages").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supa.from("workout_reviews").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      const totalCount = (chatCount || 0) + (reviewCount || 0);
      if (totalCount >= FREE_LIMIT) {
        return new Response(
          JSON.stringify({ error: "Free limit reached", code: "FREE_LIMIT" }),
          { status: 402, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const [{ count: chatToday }, { count: reviewToday }] = await Promise.all([
        supa
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", today),
        supa
          .from("workout_reviews")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", today),
      ]);
      const dailyCount = (chatToday || 0) + (reviewToday || 0);
      if (dailyCount >= DAILY_LIMIT) {
        return new Response(
          JSON.stringify({ error: "Daily limit reached" }),
          { status: 429, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    }

    // -----------------------------------------------------------------------
    // Shared user content builder
    // -----------------------------------------------------------------------
    const isProgramWorkout = source_type === "program";

    function buildUserContent(workoutSection: string): string {
      return `ATHLETE PROFILE:\n${profileStr}\n\nRECENT TRAINING (last 14 days):\n${recentStr}\n\nWORKOUT:\n${workoutSection}`;
    }

    let review: Record<string, unknown>;
    const sources: { title: string; author: string; source: string }[] = [];

    if (isProgramWorkout) {
      // -------------------------------------------------------------------
      // Program workouts: fetch stored blocks, per-block RAG + Claude calls
      // -------------------------------------------------------------------

      // Fetch pre-extracted blocks from DB (written by preprocess-program)
      let blockRows: { block_type: string; block_text: string; block_order: number }[] = [];
      if (source_id) {
        const { data } = await supa
          .from("program_workout_blocks")
          .select("block_type, block_text, block_order")
          .eq("program_workout_id", source_id)
          .order("block_order");
        blockRows = (data || []) as typeof blockRows;
      }

      // Map block types to their text
      const blockTextByType: Record<string, string> = {};
      for (const b of blockRows) {
        blockTextByType[b.block_type] = b.block_text;
      }

      // Full workout text for intent call (all blocks)
      const fullWorkoutText = blockRows.length > 0
        ? blockRows.map((b) => `${b.block_type}: ${b.block_text}`).join("\n")
        : trimmed;

      // Step 1: RAG queries in parallel
      const [journalChunks, strengthChunks] = await Promise.all([
        searchChunks(supa, fullWorkoutText, "journal", OPENAI_API_KEY!, 4, 0.25),
        searchChunks(supa, fullWorkoutText, "strength-science", OPENAI_API_KEY!, 4, 0.25),
      ]);

      const allChunks = deduplicateChunks([...journalChunks, ...strengthChunks]);
      for (const c of allChunks) {
        sources.push({ title: c.title, author: c.author || "", source: c.source || "" });
      }

      const journalContext = journalChunks.length > 0
        ? "\n\nREFERENCE MATERIAL:\n" + formatChunksAsContext(journalChunks, 4)
        : "";
      const strengthContext = strengthChunks.length > 0
        ? "\n\nREFERENCE MATERIAL:\n" + formatChunksAsContext(strengthChunks, 4)
        : "";
      const intentContext = allChunks.length > 0
        ? "\n\nREFERENCE MATERIAL:\n" + formatChunksAsContext(allChunks, 4)
        : "";

      // Step 2: Per-block Claude calls — only for blocks that exist
      const claudeOpts = (system: string, userContent: string, maxTokens: number) => ({
        apiKey: ANTHROPIC_API_KEY!, system, userContent, maxTokens,
      });

      const stagger = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const calls: Promise<[string, string]>[] = [];

      // Intent always runs (full session context)
      calls.push(
        callClaude(claudeOpts(INTENT_PROMPT + intentContext, buildUserContent(fullWorkoutText), 384))
          .then((r): [string, string] => ["intent", r])
      );

      if (blockTextByType["metcon"]) {
        calls.push(
          stagger(500).then(() => callClaude(claudeOpts(METCON_PROMPT + journalContext, buildUserContent(blockTextByType["metcon"]), 1024)))
            .then((r): [string, string] => ["metcon", r])
        );
      }
      if (blockTextByType["strength"]) {
        calls.push(
          stagger(1000).then(() => callClaude(claudeOpts(STRENGTH_PROMPT + strengthContext, buildUserContent(blockTextByType["strength"]), 1024)))
            .then((r): [string, string] => ["strength", r])
        );
      }
      if (blockTextByType["skills"]) {
        calls.push(
          stagger(1500).then(() => callClaude(claudeOpts(SKILLS_PROMPT + journalContext, buildUserContent(blockTextByType["skills"]), 1024)))
            .then((r): [string, string] => ["skills", r])
        );
      }

      const results = await Promise.all(calls);
      const resultMap: Record<string, string> = {};
      for (const [key, raw] of results) {
        resultMap[key] = raw;
      }

      // Step 3: Parse responses and assemble
      const intentParsed = parseJSON(resultMap["intent"] || "");
      const blocks: Record<string, unknown>[] = [];

      if (resultMap["skills"]) {
        const parsed = parseJSON(resultMap["skills"]);
        if (parsed?.block_type) blocks.push(parsed);
      }
      if (resultMap["strength"]) {
        const parsed = parseJSON(resultMap["strength"]);
        if (parsed?.block_type) blocks.push(parsed);
      }
      if (resultMap["metcon"]) {
        const parsed = parseJSON(resultMap["metcon"]);
        if (parsed?.block_type) blocks.push(parsed);
      }

      review = {
        intent: intentParsed?.intent || resultMap["intent"] || "Unable to parse intent.",
        blocks,
        sources: [],
      };
    } else {
      // -------------------------------------------------------------------
      // Paste-your-own: single journal RAG query (existing flow)
      // -------------------------------------------------------------------
      const embResp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + OPENAI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: trimmed.substring(0, 2000),
        }),
      });
      const embData = await embResp.json();
      const queryEmb = embData.data?.[0]?.embedding;
      if (!queryEmb) {
        return new Response(JSON.stringify({ error: "Embedding failed" }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const { data: chunks } = await supa.rpc("match_chunks_filtered", {
        query_embedding: queryEmb,
        match_threshold: 0.25,
        match_count: 6,
        filter_category: "journal",
      });

      let context = "";
      if (chunks && chunks.length > 0) {
        context =
          "\n\nRELEVANT ARTICLES:\n" +
          chunks
            .map((c: any, i: number) => {
              sources.push({ title: c.title, author: c.author || "", source: c.source || "" });
              return (
                "[Source " + (i + 1) + ": " + c.title +
                (c.author ? " by " + c.author : "") + "]\n" + c.content
              );
            })
            .join("\n\n");
      }

      const rawText = await callClaude({
        apiKey: ANTHROPIC_API_KEY!,
        system: WORKOUT_REVIEW_SYSTEM_PROMPT + context,
        userContent: buildUserContent(trimmed),
        maxTokens: 1024,
      });

      review = parseJSON(rawText) || {
        time_domain: rawText || "Unable to parse response.",
        scaling: [],
        warm_up: "",
        cues: [],
        class_prep: "",
        sources: [],
      };
    }

    // Attach sources to review
    review.sources = sources;

    // Persist to workout_reviews
    await supa.from("workout_reviews").insert({
      user_id: user.id,
      workout_text: trimmed,
      review,
    });

    return new Response(JSON.stringify({ review }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});