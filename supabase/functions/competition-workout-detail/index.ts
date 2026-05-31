/**
 * competition-workout-detail — admin-only proxy for the competition-service's
 * GET /workouts/{competition_workout_id} (the detail endpoint: full workout{}
 * spec incl. `description`, plus field_size / cap_completion_rate /
 * top_performance / stats{}). We forward and pass the response back, same as
 * competition-catalog (the list). Used to enrich the not-done workout card with
 * the prescription (and later the cohort gap bar).
 *
 * Access: VIEW gate (admin today, opens to any authed user when
 * ATHLETEDATA_PUBLIC_TIER flips) — same as competition-catalog. This is
 * reference data, NOT the paid Try-It action (that's competition-placement).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { ATHLETEDATA_PUBLIC_TIER } from "../_shared/feature-flags.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DETAIL_TIMEOUT_MS = 8_000;

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

    // View gate: admin-only today; opens to any authenticated user when
    // ATHLETEDATA_PUBLIC_TIER flips (same as competition-catalog).
    if (!ATHLETEDATA_PUBLIC_TIER) {
      const { data: profile } = await supa
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role !== "admin") return json({ error: "FORBIDDEN" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const id = typeof body?.competition_workout_id === "string" ? body.competition_workout_id.trim() : "";
    if (!id) return json({ error: "MISSING_FIELDS" }, 400);

    const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
    const serviceKey = Deno.env.get("COMPETITION_SERVICE_KEY");
    if (!baseUrl || !serviceKey) {
      console.error("[competition-workout-detail] missing COMPETITION_SERVICE_* env");
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    }

    const url = `${baseUrl.replace(/\/$/, "")}/workouts/${encodeURIComponent(id)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: { "X-Service-Key": serviceKey },
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
      console.error("[competition-workout-detail] fetch error:", (err as Error).message);
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error("[competition-workout-detail] unexpected error:", err);
    return json({ error: "INTERNAL" }, 500);
  }
});
