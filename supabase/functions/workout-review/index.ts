import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAndFormatRecentHistory } from "../_shared/training-history.ts";
import { searchChunks, deduplicateChunks, formatChunksAsContext } from "../_shared/rag.ts";
import { callClaude } from "../_shared/call-claude.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

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

const INTENT_PROMPT = `You are an expert CrossFit coach. Given a multi-block training session, explain the overall session design in 2-3 sentences: why these blocks are combined this way and what the session achieves as a whole.

Output valid JSON only, no markdown or extra text:
{ "intent": "2-3 sentences about the session design." }

Rules:
- You MUST address EVERY training block present (strength, metcon, AND skills). Do not skip any block.
- For skills blocks, explain the skill acquisition or neuromuscular goal and why skills are sequenced where they are (e.g. practiced early while the CNS is fresh, or placed after strength to challenge coordination under fatigue).
- Reference the relevant training targets for each block — energy systems for conditioning, force production for strength, AND motor learning / skill acquisition / movement quality for skills work.
- Explain how the blocks interact: does one block complement, compete with, or set up another?
- Warmup and cooldown blocks do not need emphasis — they don't drive adaptation.
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
- Do NOT include a "prescription" field — it is injected separately.
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
- Do NOT include a "prescription" field — it is injected separately.
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
- Do NOT include a "prescription" field — it is injected separately.
- Provide cues_and_faults for EVERY movement in the skills block.
- Cues: 2-3 actionable points of performance per movement. Personalize using athlete profile — if the athlete can't do the movement as written, provide a progression path and scaling option.
- Common faults: 1-2 most common errors for that movement.
- time_domain should describe the practice format and total duration.
- Ground advice in the provided reference material when available (progressions, skill transfer, quality metrics).
- Use recent training to account for recent practice or fatigue.
- Be concise and practical. Athlete-focused voice.`;

// ---------------------------------------------------------------------------
// Session-intent detection & prompt modifiers
// ---------------------------------------------------------------------------

type StrengthIntent = "assessment" | "build" | "technique" | "recovery";
type MetconIntent = "sprint" | "endurance" | "mixed";
type SkillsIntent = "acquisition" | "practice";
type SessionIntent = StrengthIntent | MetconIntent | SkillsIntent;

const INTENT_MODIFIERS: Record<SessionIntent, string> = {
  // Strength intents
  assessment: `\n\nINTENT-SPECIFIC COACHING (Assessment Day):
- Focus on attempt selection strategy: opening attempt, jumps between attempts, when to call it.
- Emphasize quality standards — what a "good" rep looks like at max effort and when to stop.
- Identify signs of positional breakdown that signal the athlete is done.
- De-emphasize generic positional cues; the athlete knows how to lift — help them peak.`,

  build: `\n\nINTENT-SPECIFIC COACHING (Building Phase):
- Focus on positional integrity under increasing load — what should stay the same as weight goes up.
- Provide RPE targets per set where applicable.
- Emphasize set-to-set consistency: tempo, bar path, bracing.
- Flag if prescribed percentages interact with recent training volume (fatigue accumulation).`,

  technique: `\n\nINTENT-SPECIFIC COACHING (Technique / Variation Work):
- Identify the specific positional demand this variation is designed to train (e.g. pause squat trains bottom position, deficit deadlift trains off-the-floor position).
- Focus ALL cues on that specific demand — do not give generic points of performance for the base movement.
- Common faults should be specific to the variation, not the parent lift.`,

  recovery: `\n\nINTENT-SPECIFIC COACHING (Recovery / Deload):
- Emphasize movement quality over intensity — this is a recovery session.
- Cue breathing, full range of motion, and positions that get neglected when pushing hard.
- Discourage the athlete from going heavier than prescribed.
- Note how this session fits recovery within the training week.`,

  // Metcon intents
  sprint: `\n\nINTENT-SPECIFIC COACHING (Sprint / Short Time Domain):
- Focus on cycle time and transitions — seconds matter in short workouts.
- Advise on redline management: when to push and how to recognize the point of no return.
- Cue aggressive pacing from the start; there is no "settling in" phase.
- Common faults should focus on breakdown under high intensity (rushed reps, no-reps, sloppy transitions).`,

  endurance: `\n\nINTENT-SPECIFIC COACHING (Endurance / Long Time Domain):
- Focus on pacing strategy: target split times, sustainable movement patterns, breathing cadence.
- Identify fatigue indicators and when to expect them (e.g. "wall balls will slow around round 6").
- Cue movement efficiency over speed — small savings compound over many reps.
- Common faults should focus on fatigue-induced breakdown (shortened ROM, loss of rhythm, grip failure).`,

  mixed: `\n\nINTENT-SPECIFIC COACHING (Mixed Modal):
- Balance movement efficiency with transition strategy.
- Identify which movement will be the bottleneck and advise managing it.
- Cue energy system management: when to push, when to recover within the workout.
- Pacing should account for both heavy and light elements.`,

  // Skills intents
  acquisition: `\n\nINTENT-SPECIFIC COACHING (Skill Acquisition):
- Provide progressions: what to do if the athlete cannot perform the movement as written.
- Define what "good enough" looks like — the minimum standard before progressing.
- Suggest scaling options that preserve the intended stimulus and skill transfer.
- Common faults should include faults specific to the progression/scaled version, not just the full movement.`,

  practice: `\n\nINTENT-SPECIFIC COACHING (Skill Practice / Refinement):
- Target specific efficiency gains — what separates "competent" from "proficient" at this movement.
- Cue timing, rhythm, and positions that unlock the next level of performance.
- Common faults should focus on efficiency leaks, not basic errors.`,
};

function detectSessionIntent(
  blockText: string,
  blockType: string,
  athleteProfile: AthleteProfileData | null,
): SessionIntent {
  const t = blockText.toLowerCase();

  if (blockType === "strength") {
    // Assessment: max effort / testing
    if (/\b(1\s*rm|one.?rep.?max|find a heavy|build to a heavy|max effort|test\b)/.test(t)) {
      return "assessment";
    }
    // Technique: variation work with positional emphasis
    if (/\b(tempo|pause|deficit|slow eccentric|position work|eccentric|isometric)\b/.test(t)) {
      return "technique";
    }
    // Recovery: deload / light percentages
    if (/\b(deload|recovery|active rest)\b/.test(t) || /[@\s]([45][05]|5[05])%/.test(t)) {
      return "recovery";
    }
    // Default: building
    return "build";
  }

  if (blockType === "metcon") {
    // Primary signal: explicit time domain
    const amrapMatch = t.match(/amrap\s+(\d+)/);
    const capMatch = t.match(/(?:time\s*cap|cap)\s*[:=]?\s*(\d+)/);
    const emomMatch = t.match(/e(?:very\s*)?(\d+)\s*m(?:in)?(?:\s*o[ntm])?/i) || t.match(/emom\s+(\d+)/);

    const amrapMin = amrapMatch ? parseInt(amrapMatch[1]) : null;
    const capMin = capMatch ? parseInt(capMatch[1]) : null;
    const emomMin = emomMatch ? parseInt(emomMatch[1]) : null;
    const timeDomain = amrapMin ?? capMin ?? emomMin ?? null;

    if (timeDomain !== null) {
      if (timeDomain <= 7) return "sprint";
      if (timeDomain >= 15) return "endurance";
      return "mixed";
    }

    // Secondary signal: "for time" with round count as proxy
    if (/for\s+time/i.test(t)) {
      const roundMatch = t.match(/(\d+)\s*(?:rounds?|rft)/i);
      const rounds = roundMatch ? parseInt(roundMatch[1]) : null;
      if (rounds !== null && rounds <= 3) return "sprint";
      if (rounds !== null && rounds >= 7) return "endurance";
    }

    // Chipper pattern (long by nature)
    if (/chipper/i.test(t)) return "endurance";

    // Sprint keyword
    if (/\bsprint\b/i.test(t)) return "sprint";

    return "mixed";
  }

  if (blockType === "skills") {
    // Check athlete profile for skill level on movements in the block
    if (athleteProfile?.skills) {
      const skillEntries = Object.entries(athleteProfile.skills);
      for (const [skillName, level] of skillEntries) {
        const normalizedSkill = skillName.replace(/_/g, " ").toLowerCase();
        if (t.includes(normalizedSkill) && (level === "none" || level === "beginner")) {
          return "acquisition";
        }
      }
    }
    // Text signals for acquisition
    if (/\b(progression|scale|build up to|practice|drill|learn)\b/.test(t)) {
      return "acquisition";
    }
    return "practice";
  }

  return "mixed";
}

function applyIntentModifier(basePrompt: string, intent: SessionIntent): string {
  const modifier = INTENT_MODIFIERS[intent];
  return modifier ? basePrompt + modifier : basePrompt;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

// callClaude imported from _shared/call-claude.ts (retry + Haiku fallback)

function parseJSON(raw: string): Record<string, unknown> | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : raw);
  } catch {
    return null;
  }
}

/**
 * Background task: runs the heavy review pipeline (RAG + 4 parallel
 * Claude calls + parse + assemble) and updates the workout_reviews row
 * with status='complete' + review JSON, or status='failed' + error
 * message. Fired via EdgeRuntime.waitUntil so the kickoff request can
 * return immediately — the client polls workout-review-status until
 * the row hits a terminal state, sidestepping iOS Safari's 15-30s
 * fetch-drop window entirely.
 */
async function runReview(
  supa: ReturnType<typeof createClient>,
  reviewId: string,
  trimmed: string,
  sourceId: string | null,
  athleteProfile: AthleteProfileData | null,
  profileStr: string,
  recentStr: string,
): Promise<void> {
  const start = Date.now();
  console.log(`[workout-review] Job ${reviewId} start`);
  try {
    await supa
      .from("workout_reviews")
      .update({ status: "processing" })
      .eq("id", reviewId);

    const buildUserContent = (workoutSection: string): string =>
      `ATHLETE PROFILE:\n${profileStr}\n\nRECENT TRAINING (last 14 days):\n${recentStr}\n\nWORKOUT:\n${workoutSection}`;

    const sources: { title: string; author: string; source: string }[] = [];

    // Fetch pre-extracted blocks from DB (written by preprocess-program)
    let blockRows: { block_type: string; block_text: string; block_order: number }[] = [];
    if (sourceId) {
      const { data } = await supa
        .from("program_workout_blocks")
        .select("block_type, block_text, block_order")
        .eq("program_workout_id", sourceId)
        .order("block_order");
      blockRows = (data || []) as typeof blockRows;
    }

    const blockTextByType: Record<string, string> = {};
    for (const b of blockRows) {
      blockTextByType[b.block_type] = b.block_text;
    }

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

    calls.push(
      callClaude(claudeOpts(INTENT_PROMPT + intentContext, buildUserContent(fullWorkoutText), 384))
        .then((r): [string, string] => ["intent", r])
    );

    if (blockTextByType["metcon"]) {
      const metconIntent = detectSessionIntent(blockTextByType["metcon"], "metcon", athleteProfile);
      calls.push(
        stagger(500).then(() => callClaude(claudeOpts(applyIntentModifier(METCON_PROMPT, metconIntent) + journalContext, buildUserContent(blockTextByType["metcon"]), 1024)))
          .then((r): [string, string] => ["metcon", r])
      );
    }
    if (blockTextByType["strength"]) {
      const strengthIntent = detectSessionIntent(blockTextByType["strength"], "strength", athleteProfile);
      calls.push(
        stagger(1000).then(() => callClaude(claudeOpts(applyIntentModifier(STRENGTH_PROMPT, strengthIntent) + strengthContext, buildUserContent(blockTextByType["strength"]), 1024)))
          .then((r): [string, string] => ["strength", r])
      );
    }
    if (blockTextByType["skills"]) {
      const skillsIntent = detectSessionIntent(blockTextByType["skills"], "skills", athleteProfile);
      calls.push(
        stagger(1500).then(() => callClaude(claudeOpts(applyIntentModifier(SKILLS_PROMPT, skillsIntent) + journalContext, buildUserContent(blockTextByType["skills"]), 1024)))
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
      if (parsed?.block_type) {
        parsed.prescription = blockTextByType["skills"] || "";
        blocks.push(parsed);
      }
    }
    if (resultMap["strength"]) {
      const parsed = parseJSON(resultMap["strength"]);
      if (parsed?.block_type) {
        parsed.prescription = blockTextByType["strength"] || "";
        blocks.push(parsed);
      }
    }
    if (resultMap["metcon"]) {
      const parsed = parseJSON(resultMap["metcon"]);
      if (parsed?.block_type) {
        parsed.prescription = blockTextByType["metcon"] || "";
        blocks.push(parsed);
      }
    }

    const review = {
      intent: intentParsed?.intent || resultMap["intent"] || "Unable to parse intent.",
      blocks,
      sources,
    };

    await supa
      .from("workout_reviews")
      .update({
        review,
        status: "complete",
        ready_at: new Date().toISOString(),
      })
      .eq("id", reviewId);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[workout-review] Job ${reviewId} complete in ${elapsed}s`);
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[workout-review] Job ${reviewId} FAILED after ${elapsed}s:`, message);
    const { error: updateErr } = await supa
      .from("workout_reviews")
      .update({
        status: "failed",
        error: message,
        ready_at: new Date().toISOString(),
      })
      .eq("id", reviewId);
    if (updateErr) {
      console.error(`[workout-review] Failed to mark ${reviewId} as failed:`, updateErr);
    }
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
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

    const { workout_text, source_id } = await req.json();
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

    // -----------------------------------------------------------------------
    // Cache check: return existing review before any heavy data fetching
    // -----------------------------------------------------------------------
    if (source_id) {
      const { data: cached } = await supa
        .from("workout_reviews")
        .select("review")
        .eq("user_id", user.id)
        .eq("source_id", source_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cached?.review) {
        return new Response(JSON.stringify({ review: cached.review, cached: true }), {
          status: 200,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    } else {
      // Text-based cache: match on normalized workout text for manual submissions
      const { data: cached } = await supa
        .from("workout_reviews")
        .select("review")
        .eq("user_id", user.id)
        .is("source_id", null)
        .eq("workout_text", trimmed)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cached?.review) {
        return new Response(JSON.stringify({ review: cached.review, cached: true }), {
          status: 200,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch entitlements, athlete profile, and recent training in parallel
    const [profileRes, entitlementRes, athleteRes, recentTraining] = await Promise.all([
      supa.from("profiles").select("role").eq("id", user.id).single(),
      supa.from("user_entitlements").select("id")
        .eq("user_id", user.id)
        .eq("feature", "workout_review")
        .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
        .limit(1),
      supa.from("athlete_profiles").select("lifts, skills, conditioning, bodyweight, units, age, height, gender").eq("user_id", user.id).maybeSingle(),
      fetchAndFormatRecentHistory(supa, user.id, { days: 14, maxLines: 25 }),
    ]);

    const athleteProfile = athleteRes.data as AthleteProfileData | null;
    const profileStr = formatAthleteProfile(athleteProfile);
    const recentStr = recentTraining || "No recent workouts logged.";

    const isFreeTier = profileRes.data?.role !== "admin" && (!entitlementRes.data || entitlementRes.data.length === 0);

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
    // Async-job kickoff. The heavy work (RAG + 4 parallel Claude calls)
    // routinely runs 15-30s — long enough that iOS Safari abandons the
    // fetch and the client hangs on the loading screen with no signal.
    // We insert a pending row, fire the work as a background task via
    // EdgeRuntime.waitUntil, and return immediately. The client polls
    // workout-review-status until the row reaches 'complete' or 'failed'.
    // -----------------------------------------------------------------------
    const insertPayload: Record<string, unknown> = {
      user_id: user.id,
      workout_text: trimmed,
      review: null,
      status: "pending",
    };
    if (source_id) insertPayload.source_id = source_id;

    const { data: pending, error: insertErr } = await supa
      .from("workout_reviews")
      .insert(insertPayload)
      .select("id, created_at")
      .single();

    if (insertErr || !pending) {
      console.error("[workout-review] Failed to create pending row:", insertErr);
      return new Response(
        JSON.stringify({ error: "Failed to start workout review" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    EdgeRuntime.waitUntil(
      runReview(supa, pending.id, trimmed, source_id ?? null, athleteProfile, profileStr, recentStr),
    );

    return new Response(
      JSON.stringify({
        review_id: pending.id,
        status: "pending",
        created_at: pending.created_at,
      }),
      { status: 202, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});