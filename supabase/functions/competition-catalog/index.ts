/**
 * competition-catalog — proxy for the competition-service's workout catalog.
 *
 * Two modes, both X-Service-Key proxies (the frontend can't hold the key):
 *   - no body / no workout_id → GET /workouts — the full catalog list
 *     (~340 rows, near-static); data behind the "All"-scope grid.
 *   - body { workout_id }     → GET /workouts/{id} — one workout's full spec
 *     (the workout{} block: description, scoring, movements with loads/reps/
 *     distances/mgw_category — same shape as the bundle's all_results[].workout).
 *     Used by Try-It to read a catalog workout's prescription.
 *
 * Access: admins + holders of an active athletedata/programming entitlement
 * (see _shared/athletedata-access.ts).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CATALOG_TIMEOUT_MS = 8_000;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "UNAUTHORIZED" }, 401);

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "UNAUTHORIZED" }, 401);

    // Open to any authenticated user. The competition catalog is public
    // reference data (~340 catalog workouts) with no per-user content.

    const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
    const serviceKey = Deno.env.get("COMPETITION_SERVICE_KEY");
    if (!baseUrl || !serviceKey) {
      console.error("[competition-catalog] missing COMPETITION_SERVICE_* env");
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    }

    // Optional { workout_id } in the body routes to the per-workout detail
    // (GET /workouts/{id}); absent → the full catalog list (GET /workouts).
    const body = await req.json().catch(() => ({}));
    const workoutId = typeof body?.workout_id === "string" ? body.workout_id.trim() : "";
    const base = baseUrl.replace(/\/$/, "");
    const url = workoutId
      ? `${base}/workouts/${encodeURIComponent(workoutId)}`
      : `${base}/workouts`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: { "X-Service-Key": serviceKey },
        signal: controller.signal,
      });
      console.log(
        `[competition-catalog] ${workoutId ? `detail ${workoutId}` : "list"} → HTTP ${resp.status}, x-api-version=${resp.headers.get("x-api-version") ?? "none"}`,
      );
      let payload: unknown;
      try {
        payload = await resp.json();
      } catch {
        return json({ error: "BAD_RESPONSE" }, 502);
      }
      return json(payload, resp.status);
    } catch (err) {
      if ((err as Error).name === "AbortError") return json({ error: "TIMEOUT" }, 504);
      console.error("[competition-catalog] fetch error:", (err as Error).message);
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error("[competition-catalog] unexpected error:", err);
    return json({ error: "INTERNAL" }, 500);
  }
});
