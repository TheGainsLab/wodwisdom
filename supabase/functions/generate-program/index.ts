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
import { getTierStatus } from "../_shared/tier-status.ts";
import { interpretLevels } from "../_shared/level-interpreter.ts";
import { reconcileProfile, formatInterpretedProfile } from "../_shared/reconciler.ts";
import type { ParsedGoal, ParsedInjuries } from "../_shared/reconciler.ts";
import { ARCHETYPES } from "../_shared/archetype-specs.ts";
import type { DayArchetype } from "../_shared/archetype-specs.ts";
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
- Format EVERY block as MULTI-LINE text — NEVER use commas to join movements on one line. This applies to ALL blocks: Warm-up & Mobility, Skills, Strength, Accessory, Metcon, and Cool down.
  • First line after the header: the format or scheme ONLY (e.g. "3 Rounds For Time:", "EMOM 12 min:", "5×3 @75%"). Do NOT put a movement on this line.
  • Following lines: one movement or drill per line. Each movement gets its own line.
  • Last line (if applicable): notes, rest periods, target time, or scaling.

FORMATTING EXAMPLES (follow these exactly):
  BAD — never do this:
    Warm-up & Mobility: 400m row, 10 pass-throughs, 90/90 switches
    Accessory: 3x12 DB curls, 3x30s plank
    Metcon: 5 RFT: 10 Box Jump Overs 30/24, 8 HSPU
  GOOD — always do this:
    Warm-up & Mobility:
    400m row
    10 pass-throughs
    10 air squats
    90/90 switches 1 min/side

    Accessory:
    3x12 DB hammer curls @ 25 lbs
    3x30s hollow hold
    3x40m suitcase carry @ 50 lbs/hand

    Metcon:
    5 RFT:
    10 Box Jump Overs 30/24
    8 HSPU
- Each day header includes the archetype tag in square brackets (e.g., "Day 1: [Strength Day]"). The blocks for that day are dictated by the archetype — DO NOT add or remove blocks beyond what the template provides.
- Block headers (Warm-up & Mobility:, Skills:, Strength:, Accessory:, Metcon:, Active Recovery:, Cool down:) MUST appear on their own line starting at position 0. Never nest one block inside another. Content lines for a block go on the lines BELOW its header.
- Do not add, remove, or reorder any headers.
- Prescribe weights using the athlete's 1RMs where applicable. Use / for M/F Rx (e.g. 95/65).
- Metcon examples in the REFERENCE section are real CrossFit workouts. Use them for structural inspiration only — adapt to the athlete's profile and eligibility rules, never copy verbatim.`;

const METCON_GUIDANCE = `

METCON DESIGN RULES (apply to every Metcon: block — note Metcon does NOT appear on every day, only on Metcon Days, Fitness Days, and some Skill/Recovery patterns):

1. BREADTH OVER WEAKNESS — Metcons draw from movements the athlete is PROFICIENT at (intermediate or advanced). Weaknesses and developing skills belong in the Skills block, not the Metcon. If the athlete is advanced at ring muscle-ups, use them in metcons. If the athlete is beginner at HSPU, never put HSPU in a metcon — that stays in the skill block. See the METCON MOVEMENT ELIGIBILITY section for the explicit lists. FREQUENCY CAP: No single movement may appear in more than 30% of the metcons across the program. Spread variety.

2. MONOSTRUCTURAL CAP — Across the metcons in any single week, at most half may include a monostructural cardio element (row, bike, ski erg, run — any of these count). For weeks with 1-2 metcons, allow at most 1 monostructural metcon.

3. LOADING PREFERENCES — When a metcon calls for a weighted movement, prefer barbells and dumbbells over kettlebells. Kettlebells are acceptable when the movement is inherently KB-based (e.g., Turkish get-ups, KB swings) but do not substitute KBs for movements that can use a barbell or dumbbell. BARBELL CYCLING: Do not repeat the same barbell movement in back-to-back metcons (e.g., if a metcon has thrusters, the next metcon in the week should not). Rotate barbell movements across days.

4. TIME DOMAIN DISTRIBUTION (per week) — Assign a target time domain to each metcon:
   - Short: sub-8 minutes
   - Medium: 8-15 minutes
   - Long: 15+ minutes
   For weeks with 3+ metcons, include at least 1 short, 1 medium, and 1 long. For weeks with 2 metcons, include at least 2 different domains. For weeks with 1 metcon, vary the domain across weeks. No single category may appear in more than half the week's metcons.

5. COMPLEMENT THE STRENGTH BLOCK — If a day's Strength block is squat-dominant, the Metcon must NOT be squat-dominant. If Strength is pressing, the Metcon should not be press-heavy. The metcon should use complementary movement patterns to avoid overloading the same muscle groups. Apply same logic across adjacent days — if yesterday was a heavy squat Strength Day, today's Metcon (if any) should not be squat-dominant.

6. DEVELOPING SKILLS BAN (HARD CONSTRAINT) — The following movements are NOT allowed in any Metcon: block. They belong exclusively in the Skills: block. This is non-negotiable — zero exceptions.
   BANNED FROM METCONS: {developingSkills}`;
/* ------------------------------------------------------------------ */
/*  SKELETON BUILDER — variable-shape template from weekly pattern     */
/* ------------------------------------------------------------------ */
/**
 * Variable-shape skeleton builder. Emits the day count and block composition
 * dictated by `weeks` (an array of 4 week-arrays of archetypes).
 *
 * The day_offset grows each month so day numbers stay continuous across
 * months (Month 2 starts at Day N+1 where N is the last day of Month 1's
 * actual day count, not a hardcoded 20).
 */
function buildProgramSkeleton(args: {
  monthNumber: number;
  weeks: import("../_shared/archetype-specs.ts").DayArchetype[][];
}): { skeleton: string; daysInMonth: number } {
  const { monthNumber, weeks } = args;
  const weekOffset = (monthNumber - 1) * 4;
  const lines: string[] = [];
  let dayCounter = 0;
  // For continuous day numbering across months, count prior days from prior
  // months' patterns. Caller should pass a consistent `weeks` shape per month
  // to avoid drift; for v1 we just use this month's day count and offset by
  // (monthNumber-1) * thisMonthDayCount.
  const daysPerWeek = weeks[0]?.length ?? 5;
  const dayOffset = (monthNumber - 1) * (daysPerWeek * 4);

  for (let weekIdx = 0; weekIdx < weeks.length; weekIdx++) {
    const weekDays = weeks[weekIdx];
    lines.push(`Week ${weekOffset + weekIdx + 1}`);
    for (let dayIdx = 0; dayIdx < weekDays.length; dayIdx++) {
      const archetype = weekDays[dayIdx];
      const spec = ARCHETYPES[archetype];
      dayCounter++;
      const dayNum = dayOffset + dayCounter;
      lines.push(`Day ${dayNum}: [${spec.displayLabel}]`);
      for (const block of spec.blocks) {
        lines.push(`${block.header}: `);
      }
      lines.push(``);
    }
  }
  return { skeleton: lines.join("\n"), daysInMonth: dayCounter };
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
  // Fetch profile, training, and nutrition evaluations in parallel, all grouped by month
  const [profileRes, trainingRes, nutritionRes] = await Promise.all([
    supa.from("profile_evaluations")
      .select("month_number, analysis, created_at")
      .eq("user_id", userId)
      .eq("visible", true)
      .eq("status", "complete")
      .order("month_number", { ascending: true }),
    supa.from("training_evaluations")
      .select("month_number, analysis, created_at")
      .eq("user_id", userId)
      .order("month_number", { ascending: true }),
    supa.from("nutrition_evaluations")
      .select("month_number, analysis, created_at")
      .eq("user_id", userId)
      .order("month_number", { ascending: true }),
  ]);

  const profileEvals = profileRes.data || [];
  const trainingEvals = trainingRes.data || [];
  const nutritionEvals = nutritionRes.data || [];

  if (profileEvals.length === 0 && trainingEvals.length === 0 && nutritionEvals.length === 0) return "";

  // Group all evaluations by month_number
  const byMonth = new Map<number, { profile?: string; training?: string; nutrition?: string; date: string }>();
  const ensureMonth = (m: number, created_at: string) => {
    if (!byMonth.has(m)) {
      byMonth.set(m, { date: new Date(created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" }) });
    }
    return byMonth.get(m)!;
  };

  for (const e of profileEvals as Array<{ month_number: number; analysis: string; created_at: string }>) {
    ensureMonth(e.month_number, e.created_at).profile = e.analysis;
  }
  for (const e of trainingEvals as Array<{ month_number: number; analysis: string; created_at: string }>) {
    ensureMonth(e.month_number || 1, e.created_at).training = e.analysis;
  }
  for (const e of nutritionEvals as Array<{ month_number: number; analysis: string; created_at: string }>) {
    ensureMonth(e.month_number || 1, e.created_at).nutrition = e.analysis;
  }

  const months = Array.from(byMonth.keys()).sort((a, b) => a - b);
  const parts = months.map(m => {
    const group = byMonth.get(m)!;
    const sections: string[] = [`Month ${m} (${group.date}):`];
    if (group.profile) sections.push(`## Profile\n${group.profile}`);
    if (group.training) sections.push(`## Training Review\n${group.training}`);
    if (group.nutrition) sections.push(`## Nutrition Review\n${group.nutrition}`);
    return sections.join("\n\n");
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

  // Rule 1 frequency cap: no movement in more than 30% of metcons across
  // the program. Cap scales with total metcon count (which varies by
  // archetype pattern) — not a hardcoded number.
  // We check for known movement patterns rather than individual words.
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

  const totalMetcons = metcons.length;
  const freqCap = Math.max(2, Math.ceil(totalMetcons * 0.30));
  for (const [movement, days] of movementDayCount) {
    if (days.length > freqCap) {
      violations.push({
        rule: "Rule 1 (Frequency Cap)",
        detail: `"${movement}" appears in ${days.length}/${totalMetcons} metcons (max ${freqCap} = 30% of program metcons). Days: ${days.join(", ")}.`,
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
    // ── Pre-generation classifier pipeline ────────────────────────────────
    // Fetch the live fields we need (goal + self-perception + injuries + T3 numerics)
    // since profile_snapshot may be stale on Month 2+ generations.
    const { data: athleteLive } = await supa
      .from("athlete_profiles")
      .select("injuries_constraints, goal, self_perception_level, days_per_week, session_length_minutes")
      .eq("user_id", userId)
      .maybeSingle();
    const goalText = (athleteLive?.goal ?? "").trim();
    const injuriesText = (athleteLive?.injuries_constraints ?? "").trim();
    const selfPerception = athleteLive?.self_perception_level ?? null;

    // Fire classifiers in parallel
    const classifierStart = Date.now();
    const [goalResult, injuriesResult] = await Promise.all([
      goalText
        ? supa.functions.invoke("parse-goal", { body: { goal_text: goalText } })
        : Promise.resolve({ data: null, error: null }),
      injuriesText
        ? supa.functions.invoke("parse-injuries", { body: { injuries_text: injuriesText } })
        : Promise.resolve({ data: { constraints: [], summary: "No reported injuries or constraints." }, error: null }),
    ]);
    console.log(`[generate-program] Classifiers: ${((Date.now() - classifierStart) / 1000).toFixed(1)}s`);

    const parsedGoal: ParsedGoal = (goalResult?.data?.goal as ParsedGoal) ?? {
      primary_goal: "fitness",
      secondary_emphasis: [],
      time_horizon: null,
      named_event: null,
      emphasis_blocks: ["metcon", "strength", "skills"],
    };
    const parsedInjuries: ParsedInjuries = (injuriesResult?.data as ParsedInjuries) ?? {
      constraints: [],
      summary: "No reported injuries or constraints.",
    };

    // Rule-based level interpretation + reconcile
    const levels = interpretLevels({
      age: profile.age,
      gender: profile.gender,
      bodyweight: profile.bodyweight,
      units: profile.units,
      lifts: profile.lifts,
      skills: profile.skills,
      conditioning: profile.conditioning,
    });
    // Look up previous month's effective tier (for upward-only ratchet).
    let previousTier: import("../_shared/level-interpreter.ts").ExperienceTier | null = null;
    if (existingProgramId) {
      const { data: prevProgram } = await supa
        .from("programs")
        .select("experience_tier_at_gen")
        .eq("id", existingProgramId)
        .maybeSingle();
      const t = prevProgram?.experience_tier_at_gen;
      if (t === "novice" || t === "intermediate" || t === "advanced" || t === "competitor") {
        previousTier = t;
      }
    }
    const interpretedProfile = reconcileProfile({
      goal: parsedGoal,
      injuries: parsedInjuries,
      levels,
      self_perception_level: selfPerception,
      days_per_week: athleteLive?.days_per_week ?? null,
      previous_tier: previousTier,
    });
    const interpretedBlock = "\n" + formatInterpretedProfile(interpretedProfile) + "\n";
    console.log(`[generate-program] Interpreted: goal=${interpretedProfile.goal.primary_goal}, tier=${interpretedProfile.effective_tier} (raw ${interpretedProfile.levels.experience_tier}), days=${interpretedProfile.days_per_week}, pattern=[${interpretedProfile.weekly_pattern.baseline.join(",")}], blockers=${interpretedProfile.blockers.length}`);

    // Persist the reconciler output onto the evaluation row for admin audit.
    if (evalRow.id) {
      await supa
        .from("profile_evaluations")
        .update({ interpreted_profile: interpretedProfile })
        .eq("id", evalRow.id);
    }
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
    const { skeleton, daysInMonth } = buildProgramSkeleton({
      monthNumber,
      weeks: interpretedProfile.weekly_pattern.weeks,
    });
    console.log(`[generate-program] Skeleton: ${skeleton.length} chars, ${(skeleton.match(/^Day \d+:/gm) || []).length} day headers, ${daysInMonth} days in month`);
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
    // Archetype-aware prompt sections
    const archetypePlanLines: string[] = ["ARCHETYPE PLAN (this month):"];
    interpretedProfile.weekly_pattern.weeks.forEach((week, wi) => {
      const label = wi === 3 ? `Week ${wi + 1} (DELOAD)` : `Week ${wi + 1}`;
      archetypePlanLines.push(`  ${label}: ${week.map((a) => ARCHETYPES[a].displayLabel).join(" → ")}`);
    });
    const archetypePlan = archetypePlanLines.join("\n");

    // Per-archetype rules — only emit rules for archetypes present in the pattern
    const usedArchetypes = new Set<DayArchetype>();
    interpretedProfile.weekly_pattern.weeks.forEach((w) => w.forEach((a) => usedArchetypes.add(a)));
    const archetypeRulesLines: string[] = ["ARCHETYPE-SPECIFIC RULES:"];
    if (usedArchetypes.has("strength")) {
      archetypeRulesLines.push(`
STRENGTH DAY:
- Blocks: Warm-up & Mobility, Strength, Accessory, Cool down. NO Skills, NO Metcon — do not add these headers.
- The Strength block is the day's main event (30-40 min). Use heavy schemes: 5x3 @85%, 3x1 build to heavy, cluster sets, tempo (3-second eccentrics). Adequate rest 3-5 min between working sets.
- Accessory volume is HIGHER on Strength Day than on Fitness Day: 3-4 movements, hypertrophy rep ranges (3 sets x 10-15 reps), targeting muscle groups NOT hit by today's primary lift.
- Optional secondary lift if time permits: supplementary movement at 70%, lower volume.`);
    }
    if (usedArchetypes.has("metcon")) {
      archetypeRulesLines.push(`
METCON DAY:
- Blocks: Warm-up & Mobility, Skills (PRIMER), Metcon, Cool down. NO Strength, NO Accessory — do not add these headers.
- The Skills block here is a brief 5-8 min PRIMER — not progression work. Activation or movement rehearsal for the metcon (e.g., light pressing if the metcon has HSPU).
- Metcon is the main event (15-25 min). Pick ONE time-domain target for this day (short / medium / long) per the time-domain distribution rule.
- Complement nearby Strength Days: if yesterday was squat-heavy Strength, today's Metcon avoids squats.`);
    }
    if (usedArchetypes.has("skill")) {
      archetypeRulesLines.push(`
SKILL DAY:
- Blocks: Warm-up & Mobility, Skills (EXTENDED), Strength (SECONDARY), Cool down. NO Accessory, NO Metcon — do not add these headers.
- Skills is the main event (25-30 min). 2-3 skill tracks with deep progression work: foundational variant → advanced variant. End with a test set demonstrating progress.
- Strength here is SECONDARY (15-20 min): one lift that supports today's skill work (strict press if skill was HSPU, weighted pull-ups if skill was pull-ups). Moderate volume at 70-80%, NOT max effort.`);
    }
    if (usedArchetypes.has("fitness")) {
      archetypeRulesLines.push(`
FITNESS DAY:
- Blocks: full 6-block template (Warm-up & Mobility, Skills, Strength, Accessory, Metcon, Cool down).
- Balanced moderate volume per block — nothing is the star. Skills 8-12 min, Strength 15-20 min @ 75-85%, Accessory 8-12 min (2-3 movements with at least one midline), Metcon 10-20 min.`);
    }
    if (usedArchetypes.has("recovery")) {
      archetypeRulesLines.push(`
RECOVERY DAY:
- Blocks: Warm-up & Mobility, Active Recovery, Cool down. NO other blocks — do not add Skills, Strength, Accessory, or Metcon.
- Warm-up & Mobility doubles as the week's main mobility session: joint-by-joint opening + foam rolling on chronic tight areas.
- Active Recovery is 20-30 min of low-intensity movement. Easy walk, easy bike, light row, yoga flow, or mobility circuit. Conversational pace only. This is NOT aerobic training — purpose is blood flow and parasympathetic recovery, not stimulus.
- Cool down: 2-3 static stretches + 2-3 min of slow nasal breathing for parasympathetic emphasis.`);
    }
    const archetypeRules = archetypeRulesLines.join("\n");

    // Experience tier modifier
    const tier = interpretedProfile.effective_tier;
    const tierModifier: Record<typeof tier, string> = {
      novice: `EXPERIENCE TIER MODIFIER (${tier}):
- Volume: 0.7x baseline — fewer working sets, conservative rep counts.
- Strength loading: cap percentages at 75% 1RM. Use 5-8 rep ranges, no 1RM attempts.
- Skills: keep on foundational variants. Progression only after a variant is owned.
- No tempo / cluster / complex schemes. Focus on movement quality.`,
      intermediate: `EXPERIENCE TIER MODIFIER (${tier}):
- Volume: 1.0x baseline.
- Strength loading: typical percentages 75-85%. Occasional heavy singles allowed.
- Skills: standard progression cadence.
- Standard schemes with some variation.`,
      advanced: `EXPERIENCE TIER MODIFIER (${tier}):
- Volume: 1.1x baseline — more working sets, slightly higher density.
- Strength loading: percentages up to 90%. Tempo work (3-second eccentrics, paused reps) and cluster sets are appropriate.
- Skills: aggressive progression — drill, load, test cadence.
- Allow complexes, EMOMs with technical movements.`,
      competitor: `EXPERIENCE TIER MODIFIER (${tier}):
- Volume: 1.2x baseline.
- Strength loading: percentages up to 95%, periodic heavy singles, peaking cycles.
- Skills: competition-relevant variants always present, test sets every 2-3 weeks.
- Allow all advanced schemes plus benchmark workout exposure (Fran, Helen, Grace, etc.).`,
    };

    // Session length modifier — dials volume up or down within each block based
    // on how long the athlete has per session. Composes multiplicatively with
    // the experience tier modifier (i.e., novice at 30 min = 0.7 × 0.7 = 0.49×
    // baseline; competitor at 90+ min = 1.2 × 1.2 = 1.44× baseline).
    const sessionMin = athleteLive?.session_length_minutes ?? 60;
    const sessionBracket = sessionMin < 45 ? "30-44"
      : sessionMin < 60 ? "45-59"
      : sessionMin < 75 ? "60-74"
      : sessionMin < 90 ? "75-89"
      : "90+";
    const sessionMultiplier = sessionMin < 45 ? "0.70×"
      : sessionMin < 60 ? "0.85×"
      : sessionMin < 75 ? "1.00×"
      : sessionMin < 90 ? "1.10×"
      : "1.20×";
    const sessionGuidance = sessionMin < 45
      ? "Heavily condensed session. Accessory block is optional and often cut. Strength: max 3 working sets. Metcon: short time domains only (sub-12 min). Warm-up & Mobility: ~8 min max."
      : sessionMin < 60
      ? "Condensed session. Accessory reduced to 1-2 movements. Strength: standard scheme with fewer sets. Metcon: short to medium time domains."
      : sessionMin < 75
      ? "Default prescriptions per archetype spec."
      : sessionMin < 90
      ? "Extra room to work. Add one extra accessory movement, slightly longer Strength or Metcon blocks. Skill block can include an extra progression variant on Skill Days."
      : "Maximum block durations. Secondary lift allowed on Strength Day. Metcon can run to the long end. Skill Day can fit a test set plus two progression tracks. More accessory volume.";
    const sessionLengthModifier = `SESSION LENGTH MODIFIER (${sessionMin} min / bracket ${sessionBracket}, volume ${sessionMultiplier}):
- ${sessionGuidance}
- When trimming is needed (volume < 1.0×), cut in this priority order:
  1. Accessory first (it's the most optional block)
  2. Skills (reduce to a primer on Metcon Days and Fitness Days if time is very tight)
  3. Warm-up & Mobility (can shrink from 15 min to ~8 min if needed)
  4. NEVER trim the archetype's main event — Strength Day keeps its Strength block, Metcon Day keeps its Metcon, Skill Day keeps its extended Skills block.
- When expanding (volume > 1.0×), add depth to the archetype's main event first, then Accessory, then Skills.
- This modifier COMPOSES with the experience tier modifier. Apply both multiplicatively — e.g., novice + 30 min = 0.7 × 0.7 = ~0.49× baseline; competitor + 90+ min = 1.2 × 1.2 = ~1.44× baseline.`;

    const userPrompt = `ATHLETE PROFILE:
${profileStr}

UNIT SYSTEM: This athlete uses ${unitLabel}. All weights in the program (strength percentages, barbell loads, dumbbell weights, wall ball weights, etc.) MUST be written in ${unitLabel}. Do not mix units.

${analysisStr}
${trainingBlock}${metconEligibility}${equipmentConstraint}${interpretedBlock}
${archetypePlan}

${archetypeRules}

${tierModifier[tier]}

${sessionLengthModifier}

WARM-UP & MOBILITY BLOCK RULES:
The Warm-up & Mobility: block is a single combined block that progresses from general preparation to targeted drills for the day's work.
- 4-8 minutes of general prep (light cardio, dynamic stretching, activation) followed by 2-4 targeted drills for the day's primary movements.
- Match the targeted drills to the day's work: hip/ankle for squat days, thoracic/shoulder for overhead days, posterior chain for hinge days.
- If the athlete has a movement flagged as a mobility limiter, weave that area into relevant days throughout the program.
- Progression is general → specific. Lift-specific warm-up sets belong in the Strength block, not here.
- Keep it concise and coach-like.

STRENGTH BLOCK RULES (apply when the Strength block appears in a day):
Compound multi-joint lifts only. Isolation and hypertrophy work lives in the Accessory block, not here.
The STRENGTH HIERARCHY above (if present) dictates priority, but you MUST also ensure movement-pattern diversity across all Strength blocks in a week (count varies by archetype pattern).

MOVEMENT PATTERN DISTRIBUTION (across all Strength blocks in the week):
- Olympic lifts (snatch variants, clean variants, jerks): no more than 40% of the week's Strength slots. Alternate snatch-family and clean-family across days.
- Squat (back squat, front squat, overhead squat): 1-2 slots per week if available, rotate variants across weeks — do not repeat the same squat variant in the same week.
- Press (strict press, push press, bench press, push jerk): include at least 1 pressing slot per week if there are 3+ Strength blocks. For weeks with fewer Strength blocks, rotate pressing across weeks so it appears at least every other week.
- Hinge/Pull (deadlift, RDL, clean pull, snatch pull): include at least 1 hinge slot per week if there are 3+ Strength blocks; otherwise rotate across weeks.
- If the athlete provided a lift, try to include it at least once across the 4-week program — but not at the expense of cluttering weeks. LOW priority lifts can be omitted if slots are tight.
- A movement flagged as a mobility limiter in the STRENGTH ANALYSIS is accessory or warm-up work — it does NOT fulfill a movement-pattern slot. Program it as light technique work alongside the day's main lift, not as the Strength block's primary movement.

PRIORITY RULES (within the pattern constraints above):
- HIGH priority movements get 2+ slots per week. These are the athlete's limiters — give them the most volume.
- MODERATE priority movements get 1 slot per week.
- LOW priority movements get 0-1 slots per week. Do NOT waste training time on movements the athlete is already strong at.
- Follow the hierarchy ordering strictly. If the hierarchy says deadlift is LOW, do not program heavy deadlifts twice a week.
- Vary the specific exercises within a movement pattern across weeks (e.g. for "olympic lifts": clean & jerk one day, snatch complex another).

SKILLS BLOCK RULES (apply when the Skills block appears in a day; NOTE: on Metcon Days the Skills block is a brief 5-8 min PRIMER, NOT progression work):
Use the SKILLS ANALYSIS above to decide skill content. You are the coach — distribute skills intelligently across the days that include a Skills block.
- "Needs Attention" skills are the highest priority. Program their progression track when Skills blocks are available — alternate foundational and advanced variants. Never the same variant twice in a week.
- "Intermediate" skills get exposure to keep progressing.
- "Strong" skills are maintenance only or used as metcon components instead.
- Never program the same skill on consecutive days.
- Related progressions are a single track, not separate skills. For example: strict HSPU, wall-facing HSPU, and deficit HSPU are one progression — pick the variant that matches the athlete's level and periodize across weeks (drill → load → test).
- Vary the drill, not just the movement. Each session should have a different focus angle.
- On Metcon Days, the Skills block is a primer — light activation only, NOT progression work.

ACCESSORY BLOCK RULES:
The Accessory: block is for hypertrophy, weak-point work, injury prevention, and midline/core. It complements the day's Strength and Metcon — do NOT pile on the same muscle groups those blocks are already hitting.
- Program 2-4 movements per session. Scale volume to the athlete's session length: ~45 min session = 1-2 movements, ~60 min = 2-3, ~90 min = 3-4.
- EVERY accessory block MUST include at least one midline/core element (hollow hold, plank variant, L-sit, hanging leg raise, weighted sit-up, Pallof press, or a loaded carry).
- Typical rep schemes: 2-4 sets × 8-15 reps for load-based movements, 30-60s for isometric holds, distance in meters for carries.
- Format each movement as parseable:
  • Load-based: "3x12 DB hammer curls @ 25 lbs"
  • Isometric: "3x30s hollow hold"
  • Distance: "3x40m farmer carry @ 50 lbs/hand"
- Target weak points revealed by the athlete's profile: shoulder health → face pulls, Y-T-W, external rotation; grip → carries, dead hangs; posterior chain → good mornings, GHD raises, reverse hypers.
- If the athlete has flagged INJURIES OR MOVEMENT CONSTRAINTS, use the Accessory block for corrective/prehab work targeting the flagged region (e.g., rotator cuff work for shoulder issues, glute bridges for low back, VMO work for knee pain). Do NOT program movements that aggravate the flagged region.
- Bridge movements (loaded carries, GHD back extensions, anti-rotation work) count toward both the midline requirement AND an accessory slot.
- Week 4 deload: reduce to 1-2 movements at lower volume and intensity.

COOL DOWN BLOCK RULES:
- 2-4 minutes of easy movement (walk, easy row/bike, or light stretching) plus 2-3 static stretches for the day's primary muscle groups.
- Match the focus to what was trained today: hips/quads for squat days, pecs/lats for pressing days, posterior chain for deadlift days.
- Keep it brief, casual, advisory — not a rigid checklist.

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
      const warmupCount = (programText.match(/^Warm-up\s*&\s*Mobility:/gmi) || []).length;
      const skillsCount = (programText.match(/^Skills:/gmi) || []).length;
      const strengthCount = (programText.match(/^Strength:/gmi) || []).length;
      const accessoryCount = (programText.match(/^Accessory:/gmi) || []).length;
      const metconCount = (programText.match(/^Metcon:/gmi) || []).length;
      const cooldownCount = (programText.match(/^Cool\s*down:/gmi) || []).length;
      console.log(`[generate-program] Attempt ${attempt}: ${apiElapsed}s, stop=${stopReason}, tokens=${inputTokens}in/${outputTokens}out, chars=${programText.length}, days=${dayHeaders.length}, blocks=[warmup=${warmupCount},skills=${skillsCount},strength=${strengthCount},accessory=${accessoryCount},metcon=${metconCount},cooldown=${cooldownCount}]`);
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
      // Day count validation — varies by archetype pattern (3, 4, 5, or 6 days/week × 4 weeks).
      const expectedDayCount = daysInMonth;
      const dayOffset = (monthNumber - 1) * expectedDayCount;
      const expectedFirstDay = dayOffset + 1;
      const expectedLastDay = dayOffset + expectedDayCount;
      const daysPerWeek = interpretedProfile.days_per_week;
      if (dayHeaders.length < expectedDayCount) {
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[generate-program] Attempt ${attempt}: only ${dayHeaders.length}/${expectedDayCount} days, retrying with correction...`);
          messages.push({ role: "assistant", content: programText });
          messages.push({ role: "user", content: `That program only contained ${dayHeaders.length} days. It must have exactly ${expectedDayCount} days (Day ${expectedFirstDay} through Day ${expectedLastDay}). Please output the complete program with all ${expectedDayCount} days.` });
          continue;
        }
        throw new Error(`Program contained ${dayHeaders.length}/${expectedDayCount} days after ${MAX_ATTEMPTS} attempts`);
      }
      // Save program directly (bypasses preprocess-program HTTP call)
      console.log(`[generate-program] Saving program inline: ${programText.length} chars, name="${programName}"`);
      // Parse AI output into workouts using Day N: markers (header may include "[Archetype]" suffix)
      const dayParts = programText.replace(/\r\n/g, "\n").split(/^Day (\d+):.*$/mi);
      const parsedWorkouts: { week_num: number; day_num: number; workout_text: string; sort_order: number; day_type: string | null }[] = [];
      // Build lookup of expected archetype per absolute day number for this month
      const archetypeByDayNum = new Map<number, DayArchetype>();
      let dayCounter = 0;
      interpretedProfile.weekly_pattern.weeks.forEach((week) => {
        week.forEach((arch) => {
          dayCounter++;
          archetypeByDayNum.set(dayOffset + dayCounter, arch);
        });
      });
      for (let pi = 1; pi < dayParts.length - 1; pi += 2) {
        const n = parseInt(dayParts[pi], 10);
        const wText = dayParts[pi + 1].trim();
        if (!wText) continue;
        const week_num = Math.ceil((n - dayOffset) / daysPerWeek);
        const day_num = ((n - dayOffset - 1) % daysPerWeek) + 1;
        parsedWorkouts.push({
          week_num,
          day_num,
          workout_text: wText,
          sort_order: n - 1,
          day_type: archetypeByDayNum.get(n) ?? null,
        });
      }
      if (parsedWorkouts.length !== expectedDayCount) {
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[generate-program] Attempt ${attempt}: parsed ${parsedWorkouts.length}/${expectedDayCount} workouts, retrying...`);
          messages.push({ role: "assistant", content: programText });
          messages.push({ role: "user", content: `That program failed validation: Expected exactly ${expectedDayCount} workouts, got ${parsedWorkouts.length}. Please output the complete program with exactly ${expectedDayCount} days (Day ${expectedFirstDay} through Day ${expectedLastDay}), filling in every block of the template.` });
          continue;
        }
        throw new Error(`Expected ${expectedDayCount} workouts, got ${parsedWorkouts.length}`);
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
          messages.push({ role: "user", content: `That program has metcon rule violations:\n${violationList}\n\nPlease fix these violations and output the complete ${expectedDayCount}-day program again.` });
          continue;
        }
        // On final attempt, log but proceed — partial compliance is better than failure
        console.warn(`[generate-program] Final attempt still has ${metconViolations.length} violations — saving anyway`);
      }
      // Shadow classifier — run classify-day-type in parallel for each day.
      // Do NOT gate/retry on mismatches; just collect results for the dataset.
      const classifyStart = Date.now();
      const classifications = await Promise.all(
        parsedWorkouts.map(async (pw) => {
          if (!pw.day_type) return { actual: null as string | null, confidence: null as number | null };
          try {
            const { data, error } = await supa.functions.invoke("classify-day-type", {
              body: { day_text: pw.workout_text, expected_archetype: pw.day_type },
            });
            if (error || !data) return { actual: null, confidence: null };
            const actual = typeof data.actual_archetype === "string" ? data.actual_archetype : null;
            const confidence = typeof data.confidence === "number" ? data.confidence : null;
            return { actual, confidence };
          } catch (err) {
            console.error(`[classify-day-type] error on day ${pw.sort_order + 1}:`, err);
            return { actual: null, confidence: null };
          }
        }),
      );
      const classifyElapsed = ((Date.now() - classifyStart) / 1000).toFixed(1);
      const matchCount = classifications.filter((c, i) => c.actual && c.actual === parsedWorkouts[i].day_type).length;
      const mismatches = classifications
        .map((c, i) => ({ c, expected: parsedWorkouts[i].day_type, dayNum: parsedWorkouts[i].sort_order + 1 }))
        .filter((x) => x.c.actual && x.c.actual !== x.expected);
      console.log(`[generate-program] Classifier (shadow): ${classifyElapsed}s, match=${matchCount}/${classifications.length}, mismatches=${mismatches.length}`);
      for (const m of mismatches) {
        console.log(`  Day ${m.dayNum}: expected=${m.expected}, classified=${m.c.actual} (conf=${m.c.confidence})`);
      }
      // For Month 1: create new program. For Month 2+: append to existing program.
      let progId: string;
      if (isContinuation && existingProgramId) {
        progId = existingProgramId;
        console.log(`[generate-program] Appending month ${monthNumber} to existing program`);
        // Update with current month's pattern + tier (latest snapshot wins)
        await supa
          .from("programs")
          .update({
            weekly_pattern: interpretedProfile.weekly_pattern,
            experience_tier_at_gen: interpretedProfile.effective_tier,
          })
          .eq("id", progId);
      } else {
        const { data: prog, error: progErr } = await supa
          .from("programs")
          .insert({
            user_id: userId,
            name: programName,
            source: "generated",
            weekly_pattern: interpretedProfile.weekly_pattern,
            experience_tier_at_gen: interpretedProfile.effective_tier,
          })
          .select("id")
          .single();
        if (progErr || !prog) throw new Error("Failed to create program");
        progId = prog.id;
        console.log("[generate-program] Created new program");
      }
      // Insert workouts with month_number, day_type, and shadow classifier output
      const wkRows = parsedWorkouts.map((pw, i) => ({
        program_id: progId,
        week_num: pw.week_num,
        day_num: pw.day_num,
        workout_text: pw.workout_text,
        sort_order: pw.sort_order,
        month_number: monthNumber,
        day_type: pw.day_type,
        classified_archetype: classifications[i]?.actual ?? null,
        classified_confidence: classifications[i]?.confidence ?? null,
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
      // Extract and insert blocks. Block set varies by archetype, so try all
      // possible headers and only persist the ones actually present.
      const BLOCK_LABELS = ["Warm-up & Mobility", "Skills", "Strength", "Accessory", "Metcon", "Active Recovery", "Cool down"];
      const BLOCK_TYPE_MAP: Record<string, string> = {
        "warm-up & mobility": "warm-up",
        "skills": "skills",
        "strength": "strength",
        "accessory": "accessory",
        "metcon": "metcon",
        "active recovery": "active-recovery",
        "cool down": "cool-down",
      };
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

    // Server-side one-program limit for Month 1 generation. Defense-in-depth
    // covering races, double-submits, multi-tab, and any UI gate drift.
    // Admins bypass both checks for testing.
    if (monthNumber === 1) {
      const { data: adminProfile } = await supa
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      const isAdmin = adminProfile?.role === "admin";

      if (!isAdmin) {
        // Check 1: is there an in-flight generation job for this user?
        const { data: activeJobs } = await supa
          .from("program_jobs")
          .select("id, status, updated_at")
          .eq("user_id", user.id)
          .in("status", ["pending", "processing"]);
        // Guard against stale jobs (stuck over 10 minutes — treat as abandoned)
        const liveJob = activeJobs?.find((j) => {
          const updated = j.updated_at ? new Date(j.updated_at).getTime() : 0;
          return Date.now() - updated < 10 * 60 * 1000;
        });
        if (liveJob) {
          return new Response(
            JSON.stringify({
              error: "GENERATION_IN_PROGRESS",
              message: "A program is already being generated. Please wait for it to finish.",
              job_id: liveJob.id,
            }),
            { status: 409, headers: { ...cors, "Content-Type": "application/json" } }
          );
        }

        // Check 2: does the user already have a completed generated program?
        const { count: existingCount } = await supa
          .from("programs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("source", "generated");
        if ((existingCount ?? 0) > 0) {
          return new Response(
            JSON.stringify({
              error: "PROGRAM_EXISTS",
              message: "You already have a generated program. Delete it to start a new one.",
            }),
            { status: 409, headers: { ...cors, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Gate first-month generation on complete T3 (training context). Month 2+
    // runs off an existing program, so we don't re-gate mid-program.
    if (monthNumber === 1) {
      const { data: athleteProfile } = await supa
        .from("athlete_profiles")
        .select("lifts, skills, conditioning, equipment, bodyweight, units, age, height, gender, days_per_week, session_length_minutes, injuries_constraints, goal, self_perception_level")
        .eq("user_id", user.id)
        .maybeSingle();
      const tierStatus = getTierStatus(athleteProfile);
      if (!tierStatus.canRunPrograms) {
        const missing = [
          ...tierStatus.tier1.missing.map((f) => `basics.${f}`),
          ...tierStatus.tier2.missing.map((f) => `athletic.${f}`),
          ...tierStatus.tier3.missing.map((f) => `training_context.${f}`),
        ];
        return new Response(
          JSON.stringify({
            error: "TIER_INCOMPLETE",
            message: "Fill in your training context to generate a program tailored to your week.",
            missing_fields: missing,
          }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    }
    // Fetch evaluation: use provided id, or most recent
    let evalRow: {
      id?: string;
      profile_snapshot: ProfileData;
      analysis: string | null;
      status?: string | null;
    } | null = null;
    if (evaluationId) {
      const { data } = await supa
        .from("profile_evaluations")
        .select("id, profile_snapshot, analysis, status")
        .eq("id", evaluationId)
        .eq("user_id", user.id)
        .maybeSingle();
      evalRow = data;
    }
    if (!evalRow) {
      // Fall back to the most recent COMPLETED evaluation. Pending/failed
      // rows (from the async job pattern) would have analysis=null and
      // shouldn't be used to generate a program.
      const { data } = await supa
        .from("profile_evaluations")
        .select("id, profile_snapshot, analysis, status")
        .eq("user_id", user.id)
        .eq("status", "complete")
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
    // Reject an explicitly-specified evaluation that's still pending/failed.
    if (evalRow.status && evalRow.status !== "complete") {
      return new Response(
        JSON.stringify({
          error: "EVALUATION_NOT_READY",
          message: `Evaluation is ${evalRow.status}. Wait for it to finish or re-run it.`,
        }),
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
