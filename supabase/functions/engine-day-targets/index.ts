/**
 * engine-day-targets — the pace targets for one Engine day, both formulas
 * (Continuum Phase 2; docs/conditioning_continuum_phase2_plan.md §5).
 *
 * Body: {
 *   workout_id?: string,        the engine_workouts row (catalogue day or sequencer override)
 *   position?: number,          else: the athlete's sequence position (default engine_current_day) → override or mapping
 *   modality?: string, units?: string,   the machine (default: the athlete's most recent current trial)
 *   target_user_id?: string     admin only: another athlete (the rollout view)
 * }
 * Returns both the legacy (today's) and curve (Phase 2) target for every work
 * segment, which one the athlete is on (`mode`, from athlete_profiles.engine_targets_v2),
 * and `snapshot` — the shown targets in the shape the day page stores on the
 * session at Start (engine_workout_sessions.targets). Computes only; writes nothing.
 *
 * Deploy: supabase functions deploy engine-day-targets
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import type { CatalogEngineDay } from "../_shared/engine-block-resolve.ts";
import { type EngineCurve, type PdCurvePoint } from "../_shared/engine-continuum.ts";
import { dayTargets, type DayTargets, deliveredPaceFloor, previousFromSnapshot, type SegmentTarget } from "../_shared/engine-targets.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SNAPSHOT_VERSION = 1;

interface WorkoutRow extends CatalogEngineDay { id: string; program_type: string }

async function loadDay(supa: SupabaseClient, userId: string, body: { workout_id?: string; position?: number }, version: string, currentDay: number): Promise<{ workout: WorkoutRow | null; position: number | null }> {
  const SEL = "id, program_type, day_number, day_type, phase, month, block_count, set_rest_seconds, block_1_params, block_2_params, block_3_params, block_4_params, total_duration_minutes";
  if (body.workout_id) {
    const { data } = await supa.from("engine_workouts").select(SEL).eq("id", body.workout_id).maybeSingle();
    return { workout: (data as WorkoutRow | null) ?? null, position: null };
  }
  const position = typeof body.position === "number" ? body.position : currentDay;
  const { data: ov } = await supa.from("engine_user_day_overrides").select("engine_workout_id").eq("user_id", userId).eq("program_version", version).eq("sequence_position", position).maybeSingle();
  if (ov?.engine_workout_id) {
    const { data } = await supa.from("engine_workouts").select(SEL).eq("id", ov.engine_workout_id).maybeSingle();
    if (data) return { workout: data as WorkoutRow, position };
  }
  const { data: map } = await supa.from("engine_program_mapping").select("engine_workout_day_number").eq("engine_program_id", version).eq("program_sequence_order", position).maybeSingle();
  if (!map) return { workout: null, position };
  const { data } = await supa.from("engine_workouts").select(SEL).eq("program_type", version).eq("day_number", map.engine_workout_day_number).maybeSingle();
  return { workout: (data as WorkoutRow | null) ?? null, position };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: { user }, error: authErr } = await supa.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({})) as { workout_id?: string; position?: number; modality?: string; units?: string; target_user_id?: string };
    let userId = user.id;
    if (body.target_user_id && body.target_user_id !== user.id) {
      const { data: prof } = await supa.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (prof?.role !== "admin") return json({ error: "Forbidden" }, 403);
      userId = body.target_user_id;
    }

    const { data: profile } = await supa.from("athlete_profiles")
      .select("engine_program_version, engine_current_day, engine_targets_v2, engine_curve")
      .eq("user_id", userId).maybeSingle();
    const version = (profile?.engine_program_version as string | null) ?? "main_5day";
    const currentDay = (profile?.engine_current_day as number | null) ?? 1;
    const flag = profile?.engine_targets_v2 === true;

    const { workout, position } = await loadDay(supa, userId, body, version, currentDay);
    if (!workout) return json({ error: "no workout for that day", position }, 404);

    // The machine: given, else the athlete's most recent current trial.
    let modality = body.modality ?? null, units = body.units ?? null;
    const { data: trials } = await supa.from("engine_time_trials").select("id, modality, units, calculated_rpm, date").eq("user_id", userId).eq("is_current", true).order("date", { ascending: false });
    const trialRows = (trials ?? []) as Array<{ id: string; modality: string; units: string | null; calculated_rpm: number | null; date: string }>;
    if (!modality) { modality = trialRows[0]?.modality ?? null; units = trialRows[0]?.units ?? null; }
    if (!modality) return json({ error: "no machine: pass modality/units or record a time trial", position }, 400);
    const trial = trialRows.find((t) => t.modality === modality && (t.units ?? "") === (units ?? "") && t.calculated_rpm != null) ?? null;

    const since28 = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
    const [{ data: curveRows }, { data: metric }, { data: prevSess }, { data: recent }] = await Promise.all([
      supa.from("engine_pd_curves").select("r, seconds, k_effort").eq("modality", modality).eq("units", units ?? ""),
      supa.from("engine_user_performance_metrics").select("rolling_avg_ratio").eq("user_id", userId).eq("day_type", workout.day_type).eq("modality", modality).maybeSingle(),
      supa.from("engine_workout_sessions").select("targets, date").eq("user_id", userId).eq("modality", modality).eq("units", units ?? "")
        .not("targets", "is", null).gte("date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)).order("date", { ascending: false }).limit(1).maybeSingle(),
      // the delivered-pace floor: what the athlete has recently delivered on this day type and machine
      supa.from("engine_workout_sessions").select("actual_pace").eq("user_id", userId).eq("completed", true).eq("day_type", workout.day_type).eq("modality", modality).eq("units", units ?? "").gte("date", since28),
    ]);
    const deliveredFloor = deliveredPaceFloor(((recent ?? []) as Array<{ actual_pace: number | null }>).map((r) => (r.actual_pace != null ? Number(r.actual_pace) : null)));
    const machineCurve: PdCurvePoint[] | null = curveRows && curveRows.length >= 2 ? (curveRows as Array<{ r: number; seconds: number }>).map((p) => ({ r: Number(p.r), seconds: Number(p.seconds) })) : null;
    const kEffort = curveRows?.[0] ? Number((curveRows[0] as { k_effort: number }).k_effort) : null;
    const athleteCurve = (profile?.engine_curve as EngineCurve | null) ?? null;

    // The share is derived per segment from the day's own pace fraction at its own
    // duration (decided 2026-11-17); only a block carrying its OWN intensityShare
    // (a sequenced day from rollout stage 3) overrides that. The envelope's
    // intensityShare on engine_day_types is the sequencer's choice range, not
    // merged here.
    const targets: DayTargets = dayTargets(workout, {
      trialPace: trial?.calculated_rpm != null ? Number(trial.calculated_rpm) : null,
      machineCurve,
      kEffort,
      athleteCurve,
      rollingRatio: metric?.rolling_avg_ratio != null ? Number(metric.rolling_avg_ratio) : null,
      isGenerated: String(workout.program_type).startsWith("gen:"),
      deliveredFloor,
    }, previousFromSnapshot((prevSess?.targets as Parameters<typeof previousFromSnapshot>[0]) ?? null));

    const mode: "curve" | "legacy" = flag ? "curve" : "legacy";
    const snapshot = {
      version: SNAPSHOT_VERSION,
      mode,
      trial: trial ? { id: trial.id, pace: Number(trial.calculated_rpm), date: trial.date } : null,
      machine: `${modality}|${units ?? ""}`,
      computed_at: new Date().toISOString(),
      blocks: targets.blocks.map((b) => b.segments.map((s): SegmentTarget & { label: string; round_index: number; duration_seconds: number } => ({ ...s[mode], label: s.label, round_index: s.round_index, duration_seconds: s.duration_seconds }))),
    };

    return json({
      user_id: userId,
      workout: { id: workout.id, day_type: workout.day_type, program_type: workout.program_type, day_number: workout.day_number, position },
      modality, units, mode, flag,
      trial: snapshot.trial,
      machine_curve: machineCurve != null, k_effort: kEffort,
      delivered_floor: deliveredFloor, recent_sessions: (recent ?? []).length,
      athlete_curve: athleteCurve != null,
      ...targets,
      snapshot,
    });
  } catch (e) {
    console.error("[engine-day-targets]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
