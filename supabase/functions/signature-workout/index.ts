/**
 * signature-workout — Workout Signatures, phase 2 (ADMIN-ONLY tool).
 *
 * The one reusable brain of the signature system: every consumer (admin
 * review queue, what-if editor, later program audits and the composer)
 * calls this same function.
 *
 * Input is always the canonical structured workout (BlockPrescription —
 * the shape the generator writes and preprocess-program parses into).
 * Raw text enters only through the `parse` action.
 *
 * Actions:
 *   { action: "parse", text }        → one Sonnet call: workout text →
 *                                      BlockPrescription. Nothing stored.
 *   { action: "draft", workout, gender? }
 *                                    → one Sonnet call drafts the editorial
 *                                      judgments (demand / discrimination /
 *                                      stimulus weights over FOCUS_AREAS,
 *                                      gates, archetype, rationale), then the
 *                                      deterministic measured layer runs.
 *                                      Nothing stored.
 *   { action: "measure", workout, gender? }
 *                                    → deterministic layer only (expected
 *                                      benchmark / time domain / anchors).
 *                                      Zero tokens — this is what makes
 *                                      load/rep edits feel instant.
 *   { action: "save", row }          → insert or update a draft row.
 *   { action: "approve", id, row? }  → final weight edits + status approved.
 *   { action: "reject", id }         → status rejected (row kept).
 *   { action: "list", status? }      → the review queue.
 *   { action: "delete", id }         → remove a row.
 *   { action: "selftest" }           → version + env checks.
 *
 * Weight rules (validated server-side, both on draft and save):
 *   keys ⊆ FOCUS_AREAS, integer percents in 5% steps, sum exactly 100.
 *
 * The function never persists on draft/parse/measure — persistence happens
 * only through save/approve, so the editorial gate stays real (same
 * principle as score-program's parse/ratify split).
 *
 * NAMING LAW: no output of this function may contain the word "CrossFit"
 * or imply a vendor relationship.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { callClaude } from "../_shared/call-claude.ts";
import { FOCUS_AREAS } from "../_shared/coach-state.ts";
import {
  computeBlockBenchmark,
  type ExpectedBenchmark,
} from "../_shared/compute-block-benchmark.ts";
import type { BlockPrescription } from "../_shared/v2-output-schema.ts";
import type { Gender } from "../_shared/compute-benchmarks.ts";

const FUNCTION_VERSION = "2026-10-30.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ??
  Deno.env.get("ANTHROPIC_API_KEY");

const MAX_TEXT_CHARS = 8_000;
const GATE_KINDS = ["skill", "load", "capacity"] as const;
const SIG_FORMATS = ["amrap", "for_time", "intervals", "emom", "ladder"] as const;

// ============================================================
// Weight / gate validation
// ============================================================

type Weights = Record<string, number>;

function validateWeights(w: unknown, label: string): string[] {
  const errors: string[] = [];
  if (typeof w !== "object" || w === null || Array.isArray(w)) {
    return [`${label}: must be an object of {focus_area: percent}`];
  }
  let sum = 0;
  for (const [k, v] of Object.entries(w as Record<string, unknown>)) {
    if (!(FOCUS_AREAS as readonly string[]).includes(k)) {
      errors.push(`${label}: "${k}" is not a focus area`);
      continue;
    }
    if (typeof v !== "number" || !Number.isInteger(v) || v < 5 || v > 100 || v % 5 !== 0) {
      errors.push(`${label}.${k}: must be an integer multiple of 5 between 5 and 100 (got ${v})`);
      continue;
    }
    sum += v;
  }
  if (errors.length === 0 && sum !== 100) {
    errors.push(`${label}: weights sum to ${sum}, must sum to exactly 100`);
  }
  return errors;
}

function validateGates(g: unknown): string[] {
  if (g === undefined || g === null) return [];
  if (!Array.isArray(g)) return ["gates: must be an array"];
  const errors: string[] = [];
  g.forEach((gate, i) => {
    if (typeof gate !== "object" || gate === null) {
      errors.push(`gates[${i}]: must be an object`);
      return;
    }
    const { movement, kind } = gate as Record<string, unknown>;
    if (typeof movement !== "string" || !movement.trim()) {
      errors.push(`gates[${i}].movement: required string`);
    }
    if (!GATE_KINDS.includes(kind as typeof GATE_KINDS[number])) {
      errors.push(`gates[${i}].kind: must be one of ${GATE_KINDS.join("/")}`);
    }
  });
  return errors;
}

interface SignatureDraft {
  demand: Weights;
  discrimination: Weights;
  stimulus: Weights;
  gates: Array<{ movement: string; kind: string; detail?: string }>;
  time_domain?: "short" | "medium" | "long";
  format?: string;
  archetype?: string;
  rationale?: string;
}

function validateSignature(sig: Partial<SignatureDraft>, requireAll: boolean): string[] {
  const errors: string[] = [];
  if (sig.demand !== undefined || requireAll) {
    errors.push(...validateWeights(sig.demand, "demand"));
  }
  for (const key of ["discrimination", "stimulus"] as const) {
    if (sig[key] !== undefined && sig[key] !== null) {
      errors.push(...validateWeights(sig[key], key));
    } else if (requireAll) {
      errors.push(`${key}: required for approval`);
    }
  }
  errors.push(...validateGates(sig.gates));
  if (sig.time_domain !== undefined && sig.time_domain !== null &&
    !["short", "medium", "long"].includes(sig.time_domain)) {
    errors.push(`time_domain: must be short/medium/long`);
  }
  return errors;
}

// ============================================================
// Prompts
// ============================================================

const AXES_GLOSSARY = `The ONLY allowed weight keys (the fixed training axes):
- olympic_lifting — snatch/clean & jerk technique and positions
- powerlifting_strength — maximal squat/press/deadlift strength
- posterior_chain — hinge pattern: deadlifts, swings, hip extension (incl. endurance at submax load)
- upper_body_pressing — horizontal/overhead barbell+DB pressing strength
- gymnastics_pulling — pull-ups, chest-to-bar, muscle-ups, toes-to-bar, rope climbs
- gymnastics_pressing — HSPU, dips, wall walks, handstand holds (inverted work)
- midline — trunk under load/fatigue: GHD, L-sits, heavy carries
- skill_coordination — double-unders, handstand walk, jump-rope-class rhythm skills
- squat_cycling — HIGH-REP squat capacity under fatigue: wall balls, light thrusters, lunge/step-up/pistol volume; leg muscular endurance, NOT maximal squat strength
- aerobic_capacity — sustained-output engine, pacing over long continuous work
- anaerobic_capacity — repeated high-power bursts, sprint tolerance
- mixed_modal_conditioning — holding output while switching movements/modalities under fatigue`;

const DRAFT_SYSTEM = `You tag scoreable workouts with a SIGNATURE for a training-analysis system.

${AXES_GLOSSARY}

A signature has THREE weight vectors over those axes (each: integer percents, multiples of 5, SUM EXACTLY 100, omit zero-weight axes):

1. "demand" — what the workout REQUIRES of anyone who does it, cohort-independent. Draft this FIRST from time share (where a mid-pack athlete's minutes actually go) adjusted for what the structure makes matter. Duration is an input to your judgment, never a fixed allocation.
2. "discrimination" — what decides RANK among RX competitive athletes. Derive it from demand by cohort adjustment: light loads nearly everyone moves fast separate little; high-skill gymnastics and fatigued inverted work separate enormously; pacing separates on long pieces.
3. "stimulus" — what adaptation PERFORMING it produces (wall walks under fatigue test inverted capacity without building maximal pressing).

ADJUDICATED MAPPING RULES (founder rulings — follow them over your own instinct):
- Dumbbell/kettlebell variants of the Olympic lifts carry REDUCED olympic_lifting weight (the overhead receive only, ~5–10, scaled by load); the pull is posterior_chain. Full olympic_lifting weight is reserved for barbell snatch/clean work at loads where positions and technique decide the outcome.
- Wall balls, light thrusters, lunges, step-ups and pistol volume are squat_cycling, not powerlifting_strength (unless the load is genuinely heavy for the cohort), not midline, and not merely conditioning — name the leg endurance explicitly, then weight the engine axes for the pacing on top.
- A movement near-universally possessed by the RX competitive cohort (wall walks, box jump-overs) is NEVER a skill gate — its difficulty is capacity, which lives in the weights.

"gates" — binary walls only, kept OUTSIDE the weights: [{"movement": "...", "kind": "skill"|"load"|"capacity", "detail": "what it blocks"}]. skill = cannot do the movement at all; load = cannot move the prescribed weight; capacity = can do the work but slows dramatically (use sparingly — capacity usually belongs in the weights). Most workouts have NO gates; an empty array is the common, correct answer.

Also emit:
- "time_domain": "short" (<8 min) | "medium" (8–15) | "long" (>15), judged from the structure for a mid-pack athlete.
- "format": one of ${SIG_FORMATS.join("/")}.
- "archetype": a 2–5 word label for the recurring test design this matches (e.g. "couplet sprint", "gymnastics ladder with cap", "long grind triplet").
- "rationale": 2–4 sentences on the judgment calls — why the dominant buckets dominate, what separates, why any gate.

Output STRICT JSON only — one object with keys demand, discrimination, stimulus, gates, time_domain, format, archetype, rationale. No markdown fences, no commentary.
Never use the word "CrossFit" anywhere in your output.`;

const PARSE_SYSTEM = `You parse ONE workout from raw text into a strict JSON structure. Output JSON only — no fences, no commentary.

Shape:
{
  "block_type": "metcon" | "strength" | "skills" | "cardio" | "accessory",
  "block_scheme": string,          // the rendered header, e.g. "21-15-9 for time (12-min cap)" or "AMRAP 15"
  "time_cap_seconds": number|null, // stated cap OR fixed clock (AMRAP 15 → 900); null if uncapped
  "movements": [{
    "movement": string,            // canonical movement name, e.g. "Dumbbell Snatch"
    "rep_scheme": number[]|null,   // per-round reps: "21-15-9" → [21,15,9]; 3 RFT of 15 → [15,15,15]; AMRAP round of 10 → [10]; 100 straight → [100]
    "cal_scheme": number[]|null,   // per-round calories when they vary; uniform rounds use "calories" instead
    "distance_scheme": number[]|null, // per-round meters when they vary
    "calories": number|null,       // per-round calories (uniform)
    "distance": number|null,       // per-round distance (uniform)
    "distance_unit": "m"|"ft"|null,
    "weight": number|null,         // RX men's load when stated
    "weight_unit": "lbs"|"kg"|null,
    "time_seconds": number|null    // duration prescriptions ("row 5 min" → 300)
  }]
}

Rules: movements in performed order. Every movement needs at least one volume field. Use the men's RX load when two are given ("50/35" → 50). Do arithmetic for schemes ("5 rounds: 12 snatches" → rep_scheme [12,12,12,12,12]). Default block_type "metcon" for scored mixed work. Never use the word "CrossFit" in output.`;

// ============================================================
// Model call helpers
// ============================================================

function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("model returned no JSON object");
  }
  return JSON.parse(t.slice(start, end + 1));
}

/** One drafting call with one validation-driven repair attempt. */
async function draftSignature(workout: BlockPrescription): Promise<SignatureDraft> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const workoutJson = JSON.stringify(workout, null, 2);
  const ask = `Tag this workout:\n\n${workoutJson}`;

  let raw = await callClaude({
    apiKey: ANTHROPIC_API_KEY,
    system: DRAFT_SYSTEM,
    userContent: ask,
    maxTokens: 2000,
    fallbackToHaiku: false, // judgment seat — a degraded draft is worse than none
  });
  let sig = extractJson(raw) as SignatureDraft;
  let errors = validateSignature(sig, true);

  if (errors.length > 0) {
    raw = await callClaude({
      apiKey: ANTHROPIC_API_KEY,
      system: DRAFT_SYSTEM,
      userContent:
        `${ask}\n\nYour previous attempt failed validation:\n${JSON.stringify(sig)}\n\nErrors:\n- ${
          errors.join("\n- ")
        }\n\nEmit corrected strict JSON.`,
      maxTokens: 2000,
      fallbackToHaiku: false,
    });
    sig = extractJson(raw) as SignatureDraft;
    errors = validateSignature(sig, true);
    if (errors.length > 0) {
      throw new Error(`draft failed validation after repair: ${errors.join("; ")}`);
    }
  }
  sig.gates = Array.isArray(sig.gates) ? sig.gates : [];
  return sig;
}

async function parseWorkout(text: string): Promise<BlockPrescription> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const raw = await callClaude({
    apiKey: ANTHROPIC_API_KEY,
    system: PARSE_SYSTEM,
    userContent: text,
    maxTokens: 2000,
    fallbackToHaiku: false,
  });
  const parsed = extractJson(raw) as Record<string, unknown>;
  if (!Array.isArray(parsed.movements) || parsed.movements.length === 0) {
    throw new Error("parse produced no movements");
  }
  // Strip nulls so the object matches the optional-field BlockPrescription shape.
  const clean = (o: Record<string, unknown>) => {
    for (const k of Object.keys(o)) if (o[k] === null) delete o[k];
    return o;
  };
  clean(parsed);
  parsed.movements = (parsed.movements as Record<string, unknown>[]).map(clean);
  return parsed as unknown as BlockPrescription;
}

/** Deterministic layer — zero tokens. Null when the structure has no
 *  resolvable benchmark (non-metcon, unresolved movement). */
async function measure(
  workout: BlockPrescription,
  gender: Gender,
): Promise<ExpectedBenchmark | null> {
  try {
    return await computeBlockBenchmark(workout, gender);
  } catch (e) {
    console.warn(`[signature-workout] measure failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ============================================================
// Row shaping
// ============================================================

const ROW_FIELDS = [
  "source",
  "competition_workout_id",
  "name",
  "workout",
  "demand",
  "discrimination",
  "stimulus",
  "gates",
  "time_domain",
  "format",
  "archetype",
  "rationale",
  "measured",
  "drafted_model",
] as const;

function pickRowFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of ROW_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

// ============================================================
// Handler
// ============================================================

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    // ── Auth: admin only while this is a review tool ─────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "UNAUTHORIZED" }, 401);
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "UNAUTHORIZED" }, 401);
    const { data: profile } = await supa
      .from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "FORBIDDEN" }, 403);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const gender: Gender = body.gender === "women" ? "women" : "men";

    if (action === "selftest") {
      return json({
        ok: true,
        version: FUNCTION_VERSION,
        anthropic_key: !!ANTHROPIC_API_KEY,
        focus_areas: FOCUS_AREAS,
      });
    }

    if (action === "parse") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json({ error: "MISSING_TEXT" }, 400);
      if (text.length > MAX_TEXT_CHARS) return json({ error: "TEXT_TOO_LONG" }, 400);
      const workout = await parseWorkout(text);
      return json({ workout });
    }

    if (action === "draft" || action === "measure") {
      const workout = body.workout as BlockPrescription | undefined;
      if (!workout || !Array.isArray(workout.movements) || workout.movements.length === 0) {
        return json({ error: "MISSING_WORKOUT" }, 400);
      }
      if (action === "measure") {
        return json({ measured: await measure(workout, gender) });
      }
      const [signature, measured] = await Promise.all([
        draftSignature(workout),
        measure(workout, gender),
      ]);
      return json({ signature, measured, drafted_model: "sonnet" });
    }

    if (action === "save") {
      const fields = pickRowFields(body);
      const sigErrors = validateSignature(fields as Partial<SignatureDraft>, false);
      if (sigErrors.length > 0) return json({ error: sigErrors.join("; ") }, 422);
      const id = typeof body.id === "string" ? body.id : null;
      if (id) {
        const { data, error } = await supa
          .from("workout_signatures")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", id).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ row: data });
      }
      if (!fields.name || !fields.workout || !fields.demand) {
        return json({ error: "MISSING_FIELDS (name, workout, demand required)" }, 400);
      }
      const { data, error } = await supa
        .from("workout_signatures")
        .insert({ ...fields, status: "draft" })
        .select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ row: data });
    }

    if (action === "approve" || action === "reject") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return json({ error: "MISSING_ID" }, 400);
      const update: Record<string, unknown> = {
        status: action === "approve" ? "approved" : "rejected",
        updated_at: new Date().toISOString(),
      };
      if (action === "approve") {
        // Final weight edits may ride the approval; the approved row must
        // carry all three valid vectors.
        const fields = pickRowFields(body);
        const { data: existing } = await supa
          .from("workout_signatures").select("*").eq("id", id).single();
        if (!existing) return json({ error: "NOT_FOUND" }, 404);
        const merged = { ...existing, ...fields };
        const sigErrors = validateSignature(merged as Partial<SignatureDraft>, true);
        if (sigErrors.length > 0) return json({ error: sigErrors.join("; ") }, 422);
        Object.assign(update, fields, { approved_at: new Date().toISOString() });
      }
      const { data, error } = await supa
        .from("workout_signatures").update(update).eq("id", id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ row: data });
    }

    if (action === "list") {
      let q = supa.from("workout_signatures").select("*")
        .order("created_at", { ascending: false }).limit(200);
      if (typeof body.status === "string" && body.status) q = q.eq("status", body.status);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ rows: data ?? [] });
    }

    if (action === "delete") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return json({ error: "MISSING_ID" }, 400);
      const { error } = await supa.from("workout_signatures").delete().eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: `UNKNOWN_ACTION: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[signature-workout] ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
