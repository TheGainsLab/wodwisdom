/**
 * engine-class-leaderboard — the gym Engine Class leaderboard for a signed-in member
 * or coach (GYM_PORTAL_FLOWS §F4). Per-workout board + season standings; divisions by
 * gender (+ the workout's modality); W·kg physics-normalized default with a raw toggle.
 *
 * The affiliate moderation ledger is AUTHORITATIVE and applied here BEFORE ranking
 * (drop hide / badge flag / substitute adjust — F4_MODERATION_CONTRACT seam 2). A
 * moderation-service outage degrades to an unmoderated board, never a failure.
 *
 * GATE: joined + active engine_cohort-family entitlement (the member sees THEIR gym's
 * board). Auth: verify_jwt=true; we decode the member id (also the viewer anchor).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { decodeJwtSub } from "../_shared/engine-class/auth.ts";
import { resolveMemberGym } from "../_shared/engine-class/gate.ts";
import { loadLatestProgram, loadEntries, loadProfiles } from "../_shared/engine-class/queries.ts";
import { selectTodaysWorkout } from "../_shared/engine-class/select-workout.ts";
import { fetchModerations } from "../_shared/engine-class/moderation-client.ts";
import { buildWorkoutBoard, buildSeasonStandings, type Metric } from "../_shared/engine-class/leaderboard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = createClient(SUPABASE_URL, SUPABASE_KEY);

interface Body {
  mode?: unknown;   // 'workout' | 'season'
  metric?: unknown; // 'wkg' | 'raw'
  week?: unknown;
  day?: unknown;
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

  let body: Body = {};
  try { body = await req.json() as Body; } catch { /* empty body = defaults */ }
  const mode = body.mode === "season" ? "season" : "workout";
  const metric: Metric = body.metric === "raw" ? "raw" : "wkg";

  const nowIso = new Date().toISOString();

  try {
    const gym = await resolveMemberGym(svc, userId, nowIso);
    if (!gym) return json({ error: "forbidden" }, 403);

    const program = await loadLatestProgram(svc, gym.gym_id);
    if (!program) return json({ mode, metric, gym_name: gym.gym_name, divisions: [], season: [], workout: null, moderation_connected: false });

    // Which workout: explicit (week,day) or today's.
    let week: number | undefined;
    let day: number | undefined;
    let modality: string | null = null;
    if (typeof body.week === "number" && typeof body.day === "number") {
      week = body.week; day = body.day;
    } else {
      const today = selectTodaysWorkout(program.shared_output, program.created_at, nowIso);
      if (today) { week = today.week_num; day = today.day_num; modality = today.modality; }
    }

    // Moderation ledger (seam 2) — authoritative, graceful-degrade.
    const mod = await fetchModerations(gym.gym_id);

    if (mode === "season") {
      const entries = await loadEntries(svc, gym.gym_id, program.id);
      const profiles = await loadProfiles(svc, entries.map((e) => e.user_id));
      const season = buildSeasonStandings(entries, profiles, mod.moderations, metric, userId);
      return json({ mode, metric, gym_name: gym.gym_name, cohort_program_id: program.id, season,
        moderation_connected: mod.connected });
    }

    // workout mode
    const entries = await loadEntries(svc, gym.gym_id, program.id, week, day);
    const profiles = await loadProfiles(svc, entries.map((e) => e.user_id));
    const divisions = buildWorkoutBoard(entries, profiles, mod.moderations, metric, userId);
    return json({
      mode, metric, gym_name: gym.gym_name, cohort_program_id: program.id,
      workout: week != null && day != null ? { week_num: week, day_num: day, modality } : null,
      divisions,
      moderation_connected: mod.connected,
    });
  } catch (e) {
    console.error("[engine-class-leaderboard]", userId, e);
    return json({ error: "leaderboard_failed", detail: (e as Error).message }, 500);
  }
});
