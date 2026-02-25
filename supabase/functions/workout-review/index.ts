import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAndFormatRecentHistory } from "../_shared/training-history.ts";
import { searchChunks, deduplicateChunks, formatChunksAsContext, type RAGChunk } from "../_shared/rag.ts";

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
// Block parsing for program workouts (simplified from workout-parser.ts)
// ---------------------------------------------------------------------------
type ReviewBlockType = "strength" | "metcon" | "skills" | "warm-up" | "cool-down" | "accessory" | "other";

interface WorkoutBlock {
  label: string;
  type: ReviewBlockType;
  text: string;
}

function splitAndClassifyBlocks(workoutText: string): WorkoutBlock[] {
  const normalized = workoutText.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const pattern = /^(Strength|Metcon|MetCon|Accessory|Warm-up|Warmup|Conditioning|Skills|Cool\s*down|Cool-down):\s*/im;
  const parts = normalized.split(pattern);

  if (parts.length <= 1) {
    return [{ label: "Metcon", type: "metcon", text: normalized }];
  }

  const blocks: WorkoutBlock[] = [];
  let i = 1;
  while (i + 1 < parts.length) {
    const label = parts[i]?.trim() || "";
    const text = parts[i + 1]?.trim() || "";
    i += 2;
    if (!label || !text) continue;

    const ll = label.toLowerCase();
    let type: ReviewBlockType;
    if (/strength/.test(ll)) type = "strength";
    else if (/metcon|conditioning/.test(ll)) type = "metcon";
    else if (/skills/.test(ll)) type = "skills";
    else if (/warm-?up/.test(ll)) type = "warm-up";
    else if (/cool\s*-?down/.test(ll)) type = "cool-down";
    else if (/accessory/.test(ll)) type = "accessory";
    else type = "other";

    blocks.push({ label, type, text });
  }

  return blocks.length > 0 ? blocks : [{ label: "Metcon", type: "metcon", text: normalized }];
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/** Prompt for program workouts — per-block analysis with unified intent */
function buildProgramPrompt(blocks: WorkoutBlock[]): string {
  const blockDescriptions = blocks
    .filter((b) => b.type === "skills" || b.type === "strength" || b.type === "metcon")
    .map((b) => `  - "${b.label}" (${b.type})`)
    .join("\n");

  const blocksSchema = blocks
    .filter((b) => b.type === "skills" || b.type === "strength" || b.type === "metcon")
    .map((b) => {
      const timeDomainField =
        b.type === "strength"
          ? `"time_domain": "Rest intervals, total block duration, tempo if applicable"`
          : b.type === "skills"
          ? `"time_domain": "Format/tempo (e.g. EMOM structure), total duration"`
          : `"time_domain": "Expected duration. What will limit the athlete."`;
      return `    {
      "block_type": "${b.type}",
      "block_label": "${b.label}",
      ${timeDomainField},
      "cues_and_faults": [
        { "movement": "Movement name", "cues": ["Cue 1", "Cue 2"], "common_faults": ["Fault 1"] }
      ]
    }`;
    })
    .join(",\n");

  return `You are an expert CrossFit coach preparing an athlete for a multi-block training session. Analyze each training block and provide targeted coaching. Ground advice in the provided reference material when available.

The workout has these training blocks:
${blockDescriptions}

Output valid JSON only, no markdown or extra text, with this exact structure:
{
  "intent": "2-3 sentences: the overall session design — why these blocks are combined, what energy systems or adaptations are targeted across the session, and how the blocks build on each other.",
  "blocks": [
${blocksSchema}
  ],
  "sources": []
}

Rules:
- intent should tie the entire session together, not just describe one block.
- For each block, provide cues_and_faults for every primary movement.
- Cues: 2-3 actionable coaching cues per movement. Personalize using athlete profile (e.g. specific loads from their 1RMs).
- Common faults: 1-2 most common errors for that movement at the prescribed intensity/volume.
- For strength blocks: include rest intervals and RPE expectations in time_domain. Use strength science principles (periodization, load management).
- For skills blocks: include progression tips and scaling if the athlete can't perform the movement as written.
- For metcon blocks: include pacing strategy and what will be the primary limiter.
- Use recent training to account for fatigue or similar volume.
- Be concise and practical. Athlete-focused voice.
- Do not include sources in the JSON — leave sources as empty array.`;
}

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

    const { workout_text, source_type } = await req.json();
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
    // Program workouts: per-block RAG + per-block analysis
    // -----------------------------------------------------------------------
    const isProgramWorkout = source_type === "program";
    const blocks = isProgramWorkout ? splitAndClassifyBlocks(trimmed) : [];
    const analysisBlocks = blocks.filter(
      (b) => b.type === "skills" || b.type === "strength" || b.type === "metcon"
    );

    let systemPrompt: string;
    let context = "";
    const sources: { title: string; author: string; source: string }[] = [];

    if (isProgramWorkout && analysisBlocks.length > 0) {
      // Build per-category RAG queries in parallel
      const skillsMetconText = analysisBlocks
        .filter((b) => b.type === "skills" || b.type === "metcon")
        .map((b) => b.text)
        .join("\n");
      const strengthText = analysisBlocks
        .filter((b) => b.type === "strength")
        .map((b) => b.text)
        .join("\n");

      const ragPromises: Promise<RAGChunk[]>[] = [];
      if (skillsMetconText) {
        ragPromises.push(
          searchChunks(supa, skillsMetconText, "journal", OPENAI_API_KEY!, 4, 0.25)
        );
      }
      if (strengthText) {
        ragPromises.push(
          searchChunks(supa, strengthText, "strength-science", OPENAI_API_KEY!, 4, 0.25)
        );
      }

      const ragResults = await Promise.all(ragPromises);
      const allChunks = deduplicateChunks(ragResults.flat());

      for (const c of allChunks) {
        sources.push({ title: c.title, author: c.author || "", source: c.source || "" });
      }
      if (allChunks.length > 0) {
        context = "\n\nREFERENCE MATERIAL:\n" + formatChunksAsContext(allChunks, 8);
      }

      systemPrompt = buildProgramPrompt(analysisBlocks);
    } else {
      // Paste-your-own: single journal RAG query (existing flow)
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

      systemPrompt = WORKOUT_REVIEW_SYSTEM_PROMPT;
    }

    // Call Claude (non-streaming for structured JSON)
    const userContent = `ATHLETE PROFILE:
${profileStr}

RECENT TRAINING (last 14 days):
${recentStr}

WORKOUT:
${trimmed}`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: isProgramWorkout ? 2048 : 1024,
        stream: false,
        system: systemPrompt + context,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.json().catch(() => ({}));
      console.error("Claude API error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to generate review" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeResp.json();
    const rawText =
      claudeData.content?.[0]?.text?.trim() ||
      claudeData.content?.[0]?.input?.trim() ||
      "";

    // Parse JSON from response (handle possible markdown code blocks)
    let review: Record<string, unknown>;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
      review = JSON.parse(jsonStr);
    } catch {
      if (isProgramWorkout) {
        review = {
          intent: rawText || "Unable to parse response.",
          blocks: [],
          sources: [],
        };
      } else {
        review = {
          time_domain: rawText || "Unable to parse response.",
          scaling: [],
          warm_up: "",
          cues: [],
          class_prep: "",
          sources: [],
        };
      }
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