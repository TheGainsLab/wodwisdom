/**
 * Generate a 4-week (1-month) periodized program from profile analysis.
 * Returns a job_id immediately; heavy work runs in background via EdgeRuntime.waitUntil.
 * Client polls program-job-status for completion.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  searchChunks,
  deduplicateChunks,
  formatChunksAsContext,
} from "../_shared/rag.ts";
import { fetchAndFormatRecentHistory } from "../_shared/training-history.ts";
import { rankSkillPriorities } from "../_shared/skill-priorities.ts";
import { buildSkillSchedule, formatScheduleForPrompt } from "../_shared/build-skill-schedule.ts";
import { extractBlocksFromWorkoutText } from "../_shared/parse-workout-blocks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

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

const GENERATE_PROMPT = `You are an expert CrossFit coach. Generate a 4-week (1-month) periodized program for this athlete based on their profile and analysis.

PERIODIZATION STRUCTURE:
- The program is one 4-week cycle: 3 build weeks + 1 deload week.
  - Build weeks (1-3): Progressive intensity increase each week.
  - Deload week (4): Reduce BOTH volume AND intensity. Use 55-65% loads, fewer sets, shorter metcons.
- Strength loading progression:
  - Week 1: moderate (70-75%)
  - Week 2: moderate-heavy (75-80%)
  - Week 3: heavy (80-85%)
  - Week 4 (deload): light (55-65%), reduced volume (3x3-5 instead of 5x5)

FREQUENCY & RECOVERY RULES:
- No single strength exercise more than 2x per week. Vary the barbell movements across the week (e.g. back squat Mon, front squat Thu — not back squat Mon/Wed/Fri).
- Follow the SKILL ASSIGNMENTS section exactly. Each day's Skills block must use the assigned skill. Do not substitute or skip assignments.
- Do not program heavy squats and heavy deadlifts on consecutive days. Same for pressing patterns (strict press and push press should not be back-to-back days).
- The metcon should complement the strength block, not duplicate it. If the strength block is front squats, the metcon should NOT also be thrusters and wall balls. Vary the movement patterns between blocks within a day.

WEAKNESS vs. MAINTENANCE BALANCE:
- The analysis identifies weaknesses/priorities. Address them consistently but not exclusively.
- Weakness movements: program 2x per week across the cycle.
- Strengths and maintenance movements: still program 1x per week to maintain. Do not ignore movements just because they are not a weakness.
- Distribute weakness work across all 4 weeks with progression, not just repetition.

OUTPUT FORMAT (strict):
- Use "Week 1", "Week 2", "Week 3", "Week 4" for week headers.
- Use "Monday:", "Tuesday:", etc. (or "Mon:", "Tue:", etc.) for each training day.
- Each day has exactly 5 blocks in this order. Put each block on its own line:
  1. Warm-up: (5-8 min movement prep for that day's work)
  2. Skills: (10-15 min — use the assigned skill from SKILL ASSIGNMENTS)
  3. Strength: (barbell work with percentages, e.g. 5x5 @ 75%)
  4. Metcon: (For Time, AMRAP, EMOM etc. - prescribe Rx weights)
  5. Cool down: (3-5 min mobility/stretch)
- Use exactly 5 training days per week (Monday through Friday), every week, no exceptions.
- Each block must fit on ONE line. Use commas to separate movements within a block.
- Prescribe weights using their 1RMs (e.g. 75% of back squat). Use / for M/F (e.g. 95/65).

Example format for one day (Week 1, build week):
Monday:
Warm-up: 3 rounds 400m run, 10 air squats, 5 PVC pass-throughs, 10 lunges
Skills: EMOM 10 3 kipping pull-up practice, 5s hang
Strength: Back Squat 5x5 @ 72%
Metcon: AMRAP 12 9 deadlifts 185/125, 6 bar-facing burpees, 3 rope climbs
Cool down: 2 min couch stretch each leg, 2 min child's pose

Example format for one day (Week 4, deload week):
Monday:
Warm-up: 2 rounds 200m jog, 10 air squats, 10 arm circles, 5 inchworms
Skills: 3x5 strict pull-ups, focus on control and tempo
Strength: Back Squat 3x5 @ 60%
Metcon: 3 rounds for quality (not time) 10 KB swings 53/35, 10 box step-ups, 200m row
Cool down: 3 min foam roll quads and lats, 2 min pigeon stretch each side

Output ONLY the program text. No preamble or explanation.`;

async function retrieveRAGContext(
  supa: ReturnType<typeof createClient>,
  profileData: ProfileData
): Promise<string> {
  if (!OPENAI_API_KEY) return "";

  try {
    const allChunks: import("../_shared/rag.ts").RAGChunk[] = [];
    const liftNames = profileData.lifts
      ? Object.keys(profileData.lifts).map((k) => k.replace(/_/g, " ")).join(", ")
      : "";
    const skillNames = profileData.skills
      ? Object.entries(profileData.skills)
          .filter(([, v]) => v && v !== "none")
          .map(([k]) => k.replace(/_/g, " "))
          .join(", ")
      : "";

    if (liftNames) {
      const chunks = await searchChunks(
        supa,
        `strength training programming periodization ${liftNames}`,
        "journal",
        OPENAI_API_KEY,
        3,
        0.25
      );
      allChunks.push(...chunks);
    }
    if (skillNames) {
      const chunks = await searchChunks(
        supa,
        `CrossFit gymnastics skill progression ${skillNames}`,
        "journal",
        OPENAI_API_KEY,
        3,
        0.25
      );
      allChunks.push(...chunks);
    }
    const chunks = await searchChunks(
      supa,
      "CrossFit conditioning engine metcon programming",
      "journal",
      OPENAI_API_KEY,
      3,
      0.25
    );
    allChunks.push(...chunks);

    // Strength Science: evidence-based load prescription, periodization for barbell block
    const strengthScienceChunks = await searchChunks(
      supa,
      liftNames ? `strength programming periodization load prescription ${liftNames}` : "strength programming periodization load prescription squat deadlift",
      "strength-science",
      OPENAI_API_KEY,
      2,
      0.25
    );
    allChunks.push(...strengthScienceChunks);

    const unique = deduplicateChunks(allChunks);
    if (unique.length === 0) return "";

    return "\n\nREFERENCE (Journal and Strength Science — use to ground programming):\n" + formatChunksAsContext(unique, 8);
  } catch (err) {
    console.error("RAG retrieval error:", err);
    return "";
  }
}

/** Background task: generate program and update job row */
async function processJob(
  jobId: string,
  userId: string,
  authHeader: string,
  evalRow: {
    profile_snapshot: ProfileData;
    lifting_analysis: string | null;
    skills_analysis: string | null;
    engine_analysis: string | null;
  }
): Promise<void> {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Mark processing
    await supa.from("program_jobs").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", jobId);

    const profile = evalRow.profile_snapshot || {};
    const profileStr = formatProfile(profile);
    const analysisParts: string[] = [];
    if (evalRow.lifting_analysis) analysisParts.push("STRENGTH ANALYSIS:\n" + evalRow.lifting_analysis);
    if (evalRow.skills_analysis) analysisParts.push("SKILLS ANALYSIS:\n" + evalRow.skills_analysis);
    if (evalRow.engine_analysis) analysisParts.push("ENGINE ANALYSIS:\n" + evalRow.engine_analysis);
    const analysisStr = analysisParts.length > 0 ? analysisParts.join("\n\n") : "No detailed analysis.";

    // Fetch gymnastics movements for priority scoring
    const { data: movementRows } = await supa
      .from("movements")
      .select("canonical_name, display_name, modality, category, aliases, competition_count")
      .eq("modality", "G");

    // Build deterministic skill schedule
    const priorities = rankSkillPriorities(profile.skills || {}, movementRows || []);
    const schedule = buildSkillSchedule(priorities);
    const scheduleBlock = schedule.length > 0
      ? `\n\nSKILL ASSIGNMENTS (mandatory — each day's Skills block MUST use the assigned skill):\n${formatScheduleForPrompt(schedule)}\n\nFor each Skills block, write a 10-15 min progression appropriate for the athlete's level with that skill. Vary the format (EMOM, sets, practice + hold, etc.). Progress difficulty across weeks within each 3-week build block. On deload weeks, reduce skill volume (lighter sets, focus on quality).`
      : "";

    const recentTraining = await fetchAndFormatRecentHistory(supa, userId, { maxLines: 25 });
    const trainingBlock = recentTraining ? `\n\n${recentTraining}` : "";

    const ragContext = await retrieveRAGContext(supa, profile);

    const userPrompt = `ATHLETE PROFILE:
${profileStr}

ANALYSIS TO ADDRESS:
${analysisStr}
${trainingBlock}${scheduleBlock}

Generate a 4-week program (20 workouts total: 5 days x 4 weeks). Follow the format and periodization rules exactly.`;

    const systemPrompt = GENERATE_PROMPT + ragContext;

    if (!ANTHROPIC_API_KEY) {
      throw new Error("Program generation is not configured");
    }

    const MAX_ATTEMPTS = 3;
    const preprocessUrl = `${SUPABASE_URL}/functions/v1/preprocess-program`;
    const monthYear = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const programName = `Month 1 — ${monthYear}`;

    let program_id: string | undefined;
    let workout_count: number | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          stream: false,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (!claudeResp.ok) {
        const err = await claudeResp.json().catch(() => ({}));
        console.error("Claude API error:", err);
        throw new Error("Failed to generate program");
      }

      const claudeData = await claudeResp.json();
      let programText =
        claudeData.content?.[0]?.text?.trim() || claudeData.content?.[0]?.input?.trim() || "";

      // Strip markdown code blocks if present
      const codeMatch = programText.match(/```(?:text)?\s*\n?([\s\S]*?)```/);
      if (codeMatch) programText = codeMatch[1].trim();

      if (!programText || programText.length < 100) {
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`Attempt ${attempt}: program too short, retrying...`);
          continue;
        }
        throw new Error("Generated program was empty or too short");
      }

      // Validate skill assignments compliance (logging only)
      if (schedule.length > 0) {
        const dayPattern = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Mon|Tue|Wed|Thu|Fri|Sat):/gi;
        const workoutTexts = programText.split(dayPattern).filter((t) => t.trim().length > 20);
        let matched = 0;
        let total = 0;
        for (const slot of schedule) {
          total++;
          const idx = (slot.week - 1) * 5 + (slot.day - 1);
          const workoutText = workoutTexts[idx];
          if (!workoutText) continue;
          const blocks = extractBlocksFromWorkoutText(workoutText);
          const skillBlock = blocks.find((b) => b.block_type === "skills");
          if (!skillBlock) continue;
          const display = slot.displayName.toLowerCase();
          const blockLower = skillBlock.block_text.toLowerCase();
          const keywords = display.split(/[\s\-()]+/).filter((w) => w.length > 2);
          const found = keywords.some((kw) => blockLower.includes(kw));
          if (found) matched++;
        }
        const complianceRate = total > 0 ? matched / total : 1;
        console.log(`Skill schedule compliance: ${matched}/${total} (${(complianceRate * 100).toFixed(0)}%)`);
      }

      // Create program via preprocess-program
      const preprocessResp = await fetch(preprocessUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ text: programText, name: programName, source: "generate" }),
      });

      if (!preprocessResp.ok) {
        const errBody = await preprocessResp.text();
        let errMsg = "Failed to save program";
        try {
          const errJson = JSON.parse(errBody);
          if (errJson?.error) errMsg = errJson.error;
        } catch {
          // use default
        }

        // Retry on workout count mismatch (422), otherwise fail immediately
        if (preprocessResp.status === 422 && attempt < MAX_ATTEMPTS) {
          console.warn(`Attempt ${attempt}: ${errMsg}, retrying...`);
          continue;
        }
        throw new Error(errMsg);
      }

      const result = await preprocessResp.json();
      program_id = result.program_id;
      workout_count = result.workout_count;
      break;
    }

    if (!program_id) {
      throw new Error("Failed to generate program after all attempts");
    }

    // Mark complete
    await supa.from("program_jobs").update({
      status: "complete",
      program_id,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    console.log(`Job ${jobId} complete: program_id=${program_id}, workouts=${workout_count}`);
  } catch (e) {
    console.error(`Job ${jobId} failed:`, e);
    try {
      await supa.from("program_jobs").update({
        status: "failed",
        error: (e as Error).message,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
    } catch { /* ignore cleanup errors */ }
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

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let evaluationId: string | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      evaluationId = body?.evaluation_id ?? null;
    } catch {
      // no body
    }

    // Fetch evaluation: use provided id, or most recent
    let evalRow: {
      profile_snapshot: ProfileData;
      lifting_analysis: string | null;
      skills_analysis: string | null;
      engine_analysis: string | null;
    } | null = null;

    if (evaluationId) {
      const { data } = await supa
        .from("profile_evaluations")
        .select("profile_snapshot, lifting_analysis, skills_analysis, engine_analysis")
        .eq("id", evaluationId)
        .eq("user_id", user.id)
        .maybeSingle();
      evalRow = data;
    }

    if (!evalRow) {
      const { data } = await supa
        .from("profile_evaluations")
        .select("profile_snapshot, lifting_analysis, skills_analysis, engine_analysis")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      evalRow = data;
    }

    if (!evalRow) {
      return new Response(
        JSON.stringify({ error: "No profile analysis found. Run AI analysis first, then generate program." }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Program generation is not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Create job row
    const { data: job, error: jobErr } = await supa
      .from("program_jobs")
      .insert({ user_id: user.id, status: "pending" })
      .select("id")
      .single();

    if (jobErr || !job) {
      console.error("Failed to create job:", jobErr);
      return new Response(
        JSON.stringify({ error: "Failed to start program generation" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Fire background task — isolate stays alive up to 400s on Pro
    EdgeRuntime.waitUntil(processJob(job.id, user.id, authHeader, evalRow));

    // Return immediately with job_id
    return new Response(
      JSON.stringify({ job_id: job.id }),
      { status: 202, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-program error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
