/**
 * engine-class-tv — F4 TV mode: a tokenized, NO-LOGIN endpoint for the gym-wall
 * screen. Returns today's Engine Class workout (Rx) + the rolling leaderboard for a
 * gym identified only by a high-entropy token (gym_tv_tokens). verify_jwt=false —
 * the token IS the capability; no member JWT (the cohort tables are service-role or
 * own-row gated, which a wall device can't satisfy).
 *
 * The moderation ledger (seam 2) is applied to the board, same as the member surface.
 * Privacy: only rank + display name + metric + division reach the wall.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { loadLatestProgram, loadEntries, loadProfiles } from "../_shared/engine-class/queries.ts";
import { selectTodaysWorkout } from "../_shared/engine-class/select-workout.ts";
import { fetchModerations } from "../_shared/engine-class/moderation-client.ts";
import { buildWorkoutBoard, anyRanked, type Metric } from "../_shared/engine-class/leaderboard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = createClient(SUPABASE_URL, SUPABASE_KEY);

/** SHA-256 hex of the presented token — we store/look up only the digest. */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  // Token from ?t= (GET, so the wall can just hit a URL) or POST body.
  let token = new URL(req.url).searchParams.get("t") ?? "";
  let metric: Metric = "wkg";
  if (req.method === "POST") {
    try {
      const b = await req.json() as { token?: unknown; metric?: unknown };
      if (typeof b.token === "string") token = b.token;
      if (b.metric === "raw") metric = "raw";
    } catch { /* fall through to query token */ }
  } else if (req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (new URL(req.url).searchParams.get("metric") === "raw") metric = "raw";
  token = token.trim();
  if (!token) return json({ error: "invalid_request", detail: "token required" }, 400);

  const nowIso = new Date().toISOString();

  try {
    const { data: tok, error: tokErr } = await svc
      .from("gym_tv_tokens")
      .select("gym_id, label, revoked_at, expires_at")
      .eq("token_digest", await sha256Hex(token))
      .maybeSingle();
    if (tokErr) return json({ error: "tv_failed", detail: tokErr.message }, 500);
    const t = tok as { gym_id: string; label: string | null; revoked_at: string | null; expires_at: string | null } | null;
    if (!t || t.revoked_at || (t.expires_at && Date.parse(t.expires_at) < Date.now())) {
      return json({ error: "invalid_token" }, 403);
    }
    const gymId = t.gym_id;

    // A display name for the wall (from any joined link for this gym).
    const { data: anyLink } = await svc
      .from("member_gym_links").select("gym_name, class_name").eq("gym_id", gymId).limit(1).maybeSingle();

    const program = await loadLatestProgram(svc, gymId);
    if (!program) return json({ gym_name: anyLink?.gym_name ?? null, workout: null, divisions: [], moderation_connected: false });

    const workout = selectTodaysWorkout(program.shared_output, program.created_at, nowIso);
    if (!workout) return json({ gym_name: anyLink?.gym_name ?? null, workout: null, divisions: [], moderation_connected: false });

    // Moderation ledger + entries are independent — fetch concurrently.
    const [mod, entries] = await Promise.all([
      fetchModerations(gymId),
      loadEntries(svc, gymId, program.id, workout.week_num, workout.day_num),
    ]);
    const profiles = await loadProfiles(svc, entries.map((e) => e.user_id));
    // TV uses SHORT names ("First L.") — the public wall is more exposure than the authed board.
    let divisions = buildWorkoutBoard(entries, profiles, mod.moderations, metric, null, "short");
    let effectiveMetric: Metric = metric;
    if (metric === "wkg" && entries.length > 0 && !anyRanked(divisions)) {
      effectiveMetric = "raw";
      divisions = buildWorkoutBoard(entries, profiles, mod.moderations, "raw", null, "short");
    }

    return json({
      gym_name: anyLink?.gym_name ?? t.label ?? null,
      class_name: anyLink?.class_name ?? null,
      metric: effectiveMetric,
      workout: {
        week_num: workout.week_num,
        day_num: workout.day_num,
        modality: workout.modality,
        blocks: workout.blocks, // Rx for the wall
      },
      divisions,
      moderation_connected: mod.connected,
    });
  } catch (e) {
    console.error("[engine-class-tv]", e);
    return json({ error: "tv_failed", detail: (e as Error).message }, 500);
  }
});
