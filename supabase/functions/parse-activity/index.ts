/**
 * parse-activity — free-text and/or screenshot outside-workout entry →
 * structured, athlete-confirmable JSON.
 *
 * v2: block-aligned taxonomy + per-type contracts. The model classifies each
 * described workout as conditioning / metcon / strength / skills / other and
 * extracts the fields that category actually has:
 *   conditioning → calories (erg-native), distance, modality
 *   metcon       → score ("4:13", "12+7") as a RESULT, never a duration
 *   strength/skills → movement + sets/reps/weight (flat single-movement case;
 *                     multi-movement detail stays in the JSON blob)
 * Returns an ARRAY (an entry may describe several activities — a watch daily
 * summary, a two-session day). `parsed` mirrors activities[0] so pre-v2
 * clients keep working across the deploy boundary.
 *
 * Images: an optional screenshot (erg display, watch summary, whiteboard) is
 * read via callClaudeVision; accompanying text is athlete context.
 *
 * Parse-only: this function never writes — the client saves the confirmed
 * rows via RLS. Same free-text→AI→structured→show-back idiom as
 * parse-injuries-constraints.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { callClaude, callClaudeVision } from "../_shared/call-claude.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const WORKOUT_TYPES = ["conditioning", "metcon", "strength", "skills", "other"] as const;
const ACTIVITY_TYPES = ["ride", "run", "swim", "row", "ski", "hike", "walk", "strength", "sport", "mobility", "test", "other"] as const;
const IMAGE_TYPES: Record<string, string> = { jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
// Anthropic caps images at 5MB; base64 inflates ~4/3, so cap the payload there.
const MAX_IMAGE_B64 = 6_800_000;

const SYSTEM_PROMPT =
  `You parse an athlete's description of training they did (free text, and/or a photo of a machine display, ` +
  `watch summary, fitness-app screen, or whiteboard) into strict JSON. ` +
  `Extract ONLY what is stated or clearly visible — never invent numbers. When a photo is present, read the ` +
  `numbers off it; any text is the athlete's added context.\n\n` +
  `Output ONLY a JSON object (no prose, no fences): { "activities": [ ... ] } — one entry per distinct ` +
  `activity described (usually one; a daily summary or multi-session day may yield several, max 4).\n\n` +
  `Each activity has these fields (null when not stated):\n` +
  `- workout_type: one of ${JSON.stringify(WORKOUT_TYPES)}\n` +
  `    conditioning = steady or interval monostructural work (erg, run, ride, swim, ski)\n` +
  `    metcon = a scored mixed-modal workout (rounds/reps/for-time/AMRAP)\n` +
  `    strength = barbell/dumbbell lifting incl. accessory volume work\n` +
  `    skills = gymnastics or technique practice (pull-ups, HSPU, DU practice)\n` +
  `    other = sport, hike, mobility, anything else\n` +
  `- activity_type: one of ${JSON.stringify(ACTIVITY_TYPES)} — for conditioning this is the modality ` +
  `(echo/assault/any bike → "ride", erg row → "row", ski erg → "ski"); "test" when it is a deliberate max-effort benchmark test\n` +
  `- duration_minutes: number | null — how long they worked. For a metcon, do NOT put the score here.\n` +
  `- rpe: number 1-10 | null (map effort words: easy/zone 2≈4, moderate≈6, hard≈8, max≈10 — only when effort is described)\n` +
  `- avg_hr: number | null, peak_hr: number | null\n` +
  `- summary: one short line restating the activity (e.g. "Echo bike, 60 min zone 2, 489 cal")\n` +
  `- calories: number | null — total calories for erg/machine work. Erg calories ALWAYS go here, never in distance.\n` +
  `- distance: number | null, distance_unit: string | null (as stated: km, mi, m — actual distances only, never calories)\n` +
  `- score: string | null — a metcon's RESULT exactly as scored: a time ("4:13"), rounds+reps ("12+7"), or total reps. ` +
  `Metcons only; null elsewhere.\n` +
  `- movement: string | null, sets: number | null, reps: number | null, weight: number | null, ` +
  `weight_unit: "lbs" | "kg" | null — for strength/skills work with ONE primary movement ("5x8 pull-ups" → ` +
  `movement "Pull-Up", sets 5, reps 8). reps is PER SET. For multi-movement work leave these null and list the ` +
  `movements in "detail" instead.\n` +
  `- detail: null, or { "movements": [ { "movement", "reps_scheme", "weight", "weight_unit" } ] } for ` +
  `multi-movement workouts (e.g. a 21-15-9 couplet) — reps_scheme as stated ("21-15-9", "5x10").\n` +
  `- is_benchmark: boolean — true ONLY for a deliberate max-effort test with a measurable result ` +
  `(FTP test, 1RM test, 5k time trial, max rep test). A regular scored metcon is NOT a benchmark.\n` +
  `- benchmark: null, or when is_benchmark: { "name": short stable test name (e.g. "bike erg 20:00 FTP", ` +
  `"5k run", "max strict pull-ups"), "value": number, "unit": string (W, kg, lb, reps, seconds — for times, use seconds) }\n`;

const json = (body: unknown, cors: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && isFinite(v) && v > lo && v < hi ? Math.round(v * 100) / 100 : null;

const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = num(v, lo, hi);
  return n == null ? null : Math.round(n);
};

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

// Exported for unit tests — the confirm card renders this verbatim, so the
// clamp layer is the correctness boundary.
// deno-lint-ignore no-explicit-any
export function clampActivity(p: any, fallbackSummary: string) {
  const workoutType = WORKOUT_TYPES.includes(p?.workout_type) ? p.workout_type : "other";
  const activityType = ACTIVITY_TYPES.includes(p?.activity_type) ? p.activity_type : "other";
  const isBenchmark = p?.is_benchmark === true && p?.benchmark && typeof p.benchmark.name === "string" && typeof p.benchmark.value === "number";
  // Multi-movement detail passes through lightly bounded — it lives in the
  // JSONB blob, not in typed columns, so shape-tolerance beats strictness.
  let detail: { movements: unknown[] } | null = null;
  if (Array.isArray(p?.detail?.movements) && p.detail.movements.length > 0) {
    detail = { movements: p.detail.movements.slice(0, 12) };
  }
  const parsed = {
    workout_type: workoutType,
    activity_type: activityType,
    duration_minutes: int(p?.duration_minutes, 0, 1440),
    rpe: num(p?.rpe, 0, 11),
    avg_hr: int(p?.avg_hr, 39, 251),
    peak_hr: int(p?.peak_hr, 39, 251),
    summary: str(p?.summary, 200) ?? fallbackSummary,
    calories: num(p?.calories, 0, 100000),
    distance: num(p?.distance, 0, 100000),
    distance_unit: str(p?.distance_unit, 10),
    score: workoutType === "metcon" ? str(p?.score, 40) : null,
    movement: str(p?.movement, 80),
    sets: int(p?.sets, 0, 51),
    reps: int(p?.reps, 0, 1001),
    weight: num(p?.weight, 0, 2000),
    weight_unit: p?.weight_unit === "kg" ? "kg" : p?.weight_unit === "lbs" ? "lbs" : null,
    detail,
    is_benchmark: isBenchmark,
    benchmark: isBenchmark
      ? {
          name: String(p.benchmark.name).slice(0, 80),
          value: num(p.benchmark.value, 0, 10_000_000) ?? 0,
          unit: typeof p.benchmark.unit === "string" ? p.benchmark.unit.slice(0, 20) : "",
        }
      : null,
  };
  if (parsed.is_benchmark && (!parsed.benchmark || parsed.benchmark.value <= 0)) {
    parsed.is_benchmark = false;
    parsed.benchmark = null;
  }
  return parsed;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, cors, 401);
    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: { user }, error: authErr } = await supa.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "Unauthorized" }, cors, 401);

    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 2000) : "";
    const imageB64 = typeof body?.image_base64 === "string" ? body.image_base64 : "";
    const imageType = typeof body?.image_type === "string" ? IMAGE_TYPES[body.image_type.toLowerCase()] : undefined;
    if (imageB64 && !imageType) return json({ error: "Unsupported image type (use jpeg, png, or webp)" }, cors, 400);
    if (imageB64.length > MAX_IMAGE_B64) return json({ error: "Image too large — try a smaller photo" }, cors, 400);
    if (text.length < 3 && !imageB64) return json({ error: "Describe the workout or attach a photo" }, cors, 400);
    if (!ANTHROPIC_API_KEY) return json({ error: "AI not configured" }, cors, 500);

    const raw = imageB64
      ? await callClaudeVision({
          apiKey: ANTHROPIC_API_KEY,
          system: SYSTEM_PROMPT,
          images: [{ base64: imageB64, mediaType: imageType! }],
          textPrompt: text || "Parse the training shown in this image.",
          maxTokens: 900,
        })
      : await callClaude({
          apiKey: ANTHROPIC_API_KEY,
          system: SYSTEM_PROMPT,
          userContent: text,
          maxTokens: 900,
        });

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "Could not parse that — try rewording" }, cors, 422);
    // deno-lint-ignore no-explicit-any
    let p: any;
    try {
      p = JSON.parse(match[0]);
    } catch {
      return json({ error: "Could not parse that — try rewording" }, cors, 422);
    }

    // Accept both shapes: v2 {activities:[...]} and a bare single object.
    const rawActivities: unknown[] = Array.isArray(p?.activities) ? p.activities.slice(0, 4) : [p];
    const fallbackSummary = (text || "Logged activity").slice(0, 120);
    const activities = rawActivities.map((a) => clampActivity(a, fallbackSummary));
    if (activities.length === 0) return json({ error: "Could not parse that — try rewording" }, cors, 422);

    // `parsed` mirrors the first activity for pre-v2 clients across the
    // deploy boundary.
    return json({ activities, parsed: activities[0] }, cors);
  } catch (e) {
    console.error("[parse-activity] error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, cors, 500);
  }
});
