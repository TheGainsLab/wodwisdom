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
import { SKILL_DISPLAY_NAMES } from "../_shared/skill-priorities.ts";
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
/* ------------------------------------------------------------------ */
/*  Fetch active coaching guidelines from DB                          */
/* ------------------------------------------------------------------ */
async function fetchCoachingGuidelines(
  supa: ReturnType<typeof createClient>,
  scopes: string[] = ["all"]
): Promise<string> {
  const { data, error } = await supa
    .from("coaching_guidelines")
    .select("guideline_text")
    .in("category", ["strength", "metcon"])
    .eq("is_active", true)
    .in("scope", scopes)
    .order("priority", { ascending: false });
  if (error) {
    console.error("Failed to fetch coaching guidelines:", error);
    return "";
  }
  if (!data || data.length === 0) return "";
  return "\n\nCOACHING GUIDELINES:\n" +
    data.map((r: { guideline_text: string }) => `- ${r.guideline_text}`).join("\n");
}
/* ------------------------------------------------------------------ */
/*  SYSTEM PROMPT — coherence guardrails only, no methodology         */
/* ------------------------------------------------------------------ */
const GENERATE_PROMPT = `Generate a 4-week training program for the athlete described below.
Use the REFERENCE material and COACHING GUIDELINES below to guide all programming decisions — periodization approach, loading schemes, skill progressions, metcon design, and deload strategy.
OUTPUT RULES:
- Complete every block in the template provided. One line per block.
- Do not add, remove, or reorder any headers.
- Prescribe weights using the athlete's 1RMs where applicable. Use / for M/F Rx (e.g. 95/65).`;

const METCON_GUIDANCE = `

METCON DESIGN RULES (apply to every Metcon: block):

1. BREADTH OVER WEAKNESS — Metcons draw from movements the athlete is PROFICIENT at (intermediate or advanced). Weaknesses and developing skills belong in the Skills block, not the Metcon. If the athlete is advanced at ring muscle-ups, use them in metcons. If the athlete is beginner at HSPU, never put HSPU in a metcon — that stays in the skill block. See the METCON MOVEMENT ELIGIBILITY section for the explicit lists.

2. MONOSTRUCTURAL CAP — Across the 5 metcons in any single week, at most 2 may include a monostructural cardio element (row, bike, ski erg, run — any of these count). This is a hard cap. Weeks 1-4 each independently enforce this limit.

3. LOADING PREFERENCES — When a metcon calls for a weighted movement, prefer barbells and dumbbells over kettlebells. Kettlebells are acceptable when the movement is inherently KB-based (e.g., Turkish get-ups, KB swings) but do not substitute KBs for movements that can use a barbell or dumbbell.

4. TIME DOMAIN DISTRIBUTION (per week) — Assign a target time domain to each metcon:
   - Short: sub-8 minutes
   - Medium: 8-15 minutes
   - Long: 15+ minutes
   Each week must include at least 1 short, 1 medium, and 1 long metcon. No single category may appear more than 3 times in one week. Design the rep schemes, round counts, and movement complexity to fit the target time domain.

5. COMPLEMENT THE STRENGTH BLOCK — If a day's Strength block is squat-dominant, the Metcon must NOT be squat-dominant. If Strength is pressing, the Metcon should not be press-heavy. The metcon should use complementary movement patterns to avoid overloading the same muscle groups.`;
/* ------------------------------------------------------------------ */
/*  SKELETON BUILDER — full 20-day template                           */
/* ------------------------------------------------------------------ */
function buildProgramSkeleton(): string {
  const lines: string[] = [];
  for (let week = 1; week <= 4; week++) {
    lines.push(`Week ${week}`);
    for (let day = 1; day <= 5; day++) {
      const dayNum = (week - 1) * 5 + day;
      lines.push(`Day ${dayNum}:`);
      lines.push(`Warm-up: `);
      lines.push(`Skills: `);
      lines.push(`Strength: `);
      lines.push(`Metcon: `);
      lines.push(`Cool down: `);
      lines.push(``);
    }
  }
  return lines.join("\n");
}
async function retrieveRAGContext(
  supa: ReturnType<typeof createClient>,
  profileData: ProfileData
): Promise<string> {
  if (!OPENAI_API_KEY) return "";
  try {
    const liftNames = profileData.lifts
      ? Object.keys(profileData.lifts).map((k) => k.replace(/_/g, " ")).join(", ")
      : "";
    const skillNames = profileData.skills
      ? Object.entries(profileData.skills)
          .filter(([, v]) => v && v !== "none")
          .map(([k]) => k.replace(/_/g, " "))
          .join(", ")
      : "";
    console.log(`[RAG] Searching with lifts="${liftNames}", skills="${skillNames}"`);
    // FIX 8: Run all searches in parallel
    const queries: Promise<import("../_shared/rag.ts").RAGChunk[]>[] = [];
    if (liftNames) {
      queries.push(
        searchChunks(supa, `strength training programming periodization ${liftNames}`, "journal", OPENAI_API_KEY, 3, 0.25)
      );
    }
    if (skillNames) {
      queries.push(
        searchChunks(supa, `CrossFit gymnastics skill progression ${skillNames}`, "journal", OPENAI_API_KEY, 3, 0.25)
      );
    }
    queries.push(
      searchChunks(supa, "CrossFit conditioning engine metcon programming", "journal", OPENAI_API_KEY, 3, 0.25)
    );
    queries.push(
      searchChunks(
        supa,
        liftNames
          ? `strength programming periodization load prescription ${liftNames}`
          : "strength programming periodization load prescription squat deadlift",
        "strength-science",
        OPENAI_API_KEY,
        2,
        0.25
      )
    );
    const results = await Promise.all(queries);
    const allChunks = results.flat();
    // Log individual counts in the same order as queries were pushed
    let i = 0;
    if (liftNames) console.log(`[RAG] journal/strength: ${results[i++].length} chunks`);
    if (skillNames) console.log(`[RAG] journal/skills: ${results[i++].length} chunks`);
    console.log(`[RAG] journal/conditioning: ${results[i++].length} chunks`);
    console.log(`[RAG] strength-science: ${results[i++].length} chunks`);
    const unique = deduplicateChunks(allChunks);
    console.log(`[RAG] Total: ${allChunks.length} raw → ${unique.length} deduplicated`);
    if (unique.length === 0) return "";
    return "\n\nREFERENCE (use to guide all programming decisions):\n" + formatChunksAsContext(unique, 8);
  } catch (err) {
    console.error("RAG retrieval error:", err);
    return "";
  }
}
/** Background task: generate program and update job row */
async function processJob(
  jobId: string,
  userId: string,
  evalRow: {
    profile_snapshot: ProfileData;
    lifting_analysis: string | null;
    skills_analysis: string | null;
    engine_analysis: string | null;
  }
): Promise<void> {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log(`=== Job ${jobId} start ===`);
  const jobStart = Date.now();
  try {
    // Mark processing
    await supa.from("program_jobs").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", jobId);
    const profile = evalRow.profile_snapshot || {};
    const profileStr = formatProfile(profile);
    console.log(`[${jobId}] Profile: ${profileStr.length} chars, lifts=${Object.keys(profile.lifts || {}).length}, skills=${Object.keys(profile.skills || {}).length}`);
    const analysisParts: string[] = [];
    if (evalRow.lifting_analysis) analysisParts.push("STRENGTH ANALYSIS:\n" + evalRow.lifting_analysis);
    if (evalRow.skills_analysis) analysisParts.push("SKILLS ANALYSIS:\n" + evalRow.skills_analysis);
    // Engine analysis intentionally excluded — it causes the LLM to stuff row/run into every metcon
    const analysisStr = analysisParts.length > 0 ? analysisParts.join("\n\n") : "No detailed analysis.";
    console.log(`[${jobId}] Analysis sections: lifting=${!!evalRow.lifting_analysis}, skills=${!!evalRow.skills_analysis}, engine=${!!evalRow.engine_analysis}, total=${analysisStr.length} chars`);
    const recentTraining = await fetchAndFormatRecentHistory(supa, userId, { maxLines: 25 });
    const trainingBlock = recentTraining ? `\n\n${recentTraining}` : "";
    console.log(`[${jobId}] Training history: ${recentTraining ? recentTraining.length + ' chars' : 'none'}`);
    const ragContext = await retrieveRAGContext(supa, profile);
    console.log(`[${jobId}] RAG context: ${ragContext ? ragContext.length + ' chars' : 'none'}`);
    // Determine athlete scope for guideline filtering
    const scopes = ["all"];
    if (profile.skills) {
      const levels = Object.values(profile.skills).filter((v) => v && v !== "none");
      const developing = levels.filter((v) => /developing|beginner|learning/i.test(v)).length;
      const advanced = levels.filter((v) => /advanced|competition|elite/i.test(v)).length;
      if (developing > advanced) scopes.push("beginner");
      else if (advanced > 0) scopes.push("competition");
    }
    console.log(`[${jobId}] Guideline scopes: [${scopes.join(", ")}]`);
    // Fetch strength guidelines from coaching_guidelines table
    const guidelinesBlock = await fetchCoachingGuidelines(supa, scopes);
    console.log(`[${jobId}] Guidelines: ${guidelinesBlock ? guidelinesBlock.length + ' chars' : 'none'}`);
    const skeleton = buildProgramSkeleton();
    console.log(`[${jobId}] Skeleton: ${skeleton.length} chars, ${(skeleton.match(/^Day \d+:/gm) || []).length} day headers`);
    // Derive metcon-eligible vs skill-block-only movements
    const proficientSkills: string[] = [];
    const developingSkills: string[] = [];
    if (profile.skills) {
      for (const [key, level] of Object.entries(profile.skills)) {
        const display = SKILL_DISPLAY_NAMES[key] || key.replace(/_/g, " ");
        if (level === "advanced" || level === "intermediate") {
          proficientSkills.push(display);
        } else if (level && level !== "none") {
          developingSkills.push(display);
        }
      }
    }
    const metconEligibility = proficientSkills.length > 0 || developingSkills.length > 0
      ? `\nMETCON MOVEMENT ELIGIBILITY:\n- Use in metcons (proficient): ${proficientSkills.join(", ") || "none"}\n- Skill block only (developing): ${developingSkills.join(", ") || "none"}\n`
      : "";
    const userPrompt = `ATHLETE PROFILE:
${profileStr}

${analysisStr}
${trainingBlock}${metconEligibility}
STRENGTH SLOT RULES:
The STRENGTH HIERARCHY above (if present) dictates priority, but you MUST also ensure movement-pattern diversity across the 5 weekly Strength slots.

MOVEMENT PATTERN DISTRIBUTION (per week):
- Olympic lifts (snatch variants, clean variants, jerks): 2 slots max per week. Alternate snatch-family and clean-family days.
- Squat (back squat, front squat, overhead squat): 1-2 slots per week. Rotate variants across weeks — do not repeat the same squat variant in the same week.
- Press (strict press, push press, bench press, push jerk): 1 slot per week minimum. Every athlete needs pressing volume.
- Hinge/Pull (deadlift, RDL, clean pull, snatch pull): 1 slot per week minimum. Posterior chain work is non-negotiable.
- If the athlete provided a lift, try to include it at least once across the 4-week program — but not at the expense of cluttering weeks. LOW priority lifts can be omitted if slots are tight.
- A movement flagged as a mobility limiter in the STRENGTH ANALYSIS (e.g. overhead squat limited by ankle/thoracic mobility) is accessory or warm-up work — it does NOT fulfill a movement-pattern slot. Program it as light technique work alongside the day's main lift, not as the Strength block's primary movement.

PRIORITY RULES (within the pattern constraints above):
- HIGH priority movements get 2+ slots per week. These are the athlete's limiters — give them the most volume.
- MODERATE priority movements get 1 slot per week.
- LOW priority movements get 0-1 slots per week. Do NOT waste training time on movements the athlete is already strong at.
- Follow the hierarchy ordering strictly. If the hierarchy says deadlift is LOW, do not program heavy deadlifts twice a week.
- Vary the specific exercises within a movement pattern across weeks (e.g. for "olympic lifts": clean & jerk one day, snatch complex another).

SKILL SLOT RULES:
Use the SKILLS ANALYSIS above to decide what goes in each day's Skills: block. You are the coach — distribute skills intelligently across 20 days.
- "Needs Attention" skills are the highest priority. Program them 2-3x per week. These are the athlete's limiters.
- "Intermediate" skills get 1-2x per week to keep progressing.
- "Strong" skills are maintenance only — 0-1x per week or use them as metcon components instead.
- Never program the same skill on consecutive days (e.g. not Day 3 and Day 4).
- Related progressions are a single track, not separate skills. For example: strict HSPU, wall-facing HSPU, and deficit HSPU are one progression — pick the variant that matches the athlete's level and periodize across weeks (drill → load → test), don't scatter all three randomly.
- Week 4 is deload — reduce skill volume, keep only the top 1-2 priority skills at 1x each.
- Vary the drill, not just the movement. If L-sit appears 3x in a week, each session should have a different focus (e.g. tuck hold for time, single-leg extension, parallette L-sit).

Complete the following program template. Fill in every block with one line of programming. Do not add or remove any headers.
${skeleton}`;
    const systemPrompt = GENERATE_PROMPT + METCON_GUIDANCE + guidelinesBlock + ragContext;
    console.log(`[${jobId}] Prompt sizes: system=${systemPrompt.length} chars, user=${userPrompt.length} chars`);
    if (!ANTHROPIC_API_KEY) {
      throw new Error("Program generation is not configured");
    }
    const MAX_ATTEMPTS = 3;
    const preprocessUrl = `${SUPABASE_URL}/functions/v1/preprocess-program`;
    const monthYear = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const programName = `Month 1 — ${monthYear}`;
    let program_id: string | undefined;
    let workout_count: number | undefined;
    const messages: Array<{ role: string; content: string }> = [
      { role: "user", content: userPrompt },
    ];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[${jobId}] Attempt ${attempt}/${MAX_ATTEMPTS}: sending ${messages.length} messages to Claude...`);
      const apiStart = Date.now();
      const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 32000,
          stream: false,
          system: systemPrompt,
          messages,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const apiElapsed = ((Date.now() - apiStart) / 1000).toFixed(1);
      if (!claudeResp.ok) {
        const err = await claudeResp.json().catch(() => ({}));
        console.error(`[${jobId}] Attempt ${attempt}: Claude API error after ${apiElapsed}s, status=${claudeResp.status}:`, JSON.stringify(err));
        throw new Error("Failed to generate program");
      }
      const claudeData = await claudeResp.json();
      const inputTokens = claudeData.usage?.input_tokens || 0;
      const outputTokens = claudeData.usage?.output_tokens || 0;
      let programText =
        claudeData.content?.[0]?.text?.trim() || claudeData.content?.[0]?.input?.trim() || "";
      // Strip markdown code blocks if present
      const codeMatch = programText.match(/```(?:text)?\s*\n?([\s\S]*?)```/);
      if (codeMatch) programText = codeMatch[1].trim();
      const stopReason = claudeData.stop_reason || "unknown";
      // FIX 2: dayHeaders regex uses Day N:
      const dayHeaders = (programText.match(/^Day \d+:/gmi) || []);
      // Count blocks per type for diagnostics
      const warmupCount = (programText.match(/^Warm-up:/gmi) || []).length;
      const skillsCount = (programText.match(/^Skills:/gmi) || []).length;
      const strengthCount = (programText.match(/^Strength:/gmi) || []).length;
      const metconCount = (programText.match(/^Metcon:/gmi) || []).length;
      const cooldownCount = (programText.match(/^Cool\s*down:/gmi) || []).length;
      console.log(`[${jobId}] Attempt ${attempt}: ${apiElapsed}s, stop=${stopReason}, tokens=${inputTokens}in/${outputTokens}out, chars=${programText.length}, days=${dayHeaders.length}, blocks=[warmup=${warmupCount},skills=${skillsCount},strength=${strengthCount},metcon=${metconCount},cooldown=${cooldownCount}]`);
      if (dayHeaders.length > 0) {
        console.log(`[${jobId}] Attempt ${attempt} head: ${programText.slice(0, 200)}`);
        console.log(`[${jobId}] Attempt ${attempt} tail: ${programText.slice(-200)}`);
      }
      // Too short — retry with context
      if (!programText || programText.length < 100) {
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[${jobId}] Attempt ${attempt}: program too short (${programText.length} chars), retrying with correction...`);
          messages.push({ role: "assistant", content: programText || "(empty)" });
          messages.push({ role: "user", content: "That output was too short or empty. Please generate the complete program filling in every block of the template." });
          continue;
        }
        throw new Error("Generated program was empty or too short");
      }
      // FIX 4: Wrong day count retry message updated
      if (dayHeaders.length < 20) {
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[${jobId}] Attempt ${attempt}: only ${dayHeaders.length}/20 days, retrying with correction...`);
          messages.push({ role: "assistant", content: programText });
          messages.push({ role: "user", content: `That program only contained ${dayHeaders.length} days. It must have exactly 20 days (Day 1 through Day 20). Please output the complete program with all 20 days.` });
          continue;
        }
        throw new Error(`Program contained ${dayHeaders.length}/20 days after ${MAX_ATTEMPTS} attempts`);
      }
      // Create program via preprocess-program (service-role auth, user_id in body)
      console.log(`[${jobId}] Sending to preprocess-program: ${programText.length} chars, name="${programName}"`);
      const preprocessResp = await fetch(preprocessUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ text: programText, name: programName, source: "generate", user_id: userId }),
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
        console.error(`[${jobId}] Preprocess failed: status=${preprocessResp.status}, error="${errMsg}"`);
        // FIX 5: 422 retry message updated
        if (preprocessResp.status === 422 && attempt < MAX_ATTEMPTS) {
          console.warn(`[${jobId}] Attempt ${attempt} failed 422: ${errMsg}, days=${dayHeaders.length}, head=${programText.slice(0, 150)}, tail=${programText.slice(-150)}`);
          messages.push({ role: "assistant", content: programText });
          messages.push({ role: "user", content: `That program failed validation: ${errMsg}. Please output the complete program with exactly 20 days (Day 1 through Day 20), filling in every block of the template.` });
          continue;
        }
        throw new Error(errMsg);
      }
      const result = await preprocessResp.json();
      program_id = result.program_id;
      workout_count = result.workout_count;
      console.log(`[${jobId}] Preprocess success: program_id=${program_id}, workout_count=${workout_count}`);
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
    console.log(`[${jobId}] Complete: program_id=${program_id}, workouts=${workout_count}, elapsed=${((Date.now() - jobStart) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(`[${jobId}] FAILED after ${((Date.now() - jobStart) / 1000).toFixed(1)}s:`, e);
    try {
      await supa.from("program_jobs").update({
        status: "failed",
        error: (e as Error).message,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
    } catch (cleanupErr) { console.warn("Failed to update job as failed:", cleanupErr); }
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
    // Fire background task — no user token needed, uses service-role key
    EdgeRuntime.waitUntil(processJob(job.id, user.id, evalRow));
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
