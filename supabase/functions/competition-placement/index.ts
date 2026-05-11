/**
 * competition-placement — admin-only proxy for the competition-service's
 * POST /workouts/{id}/placement (interpolate an ad-hoc score against that
 * workout's percentile curve → {field_size, worldwide_percentile,
 * worldwide_rank, cohort?}). Used after a user logs a throwback to show
 * "where you'd have landed." Mirrors the other competition-* proxies.
 *
 * Request body: { competition_workout_id, score_value, score_type,
 *   finished?, age_band? }. We forward score_value/score_type/finished/
 *   age_band to /workouts/{competition_workout_id}/placement.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PLACEMENT_TIMEOUT_MS = 8_000;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "UNAUTHORIZED" }, 401);

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "UNAUTHORIZED" }, 401);

    const { data: profile } = await supa.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "FORBIDDEN" }, 403);

    const body = await req.json().catch(() => ({}));
    const id = typeof body?.competition_workout_id === "string" ? body.competition_workout_id.trim() : "";
    const scoreValue = typeof body?.score_value === "number" ? body.score_value : null;
    const scoreType = typeof body?.score_type === "string" ? body.score_type : "";
    if (!id || scoreValue == null || !scoreType) return json({ error: "MISSING_FIELDS" }, 400);
    const finished = typeof body?.finished === "boolean" ? body.finished : undefined;
    const ageBand = typeof body?.age_band === "string" && body.age_band ? body.age_band : undefined;

    const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
    const serviceKey = Deno.env.get("COMPETITION_SERVICE_KEY");
    if (!baseUrl || !serviceKey) {
      console.error("[competition-placement] missing COMPETITION_SERVICE_* env");
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    }

    const url = `${baseUrl.replace(/\/$/, "")}/workouts/${encodeURIComponent(id)}/placement`;
    const upstreamBody: Record<string, unknown> = { score_value: scoreValue, score_type: scoreType };
    if (finished !== undefined) upstreamBody.finished = finished;
    if (ageBand !== undefined) upstreamBody.age_band = ageBand;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PLACEMENT_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "X-Service-Key": serviceKey, "Content-Type": "application/json" },
        body: JSON.stringify(upstreamBody),
        signal: controller.signal,
      });
      let payload: unknown;
      try {
        payload = await resp.json();
      } catch {
        return json({ error: "BAD_RESPONSE" }, 502);
      }
      return json(payload, resp.status);
    } catch (err) {
      if ((err as Error).name === "AbortError") return json({ error: "TIMEOUT" }, 504);
      console.error("[competition-placement] fetch error:", (err as Error).message);
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error("[competition-placement] unexpected error:", err);
    return json({ error: "INTERNAL" }, 500);
  }
});
