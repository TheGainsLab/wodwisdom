/**
 * competition-catalog — admin-only proxy for the competition-service's
 * GET /workouts catalog list (every competition workout, ~340 rows,
 * near-static). The frontend can't hold the X-Service-Key, so it calls
 * this; we forward and pass the response back. Mirrors
 * search-competition-athletes / verify-competition-athlete.
 *
 * The catalog is the data behind the "All"-scope grid (the collect-them-all
 * map). Phase C / v1 is admin-only.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { ATHLETEDATA_PUBLIC_TIER } from "../_shared/feature-flags.ts";

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

    // Admin-only today. When ATHLETEDATA_PUBLIC_TIER flips, this becomes
    // any authenticated user (catalog is public reference data).
    if (!ATHLETEDATA_PUBLIC_TIER) {
      const { data: profile } = await supa
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role !== "admin") return json({ error: "FORBIDDEN" }, 403);
    }

    const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
    const serviceKey = Deno.env.get("COMPETITION_SERVICE_KEY");
    if (!baseUrl || !serviceKey) {
      console.error("[competition-catalog] missing COMPETITION_SERVICE_* env");
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    }

    const url = `${baseUrl.replace(/\/$/, "")}/workouts`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
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
