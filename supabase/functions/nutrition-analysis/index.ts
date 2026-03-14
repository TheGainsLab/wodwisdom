import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAndFormatRecentHistory } from "../_shared/training-history.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const SYSTEM_PROMPT = `You are an expert sports-nutrition coach reviewing an athlete's food logs alongside their training and profile data. You give quantitative analysis first — calories, macros, targets — then layer in practical recommendations grounded in those numbers. Write like a coach: direct, specific, no filler.`;

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
  tdee_override?: number | null;
}

interface FoodEntry {
  food_name: string;
  calories: number | null;
  protein: number | null;
  carbohydrate: number | null;
  fat: number | null;
  fiber: number | null;
  meal_type: string | null;
  number_of_units: number;
  serving_description: string | null;
  logged_at: string;
}

function formatProfile(profile: ProfileData): string {
  const parts: string[] = [];
  const u = profile.units === "kg" ? "kg" : "lbs";
  if (profile.age != null && profile.age > 0) parts.push(`Age: ${profile.age}`);
  if (profile.height != null && profile.height > 0) parts.push(`Height: ${profile.height} ${profile.units === "kg" ? "cm" : "in"}`);
  if (profile.bodyweight && profile.bodyweight > 0) parts.push(`Bodyweight: ${profile.bodyweight} ${u}`);
  if (profile.gender) parts.push(`Gender: ${profile.gender}`);
  return parts.join("\n") || "No profile data.";
}

/** Estimate TDEE using Mifflin-St Jeor. Returns null if data is incomplete. */
function estimateTDEE(profile: ProfileData): number | null {
  if (profile.tdee_override && profile.tdee_override > 0) return profile.tdee_override;
  const { bodyweight, height, age, gender, units } = profile;
  if (!bodyweight || !height || !age || !gender) return null;
  if (gender !== "male" && gender !== "female") return null;
  const weightKg = units === "lbs" ? bodyweight * 0.453592 : bodyweight;
  const heightCm = units === "lbs" ? height * 2.54 : height;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const bmr = gender === "male" ? base + 5 : base - 161;
  return Math.round(bmr * 1.6); // activity multiplier for CrossFit athletes
}

/** Estimate macro targets based on bodyweight and training. */
function estimateMacroTargets(profile: ProfileData, tdee: number): string {
  const bw = profile.bodyweight;
  if (!bw || bw <= 0) return "";
  const u = profile.units === "kg" ? "kg" : "lbs";
  const bwKg = u === "lbs" ? bw * 0.453592 : bw;

  // Protein: 1.6-2.2 g/kg for strength athletes
  const proteinLow = Math.round(bwKg * 1.6);
  const proteinHigh = Math.round(bwKg * 2.2);
  // Fat: 25-30% of TDEE
  const fatLow = Math.round((tdee * 0.25) / 9);
  const fatHigh = Math.round((tdee * 0.30) / 9);
  // Carbs: remainder
  const proteinMid = Math.round((proteinLow + proteinHigh) / 2);
  const fatMid = Math.round((fatLow + fatHigh) / 2);
  const carbCals = tdee - proteinMid * 4 - fatMid * 9;
  const carbs = Math.round(carbCals / 4);

  return `Estimated targets: Protein ${proteinLow}-${proteinHigh}g/day (1.6-2.2 g/kg), Fat ${fatLow}-${fatHigh}g/day (25-30% cals), Carbs ~${carbs}g/day (remainder).`;
}

/** Group food entries by date and compute daily totals + per-meal breakdown. */
function formatNutritionLog(entries: FoodEntry[]): { summary: string; snapshot: object } {
  // Group by date
  const byDate: Record<string, FoodEntry[]> = {};
  for (const e of entries) {
    const date = e.logged_at.slice(0, 10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(e);
  }

  const sortedDates = Object.keys(byDate).sort();
  const dailyTotals: { date: string; calories: number; protein: number; carbs: number; fat: number; fiber: number; meals: number }[] = [];
  const lines: string[] = [];

  for (const date of sortedDates) {
    const dayEntries = byDate[date];
    let dayCal = 0, dayPro = 0, dayCarb = 0, dayFat = 0, dayFiber = 0;

    const mealLines: string[] = [];
    for (const e of dayEntries) {
      const cal = e.calories ?? 0;
      const pro = e.protein ?? 0;
      const carb = e.carbohydrate ?? 0;
      const fat = e.fat ?? 0;
      const fib = e.fiber ?? 0;
      dayCal += cal;
      dayPro += pro;
      dayCarb += carb;
      dayFat += fat;
      dayFiber += fib;
      const meal = e.meal_type ? `[${e.meal_type.replace(/_/g, " ")}]` : "";
      mealLines.push(`  ${meal} ${e.food_name} (${e.number_of_units}x ${e.serving_description || "serving"}) — ${Math.round(cal)} cal, ${Math.round(pro)}P/${Math.round(carb)}C/${Math.round(fat)}F`);
    }

    dailyTotals.push({ date, calories: Math.round(dayCal), protein: Math.round(dayPro), carbs: Math.round(dayCarb), fat: Math.round(dayFat), fiber: Math.round(dayFiber), meals: dayEntries.length });

    lines.push(`${date} — ${Math.round(dayCal)} cal | ${Math.round(dayPro)}P / ${Math.round(dayCarb)}C / ${Math.round(dayFat)}F | ${Math.round(dayFiber)}g fiber | ${dayEntries.length} items`);
    lines.push(...mealLines);
    lines.push("");
  }

  // Compute averages
  const n = dailyTotals.length;
  if (n === 0) return { summary: "", snapshot: { days: 0 } };

  const avg = {
    calories: Math.round(dailyTotals.reduce((s, d) => s + d.calories, 0) / n),
    protein: Math.round(dailyTotals.reduce((s, d) => s + d.protein, 0) / n),
    carbs: Math.round(dailyTotals.reduce((s, d) => s + d.carbs, 0) / n),
    fat: Math.round(dailyTotals.reduce((s, d) => s + d.fat, 0) / n),
    fiber: Math.round(dailyTotals.reduce((s, d) => s + d.fiber, 0) / n),
    items: Math.round(dailyTotals.reduce((s, d) => s + d.meals, 0) / n),
  };

  const header = `NUTRITION LOG — ${n} days logged\nDaily averages: ${avg.calories} cal | ${avg.protein}P / ${avg.carbs}C / ${avg.fat}F | ${avg.fiber}g fiber | ~${avg.items} items/day\n\n`;

  return {
    summary: header + lines.join("\n"),
    snapshot: { days: n, dailyTotals, averages: avg },
  };
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

    // Fetch profile, food entries (7 days), and recent training in parallel
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [profileRes, foodRes, recentTraining] = await Promise.all([
      supa
        .from("athlete_profiles")
        .select("lifts, skills, conditioning, bodyweight, units, age, height, gender, tdee_override")
        .eq("user_id", user.id)
        .maybeSingle(),
      supa
        .from("food_entries")
        .select("food_name, calories, protein, carbohydrate, fat, fiber, meal_type, number_of_units, serving_description, logged_at")
        .eq("user_id", user.id)
        .gte("logged_at", sevenDaysAgo)
        .order("logged_at", { ascending: true }),
      fetchAndFormatRecentHistory(supa, user.id, { days: 7, maxLines: 30 }),
    ]);

    const profileData: ProfileData = profileRes.data || {};
    const foodEntries: FoodEntry[] = foodRes.data || [];

    if (foodEntries.length === 0) {
      return new Response(
        JSON.stringify({
          analysis: "No food logs found in the past 7 days. Log some meals first, then come back for a nutrition analysis.",
        }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const { summary: nutritionSummary, snapshot: nutritionSnapshot } = formatNutritionLog(foodEntries);
    const profileStr = formatProfile(profileData);
    const tdee = estimateTDEE(profileData);
    const macroTargets = tdee ? estimateMacroTargets(profileData, tdee) : "";
    const trainingBlock = recentTraining ? `\n\nRECENT TRAINING (same 7-day window):\n${recentTraining}` : "";

    // Build completeness caveat
    const daysLogged = new Set(foodEntries.map((e) => e.logged_at.slice(0, 10))).size;
    const completenessNote = daysLogged < 4
      ? `\n\nNOTE: Only ${daysLogged} of 7 days have food logs. Acknowledge this data gap — analysis may not reflect full eating patterns.`
      : "";

    const userPrompt = `Here is an athlete's profile:\n\n${profileStr}\n${tdee ? `Estimated TDEE: ~${tdee} cal/day\n` : ""}${macroTargets ? `${macroTargets}\n` : ""}\n${nutritionSummary}${trainingBlock}${completenessNote}\n\nAnalyze this athlete's nutrition over the logged period. Your evaluation MUST follow this structure:\n\n1. **Quantitative Summary** — Daily calorie average vs estimated TDEE (surplus/deficit and by how much). Daily protein average vs target range. Daily carb and fat averages vs targets. Note any days that are significant outliers.\n\n2. **Training-Nutrition Match** — Cross-reference food intake with training days. Are they fueling adequately on heavy training days? Are rest days adjusted? Is there pre/post workout nutrition (check meal types)?\n\n3. **Consistency & Patterns** — How consistent is daily intake? Weekend vs weekday differences? Skipped meals or long gaps? Meal frequency and distribution.\n\n4. **Top 3 Priorities** — The three highest-impact changes, each grounded in a specific number from the analysis. Format each as: the quantitative gap, then a practical recommendation to close it.\n\nEvery recommendation must follow from a number. "You averaged X but need Y, so do Z." Be direct, specific, and concise. Short paragraphs, no bullet-point lists.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        stream: false,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error("Claude API error:", err);
      throw new Error("Failed to generate nutrition analysis");
    }

    const data = await resp.json();
    const analysis = data.content?.[0]?.text?.trim() || "Unable to generate analysis.";

    // Save nutrition evaluation
    const evalRow = {
      user_id: user.id,
      analysis,
      nutrition_snapshot: nutritionSnapshot,
      profile_snapshot: {
        bodyweight: profileData.bodyweight ?? null,
        units: profileData.units || "lbs",
        age: profileData.age ?? null,
        height: profileData.height ?? null,
        gender: profileData.gender ?? null,
      },
      training_snapshot: recentTraining || "",
    };

    const { data: savedEval, error: insertErr } = await supa
      .from("nutrition_evaluations")
      .insert(evalRow)
      .select("id, created_at")
      .single();

    if (insertErr) {
      console.error("Failed to save nutrition evaluation:", insertErr);
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
