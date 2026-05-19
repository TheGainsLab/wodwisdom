/**
 * compute-benchmarks — data-grounded median/excellent benchmarks for an
 * AI-generated metcon block. Replaces the hardcoded PERFORMANCE_FACTORS
 * client-side guess in src/lib/metconScoring.ts with population-derived
 * numbers (Open p50 = median, QF p50 = excellent; see plan file).
 *
 * Auth: any logged-in user. No admin gate — every athlete needs benchmarks.
 *
 * Request body (POST JSON):
 *   {
 *     "movements": [
 *       { "movement_name": "Thruster", "reps_total": 45, "load_lbs_men": 95, "load_lbs_women": 65 },
 *       { "movement_name": "Pull-up", "reps_total": 45 }
 *     ],
 *     "workout_type": "for_time" | "amrap",
 *     "time_cap_seconds": 720,           // optional; required for AMRAPs
 *     "block_scheme_hint": "21-15-9 for time",   // optional; time-domain regex fallback
 *     "rounds": 1                         // optional; default 1; ignored for AMRAPs
 *   }
 *
 * Gender is read server-side from athlete_profiles for the authenticated user.
 * If gender is missing on the profile, defaults to "men" (with a warning log
 * including user_id for audit).
 *
 * Response (200):
 *   {
 *     "median_score": "4:56", "excellent_score": "3:44",
 *     "median_watts": 250, "excellent_watts": 330,
 *     "joules": 74000,
 *     "basis": "open_p50_vs_qf_p50",
 *     "time_domain": "short"
 *   }
 *
 * Response (200 with `null` data) when computeBenchmarks returns null
 * (upstream work-calc unavailable, stage curve unavailable, etc.):
 *   { "data": null, "reason": "upstream_unavailable" }
 *   → caller falls back to PERFORMANCE_FACTORS-based client math.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  computeBenchmarks,
  type ComputeBenchmarksInput,
  type Gender,
  type WorkCalcMovement,
} from "../_shared/compute-benchmarks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

    // 1. Auth.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "UNAUTHORIZED" }, 401);
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "UNAUTHORIZED" }, 401);

    // 2. Look up gender from athlete_profiles. Falls back to null → computeBenchmarks
    //    defaults to "men" and logs the warning with user_id.
    let gender: Gender | null = null;
    const { data: profile } = await supa
      .from("athlete_profiles")
      .select("gender")
      .eq("user_id", user.id)
      .maybeSingle();
    const profileGender = (profile as { gender: string | null } | null)?.gender?.toLowerCase();
    if (profileGender === "men" || profileGender === "male") gender = "men";
    else if (profileGender === "women" || profileGender === "female") gender = "women";

    // 3. Parse + validate body.
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const movements = parseMovements(body.movements);
    if (movements === null) {
      return json({ error: "INVALID_MOVEMENTS" }, 400);
    }
    const workoutType = body.workout_type;
    if (workoutType !== "for_time" && workoutType !== "amrap") {
      return json({ error: "INVALID_WORKOUT_TYPE" }, 400);
    }
    const timeCapSeconds = typeof body.time_cap_seconds === "number" && body.time_cap_seconds > 0
      ? body.time_cap_seconds
      : undefined;
    const blockSchemeHint = typeof body.block_scheme_hint === "string"
      ? body.block_scheme_hint
      : undefined;
    const rounds = typeof body.rounds === "number" && body.rounds > 0 ? body.rounds : undefined;

    if (workoutType === "amrap" && !timeCapSeconds) {
      return json({ error: "AMRAP_REQUIRES_TIME_CAP" }, 400);
    }

    // 4. Compute.
    const input: ComputeBenchmarksInput = {
      movements,
      gender,
      workout_type: workoutType,
      time_cap_seconds: timeCapSeconds,
      block_scheme_hint: blockSchemeHint,
      rounds,
      user_id: user.id,
    };
    const result = await computeBenchmarks(input);
    if (result === null) {
      // Upstream unavailable / Open p50 missing / etc. Caller falls back.
      return json({ data: null, reason: "upstream_unavailable" }, 200);
    }
    return json({ data: result }, 200);
  } catch (err) {
    console.error("[compute-benchmarks] unexpected error:", err);
    return json({ error: "INTERNAL" }, 500);
  }
});

/** Validates the movements array. Returns null on any structural problem.
 *  Each movement must declare EXACTLY ONE volume specifier:
 *    reps_total | reps_per_round | (distance_value + distance_unit) | calories | rounds.
 *  Sending zero or multiple specifiers is invalid — upstream sql/139
 *  will return a loud invalid_request for missing specifiers, but
 *  we'd rather catch the consumer-side mistake before the round-trip. */
function parseMovements(raw: unknown): WorkCalcMovement[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const result: WorkCalcMovement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const m = item as Record<string, unknown>;
    const name = typeof m.movement_name === "string" ? m.movement_name.trim() : "";
    if (!name) return null;
    const repsTotal = typeof m.reps_total === "number" && m.reps_total > 0 ? m.reps_total : null;
    const repsPerRound = typeof m.reps_per_round === "number" && m.reps_per_round > 0
      ? m.reps_per_round
      : null;
    const distanceValue = typeof m.distance_value === "number" && m.distance_value > 0
      ? m.distance_value
      : null;
    const distanceUnit = typeof m.distance_unit === "string" ? m.distance_unit : null;
    const calories = typeof m.calories === "number" && m.calories > 0 ? m.calories : null;
    const rounds = typeof m.rounds === "number" && m.rounds > 0 ? m.rounds : null;

    // Distance requires BOTH value + unit. Treat partial as invalid.
    const hasDistance = distanceValue !== null && distanceUnit !== null;
    const declaredCount = [
      repsTotal !== null,
      repsPerRound !== null,
      hasDistance,
      calories !== null,
      rounds !== null,
    ].filter(Boolean).length;
    if (declaredCount !== 1) return null;

    const entry: WorkCalcMovement = { movement_name: name };
    if (repsTotal !== null) entry.reps_total = repsTotal;
    if (repsPerRound !== null) entry.reps_per_round = repsPerRound;
    if (hasDistance) {
      entry.distance_value = distanceValue!;
      entry.distance_unit = distanceUnit! as WorkCalcMovement["distance_unit"];
    }
    if (calories !== null) entry.calories = calories;
    if (rounds !== null) entry.rounds = rounds;
    if (typeof m.load_lbs_men === "number" && m.load_lbs_men > 0) {
      entry.load_lbs_men = m.load_lbs_men;
    }
    if (typeof m.load_lbs_women === "number" && m.load_lbs_women > 0) {
      entry.load_lbs_women = m.load_lbs_women;
    }
    result.push(entry);
  }
  return result;
}
