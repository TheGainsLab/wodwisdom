/**
 * engine-class-log — a seat member logs their result for TODAY's shared Engine Class
 * workout. Writes an `engine_class_results` entry (the leaderboard's raw material +
 * the moderation `result_ref`) and computes avg power via the data-service work-calc
 * so the W·kg board works. Re-logging the same workout UPDATEs the entry.
 *
 * GATE: same as the view — joined + active engine_cohort-family entitlement (an active
 * seat). The free read-only view has logging LOCKED; passing this gate IS the seat.
 * Auth: verify_jwt=true; we decode the member id.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { decodeJwtSub } from "../_shared/engine-class/auth.ts";
import { resolveMemberGym } from "../_shared/engine-class/gate.ts";
import { loadLatestProgram } from "../_shared/engine-class/queries.ts";
import { selectTodaysWorkout } from "../_shared/engine-class/select-workout.ts";
import { computeEntryPower } from "../_shared/engine-class/physics.ts";
import { normalizeGender, toKg } from "../_shared/metcon-workcalc.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = createClient(SUPABASE_URL, SUPABASE_KEY);

interface LogBody {
  time_seconds?: unknown; // for_time
  score_reps?: unknown;   // amrap
  rounds?: unknown;       // rounds_reps
  reps?: unknown;         // rounds_reps partial
  load?: unknown;         // load (strength) — in the member's units
  load_unit?: unknown;    // 'lbs' | 'kg'
  score_text?: unknown;   // 'other'
  rx?: unknown;
  // TOCTOU guard: the (week, day) the client DISPLAYED. If today's workout rolled
  // over between page-load and submit, we 409 instead of silently attaching the score
  // to the wrong workout's board.
  expected_week?: unknown;
  expected_day?: unknown;
}

const SCORE_TEXT_MAX = 64;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function mmss(totalSeconds: number): string {
  // Round the TOTAL first so 89.6s → 1:30, never "1:60".
  const t = Math.round(totalSeconds);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userId = decodeJwtSub(authHeader.replace("Bearer ", ""));
  if (!userId) return json({ error: "unauthorized" }, 401);

  let body: LogBody;
  try { body = await req.json() as LogBody; } catch { return json({ error: "invalid_json" }, 400); }

  const nowIso = new Date().toISOString();

  try {
    const gym = await resolveMemberGym(svc, userId, nowIso);
    if (!gym) return json({ error: "forbidden", detail: "no active Engine Class seat for this member" }, 403);

    const program = await loadLatestProgram(svc, gym.gym_id);
    if (!program) return json({ error: "no_program", detail: "no cohort program to log against yet" }, 409);
    const workout = selectTodaysWorkout(program.shared_output, program.created_at, nowIso);
    if (!workout) return json({ error: "no_workout", detail: "no class workout today" }, 409);

    // TOCTOU: reject if today's workout changed since the client rendered it.
    const expW = num(body.expected_week);
    const expD = num(body.expected_day);
    if (expW != null && expD != null && (expW !== workout.week_num || expD !== workout.day_num)) {
      return json({
        error: "workout_rolled_over",
        detail: "today's class workout changed — reload and log against the current workout",
        week_num: workout.week_num, day_num: workout.day_num,
      }, 409);
    }

    // Build the score from the workout's score_type.
    const rx = body.rx === undefined ? true : body.rx === true;
    let score_display: string;
    let score_sort: number | null = null;
    let timeSeconds: number | undefined;
    let scoreReps: number | undefined;

    switch (workout.score_type) {
      case "for_time": {
        const t = num(body.time_seconds);
        if (t == null || t <= 0) return json({ error: "invalid_request", detail: "time_seconds required for a for-time workout" }, 400);
        score_display = mmss(t);
        score_sort = -t; // faster = higher
        timeSeconds = t;
        break;
      }
      case "amrap": {
        const r = num(body.score_reps);
        if (r == null) return json({ error: "invalid_request", detail: "score_reps required for an AMRAP" }, 400);
        score_display = `${r} reps`;
        score_sort = r;
        scoreReps = r;
        break;
      }
      case "rounds_reps": {
        const rounds = num(body.rounds);
        const reps = num(body.reps) ?? 0;
        if (rounds == null) return json({ error: "invalid_request", detail: "rounds required" }, 400);
        score_display = `${rounds}+${reps}`;
        score_sort = rounds * 1000 + reps; // rounds dominate; reps break ties
        break;
      }
      case "load": {
        const load = num(body.load);
        if (load == null || load <= 0) return json({ error: "invalid_request", detail: "load required for a strength workout" }, 400);
        const unit = body.load_unit === "kg" ? "kg" : "lbs";
        const loadLbs = unit === "kg" ? load * 2.2046226218 : load;
        score_display = `${load} ${unit}`;
        score_sort = loadLbs; // heavier = higher (normalized to lbs)
        break;
      }
      default: {
        const txt = typeof body.score_text === "string" ? body.score_text.trim().slice(0, SCORE_TEXT_MAX) : "";
        if (!txt) return json({ error: "invalid_request", detail: "score_text required" }, 400);
        score_display = txt;
        score_sort = null;
      }
    }

    // ONE PROFILE: bodyweight/gender/units for the physics call from athlete_profiles.
    const { data: ap } = await svc.from("athlete_profiles").select("gender, bodyweight, units").eq("user_id", userId).maybeSingle();
    const gender = normalizeGender(ap?.gender) ?? "men"; // default for the physics model when unknown
    const bodyMassKg = toKg(ap?.bodyweight, ap?.units) ?? undefined;

    // Physics — RX ONLY. The watts come from the Rx prescription, which describes the
    // member's real work only when they did it Rx; a scaled entry ranks on raw score
    // (with its rx:false badge), never Rx power credit (see physics.ts header).
    let avgWatts: number | null = null;
    let totalJoules: number | null = null;
    let bodyMassUsed: number | null = null;
    const physicsType = workout.score_type === "for_time" ? "for_time"
      : workout.score_type === "amrap" ? "amrap" : null;
    if (rx && physicsType && workout.scored_block_idx != null) {
      const block = workout.blocks[workout.scored_block_idx];
      const capSeconds = num(block.time_cap_seconds ?? undefined) ?? undefined; // AMRAP watts divisor
      const power = await computeEntryPower(block, {
        gender, bodyMassKg, scoreType: physicsType, timeSeconds, capSeconds, scoreReps,
      });
      if (power) {
        avgWatts = power.avg_power_watts;
        totalJoules = power.total_joules;
        bodyMassUsed = power.body_mass_kg;
      }
    }

    const { data: saved, error: upErr } = await svc
      .from("engine_class_results")
      .upsert({
        gym_id: gym.gym_id,
        user_id: userId,
        cohort_program_id: program.id,
        week_num: workout.week_num,
        day_num: workout.day_num,
        modality: workout.modality,
        score_type: workout.score_type,
        score_display,
        score_sort,
        rx,
        avg_power_watts: avgWatts,
        total_joules: totalJoules,
        body_mass_kg: bodyMassUsed,
      }, { onConflict: "gym_id,user_id,cohort_program_id,week_num,day_num" })
      .select("id")
      .single();
    if (upErr || !saved) {
      console.error("[engine-class-log] upsert failed:", upErr);
      return json({ error: "log_failed", detail: upErr?.message ?? "no row" }, 500);
    }

    return json({
      logged: true,
      result_ref: (saved as { id: string }).id,
      week_num: workout.week_num,
      day_num: workout.day_num,
      score_display,
      wkg_available: avgWatts != null && bodyMassKg != null,
    });
  } catch (e) {
    console.error("[engine-class-log]", userId, e);
    return json({ error: "log_failed", detail: (e as Error).message }, 500);
  }
});
