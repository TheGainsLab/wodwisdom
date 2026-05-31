/**
 * work-calc.ts — client for the competition-service's POST /v1/work/calculate.
 *
 * Returns work + power for a workout, computed at a given body mass. Two
 * workout modes — the endpoint dispatches on exactly one (sending both 400s):
 *
 *   - cataloged → workout_catalog_id, TOP-LEVEL (sibling of gender/body_mass_kg,
 *       NOT under a `workout` key) — Try-It throwbacks.
 *   - inline    → workout: { movements } — freelance / AI-programmed workouts.
 *
 * Athlete params, all top-level: `gender` ("men"/"women" — NOT the M/F division
 * codes the bundle uses), `body_mass_kg` (omit → 84M/64W default), and the score:
 *   - `time_seconds` — for-time / capped finish. Yields watts/w_per_kg.
 *   - `score_reps`   — AMRAP raw total rep count. work-calc v1.1+ decomposes it
 *       server-side (rounds + partial) → athlete-total joules + watts; v1
 *       ignores it (returns only a per-round figure).
 *
 * `compute_status` (v1.1+) flags whether `total_joules` is the athlete's real
 * effort — see WorkCalcResult.
 *
 * Failure-soft: returns null on every error path. Callers treat null as
 * "power unavailable" and fall back.
 */

import type { WorkCalcMovement, Gender } from "./compute-benchmarks.ts";

const WORK_CALC_TIMEOUT_MS = 8_000;

export type WorkCalcWorkout =
  | { workout_catalog_id: string }
  | { movements: WorkCalcMovement[] };

export interface ComputeWorkParams {
  /** "men" / "women" — NOT the M/F division codes the bundle uses. */
  gender: Gender;
  /** Athlete's actual body mass (kg). Omit → 84M/64W default. */
  body_mass_kg?: number;
  /** For-time / capped result: the athlete's time. Supplying it returns watts/w_per_kg. */
  time_seconds?: number;
  /** AMRAP result: the athlete's raw total rep count. Decomposed server-side
   *  by work-calc v1.1+ (ignored by v1). */
  score_reps?: number;
}

export interface WorkCalcResult {
  total_joules: number;
  /** Average power — null without a time/score signal, or AMRAP on work-calc v1. */
  watts: number | null;
  w_per_kg: number | null;
  /** Body mass actually used; body_mass_was_default=false confirms ours was applied. */
  body_mass_kg_used: number;
  body_mass_was_default: boolean;
  /** "per_workout" (for-time) | "per_round" (AMRAP). */
  unit: string;
  /** v1.1+: "computed" when total_joules is the athlete's real effort;
   *  "amrap_needs_score_reps" / "amrap_variable_rounds" when it's a per-round
   *  figure. null on v1 (field absent) — disambiguate with `unit` there. */
  compute_status: string | null;
  /** False when the workout contains movements work-calc hasn't modeled. */
  fully_modeled: boolean;
  /** True only when every movement actually produced joules — the real
   *  "total_joules is the athlete's complete effort" signal. */
  fully_computed: boolean;
}

/** Work + power for a workout, or null on any failure. */
export async function computeWork(
  workout: WorkCalcWorkout,
  params: ComputeWorkParams,
): Promise<WorkCalcResult | null> {
  const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
  // work-calc uses a SEPARATE per-consumer key, not the shared
  // COMPETITION_SERVICE_KEY used for programming-profile / catalog endpoints.
  const serviceKey = Deno.env.get("WORK_CALC_SERVICE_KEY");
  if (!baseUrl || !serviceKey) {
    console.warn(
      "[work-calc] missing COMPETITION_SERVICE_BASE_URL or WORK_CALC_SERVICE_KEY; returning null",
    );
    return null;
  }

  const url = `${baseUrl.replace(/\/$/, "")}/work-calc/v1/work/calculate`;

  // Athlete params + the catalog id are top-level; inline movements go under
  // `workout.movements`. Exactly one workout selector — never both.
  const reqBody: Record<string, unknown> = { gender: params.gender };
  if (typeof params.body_mass_kg === "number" && params.body_mass_kg > 0) {
    reqBody.body_mass_kg = params.body_mass_kg;
  }
  if (typeof params.time_seconds === "number" && params.time_seconds > 0) {
    reqBody.time_seconds = params.time_seconds;
  }
  if (
    typeof params.score_reps === "number" &&
    Number.isInteger(params.score_reps) &&
    params.score_reps >= 0
  ) {
    reqBody.score_reps = params.score_reps;
  }
  if ("workout_catalog_id" in workout) {
    reqBody.workout_catalog_id = workout.workout_catalog_id;
  } else {
    reqBody.workout = { movements: workout.movements };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORK_CALC_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "X-Service-Key": serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });

    const bodyText = await resp.text().catch(() => "");
    if (!resp.ok) {
      console.warn(`[work-calc] HTTP ${resp.status}; body=${bodyText.slice(0, 400)}; returning null`);
      return null;
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      console.warn(`[work-calc] response not JSON; body=${bodyText.slice(0, 200)}; returning null`);
      return null;
    }

    const totalJoules = json.total_joules;
    if (typeof totalJoules !== "number" || totalJoules <= 0) {
      console.warn(`[work-calc] no usable total_joules; response=${bodyText.slice(0, 400)}; returning null`);
      return null;
    }

    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;

    return {
      total_joules: totalJoules,
      watts: num(json.watts),
      w_per_kg: num(json.w_per_kg),
      body_mass_kg_used: num(json.body_mass_kg_used) ?? 0,
      body_mass_was_default: json.body_mass_was_default === true,
      unit: typeof json.unit === "string" ? json.unit : "per_workout",
      compute_status: typeof json.compute_status === "string" ? json.compute_status : null,
      fully_modeled: json.fully_modeled === true,
      fully_computed: json.fully_computed === true,
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[work-calc] timeout; returning null");
    } else {
      console.warn(`[work-calc] error: ${(err as Error).message}; returning null`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
