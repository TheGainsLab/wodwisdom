/**
 * metcon-workcalc.ts — compute power (joules/watts) for a LOGGED metcon block.
 *
 * P5's converter. A logged metcon stores per-round movement volumes + a
 * scheme string + a result; work-calc's inline mode needs pre-expanded
 * totals + the decomposed result. Bridging that:
 *
 *   1. A focused AI call (`emit_metcon_resolution`) resolves the ROUNDS
 *      STRUCTURE — workout_type + each movement's per-round volume sequence
 *      + the decomposed result. The AI does SEMANTIC recognition only — it
 *      enumerates per-round volumes, it never sums.
 *   2. Deterministic code does the arithmetic (sum the sequences), builds
 *      the WorkCalcMovement[], calls work-calc, applies the store-gate.
 *
 * Confident-or-skip + failure-soft: any gap — unknown gender, low-confidence
 * resolution, capped finish, work-calc failure, an un-modeled movement —
 * returns null. A wrong joules figure is worse than none.
 *
 * Source-indifferent: runs on a logged metcon block regardless of whether
 * the program was AI-generated or freelance-ingested.
 */

import { computeWork } from "./work-calc.ts";
import type { WorkCalcMovement, Gender } from "./compute-benchmarks.ts";
import { MODELS } from "./model-profiles.ts";

const MODEL = MODELS.sonnet;
const RESOLVE_TIMEOUT_MS = 30_000;
const LBS_PER_KG = 0.45359237;

// ── athlete param normalizers (mirror log-throwback) ───────────────────────

/** Stored bodyweight → kilograms. Null when unusable. */
export function toKg(weight: unknown, units: unknown): number | null {
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) return null;
  return units === "lbs" ? weight * LBS_PER_KG : weight;
}

/** Profile gender → work-calc "men"/"women"; null when unknown. */
export function normalizeGender(raw: unknown): Gender | null {
  if (typeof raw !== "string") return null;
  const g = raw.trim().toLowerCase();
  if (g === "men" || g === "male" || g === "m") return "men";
  if (g === "women" || g === "female" || g === "w" || g === "f") return "women";
  return null;
}

/** Distance value + its (tolerantly-spelled) unit → metres. work-calc's
 *  inline API only accepts "m", so everything is normalized to metres. */
function toMeters(value: number, unit: string | null): number {
  const u = (unit ?? "").trim().toLowerCase();
  if (u === "ft" || u === "feet" || u === "foot") return value * 0.3048;
  return value;
}

// ── input / output types ───────────────────────────────────────────────────

export interface MetconMovementInput {
  movement: string;
  reps: number | null;
  weight: number | null;
  weight_unit: string | null; // "lbs" | "kg"
  distance: number | null;
  distance_unit: string | null; // "ft" | "m"
  calories: number | null;
}

export interface MetconBlockInput {
  block_scheme: string | null;
  block_text: string | null;
  score: string | null;
  capped: boolean | null;
  capped_reps: number | null;
  /** AMRAP duration / time cap in seconds — the AMRAP watts divisor. */
  time_cap_seconds: number | null;
  movements: MetconMovementInput[];
}

export interface MetconAthlete {
  bodyweight: number | null;
  units: string | null;
  gender: string | null;
}

export interface MetconPowerResult {
  joules: number;
  avg_power_watts: number | null;
  avg_w_per_kg: number | null;
  body_mass_kg: number | null;
}

// ── the resolution AI call ─────────────────────────────────────────────────

const RESOLUTION_PROMPT =
  `You resolve a logged CrossFit / functional-fitness metcon's ROUNDS STRUCTURE so its total work can be computed. You receive the metcon's scheme, its movements (indexed, each with its per-round volume), and the athlete's result.

Return the \`emit_metcon_resolution\` tool. Rules:

workout_type:
- "for_time" — a fixed amount of work done as fast as possible (rounds-for-time, rep ladders like 21-15-9, chippers).
- "amrap"    — as many rounds/reps as possible within a fixed time.
- "emom"     — Every Minute On the Minute: a fixed per-minute amount of work over a fixed number of minutes. Includes alternating EMOMs and "every 90s"-style intervals with a fixed, completed work amount.
- "other"    — Tabata, "death by" (an EMOM escalating to failure), or anything not cleanly for-time, amrap, or emom. Use it freely when unsure.

movements — for each movement (by its given \`index\`), emit \`volume_by_round\`: the explicit list of that movement's per-round volume, one number per round, in that movement's own unit (reps, OR metres/feet, OR calories — whatever that movement uses):
- For-time ladder "21-15-9" → [21, 15, 9].
- "5 rounds for time, 15 thrusters" → [15, 15, 15, 15, 15].
- A movement done once per round at a fixed count, 4 rounds → [N, N, N, N].
- AMRAP → a single value, the per-round volume, e.g. [12].
- EMOM → one number per minute that movement is performed, in order. "EMOM 10, 12 cal row" → [12,12,12,12,12,12,12,12,12,12]. Alternating "EMOM 10, odd min: 15 wall ball, even min: 10 burpee" → wall ball [15,15,15,15,15], burpee [10,10,10,10,10] — each lists only its OWN minutes.
LIST the per-round (or per-minute) volumes. NEVER sum them — the caller does the arithmetic.

decomposed_result:
- for_time → { "time_seconds": <finish time in seconds> } parsed from the score ("6:45" → 405).
- amrap    → { "rounds": <completed rounds>, "partial_reps": <reps into the next round> } from the score ("8+12" → rounds 8, partial_reps 12).
- emom     → {} (empty). An EMOM's work is fully prescribed by volume_by_round and its clock is the block's time cap — no score decomposition.

uncertain_note — a short reason whenever you are NOT confident (ambiguous scheme, score doesn't fit the type, missing data). Omit it when confident. A note makes the caller skip — when in doubt, write one.

Output the tool only.`;

function buildResolveTool() {
  return {
    name: "emit_metcon_resolution",
    description: "Emit the resolved rounds structure of the logged metcon.",
    input_schema: {
      type: "object",
      properties: {
        workout_type: { type: "string", enum: ["for_time", "amrap", "emom", "other"] },
        movements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer", minimum: 0 },
              volume_by_round: {
                type: "array",
                minItems: 1,
                items: { type: "number", minimum: 0 },
              },
            },
            required: ["index", "volume_by_round"],
            additionalProperties: false,
          },
        },
        decomposed_result: {
          type: "object",
          properties: {
            time_seconds: { type: "integer", minimum: 1 },
            rounds: { type: "integer", minimum: 0 },
            partial_reps: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
        uncertain_note: { type: "string" },
      },
      required: ["workout_type", "movements", "decomposed_result"],
      additionalProperties: false,
    },
  };
}

interface Resolution {
  workout_type: "for_time" | "amrap" | "emom" | "other";
  movements: { index: number; volume_by_round: number[] }[];
  decomposed_result: { time_seconds?: number; rounds?: number; partial_reps?: number };
  uncertain_note?: string;
}

/** One tool-use call resolving the metcon's rounds structure. Null on failure. */
async function resolveMetcon(block: MetconBlockInput, apiKey: string): Promise<Resolution | null> {
  const movementsForAI = block.movements.map((m, i) => ({
    index: i,
    movement: m.movement,
    per_round_reps: m.reps,
    per_round_distance: m.distance != null ? `${m.distance}${m.distance_unit ?? ""}` : null,
    per_round_calories: m.calories,
  }));
  const userContent =
    `SCHEME: ${block.block_scheme || block.block_text || "(none given)"}\n` +
    `RESULT: ${block.score || "(none given)"}` +
    (block.capped ? ` — CAPPED${block.capped_reps != null ? ` at ${block.capped_reps} reps` : ""}` : "") +
    `\nMOVEMENTS (index + each movement's per-round volume):\n${JSON.stringify(movementsForAI)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        stream: false,
        system: RESOLUTION_PROMPT,
        tools: [buildResolveTool()],
        tool_choice: { type: "tool", name: "emit_metcon_resolution" },
        messages: [{ role: "user", content: userContent }],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    console.warn(`[metcon-workcalc] resolve request failed: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    console.warn(`[metcon-workcalc] resolve HTTP ${resp.status}`);
    return null;
  }
  const data = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  const toolUse = ((data?.content ?? []) as Record<string, unknown>[]).find(
    (b) => b.type === "tool_use" && b.name === "emit_metcon_resolution",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    console.warn("[metcon-workcalc] resolve: no emit_metcon_resolution tool_use");
    return null;
  }
  const res = toolUse.input as Resolution;
  if (!Array.isArray(res.movements) || typeof res.decomposed_result !== "object") return null;
  return res;
}

// ── public entry point ─────────────────────────────────────────────────────

/**
 * Compute power for a logged metcon block. Returns the power columns to store
 * on workout_log_blocks, or null (skip — leave the columns null).
 */
export async function computeMetconPower(
  block: MetconBlockInput,
  athlete: MetconAthlete,
  apiKey: string,
): Promise<MetconPowerResult | null> {
  const gender = normalizeGender(athlete.gender);
  if (!gender) {
    console.warn("[metcon-workcalc] skip: athlete gender unknown");
    return null;
  }
  if (!block.movements.length) {
    console.warn("[metcon-workcalc] skip: block has no movements");
    return null;
  }
  if (block.capped) {
    console.warn("[metcon-workcalc] skip: block is capped");
    return null;
  }

  const bodyMassKg = toKg(athlete.bodyweight, athlete.units);

  const resolution = await resolveMetcon(block, apiKey);
  if (!resolution) {
    console.warn("[metcon-workcalc] skip: resolution call failed");
    return null;
  }
  if (resolution.uncertain_note) {
    console.warn(`[metcon-workcalc] skip: uncertain — ${resolution.uncertain_note}`);
    return null;
  }
  if (resolution.workout_type === "other") {
    console.warn("[metcon-workcalc] skip: workout_type=other");
    return null;
  }

  const isAmrap = resolution.workout_type === "amrap";
  const isEmom = resolution.workout_type === "emom";
  // AMRAP + EMOM run on a fixed clock — the time cap (AMRAP) / the EMOM
  // duration; both stored in time_cap_seconds. For-Time's clock is the
  // finish time decomposed from the score.
  const isTimeFixed = isAmrap || isEmom;

  // Resolve the workout clock.
  let timeSeconds: number;
  if (isTimeFixed) {
    const cap = block.time_cap_seconds;
    if (typeof cap !== "number" || cap <= 0) {
      console.warn(`[metcon-workcalc] skip: ${resolution.workout_type} has no time_cap_seconds`);
      return null;
    }
    timeSeconds = cap;
  } else {
    const t = resolution.decomposed_result.time_seconds;
    if (typeof t !== "number" || t <= 0) {
      console.warn("[metcon-workcalc] skip: no usable time_seconds for For-Time");
      return null;
    }
    timeSeconds = t;
  }

  // AMRAP rounds + partial reps, from the decomposed score ("3+11" → 3, 11).
  let rounds = 0;
  let partialRemaining = 0;
  if (isAmrap) {
    const r = resolution.decomposed_result.rounds;
    if (typeof r !== "number" || r < 0) {
      console.warn("[metcon-workcalc] skip: AMRAP missing rounds in decomposed_result");
      return null;
    }
    rounds = r;
    partialRemaining = resolution.decomposed_result.partial_reps ?? 0;
  }

  // movement index → its per-round volume sequence (the AI's enumeration).
  const volByIndex = new Map<number, number[]>();
  for (const r of resolution.movements) {
    if (Array.isArray(r.volume_by_round)) volByIndex.set(r.index, r.volume_by_round);
  }

  // Build WorkCalcMovement[] — every movement carries its WHOLE-WORKOUT total
  // (work-calc then returns a per_workout figure):
  //   For-Time / EMOM → sum of the per-round / per-minute sequence (both are
  //              fully prescribed — the AI enumerated every entry).
  //   AMRAP    → rounds × per-round + the partial reps, allocated across
  //              movements in workout order (partial 11 over [8 thruster,
  //              10 pull-up] → 8 thruster + 3 pull-up).
  const movements: WorkCalcMovement[] = [];
  for (let i = 0; i < block.movements.length; i++) {
    const entry = block.movements[i];
    const vbr = volByIndex.get(i);
    if (!entry || !vbr || vbr.length === 0) continue;

    let total: number;
    if (isAmrap) {
      const perRound = vbr[0] ?? 0;
      const take = Math.max(0, Math.min(partialRemaining, perRound));
      partialRemaining -= take;
      total = rounds * perRound + take;
    } else {
      total = vbr.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
    }
    if (total <= 0) continue;

    const mv: WorkCalcMovement = { movement_name: entry.movement };

    if (typeof entry.weight === "number" && entry.weight > 0) {
      const lbs = entry.weight_unit === "kg" ? entry.weight / LBS_PER_KG : entry.weight;
      if (gender === "men") mv.load_lbs_men = lbs;
      else mv.load_lbs_women = lbs;
    }

    // Specifier — exactly one of calories / distance / reps, per the entry.
    if (typeof entry.calories === "number" && entry.calories > 0) {
      mv.calories = total;
    } else if (typeof entry.distance === "number" && entry.distance > 0) {
      mv.distance_value = toMeters(total, entry.distance_unit);
      mv.distance_unit = "m";
    } else {
      mv.reps_total = total;
    }
    movements.push(mv);
  }
  if (movements.length === 0) {
    console.warn("[metcon-workcalc] skip: no usable movements after build");
    return null;
  }

  const result = await computeWork(
    { movements },
    {
      gender,
      body_mass_kg: bodyMassKg ?? undefined,
      time_seconds: timeSeconds,
    },
  );
  if (!result) {
    console.warn("[metcon-workcalc] skip: work-calc returned null");
    return null;
  }
  // Store only when every movement was computed — then total_joules is the
  // athlete's complete effort. `unit`/`compute_status` are not validity
  // signals (a `per_round`-tagged result can still carry a complete total);
  // `fully_computed` is.
  if (!result.fully_computed) {
    console.warn(
      `[metcon-workcalc] skip: gate — fully_computed=${result.fully_computed} fully_modeled=${result.fully_modeled} unit=${result.unit}`,
    );
    return null;
  }

  // Average power = work ÷ time. The upstream returns watts:null for inline
  // workouts, so derive it: avg watts = total_joules / time_seconds.
  const bodyMass = result.body_mass_kg_used > 0 ? result.body_mass_kg_used : bodyMassKg;
  const rawWatts = result.watts ??
    (typeof timeSeconds === "number" && timeSeconds > 0
      ? result.total_joules / timeSeconds
      : null);
  const watts = rawWatts != null ? Math.round(rawWatts * 10) / 10 : null;
  const rawWPerKg = result.w_per_kg ??
    (watts != null && typeof bodyMass === "number" && bodyMass > 0
      ? watts / bodyMass
      : null);
  const wPerKg = rawWPerKg != null ? Math.round(rawWPerKg * 100) / 100 : null;

  console.log(
    `[metcon-workcalc] computed: joules=${result.total_joules} watts=${watts} w/kg=${wPerKg}`,
  );
  return {
    joules: result.total_joules,
    avg_power_watts: watts,
    avg_w_per_kg: wPerKg,
    body_mass_kg: bodyMass,
  };
}
