/**
 * log-throwback — logs a Try-It throwback result and computes its power.
 *
 * A competition_log user does a catalog competition workout outside
 * competition and logs their score. This function:
 *   1. gates on hasCompetitionLogAccess (the paid-action gate),
 *   2. resolves workout_catalog_id from competition_workout_id (GET /workouts/{id}),
 *   3. best-effort computes work/power via the cataloged work-calc path
 *      (workout_catalog_id + the athlete's body mass + their score),
 *   4. inserts the competition_workout_results row with the power columns,
 *   5. returns the saved row.
 *
 * Failure-soft on power: if work-calc fails, the workout has unmodeled
 * movements, body mass / gender is unknown, or the score type yields no time
 * signal, the row still saves with null power columns. The save never fails
 * because power couldn't compute.
 *
 * Placement ("where you'd have landed") stays a separate call
 * (competition-placement), made by the client after this returns.
 *
 * AMRAP note: an AMRAP throwback sends score_reps (the raw rep total). On
 * work-calc v1 that's ignored — the result is a per-round figure, not the
 * athlete's total, so the row saves with null power. On v1.1 work-calc
 * decomposes score_reps server-side and the row saves with real joules/watts.
 * Either way the save succeeds.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasCompetitionLogAccess } from "../_shared/athletedata-access.ts";
import { computeWork } from "../_shared/work-calc.ts";
import type { Gender } from "../_shared/compute-benchmarks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const SCORE_TYPES = ["time", "reps", "load_lbs", "distance"] as const;

/** Convert a stored bodyweight to kilograms. */
function toKg(weight: unknown, units: unknown): number | null {
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) return null;
  return units === "lbs" ? weight * 0.45359237 : weight;
}

/** Map a profile gender field to work-calc's "men"/"women"; null when unknown. */
function normalizeGender(raw: unknown): Gender | null {
  if (typeof raw !== "string") return null;
  const g = raw.trim().toLowerCase();
  if (g === "men" || g === "male" || g === "m") return "men";
  if (g === "women" || g === "female" || g === "w" || g === "f") return "women";
  return null;
}

/**
 * Resolve workout_catalog_id for a competition workout via the
 * competition-service GET /workouts/{id} detail. Best-effort — null on any
 * failure, which makes the caller skip the power compute (the throwback still
 * saves). Keeps the cataloged work-calc path keyed off our own
 * competition_workout_id rather than trusting a client-passed catalog id.
 */
/** Workout identity captured from the catalog detail, stored on the row so the
 *  eval/generator can read logged throwbacks like imported history. */
interface WorkoutMeta {
  workout_catalog_id: string | null;
  workout_name: string | null;
  movements: string[] | null;
  time_domain: string | null;
  classification: string | null;
}

const EMPTY_META: WorkoutMeta = {
  workout_catalog_id: null,
  workout_name: null,
  movements: null,
  time_domain: null,
  classification: null,
};

/** Defensively pull movement display names from a catalog movements array
 *  (entries may be {name} objects or bare strings). */
function movementNames(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const names = raw
    .map((m) => (typeof m === "string" ? m : (m as { name?: unknown } | null)?.name))
    .filter((n): n is string => typeof n === "string" && n.trim() !== "");
  return names.length ? names : null;
}

async function fetchWorkoutMeta(competitionWorkoutId: string): Promise<WorkoutMeta> {
  const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
  const serviceKey = Deno.env.get("COMPETITION_SERVICE_KEY");
  if (!baseUrl || !serviceKey) {
    console.warn("[log-throwback] missing COMPETITION_SERVICE_* env; skipping power + metadata");
    return EMPTY_META;
  }
  const url = `${baseUrl.replace(/\/$/, "")}/workouts/${encodeURIComponent(competitionWorkoutId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "X-Service-Key": serviceKey },
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn(`[log-throwback] workout detail HTTP ${resp.status} for ${competitionWorkoutId}`);
      return EMPTY_META;
    }
    const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json) return EMPTY_META;
    // The catalog detail may be flat or nest the spec under `workout`.
    const spec = (json.workout ?? json) as Record<string, unknown>;
    const td = spec.time_domain as { bucket?: unknown } | null | undefined;
    const id = json.workout_catalog_id;
    return {
      workout_catalog_id: typeof id === "string" && id ? id : null,
      workout_name: typeof json.workout_name === "string" ? json.workout_name : null,
      movements: movementNames(spec.movements),
      time_domain: typeof td?.bucket === "string" ? td.bucket : null,
      classification: typeof spec.classification === "string" ? spec.classification : null,
    };
  } catch (err) {
    console.warn(`[log-throwback] workout detail fetch error: ${(err as Error).message}`);
    return EMPTY_META;
  } finally {
    clearTimeout(timer);
  }
}

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

    // Auth.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "UNAUTHORIZED" }, 401);
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "UNAUTHORIZED" }, 401);

    // Paid-action gate.
    if (!(await hasCompetitionLogAccess(supa, user.id))) {
      return json({ error: "FORBIDDEN" }, 403);
    }

    // Parse + validate the throwback fields.
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const competitionWorkoutId = typeof body.competition_workout_id === "string"
      ? body.competition_workout_id.trim()
      : "";
    const scoreType = typeof body.score_type === "string" ? body.score_type : "";
    const scoreValue = typeof body.score_value === "number" ? body.score_value : NaN;
    const finished = typeof body.finished === "boolean" ? body.finished : null;
    const standardsMet = typeof body.standards_met === "boolean" ? body.standards_met : null;
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

    const todayISO = new Date().toISOString().slice(0, 10);
    const performedAt = typeof body.performed_at === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(body.performed_at)
      ? body.performed_at
      : todayISO;

    if (!competitionWorkoutId) return json({ error: "MISSING_WORKOUT_ID" }, 400);
    if (!SCORE_TYPES.includes(scoreType as (typeof SCORE_TYPES)[number])) {
      return json({ error: "INVALID_SCORE_TYPE" }, 400);
    }
    if (!Number.isFinite(scoreValue) || scoreValue <= 0) {
      return json({ error: "INVALID_SCORE_VALUE" }, 400);
    }
    if (performedAt > todayISO) return json({ error: "PERFORMED_AT_IN_FUTURE" }, 400);

    // Athlete profile — body mass + gender for the power compute.
    const { data: ap } = await supa
      .from("athlete_profiles")
      .select("bodyweight, units, gender")
      .eq("user_id", user.id)
      .maybeSingle();
    const apr = ap as { bodyweight?: number; units?: string; gender?: string } | null;
    const bodyMassKg = toKg(apr?.bodyweight, apr?.units);
    const gender = normalizeGender(apr?.gender);

    // Resolve catalog id + workout identity (name/movements/time-domain) from
    // our own competition_workout_id (server-side, not client-trusted).
    // Best-effort — nulls skip the power compute / leave metadata empty.
    const meta = await fetchWorkoutMeta(competitionWorkoutId);
    const workoutCatalogId = meta.workout_catalog_id;

    // Best-effort power compute via the cataloged work-calc path. Needs the
    // catalog id + a known gender (to pick the division's loads). Watts come
    // back only for for-time scores (time_seconds passed); reps/load/distance
    // save with joules-or-null but null watts.
    let joules: number | null = null;
    let watts: number | null = null;
    let wPerKg: number | null = null;
    let bodyMassKgUsed: number | null = null;
    if (workoutCatalogId && gender) {
      const result = await computeWork(
        { workout_catalog_id: workoutCatalogId },
        {
          gender,
          body_mass_kg: bodyMassKg ?? undefined,
          time_seconds: scoreType === "time" ? scoreValue : undefined,
          score_reps: scoreType === "reps" ? scoreValue : undefined,
        },
      );
      if (result) {
        // Store power only when total_joules is the athlete's real, COMPLETE
        // effort — gate on BOTH compute_status and fully_modeled:
        //   - compute_status "computed" → total_joules is the athlete's total
        //     (for-time, or a decomposed AMRAP). The amrap_* statuses mean a
        //     per-round figure — not the athlete's total.
        //   - fully_modeled → no un-modeled movement. compute_status alone is
        //     not enough: an un-modeled movement still reports "computed" but
        //     with an understated total_joules (its work silently dropped).
        // Fail either check → leave the power columns null.
        const usable = result.compute_status === "computed" && result.fully_modeled;
        if (usable) {
          joules = result.total_joules;
          watts = result.watts;
          wPerKg = result.w_per_kg;
          bodyMassKgUsed = result.body_mass_kg_used > 0 ? result.body_mass_kg_used : bodyMassKg;
        }
      }
    } else {
      console.warn(
        `[log-throwback] skipping power compute (workout_catalog_id=${!!workoutCatalogId}, gender=${gender ?? "unknown"})`,
      );
    }

    // Insert the throwback row. Service role → RLS bypassed; this function is
    // the authority for competition_log writes.
    const { data: row, error: insErr } = await supa
      .from("competition_workout_results")
      .insert({
        user_id: user.id,
        competition_workout_id: competitionWorkoutId,
        score_type: scoreType,
        score_value: scoreValue,
        finished,
        performed_at: performedAt,
        source: "throwback",
        scaling_level: "rx",
        standards_met: standardsMet,
        notes,
        joules,
        avg_power_watts: watts,
        avg_w_per_kg: wPerKg,
        body_mass_kg: bodyMassKgUsed,
        workout_name: meta.workout_name,
        movements: meta.movements,
        time_domain: meta.time_domain,
        classification: meta.classification,
      })
      .select()
      .single();

    if (insErr) {
      console.error("[log-throwback] insert failed:", insErr.message);
      return json({ error: "INSERT_FAILED" }, 500);
    }

    return json({ result: row }, 200);
  } catch (err) {
    console.error("[log-throwback] unexpected error:", err);
    return json({ error: "INTERNAL" }, 500);
  }
});
