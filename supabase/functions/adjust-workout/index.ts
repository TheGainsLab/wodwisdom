/**
 * adjust-workout: AI-assisted workout editing. Serves TWO contracts so the
 * live frontend (old, day-scoped prose) and the new frontend (v3 block-scoped
 * structured propose) can share one deployed function:
 *
 *   • { workout_id, request }  → v1 day adjust → { blocks:[{label,content}], rationale }
 *       (legacy ProgramEditPage AI Edit — still deployed in production)
 *   • { block_id, request }    → v3 block propose → { proposal, original, ai_edit_log_id }
 *       (new per-block AI Edit on ProgramDetailPage; PROPOSE only, one-shot per block)
 *
 * Dispatch is by which key is present. Remove the v1 path once the new
 * frontend is fully shipped and no client sends workout_id.
 */

import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "../_shared/call-claude.ts";
import { searchChunks, deduplicateChunks, formatChunksAsContext } from "../_shared/rag.ts";
import { buildEmitBlockTool, type BlockPrescription, type MovementPrescription } from "../_shared/v2-output-schema.ts";
import { fetchVocabulary } from "../_shared/build-writer-payload.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-4-20250514";

interface ProfileData {
  lifts?: Record<string, number> | null;
  skills?: Record<string, string> | null;
  conditioning?: Record<string, string | number> | null;
  equipment?: Record<string, boolean> | null;
  bodyweight?: number | null;
  units?: string | null;
}

function formatProfile(profile: ProfileData): string {
  const parts: string[] = [];
  const u = profile.units === "kg" ? "kg" : "lbs";
  if (profile.bodyweight && profile.bodyweight > 0) parts.push(`Bodyweight: ${profile.bodyweight} ${u}`);
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
  if (profile.equipment && Object.keys(profile.equipment).length > 0) {
    const unavailable = Object.entries(profile.equipment)
      .filter(([, v]) => v === false)
      .map(([k]) => k.replace(/_/g, " "));
    if (unavailable.length > 0) parts.push("Equipment NOT available — " + unavailable.join(", "));
  }
  return parts.join("\n") || "No profile data.";
}

const json = (body: unknown, cors: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/* ── v1 day adjust (legacy prose contract) ───────────────────────────── */

const DAY_SYSTEM_PROMPT = `You are an expert CrossFit programming coach. An athlete has a workout they want to adjust. They will describe what they want changed in plain language.

Your job is to modify the workout to satisfy their request while preserving the session's overall intent, time domain, and stimulus.

You have access to:
- The athlete's profile (1RM lifts, skill levels, equipment)
- The workouts on adjacent days (to avoid movement pattern conflicts)
- CrossFit methodology reference material

Rules:
- Modify only the blocks that need to change. Leave unchanged blocks exactly as they are.
- When substituting movements, pick alternatives that preserve the intended stimulus.
- Prescribe weights using the athlete's 1RMs where applicable. Use M/F Rx format (e.g. 185/125).
- If the request doesn't make sense or would compromise the session, explain why in the rationale and suggest an alternative.
- Keep the same block structure (Warm-up, Skills, Strength, Metcon, Cool down). Do not add or remove block headers.
- If changing the strength block, adjust the warm-up to match (e.g. if swapping to cleans, warm-up should include clean prep).

Return JSON only. No preamble, no markdown fences, no explanation outside the JSON.

Format:
{
  "blocks": [
    { "label": "Warm-up", "content": "..." },
    { "label": "Skills", "content": "..." },
    { "label": "Strength", "content": "..." },
    { "label": "Metcon", "content": "..." },
    { "label": "Cool down", "content": "..." }
  ],
  "rationale": "1-2 sentences explaining what was changed and why"
}

Include ALL blocks from the original workout in your response, even ones you did not change.`;

async function handleDayAdjust(
  supa: SupabaseClient,
  user: User,
  workout_id: string,
  userRequest: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { data: workout, error: wErr } = await supa
    .from("program_workouts")
    .select("id, program_id, workout_text, sort_order")
    .eq("id", workout_id)
    .single();
  if (wErr || !workout) return json({ error: "Workout not found" }, cors, 404);

  const { data: program, error: pErr } = await supa
    .from("programs")
    .select("id, user_id")
    .eq("id", workout.program_id)
    .single();
  if (pErr || !program || program.user_id !== user.id) return json({ error: "Not authorized" }, cors, 403);

  const { data: adjacentWorkouts } = await supa
    .from("program_workouts")
    .select("workout_text, sort_order")
    .eq("program_id", workout.program_id)
    .in("sort_order", [workout.sort_order - 1, workout.sort_order + 1])
    .order("sort_order");
  const prevDay = adjacentWorkouts?.find((w) => w.sort_order === workout.sort_order - 1);
  const nextDay = adjacentWorkouts?.find((w) => w.sort_order === workout.sort_order + 1);

  const { data: profile } = await supa
    .from("athlete_profiles")
    .select("lifts, skills, conditioning, equipment, bodyweight, units")
    .eq("user_id", user.id)
    .single();
  const profileStr = profile ? formatProfile(profile as ProfileData) : "No profile data.";

  let ragContext = "";
  if (OPENAI_API_KEY) {
    const results = await Promise.all([
      searchChunks(supa, `CrossFit programming ${userRequest}`, "journal", OPENAI_API_KEY, 3, 0.25),
      searchChunks(supa, `${userRequest} ${(workout.workout_text ?? "").slice(0, 200)}`, "strength-science", OPENAI_API_KEY, 2, 0.25),
    ]);
    const unique = deduplicateChunks(results.flat());
    if (unique.length > 0) ragContext = "\n\nREFERENCE MATERIAL:\n" + formatChunksAsContext(unique, 6);
  }

  const adjacentContext = [
    prevDay ? `Previous day (Day ${workout.sort_order}):\n${prevDay.workout_text}` : null,
    nextDay ? `Next day (Day ${workout.sort_order + 2}):\n${nextDay.workout_text}` : null,
  ].filter(Boolean).join("\n\n");

  const userPrompt = `ATHLETE PROFILE:
${profileStr}

CURRENT WORKOUT (Day ${workout.sort_order + 1}):
${workout.workout_text}

${adjacentContext ? `ADJACENT DAYS (avoid movement pattern conflicts):\n${adjacentContext}\n` : ""}
ATHLETE'S REQUEST:
${userRequest}
${ragContext}

Modify the workout to satisfy the athlete's request. Return JSON only.`;

  if (!ANTHROPIC_API_KEY) return json({ error: "AI not configured" }, cors, 500);

  const raw = await callClaude({ apiKey: ANTHROPIC_API_KEY, system: DAY_SYSTEM_PROMPT, userContent: userPrompt, maxTokens: 2048 });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  if (!parsed.blocks || !Array.isArray(parsed.blocks)) throw new Error("Invalid response format from AI");
  return json({ blocks: parsed.blocks, rationale: parsed.rationale || "" }, cors);
}

/* ── v3 block propose (structured, one-shot per block) ────────────────── */

const BLOCK_SYSTEM_PROMPT = `You are an expert CrossFit coach revising ONE block of an athlete's training program at their request. The athlete describes, in plain language, what they want changed about this block.

You will receive:
  - The block as it currently stands (its prescription)
  - The other blocks in the same day (context only — do NOT change them)
  - The athlete's request
  - Slim athlete context (units, key 1RMs, equipment NOT available)
  - The movement vocabulary you must draw from

You will emit: ONE revised block via the \`emit_block\` tool, matching the BlockPrescription schema.

RULES (honor every one):
- Satisfy the athlete's request. If it would compromise safety (loads above 1RM without a max-effort scheme, mixing two monostructural cardio modalities in a metcon, programming an unavailable-equipment or do-not-program movement), adapt to honor safety over the literal ask.
- Preserve the block's intent and time domain UNLESS the athlete explicitly asks to change it. A weight tweak keeps the scheme; "make it longer" changes the work volume, not the movement character.
- Keep the same block_type unless the request clearly requires otherwise.
- All weights in the athlete's units. Plate math: lbs → nearest 5, kg → nearest 2.5. Prescribed barbell weight ≤ the relevant 1RM unless the scheme is an explicit max attempt.
- At most ONE monostructural cardio modality (Row / Bike / Ski-erg / Run / Swim) per metcon. Barbell movements within a metcon share ONE load.
- Movements use display-name strings from the vocabulary list in the user message.
- Pick exactly ONE work specifier per movement: rep-counted → emit rep_scheme as the per-iteration breakdown ([21,15,9] chipper, [15,15,15] for 3 RFT, [100] single-pass, [10] one AMRAP round); do NOT also set reps. distance-counted → distance + distance_unit. calorie-counted → rep_scheme per iteration with scaling_note "Calories".
- Every movement must populate at least one of {sets, reps, rep_scheme, calories, weight, time_seconds, distance} > 0.

Emit ONLY the revised block via the emit_block tool. No prose outside the tool call.`;

interface ClaudeToolResponse {
  content?: Array<{ type: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

// deno-lint-ignore no-explicit-any
function rowToMovement(m: any): MovementPrescription {
  const mv: MovementPrescription = { movement: m.movement };
  if (m.sets != null) mv.sets = m.sets;
  if (m.reps != null) mv.reps = m.reps;
  if (Array.isArray(m.rep_scheme)) mv.rep_scheme = m.rep_scheme;
  if (m.weight != null) mv.weight = m.weight;
  if (m.weight_unit != null) mv.weight_unit = m.weight_unit;
  if (m.rpe != null) mv.rpe = m.rpe;
  if (m.time_seconds != null) mv.time_seconds = m.time_seconds;
  if (m.distance != null) mv.distance = m.distance;
  if (m.distance_unit != null) mv.distance_unit = m.distance_unit;
  if (m.scaling_note != null) mv.scaling_note = m.scaling_note;
  if (m.target_pct_1rm != null) mv.target_pct_1rm = m.target_pct_1rm;
  if (m.cardio_modality != null) mv.cardio_modality = m.cardio_modality;
  if (m.calories != null) mv.calories = m.calories;
  return mv;
}

function buildBlockUserMessage(
  original: BlockPrescription,
  siblings: Array<{ block_type: string; block_label: string | null; block_scheme: string | null }>,
  userRequest: string,
  slimAthlete: Record<string, unknown>,
): string {
  const siblingStr = siblings.length
    ? siblings.map((s) => `  - ${s.block_type}${s.block_label ? ` "${s.block_label}"` : ""}${s.block_scheme ? ` — ${s.block_scheme}` : ""}`).join("\n")
    : "  (none)";
  return [
    `CURRENT BLOCK (revise this one):\n${JSON.stringify(original, null, 2)}`,
    "",
    `OTHER BLOCKS IN THIS DAY (context only — do NOT modify):\n${siblingStr}`,
    "",
    `ATHLETE'S REQUEST:\n${userRequest}`,
    "",
    `ATHLETE CONTEXT (units, loads, equipment, vocabulary):\n${JSON.stringify(slimAthlete, null, 2)}`,
    "",
    "Emit the revised block via the emit_block tool. Keep the same block_type unless the request requires otherwise.",
  ].join("\n");
}

async function handleBlockPropose(
  supa: SupabaseClient,
  user: User,
  block_id: string,
  userRequest: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!ANTHROPIC_API_KEY) return json({ error: "AI not configured" }, cors, 500);

  const { data: block, error: bErr } = await supa
    .from("program_blocks_v2")
    .select("id, program_workout_id, block_type, block_label, block_scheme, time_cap_seconds, block_notes, cardio_modality")
    .eq("id", block_id)
    .single();
  if (bErr || !block) return json({ error: "Block not found" }, cors, 404);

  const { data: workout } = await supa.from("program_workouts").select("id, program_id").eq("id", block.program_workout_id).single();
  if (!workout) return json({ error: "Workout not found" }, cors, 404);
  const { data: program } = await supa.from("programs").select("id, user_id").eq("id", workout.program_id).single();
  if (!program || program.user_id !== user.id) return json({ error: "Not authorized" }, cors, 403);

  const { count: priorUses } = await supa
    .from("ai_edit_log")
    .select("id", { count: "exact", head: true })
    .eq("block_id", block_id);
  if ((priorUses ?? 0) > 0) return json({ error: "AI Edit already used on this block", code: "BLOCK_LOCKED" }, cors, 409);

  const { data: movementRows } = await supa
    .from("program_movements_v2")
    .select("movement, sets, reps, rep_scheme, weight, weight_unit, rpe, time_seconds, distance, distance_unit, scaling_note, target_pct_1rm, cardio_modality, calories, sort_order")
    .eq("block_id", block_id)
    .order("sort_order");

  const original: BlockPrescription = {
    block_type: block.block_type,
    ...(block.block_label != null ? { block_label: block.block_label } : {}),
    ...(block.block_scheme != null ? { block_scheme: block.block_scheme } : {}),
    ...(block.time_cap_seconds != null ? { time_cap_seconds: block.time_cap_seconds } : {}),
    ...(block.block_notes != null ? { block_notes: block.block_notes } : {}),
    ...(block.cardio_modality != null ? { cardio_modality: block.cardio_modality } : {}),
    movements: (movementRows ?? []).map(rowToMovement),
  };

  const { data: siblingRows } = await supa
    .from("program_blocks_v2")
    .select("block_type, block_label, block_scheme, sort_order")
    .eq("program_workout_id", block.program_workout_id)
    .neq("id", block_id)
    .order("sort_order");

  const [{ data: profile }, vocabulary] = await Promise.all([
    supa.from("athlete_profiles").select("lifts, skills, conditioning, equipment, bodyweight, units").eq("user_id", user.id).single(),
    fetchVocabulary(supa),
  ]);
  const prof = (profile ?? {}) as ProfileData;
  const units = (prof.units === "kg" ? "kg" : "lbs") as "lbs" | "kg";
  const equipmentUnavailable = prof.equipment
    ? Object.entries(prof.equipment).filter(([, v]) => v === false).map(([k]) => k.replace(/_/g, " "))
    : [];
  const slimAthlete = { units, lifts: prof.lifts ?? {}, equipment_not_available: equipmentUnavailable, vocabulary };

  const userMessage = buildBlockUserMessage(original, siblingRows ?? [], userRequest.trim(), slimAthlete);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      stream: false,
      system: BLOCK_SYSTEM_PROMPT,
      tools: [buildEmitBlockTool(units, null)],
      tool_choice: { type: "tool", name: "emit_block" },
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.warn(`[adjust-workout] Anthropic HTTP ${resp.status}: ${body.slice(0, 300)}`);
    return json({ error: "AI request failed" }, cors, 502);
  }

  const data = (await resp.json()) as ClaudeToolResponse;
  const toolUse = (data.content ?? []).find((b) => b.type === "tool_use" && b.name === "emit_block");
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    console.warn(`[adjust-workout] no emit_block tool_use; stop_reason=${data.stop_reason}`);
    return json({ error: "AI did not return a valid block" }, cors, 502);
  }
  const proposal = toolUse.input as BlockPrescription;

  const { data: logRow, error: logErr } = await supa
    .from("ai_edit_log")
    .insert({ user_id: user.id, block_id, request: userRequest.trim(), original, proposal, outcome: null })
    .select("id")
    .single();
  if (logErr || !logRow) {
    console.error("[adjust-workout] ai_edit_log insert failed:", logErr?.message);
    return json({ error: "Failed to record edit" }, cors, 500);
  }

  return json({ proposal, original, ai_edit_log_id: (logRow as { id: string }).id }, cors);
}

/* ── dispatch ─────────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, cors, 401);

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Invalid token" }, cors, 401);

    const body = await req.json();
    const userRequest = body?.request;
    if (!userRequest || typeof userRequest !== "string") return json({ error: "request is required" }, cors, 400);

    // New v3 block-scoped propose.
    if (body?.block_id) return await handleBlockPropose(supa, user, body.block_id, userRequest, cors);
    // Legacy day-scoped prose adjust (still used by the deployed production frontend).
    if (body?.workout_id) return await handleDayAdjust(supa, user, body.workout_id, userRequest, cors);

    return json({ error: "block_id or workout_id is required" }, cors, 400);
  } catch (err) {
    console.error("adjust-workout error:", err);
    return json({ error: (err as Error).message }, cors, 500);
  }
});
