/**
 * gym-services — the generation seam (SERVICE_API_CONTRACT v2; Decision 12a).
 *
 * THE GENERATION RULE: wodwisdom GENERATES; everything generated LIVES ON THE
 * PLATFORM; wodwisdom is NEVER in the member's runtime path. This function is
 * invoked by the AFFILIATE BACKEND at block boundaries only. Zero member
 * identity in any request or response; nothing is stored here.
 *
 * Action: engine_generate_block
 *   { gym_id, program?, prefs?, athlete?: { baseline }, history?: [...], memo? }
 *   → { block: { label, days: [ResolvedEngineDay…] }, memo }
 *   `program` picks one of the authored engine_programs (default main_5day);
 *   every program is an ordered mapping (engine_program_mapping: sequence →
 *   catalog day, with its own month splits) over the main_5day catalog. The
 *   memo is { v: 1, program, next_seq } — legacy next_day memos migrate
 *   forward as next_seq (identity for main_5day).
 *
 * Action: engine_programs
 *   { gym_id } → { programs: [{ id, name, description, days_per_week,
 *   total_days, total_months }] } — the choice catalog, fetched by the
 *   affiliate at CHOICE moments only (a generation-adjacent moment; never
 *   per view).
 *
 * Action: nutrition_evaluate (SERVICE_API_CONTRACT §2.3 — batch/stateless)
 *   { gym_id, attrs: { bodyweight, height, age, gender, units },
 *     targets?: { calories, protein_g, carbs_g, fat_g },
 *     days: [{ date, calories, protein, carbohydrate, fat }] }
 *   → { analysis }
 *   The monthly AI nutrition evaluation from EXPLICIT anonymous inputs —
 *   daily totals in, coach-voice analysis out, nothing stored. The affiliate
 *   frequency-caps it and owns the stored result.
 *
 * Semantics: the block is the next mapped month of the chosen program, each
 * day expanded into its concrete segment timeline with pace FRACTIONS +
 * scoring_params (the member app multiplies by its locally stored baseline —
 * engine_ratio_v1). Bootstrap (memo null) starts at sequence 1. Day refs are
 * sequence-keyed and program-scoped ('{program}:d{seq}'; main_5day keeps its
 * legacy bare 'd{N}' — identity mapping). `athlete` / `history` are ACCEPTED
 * and currently unused (reserved for the adaptive sequencer — a later rev).
 *
 * Auth: the tenant-bound wholesale consumer-key family (_shared/consumer-auth.ts).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createConsumerAuth } from "../_shared/consumer-auth.ts";
import {
  resolveEngineDay,
  type CatalogEngineDay,
} from "../_shared/engine-block-resolve.ts";
import { MODELS } from "../_shared/model-profiles.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const auth = createConsumerAuth({
  serviceKey: Deno.env.get("WHOLESALE_SERVICE_KEY"),
  consumerKeysRaw: Deno.env.get("WHOLESALE_CONSUMER_KEYS"),
  label: "gym-services",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROGRAM = "main_5day"; // v1: the authored catalog progression
const CATALOG_MAX_DAY = 720;

// ── nutrition_evaluate — the retail evaluation's voice, from explicit inputs ─

const NUTRITION_SYSTEM_PROMPT =
  `You are an expert sports-nutrition coach reviewing an athlete's food logs alongside their training and profile data. You give quantitative analysis first — calories, macros, targets — then layer in practical recommendations grounded in those numbers. Write like a coach: direct, specific, no filler.`;

interface EvalAttrs { bodyweight: number; height: number; age: number; gender: string; units: string }
interface EvalDay { date: string; calories: number; protein: number; carbohydrate: number; fat: number }

/** Mifflin-St Jeor × 1.6 — same estimate the retail evaluation uses. */
function estimateTDEE(a: EvalAttrs): number {
  const kg = a.units === "kg" ? a.bodyweight : a.bodyweight * 0.453592;
  const cm = a.units === "kg" ? a.height : a.height * 2.54;
  const base = 10 * kg + 6.25 * cm - 5 * a.age;
  return Math.round((a.gender === "female" ? base - 161 : base + 5) * 1.6);
}

async function runNutritionEvaluate(attrs: EvalAttrs, targets: Record<string, number> | null, days: EvalDay[]) {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) throw new Error("evaluation_not_configured");

  const tdee = estimateTDEE(attrs);
  const kg = attrs.units === "kg" ? attrs.bodyweight : attrs.bodyweight * 0.453592;
  const n = days.length;
  const avg = {
    calories: Math.round(days.reduce((s, d) => s + d.calories, 0) / n),
    protein: Math.round(days.reduce((s, d) => s + d.protein, 0) / n),
    carbs: Math.round(days.reduce((s, d) => s + d.carbohydrate, 0) / n),
    fat: Math.round(days.reduce((s, d) => s + d.fat, 0) / n),
  };
  const lines = days.map((d) =>
    `${d.date} — ${Math.round(d.calories)} cal | ${Math.round(d.protein)}P / ${Math.round(d.carbohydrate)}C / ${Math.round(d.fat)}F`);
  const targetsLine = targets
    ? `Daily targets: ${targets.calories ?? "?"} cal, ${targets.protein_g ?? "?"}g protein, ${targets.carbs_g ?? "?"}g carbs, ${targets.fat_g ?? "?"}g fat.`
    : `Estimated targets: protein ${Math.round(kg * 1.6)}-${Math.round(kg * 2.2)}g/day, fat ${Math.round((tdee * 0.25) / 9)}-${Math.round((tdee * 0.30) / 9)}g/day, carbs the remainder.`;
  const completeness = n < 20
    ? `\n\nNOTE: Only ${n} of the last 30 days have food logs. Acknowledge this data gap — the analysis may not reflect full eating patterns.`
    : "";

  const userPrompt = `Here is an athlete's profile:\n\nBodyweight: ${attrs.bodyweight} ${attrs.units}\nHeight: ${attrs.height} ${attrs.units === "kg" ? "cm" : "in"}\nAge: ${attrs.age}\nGender: ${attrs.gender}\nEstimated TDEE: ~${tdee} cal/day\n${targetsLine}\n\nNUTRITION LOG — ${n} days logged (last 30 days)\nDaily averages: ${avg.calories} cal | ${avg.protein}P / ${avg.carbs}C / ${avg.fat}F\n\n${lines.join("\n")}${completeness}\n\nThis athlete trains at a CrossFit gym (assume 3-5 sessions/week of mixed strength + conditioning). Analyze their nutrition over the logged period. Your evaluation MUST follow this structure:\n\n1. **Quantitative Summary** — Daily calorie average vs estimated TDEE (surplus/deficit and by how much). Daily protein average vs target. Daily carb and fat averages vs targets. Note any days that are significant outliers.\n\n2. **Consistency & Patterns** — How consistent is daily intake? Weekend vs weekday differences? Gaps in logging?\n\n3. **Top 3 Priorities** — The three highest-impact changes, each grounded in a specific number from the analysis. Format each as: the quantitative gap, then a practical recommendation to close it.\n\nEvery recommendation must follow from a number. "You averaged X but need Y, so do Z." Be direct, specific, and concise. Short paragraphs, no bullet-point lists.`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELS.sonnet,
      max_tokens: 1500,
      system: NUTRITION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!resp.ok) {
    console.error("[gym-services] evaluation model error", resp.status, await resp.text().catch(() => ""));
    throw new Error("evaluation_failed");
  }
  const data = await resp.json();
  const analysis: string = data.content?.[0]?.text?.trim();
  if (!analysis) throw new Error("evaluation_failed");
  return analysis;
}

interface Memo {
  v: number;
  program: string;
  next_seq: number;
}

function parseMemo(raw: unknown, program: string): Memo | { error: string } {
  if (raw === null || raw === undefined) return { v: 1, program, next_seq: 1 };
  if (typeof raw !== "object") return { error: "memo must be an object or null" };
  const m = raw as Record<string, unknown>;
  // Migrate-forward (contract §3): legacy memos carried next_day; for
  // main_5day the mapping is the identity, so next_day IS next_seq.
  const nextSeq = typeof m.next_seq === "number" ? m.next_seq
    : typeof m.next_day === "number" ? m.next_day : NaN;
  if (!Number.isInteger(nextSeq) || nextSeq < 1) return { error: "memo.next_seq invalid" };
  if (nextSeq > CATALOG_MAX_DAY) return { error: "progression_complete" };
  // The memo's program wins over the request's when both present — a stored
  // memo belongs to the progression it came from.
  const memoProgram = typeof m.program === "string" && m.program ? m.program : program;
  return { v: 1, program: memoProgram, next_seq: nextSeq };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!auth.configured()) return json({ error: "config_missing_wholesale_key" }, 500);
  const presentedKey = req.headers.get("x-service-key");
  if (!presentedKey) return json({ error: "forbidden" }, 401);
  const authResult = await auth.authorize(presentedKey);
  if (!authResult) return json({ error: "forbidden" }, 401);
  const { authz } = authResult;

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return json({ error: "invalid_json" }, 400); }

  const gymId = typeof body.gym_id === "string" ? body.gym_id : "";
  if (!UUID_RE.test(gymId)) return json({ error: "invalid_request", detail: "gym_id must be a uuid" }, 400);
  if (!auth.authorizes(authz, gymId)) {
    return json({ error: "tenant_forbidden", detail: "key not authorized for gym_id" }, 403);
  }

  const action = typeof body.action === "string" ? body.action : "";

  // ── engine_programs — the choice catalog (choice moments only) ──
  if (action === "engine_programs") {
    const supaList = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await supaList
      .from("engine_programs")
      .select("id, name, description, days_per_week, total_days, total_months")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) return json({ error: "read_failed", detail: error.message }, 500);
    return json({ programs: data ?? [] });
  }

  // ── nutrition_evaluate — stateless: explicit inputs → analysis, no reads ──
  if (action === "nutrition_evaluate") {
    const a = body.attrs as Partial<EvalAttrs> | undefined;
    const bodyweight = Number(a?.bodyweight);
    const height = Number(a?.height);
    const age = Number(a?.age);
    if (!Number.isFinite(bodyweight) || bodyweight <= 0 ||
        !Number.isFinite(height) || height <= 0 ||
        !Number.isFinite(age) || age <= 0) {
      return json({ error: "invalid_request", detail: "attrs.bodyweight/height/age required" }, 400);
    }
    const attrs: EvalAttrs = {
      bodyweight, height, age,
      gender: a?.gender === "female" ? "female" : "male",
      units: a?.units === "kg" ? "kg" : "lbs",
    };
    const daysRaw = Array.isArray(body.days) ? body.days as Partial<EvalDay>[] : [];
    const days = daysRaw
      .filter((d) => typeof d?.date === "string" && Number.isFinite(Number(d?.calories)))
      .map((d) => ({
        date: d.date as string,
        calories: Number(d.calories), protein: Number(d.protein) || 0,
        carbohydrate: Number(d.carbohydrate) || 0, fat: Number(d.fat) || 0,
      }));
    if (days.length < 3) {
      return json({ error: "invalid_request", detail: "at least 3 logged days required" }, 400);
    }
    const targets = (body.targets && typeof body.targets === "object")
      ? body.targets as Record<string, number> : null;
    try {
      const analysis = await runNutritionEvaluate(attrs, targets, days.slice(0, 31));
      console.log(JSON.stringify({
        at: "gym-services", event: "nutrition_evaluate", gym_id: gymId, days: days.length,
      }));
      return json({ analysis });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "internal";
      const status = msg === "evaluation_not_configured" ? 500 : 502;
      return json({ error: msg }, status);
    }
  }

  if (action !== "engine_generate_block") {
    return json({ error: "invalid_request", detail: "action must be engine_generate_block, engine_programs, or nutrition_evaluate" }, 400);
  }

  const requestedProgram = typeof body.program === "string" && body.program ? body.program : PROGRAM;
  const memo = parseMemo(body.memo, requestedProgram);
  if ("error" in memo) {
    if (memo.error === "progression_complete") {
      return json({ error: "progression_complete", detail: "the member has completed the full catalog" }, 409);
    }
    return json({ error: "invalid_request", detail: memo.error }, 400);
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Validate the program against the authored registry.
  const { data: progRow, error: progErr } = await supa
    .from("engine_programs")
    .select("id, total_days")
    .eq("id", memo.program)
    .eq("is_active", true)
    .maybeSingle();
  if (progErr) return json({ error: "read_failed", detail: progErr.message }, 500);
  if (!progRow) return json({ error: "invalid_request", detail: `unknown program '${memo.program}'` }, 400);
  if (memo.next_seq > (progRow as { total_days: number }).total_days) {
    return json({ error: "progression_complete", detail: "the member has completed this program" }, 409);
  }

  // The program's mapping owns sequence order AND month splits: probe the
  // month at next_seq, then take everything remaining in that month.
  const { data: probe, error: probeErr } = await supa
    .from("engine_program_mapping")
    .select("month")
    .eq("engine_program_id", memo.program)
    .eq("program_sequence_order", memo.next_seq)
    .maybeSingle();
  if (probeErr) return json({ error: "read_failed", detail: probeErr.message }, 500);
  if (!probe) return json({ error: "progression_complete", detail: "no mapped day at position" }, 409);
  const month = (probe as { month: number }).month;

  const { data: mapRows, error: mapErr } = await supa
    .from("engine_program_mapping")
    .select("program_sequence_order, engine_workout_day_number")
    .eq("engine_program_id", memo.program)
    .eq("month", month)
    .gte("program_sequence_order", memo.next_seq)
    .order("program_sequence_order", { ascending: true });
  if (mapErr) return json({ error: "read_failed", detail: mapErr.message }, 500);
  const mapping = (mapRows ?? []) as { program_sequence_order: number; engine_workout_day_number: number }[];
  if (mapping.length === 0) return json({ error: "progression_complete", detail: "no days in slice" }, 409);

  const dayNumbers = [...new Set(mapping.map((m) => m.engine_workout_day_number))];
  const { data: rows, error: daysErr } = await supa
    .from("engine_workouts")
    .select("day_number, day_type, phase, month, block_count, set_rest_seconds, block_1_params, block_2_params, block_3_params, block_4_params, total_duration_minutes")
    .eq("program_type", PROGRAM)
    .in("day_number", dayNumbers);
  if (daysErr) return json({ error: "read_failed", detail: daysErr.message }, 500);
  const byDayNumber = new Map(
    ((rows ?? []) as unknown as CatalogEngineDay[]).map((d) => [d.day_number, d]));

  // Day-type display metadata (names + coaching intent).
  const { data: typeRows, error: typesErr } = await supa
    .from("engine_day_types")
    .select("id, name, coaching_intent");
  if (typesErr) return json({ error: "read_failed", detail: typesErr.message }, 500);
  const meta = new Map(
    ((typeRows ?? []) as { id: string; name: string; coaching_intent: string | null }[])
      .map((t) => [t.id, { title: t.name, coaching_intent: t.coaching_intent }]),
  );

  // Resolve in SEQUENCE order. Refs are sequence-keyed and program-scoped so
  // repeated catalog days inside a mapped program stay distinct and programs
  // never collide in the member's log history. main_5day keeps its legacy
  // bare 'd{N}' refs (identity mapping — existing member state stays valid).
  const resolved = [];
  for (const m of mapping) {
    const d = byDayNumber.get(m.engine_workout_day_number);
    if (!d) return json({ error: "read_failed", detail: `catalog day ${m.engine_workout_day_number} missing` }, 500);
    const r = resolveEngineDay(d, meta.get(d.day_type) ?? { title: d.day_type, coaching_intent: null });
    r.ref = memo.program === PROGRAM
      ? `d${m.program_sequence_order}`
      : `${memo.program}:d${m.program_sequence_order}`;
    resolved.push(r);
  }

  const lastSeq = mapping[mapping.length - 1].program_sequence_order;
  console.log(JSON.stringify({
    at: "gym-services", event: "engine_generate_block", gym_id: gymId,
    program: memo.program, month, from: memo.next_seq, days: resolved.length,
  }));
  return json({
    block: { label: `Month ${month}`, month, days: resolved },
    memo: { v: 1, program: memo.program, next_seq: lastSeq + 1 },
  });
});
