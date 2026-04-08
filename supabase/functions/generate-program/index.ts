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
import { getCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
interface ProfileData {
  lifts?: Record<string, number> | null;
  skills?: Record<string, string> | null;
  conditioning?: Record<string, string | number> | null;
  equipment?: Record<string, boolean> | null;
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
  if (profile.equipment && Object.keys(profile.equipment).length > 0) {
    const unavailable = Object.entries(profile.equipment)
      .filter(([, v]) => v === false)
      .map(([k]) => k.replace(/_/g, " "));
    if (unavailable.length > 0) {
      parts.push("Equipment NOT available — " + unavailable.join(", "));
    }
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
- Complete every block in the template provided.
- Format EVERY block as MULTI-LINE text — NEVER use commas to join movements on one line. This applies to ALL blocks: Warm-up, Mobility, Skills, Strength, Metcon, and Cool down.
  • First line after the header: the format or scheme ONLY (e.g. "3 Rounds For Time:", "EMOM 12 min:", "5×3 @75%"). Do NOT put a movement on this line.
  • Following lines: one movement or drill per line. Each movement gets its own line.
  • Last line (if applicable): notes, rest periods, target time, or scaling.

FORMATTING EXAMPLES (follow these exactly):
  BAD — never do this:
    Warm-up: 400m row, 10 pass-throughs, 10 air squats, hip circles
    Mobility: 90/90 switches, couch stretch 1 min/side
    Metcon: 5 RFT: 10 Box Jump Overs 30/24, 8 HSPU
  GOOD — always do this:
    Warm-up:
    400m row
    10 pass-throughs
    10 air squats
    hip circles

    Mobility:
    90/90 switches
    couch stretch 1 min/side

    Metcon:
    5 RFT:
    10 Box Jump Overs 30/24
    8 HSPU
- Each block header (Warm-up:, Mobility:, Skills:, Strength:, Metcon:, Cool down:) MUST appear on its own line starting at position 0. Never nest one block inside another. Content lines for a block go on the lines BELOW its header.
- Warm-up: and Mobility: are SEPARATE blocks. Do NOT put mobility content inside the Warm-up block. Warm-up is general preparation; Mobility is targeted drills on a separate line.
- Do not add, remove, or reorder any headers.
- Prescribe weights using the athlete's 1RMs where applicable. Use / for M/F Rx (e.g. 95/65).
- Metcon examples in the REFERENCE section are real CrossFit workouts. Use them for structural inspiration only — adapt to the athlete's profile and eligibility rules, never copy verbatim.`;

const METCON_GUIDANCE = `

METCON DESIGN RULES (apply to every Metcon: block):

1. BREADTH OVER WEAKNESS — Metcons draw from movements the athlete is PROFICIENT at (intermediate or advanced). Weaknesses and developing skills belong in the Skills block, not the Metcon. If the athlete is advanced at ring muscle-ups, use them in metcons. If the athlete is beginner at HSPU, never put HSPU in a metcon — that stays in the skill block. See the METCON MOVEMENT ELIGIBILITY section for the explicit lists. FREQUENCY CAP: No single movement may appear in more than 6 of the 20 metcons across the program. Spread variety — if you reach 6 uses, pick a different movement.

2. MONOSTRUCTURAL CAP — Across the 5 metcons in any single week, at most 2 may include a monostructural cardio element (row, bike, ski erg, run — any of these count). This is a hard cap. Weeks 1-4 each independently enforce this limit.

3. LOADING PREFERENCES — When a metcon calls for a weighted movement, prefer barbells and dumbbells over kettlebells. Kettlebells are acceptable when the movement is inherently KB-based (e.g., Turkish get-ups, KB swings) but do not substitute KBs for movements that can use a barbell or dumbbell. BARBELL CYCLING: Do not repeat the same barbell movement in back-to-back metcons (e.g., if Day 3's metcon has thrusters, Day 4's metcon should not). Rotate barbell movements across days.

4. TIME DOMAIN DISTRIBUTION (per week) — Assign a target time domain to each metcon:
   - Short: sub-8 minutes
   - Medium: 8-15 minutes
   - Long: 15+ minutes
   Each week must include at least 1 short, 1 medium, and 1 long metcon. No single category may appear more than 3 times in one week. Design the rep schemes, round counts, and movement complexity to fit the target time domain.

5. COMPLEMENT THE STRENGTH BLOCK — If a day's Strength block is squat-dominant, the Metcon must NOT be squat-dominant. If Strength is pressing, the Metcon should not be press-heavy. The metcon should use complementary movement patterns to avoid overloading the same muscle groups.

6. DEVELOPING SKILLS BAN (HARD CONSTRAINT) — The following movements are NOT allowed in any Metcon: block. They belong exclusively in the Skills: block. This is non-negotiable — zero exceptions.
   BANNED FROM METCONS: {developingSkills}`;
/* ------------------------------------------------------------------ */
/*  SKELETON BUILDER — full 20-day template                           */
/* ------------------------------------------------------------------ */
function buildProgramSkeleton(monthNumber: number = 1): string {
  const dayOffset = (monthNumber - 1) * 20;
  const weekOffset = (monthNumber - 1) * 4;
  const lines: string[] = [];
  for (let week = 1; week <= 4; week++) {
    lines.push(`Week ${weekOffset + week}`);
    for (let day = 1; day <= 5; day++) {
      const dayNum = dayOffset + (week - 1) * 5 + day;
      lines.push(`Day ${dayNum}:`);
      lines.push(`Warm-up: `);
      lines.push(`Mobility: `);
      lines.push(`Skills: `);
      lines.push(`Strength: `);
      lines.push(`Metcon: `);
      lines.push(`Cool down: `);
      lines.push(``);
    }
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  MONTH 2+ CONTEXT — fetch previous program & evaluation history    */
/* ------------------------------------------------------------------ */
async function fetchPreviousProgramContext(
  supa: ReturnType<typeof createClient>,
  programId: string,
  monthNumber: number
): Promise<string> {
  // Fetch last month's workouts (previous 20 days)
  const prevMonth = monthNumber - 1;
  const { data: prevWorkouts } = await supa
    .from("program_workouts")
    .select("week_num, day_num, workout_text, sort_order")
    .eq("program_id", programId)
    .eq("month_number", prevMonth)
    .order("sort_order");

  if (!prevWorkouts || prevWorkouts.length === 0) return "";

  // Summarize the previous month's programming (not full text — too long)
  const strengthDays: string[] = [];
  const metconSummaries: string[] = [];
  const skillDays: string[] = [];

  for (const w of prevWorkouts) {
    const text = w.workout_text || "";
    const dayNum = w.sort_order + 1;

    // Extract strength block
    const strengthMatch = text.match(/Strength:\s*([\s\S]*?)(?=(?:Metcon:|Cool\s*down:|$))/i);
    if (strengthMatch) {
      const firstLine = strengthMatch[1].trim().split("\n")[0];
      if (firstLine) strengthDays.push(`Day ${dayNum}: ${firstLine}`);
    }

    // Extract metcon block (first 2 lines)
    const metconMatch = text.match(/Metcon:\s*([\s\S]*?)(?=(?:Cool\s*down:|$))/i);
    if (metconMatch) {
      const lines = metconMatch[1].trim().split("\n").slice(0, 2).join(" | ");
      if (lines) metconSummaries.push(`Day ${dayNum}: ${lines}`);
    }

    // Extract skills block
    const skillsMatch = text.match(/Skills:\s*([\s\S]*?)(?=(?:Strength:|$))/i);
    if (skillsMatch) {
      const firstLine = skillsMatch[1].trim().split("\n")[0];
      if (firstLine) skillDays.push(`Day ${dayNum}: ${firstLine}`);
    }
  }

  const parts: string[] = [`PREVIOUS MONTH (Month ${prevMonth}) PROGRAMMING SUMMARY:`];
  if (strengthDays.length > 0) parts.push("Strength:\n" + strengthDays.join("\n"));
  if (skillDays.length > 0) parts.push("Skills:\n" + skillDays.join("\n"));
  if (metconSummaries.length > 0) parts.push("Metcons:\n" + metconSummaries.join("\n"));

  return parts.join("\n\n");
}

async function fetchEvaluationHistory(
  supa: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  const { data: evals } = await supa
    .from("profile_evaluations")
    .select("month_number, analysis, created_at")
    .eq("user_id", userId)
    .eq("visible", true)
    .order("created_at", { ascending: true });

  if (!evals || evals.length === 0) return "";

  const parts = evals.map((e: { month_number: number; analysis: string; created_at: string }) => {
    const date = new Date(e.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    return `Month ${e.month_number} (${date}):\n${e.analysis}`;
  });

  return "EVALUATION HISTORY (longitudinal progression):\n\n" + parts.join("\n\n---\n\n");
}

/* ------------------------------------------------------------------ */
/*  MONTH 2+ PROGRESSION PROMPT                                       */
/* ------------------------------------------------------------------ */
const PROGRESSION_PROMPT = `You are continuing a multi-month training program. This is Month {monthNumber} for this athlete.

PROGRESSION PRINCIPLES:
- Review the previous month's programming and the athlete's training log to determine what worked and what needs adjustment.
- LOADING PROGRESSION: If the athlete consistently hit prescribed weights, increase by 2-5% for main lifts. If they missed reps or RPE was very high, maintain or slightly reduce.
- SKILL PROGRESSION: If skills improved (reflected in evaluation or log), advance the drill complexity. If stalled, change the approach — different drills, different rep scheme.
- CONDITIONING: Vary time domains and modality balance month-to-month. If last month was heavy on short metcons, shift toward more medium/long. Rotate monostructural emphases.
- PERIODIZATION: Month {monthNumber} should build on Month {prevMonth}. Consider accumulation → intensification → peaking → deload cycles across months.
- DELOAD: Week 4 of each month remains a deload week — reduce volume but maintain movement patterns.
- VARIETY: Do not repeat the same metcon structures from last month. Rotate barbell movements, vary gymnastics pairings, introduce new combinations.
- Use the TRAINING LOG to see what the athlete ACTUALLY did — loads hit, scores posted, completion rates. Program based on demonstrated capability, not just what was prescribed.

{evaluationHistory}

{previousProgramContext}
`;
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
    // Real-world mainsite metcon examples for structural inspiration
    const profSkills = profileData.skills
      ? Object.entries(profileData.skills)
          .filter(([, v]) => v === "advanced" || v === "intermediate")
          .map(([k]) => k.replace(/_/g, " "))
          .join(", ")
      : "";
    if (profSkills) {
      queries.push(
        searchChunks(supa, `CrossFit metcon workout ${profSkills}`, "mainsite", OPENAI_API_KEY, 5, 0.3)
      );
    }
    const results = await Promise.all(queries);
    const allChunks = results.flat();
    // Log individual counts in the same order as queries were pushed
    let i = 0;
    if (liftNames) console.log(`[RAG] journal/strength: ${results[i++].length} chunks`);
    if (skillNames) console.log(`[RAG] journal/skills: ${results[i++].length} chunks`);
    console.log(`[RAG] journal/conditioning: ${results[i++].length} chunks`);
    console.log(`[RAG] strength-science: ${results[i++].length} chunks`);
    if (profSkills) console.log(`[RAG] mainsite/metcon: ${results[i++].length} chunks`);
    const unique = deduplicateChunks(allChunks);
    console.log(`[RAG] Total: ${allChunks.length} raw → ${unique.length} deduplicated`);
    if (unique.length === 0) return "";
    return "\n\nREFERENCE (use to guide all programming decisions):\n" + formatChunksAsContext(unique, 8);
  } catch (err) {
    console.error("RAG retrieval error:", err);
    return "";
  }
}
/* ------------------------------------------------------------------ */
/*  POST-GENERATION METCON VALIDATOR                                   */
/* ------------------------------------------------------------------ */
interface MetconViolation {
  rule: string;
  detail: string;
}

/**
 * Validate metcon blocks extracted from parsed workouts.
 * Returns an array of violations. Empty array = all good.
 */
function validateMetcons(
  parsedWorkouts: { week_num: number; day_num: number; workout_text: string; sort_order: number }[],
  developingSkills: string[],
): MetconViolation[] {
  const violations: MetconViolation[] = [];

  // Extract metcon text from each workout
  const metcons: { day: number; week: number; text: string }[] = [];
  for (const w of parsedWorkouts) {
    const lower = w.workout_text.toLowerCase();
    const mIdx = lower.indexOf("metcon:");
    if (mIdx < 0) continue;
    const afterMetcon = w.workout_text.slice(mIdx + 7);
    // Find next block header to delimit metcon text
    const nextHeader = afterMetcon.search(/^(Warm-up|Mobility|Skills|Strength|Cool\s*down):/mi);
    const metconText = nextHeader >= 0 ? afterMetcon.slice(0, nextHeader).trim() : afterMetcon.trim();
    metcons.push({ day: w.sort_order + 1, week: w.week_num, text: metconText });
  }

  // Rule 6 check: developing skills banned from metcons
  const devLower = developingSkills.map((s) => s.toLowerCase());
  for (const m of metcons) {
    const mLower = m.text.toLowerCase();
    for (let i = 0; i < devLower.length; i++) {
      if (mLower.includes(devLower[i])) {
        violations.push({
          rule: "Rule 6 (Developing Skills Ban)",
          detail: `Day ${m.day}: "${developingSkills[i]}" is a developing skill and must not appear in a metcon.`,
        });
      }
    }
  }

  // Rule 1 frequency cap: no movement in more than 6 of 20 metcons
  // Build a simple word-frequency map of full metcon texts
  // We check for known movement patterns rather than individual words
  const movementDayCount = new Map<string, number[]>();
  const MOVEMENT_PATTERNS = [
    "thruster", "clean and jerk", "clean & jerk", "power clean", "squat clean", "hang clean",
    "clean", "snatch", "power snatch", "squat snatch", "hang snatch",
    "deadlift", "front squat", "back squat", "overhead squat",
    "push press", "push jerk", "split jerk", "strict press", "shoulder to overhead",
    "wall ball", "box jump", "burpee", "pull-up", "pull up", "chest-to-bar", "c2b",
    "toes-to-bar", "toes to bar", "t2b", "muscle-up", "muscle up",
    "ring dip", "handstand push-up", "handstand push up", "hspu",
    "handstand walk", "pistol", "rope climb", "double-under", "double under",
    "row", "bike", "ski erg", "run",
    "kettlebell swing", "kb swing", "turkish get-up",
    "dumbbell snatch", "db snatch", "dumbbell clean", "db clean",
    "devil press", "man maker",
    "lunge", "step-up", "step up", "ghd sit-up", "ghd sit up",
  ];

  for (const m of metcons) {
    const mLower = m.text.toLowerCase();
    for (const pattern of MOVEMENT_PATTERNS) {
      if (mLower.includes(pattern)) {
        const days = movementDayCount.get(pattern) || [];
        days.push(m.day);
        movementDayCount.set(pattern, days);
      }
    }
  }

  for (const [movement, days] of movementDayCount) {
    if (days.length > 6) {
      violations.push({
        rule: "Rule 1 (Frequency Cap)",
        detail: `"${movement}" appears in ${days.length}/20 metcons (max 6). Days: ${days.join(", ")}.`,
      });
    }
  }

  // Rule 3 barbell cycling: no same barbell movement in back-to-back metcons
  const BARBELL_MOVEMENTS = [
    "thruster", "clean and jerk", "clean & jerk", "power clean", "squat clean", "hang clean",
    "clean", "snatch", "power snatch", "squat snatch", "hang snatch",
    "deadlift", "front squat", "back squat", "overhead squat",
    "push press", "push jerk", "split jerk", "strict press", "shoulder to overhead",
  ];

  // Sort metcons by day order
  const sorted = [...metcons].sort((a, b) => a.day - b.day);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    // Only check consecutive training days (within same week or sequential)
    if (curr.day - prev.day !== 1) continue;
    const prevLower = prev.text.toLowerCase();
    const currLower = curr.text.toLowerCase();
    for (const bm of BARBELL_MOVEMENTS) {
      if (prevLower.includes(bm) && currLower.includes(bm)) {
        violations.push({
          rule: "Rule 3 (Barbell Cycling)",
          detail: `"${bm}" appears in consecutive metcons on Day ${prev.day} and Day ${curr.day}.`,
        });
      }
    }
  }

  return violations;
}

/** Background task: generate program and update job row */
async function processJob(
  jobId: string,
  userId: string,
  evalRow: {
    id?: string;
    profile_snapshot: ProfileData;
    analysis: string | null;
  },
  options: {
    monthNumber?: number;
    programId?: string;  // existing program to append to
  } = {}
): Promise<void> {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log("[generate-program] Job start");
  const jobStart = Date.now();
  try {
    // Mark processing
    await supa.from("program_jobs").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", jobId);
    const monthNumber = options.monthNumber || 1;
    const existingProgramId = options.programId || null;
    const isContinuation = monthNumber > 1 && existingProgramId != null;
    console.log(`[generate-program] Month ${monthNumber}, continuation=${isContinuation}`);
    const profile = evalRow.profile_snapshot || {};
    const profileStr = formatProfile(profile);
    console.log(`[generate-program] Profile: ${profileStr.length} chars, lifts=${Object.keys(profile.lifts || {}).length}, skills=${Object.keys(profile.skills || {}).length}`);
    const analysisStr = evalRow.analysis || "No detailed analysis.";
    console.log(`[generate-program] Analysis: ${analysisStr.length} chars`);
    // For Month 2+, fetch extended training history (full month) and previous program context
    const trainingDays = isContinuation ? 35 : 14;
    const trainingMaxLines = isContinuation ? 60 : 25;
    const recentTraining = await fetchAndFormatRecentHistory(supa, userId, { days: trainingDays, maxLines: trainingMaxLines });
    const trainingBlock = recentTraining ? `\n\n${recentTraining}` : "";
    console.log(`[generate-program] Training history: ${recentTraining ? recentTraining.length + ' chars' : 'none'} (${trainingDays} days)`);
    // Fetch previous program context and evaluation history for Month 2+
    let previousProgramContext = "";
    let evaluationHistory = "";
    if (isContinuation) {
      [previousProgramContext, evaluationHistory] = await Promise.all([
        fetchPreviousProgramContext(supa, existingProgramId, monthNumber),
        fetchEvaluationHistory(supa, userId),
      ]);
      console.log(`[generate-program] Previous program context: ${previousProgramContext.length} chars`);
      console.log(`[generate-program] Evaluation history: ${evaluationHistory.length} chars`);
    }
    const ragContext = await retrieveRAGContext(supa, profile);
    console.log(`[generate-program] RAG context: ${ragContext ? ragContext.length + ' chars' : 'none'}`);
    // Determine athlete scope for guideline filtering
    const scopes = ["all"];
    if (profile.skills) {
      const levels = Object.values(profile.skills).filter((v) => v && v !== "none");
      const developing = levels.filter((v) => /developing|beginner|learning/i.test(v)).length;
      const advanced = levels.filter((v) => /advanced|competition|elite/i.test(v)).length;
      if (developing > advanced) scopes.push("beginner");
      else if (advanced > 0) scopes.push("competition");
    }
    console.log(`[generate-program] Guideline scopes: [${scopes.join(", ")}]`);
    // Fetch strength guidelines from coaching_guidelines table
    const guidelinesBlock = await fetchCoachingGuidelines(supa, scopes);
    console.log(`[generate-program] Guidelines: ${guidelinesBlock ? guidelinesBlock.length + ' chars' : 'none'}`);
    const skeleton = buildProgramSkeleton(monthNumber);
    console.log(`[generate-program] Skeleton: ${skeleton.length} chars, ${(skeleton.match(/^Day \d+:/gm) || []).length} day headers`);
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
    const metconEligibility = proficientSkills.length > 0
      ? `\nMETCON MOVEMENT ELIGIBILITY:\n- Use in metcons (proficient): ${proficientSkills.join(", ")}\n`
      : "";
    // Equipment constraints
    let equipmentConstraint = "";
    if (profile.equipment && Object.keys(profile.equipment).length > 0) {
      const unavailable = Object.entries(profile.equipment)
        .filter(([, v]) => v === false)
        .map(([k]) => k.replace(/_/g, " "));
      if (unavailable.length > 0) {
        equipmentConstraint = `\nEQUIPMENT CONSTRAINTS:\nThe athlete does NOT have the following equipment. NEVER program movements that require them: ${unavailable.join(", ")}.\nSubstitute with movements using available equipment (e.g. if no rower, use bike or run; if no rope, use extra pull-up volume; if no rings, use bar movements).\n`;
      }
    }
    const unitLabel = profile.units === "kg" ? "kg" : "lbs";
    const userPrompt = `ATHLETE PROFILE:
${profileStr}

UNIT SYSTEM: This athlete uses ${unitLabel}. All weights in the program (strength percentages, barbell loads, dumbbell weights, wall ball weights, etc.) MUST be written in ${unitLabel}. Do not mix units.

${analysisStr}
${trainingBlock}${metconEligibility}${equipmentConstraint}
MOBILITY BLOCK RULES:
The Mobility: block goes after Warm-up and targets areas needed for that day's training.
- Keep it brief: 1 focus area and 1-2 suggested drills max (e.g. "Hip mobility — 90/90 switches, couch stretch 1 min/side").
- Match the focus to the day's movements: hip/ankle for squat days, thoracic/shoulder for overhead days, posterior chain for hinge days.
- If the athlete has a movement flagged as a mobility limiter, weave that area into relevant days throughout the program.
- This is advisory — a reminder, not a rigid checklist. Keep the tone casual and coach-like.

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
- "Needs Attention" skills are the highest priority. Program their progression track 2x per week — alternate between the foundational and advanced variant across the two slots. Never the same variant twice in a week.
- "Intermediate" skills get 1-2x per week to keep progressing.
- "Strong" skills are maintenance only — 0-1x per week or use them as metcon components instead.
- Never program the same skill on consecutive days (e.g. not Day 3 and Day 4).
- Related progressions are a single track, not separate skills. For example: strict HSPU, wall-facing HSPU, and deficit HSPU are one progression — pick the variant that matches the athlete's level and periodize across weeks (drill → load → test), don't scatter all three randomly.
- Week 4 is deload — reduce skill volume, keep only the top 1-2 priority skills at 1x each.
- Vary the drill, not just the movement. If L-sit appears 3x in a week, each session should have a different focus (e.g. tuck hold for time, single-leg extension, parallette L-sit).

Complete the following program template. Fill in every block using multi-line formatting (scheme on the first line, one movement per line after that). Do not add or remove any headers.
${skeleton}`;
    // Inject developing skills into Rule 6 of METCON_GUIDANCE
    const developingList = developingSkills.length > 0 ? developingSkills.join(", ") : "none";
    const metconGuidance = METCON_GUIDANCE.replace("{developingSkills}", developingList);
    // Build system prompt — add progression context for Month 2+
    let progressionBlock = "";
    if (isContinuation) {
      progressionBlock = "\n\n" + PROGRESSION_PROMPT
        .replace(/\{monthNumber\}/g, String(monthNumber))
        .replace(/\{prevMonth\}/g, String(monthNumber - 1))
        .replace("{evaluationHistory}", evaluationHistory)
        .replace("{previousProgramContext}", previousProgramContext);
    }
    const systemPrompt = GENERATE_PROMPT + metconGuidance + progressionBlock + guidelinesBlock + ragContext;
    console.log(`[generate-program] Prompt sizes: system=${systemPrompt.length} chars, user=${userPrompt.length} chars`);
    if (!ANTHROPIC_API_KEY) {
      throw new Error("Program generation is not configured");
    }
    const MAX_ATTEMPTS = 3;
    const monthYear = new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const programName = `Month ${monthNumber} — ${monthYear}`;
    let program_id: string | undefined;
    let workout_count: number | undefined;
    const messages: Array<{ role: string; content: string }> = [
      { role: "user", content: userPrompt },
    ];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[generate-program] Attempt ${attempt}/${MAX_ATTEMPTS}: sending ${messages.length} messages to Claude...`);
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
        console.error(`[generate-program] Attempt ${attempt}: Claude API error after ${apiElapsed}s, status=${claudeResp.status}:`, JSON.stringify(err));
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
      console.log(`[generate-program] Attempt ${attempt}: ${apiElapsed}s, stop=${stopReason}, tokens=${inputTokens}in/${outputTokens}out, chars=${programText.length}, days=${dayHeaders.length}, blocks=[warmup=${warmupCount},skills=${skillsCount},strength=${strengthCount},metcon=${metconCount},cooldown=${cooldownCount}]`);
      // Too short — retry with context
      if (!programText || programText.length < 100) {
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[generate-program] Attempt ${attempt}: program too short (${programText.length} chars), retrying with correction...`);
          messages.push({ role: "assistant", content: programText || "(empty)" });
          messages.push({ role: "user", content: "That output was too short or empty. Please generate the complete program filling in every block of the template." });
          continue;
        }
        throw new Error("Generated program was empty or too short");
      }
      // Day count validation — Month N expects days offset by (monthNumber-1)*20
      const dayOffset = (monthNumber - 1) * 20;
      const expectedFirstDay = dayOffset + 1;
      const expectedLastDay = dayOffset + 20;
      if (dayHeaders.length < 20) {
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[generate-program] Attempt ${attempt}: only ${dayHeaders.length}/20 days, retrying with correction...`);
          messages.push({ role: "assistant", content: programText });
          messages.push({ role: "user", content: `That program only contained ${dayHeaders.length} days. It must have exactly 20 days (Day ${expectedFirstDay} through Day ${expectedLastDay}). Please output the complete program with all 20 days.` });
          continue;
        }
        throw new Error(`Program contained ${dayHeaders.length}/20 days after ${MAX_ATTEMPTS} attempts`);
      }
      // Save program directly (bypasses preprocess-program HTTP call)
      console.log(`[generate-program] Saving program inline: ${programText.length} chars, name="${programName}"`);
      // Parse AI output into workouts using Day N: markers
      const dayParts = programText.replace(/\r\n/g, "\n").split(/^Day (\d+):/mi);
      const parsedWorkouts: { week_num: number; day_num: number; workout_text: string; sort_order: number }[] = [];
      for (let pi = 1; pi < dayParts.length - 1; pi += 2) {
        const n = parseInt(dayParts[pi], 10);
        const wText = dayParts[pi + 1].trim();
        if (!wText) continue;
        parsedWorkouts.push({ week_num: Math.ceil(n / 5), day_num: ((n - 1) % 5) + 1, workout_text: wText, sort_order: n - 1 });
      }
      if (parsedWorkouts.length !== 20) {
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[generate-program] Attempt ${attempt}: parsed ${parsedWorkouts.length}/20 workouts, retrying...`);
          messages.push({ role: "assistant", content: programText });
          messages.push({ role: "user", content: `That program failed validation: Expected exactly 20 workouts, got ${parsedWorkouts.length}. Please output the complete program with exactly 20 days (Day ${expectedFirstDay} through Day ${expectedLastDay}), filling in every block of the template.` });
          continue;
        }
        throw new Error(`Expected 20 workouts, got ${parsedWorkouts.length}`);
      }
      // Validate metcon blocks against rules
      const metconViolations = validateMetcons(parsedWorkouts, developingSkills);
      if (metconViolations.length > 0) {
        console.warn(`[generate-program] Attempt ${attempt}: ${metconViolations.length} metcon violations found`);
        for (const v of metconViolations) {
          console.warn(`  [${v.rule}] ${v.detail}`);
        }
        if (attempt < MAX_ATTEMPTS) {
          const violationList = metconViolations.map((v) => `- ${v.rule}: ${v.detail}`).join("\n");
          messages.push({ role: "assistant", content: programText });
          messages.push({ role: "user", content: `That program has metcon rule violations:\n${violationList}\n\nPlease fix these violations and output the complete 20-day program again.` });
          continue;
        }
        // On final attempt, log but proceed — partial compliance is better than failure
        console.warn(`[generate-program] Final attempt still has ${metconViolations.length} violations — saving anyway`);
      }
      // For Month 1: create new program. For Month 2+: append to existing program.
      let progId: string;
      if (isContinuation && existingProgramId) {
        progId = existingProgramId;
        console.log(`[generate-program] Appending month ${monthNumber} to existing program`);
      } else {
        const { data: prog, error: progErr } = await supa
          .from("programs")
          .insert({ user_id: userId, name: programName, source: "generated" })
          .select("id")
          .single();
        if (progErr || !prog) throw new Error("Failed to create program");
        progId = prog.id;
        console.log("[generate-program] Created new program");
      }
      // Insert workouts with month_number
      const wkRows = parsedWorkouts.map((pw, idx) => ({
        program_id: progId,
        week_num: pw.week_num,
        day_num: pw.day_num,
        workout_text: pw.workout_text,
        sort_order: pw.sort_order,
        month_number: monthNumber,
      }));
      const { data: insertedWks, error: wkErr } = await supa
        .from("program_workouts")
        .insert(wkRows)
        .select("id, workout_text");
      if (wkErr) {
        // Only delete program if we just created it (Month 1)
        if (!isContinuation) {
          await supa.from("programs").delete().eq("id", progId);
        }
        throw new Error("Failed to save workouts");
      }
      // Extract and insert blocks
      const BLOCK_LABELS = ["Warm-up", "Mobility", "Skills", "Strength", "Metcon", "Cool down"];
      const BLOCK_TYPE_MAP: Record<string, string> = { "warm-up": "warm-up", "mobility": "mobility", "skills": "skills", "strength": "strength", "metcon": "metcon", "cool down": "cool-down" };
      if (insertedWks?.length) {
        const blockRows: { program_workout_id: string; block_type: string; block_order: number; block_text: string }[] = [];
        for (const w of insertedWks) {
          const wLower = (w.workout_text || "").toLowerCase();
          const labels = BLOCK_LABELS.map((l) => ({ label: l, needle: (l + ":").toLowerCase() }));
          for (let li = 0; li < labels.length; li++) {
            const { label, needle } = labels[li];
            const start = wLower.indexOf(needle);
            if (start < 0) continue;
            const cStart = start + needle.length;
            const nextLabel = labels.slice(li + 1).find((x) => wLower.indexOf(x.needle, cStart) >= 0);
            const end = nextLabel ? wLower.indexOf(nextLabel.needle, cStart) : w.workout_text.length;
            const bText = w.workout_text.slice(cStart, end).trim();
            blockRows.push({ program_workout_id: w.id, block_type: BLOCK_TYPE_MAP[label.toLowerCase()] ?? "other", block_order: blockRows.filter((r) => r.program_workout_id === w.id).length + 1, block_text: bText });
          }
        }
        if (blockRows.length > 0) {
          await supa.from("program_workout_blocks").insert(blockRows);
        }
        console.log(`[generate-program] Inserted ${blockRows.length} blocks for ${insertedWks.length} workouts`);
      }
      // Update generated_months on the program
      await supa
        .from("programs")
        .update({ generated_months: monthNumber })
        .eq("id", progId);
      // Mark evaluation as visible now that program is ready (atomic delivery)
      if (evalRow.id) {
        await supa
          .from("profile_evaluations")
          .update({ visible: true, program_id: progId })
          .eq("id", evalRow.id);
      }
      // Trigger analysis in background (fire and forget)
      const analyzeUrl = `${SUPABASE_URL}/functions/v1/analyze-program`;
      fetch(analyzeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        body: JSON.stringify({ program_id: progId, user_id: userId }),
      }).catch((err) => console.error("Analyze-program fire-and-forget failed:", err));
      program_id = progId;
      workout_count = parsedWorkouts.length;
      console.log(`[generate-program] Save success: workout_count=${workout_count}, month=${monthNumber}`);
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
    console.log(`[generate-program] Complete: workouts=${workout_count}, elapsed=${((Date.now() - jobStart) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(`[generate-program] FAILED after ${((Date.now() - jobStart) / 1000).toFixed(1)}s:`, e);
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
    let monthNumber: number = 1;
    let programId: string | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      evaluationId = body?.evaluation_id ?? null;
      monthNumber = body?.month_number ?? 1;
      programId = body?.program_id ?? null;
    } catch {
      // no body
    }
    // For Month 2+, validate that program_id is provided
    if (monthNumber > 1 && !programId) {
      return new Response(
        JSON.stringify({ error: "program_id is required for Month 2+ generation" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }
    // Fetch evaluation: use provided id, or most recent
    let evalRow: {
      id?: string;
      profile_snapshot: ProfileData;
      analysis: string | null;
    } | null = null;
    if (evaluationId) {
      const { data } = await supa
        .from("profile_evaluations")
        .select("id, profile_snapshot, analysis")
        .eq("id", evaluationId)
        .eq("user_id", user.id)
        .maybeSingle();
      evalRow = data;
    }
    if (!evalRow) {
      const { data } = await supa
        .from("profile_evaluations")
        .select("id, profile_snapshot, analysis")
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
    EdgeRuntime.waitUntil(processJob(job.id, user.id, evalRow, {
      monthNumber,
      programId: programId || undefined,
    }));
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
