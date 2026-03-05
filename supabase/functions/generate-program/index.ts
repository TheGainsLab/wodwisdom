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
import { buildSkillSchedule } from "../_shared/build-skill-schedule.ts";
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
/* ------------------------------------------------------------------ */
/*  SYSTEM PROMPT — coherence guardrails only, no methodology         */
/* ------------------------------------------------------------------ */
const GENERATE_PROMPT = `Generate a 4-week training program for the athlete described below.
Use the REFERENCE material to guide all programming decisions — periodization approach, loading schemes, skill progressions, metcon design, and deload strategy.
PROGRAM COHERENCE RULES:
- No single strength exercise more than 2x per week. Vary barbell movements across the week (e.g. back squat Mon, front squat Thu — not back squat Mon/Wed/Fri).
- Do not program heavy squats and heavy deadlifts on consecutive days. Same for pressing patterns (strict press and push press should not be back-to-back days).
- Weakness movements: program 2x per week across the cycle.
- Strengths and maintenance movements: still program 1x per week. Do not ignore movements just because they are not a weakness.
- Distribute weakness work across all 4 weeks with progression, not just repetition.
OUTPUT RULES:
- Complete every block in the template provided. One line per block.
- Do not add, remove, or reorder any headers.
- Prescribe weights using the athlete's 1RMs where applicable. Use / for M/F Rx (e.g. 95/65).`;
/* ------------------------------------------------------------------ */
/*  SKELETON BUILDER — full 20-day template with inline skill assigns */
/* ------------------------------------------------------------------ */
function buildProgramSkeleton(
  schedule: Array<{ week: number; day: number; displayName: string }>
): string {
const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const lines: string[] = [];
// Index skill assignments for fast lookup: "week-day" -> displayName
const skillMap = new Map<string, string>();
for (const slot of schedule) {
    skillMap.set(`${slot.week}-${slot.day}`, slot.displayName);
}
for (let week = 1; week <= 4; week++) {
    lines.push(`Week ${week}`);
for (let day = 1; day <= 5; day++) {
const skill = skillMap.get(`${week}-${day}`) || "coach's choice";
      lines.push(`${dayNames[day - 1]}:`);
      lines.push(`Warm-up: `);
      lines.push(`[skill: ${skill}]`);
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
    console.log(`[RAG] Searching with lifts="${liftNames}", skills="${skillNames}"`);
if (liftNames) {
const chunks = await searchChunks(
        supa,
`strength training programming periodization ${liftNames}`,
"journal",
OPENAI_API_KEY,
3,
0.25
);
      console.log(`[RAG] journal/strength: ${chunks.length} chunks`);
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
      console.log(`[RAG] journal/skills: ${chunks.length} chunks`);
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
    console.log(`[RAG] journal/conditioning: ${chunks.length} chunks`);
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
    console.log(`[RAG] strength-science: ${strengthScienceChunks.length} chunks`);
    allChunks.push(...strengthScienceChunks);
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
if (evalRow.engine_analysis) analysisParts.push("ENGINE ANALYSIS:\n" + evalRow.engine_analysis);
const analysisStr = analysisParts.length > 0 ? analysisParts.join("\n\n") : "No detailed analysis.";
    console.log(`[${jobId}] Analysis sections: lifting=${!!evalRow.lifting_analysis}, skills=${!!evalRow.skills_analysis}, engine=${!!evalRow.engine_analysis}, total=${analysisStr.length} chars`);
// Fetch gymnastics movements for priority scoring
const { data: movementRows } = await supa
.from("movements")
.select("canonical_name, display_name, modality, category, aliases, competition_count")
.eq("modality", "G");
// Build deterministic skill schedule
const priorities = rankSkillPriorities(profile.skills || {}, movementRows || []);
const schedule = buildSkillSchedule(priorities);
    console.log(`[${jobId}] Skill schedule: ${schedule.length} slots, priorities=${priorities.length}, movements_fetched=${(movementRows || []).length}`);
const recentTraining = await fetchAndFormatRecentHistory(supa, userId, { maxLines: 25 });
const trainingBlock = recentTraining ? `\n\n${recentTraining}` : "";
    console.log(`[${jobId}] Training history: ${recentTraining ? recentTraining.length + ' chars' : 'none'}`);
const ragContext = await retrieveRAGContext(supa, profile);
    console.log(`[${jobId}] RAG context: ${ragContext ? ragContext.length + ' chars' : 'none'}`);
// Build skeleton with inline skill assignments
const skeleton = buildProgramSkeleton(schedule);
    console.log(`[${jobId}] Skeleton: ${skeleton.length} chars, ${(skeleton.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday):/gm) || []).length} day headers`);
const userPrompt = `ATHLETE PROFILE:
${profileStr}
ANALYSIS TO ADDRESS:
${analysisStr}
${trainingBlock}
Complete the following program template. Fill in every block with one line of programming. Do not add or remove any headers.
${skeleton}`;
const systemPrompt = GENERATE_PROMPT + ragContext;
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

// Strip skill assignment annotations that the AI may echo back
programText = programText.replace(/\[skill:\s*[^\]]+\]\s*/gi, "");

const stopReason = claudeData.stop_reason || "unknown";
const dayHeaders = (programText.match(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Mon|Tue|Wed|Thu|Fri)\s*:/gmi) || []);
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
// Wrong day count — retry with specific correction
if (dayHeaders.length < 20) {
if (attempt < MAX_ATTEMPTS) {
          console.warn(`[${jobId}] Attempt ${attempt}: only ${dayHeaders.length}/20 days, retrying with correction...`);
          messages.push({ role: "assistant", content: programText });
          messages.push({ role: "user", content: `That program only contained ${dayHeaders.length} days. It must have exactly 20 days (Monday–Friday for all 4 weeks). Please output the complete program with all 20 days.` });
continue;
}
throw new Error(`Program contained ${dayHeaders.length}/20 days after ${MAX_ATTEMPTS} attempts`);
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
else console.log(`[${jobId}] Skill mismatch W${slot.week}D${slot.day}: expected="${slot.displayName}", got="${skillBlock.block_text.slice(0, 80)}"`);
}
const complianceRate = total > 0 ? matched / total : 1;
        console.log(`[${jobId}] Skill schedule compliance: ${matched}/${total} (${(complianceRate * 100).toFixed(0)}%)`);
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
if (preprocessResp.status === 422 && attempt < MAX_ATTEMPTS) {
          console.warn(`[${jobId}] Attempt ${attempt} failed 422: ${errMsg}, days=${dayHeaders.length}, head=${programText.slice(0, 150)}, tail=${programText.slice(-150)}`);
          messages.push({ role: "assistant", content: programText });
          messages.push({ role: "user", content: `That program failed validation: ${errMsg}. Please output the complete program with exactly 20 days (Monday–Friday for all 4 weeks), filling in every block of the template.` });
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
