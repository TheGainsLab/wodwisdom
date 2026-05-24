/**
 * search-competition-athletes — admin-only Phase C proxy.
 *
 * The competition-service exposes GET /athlete-search (X-Service-Key auth).
 * The frontend can't hold that key, so it calls this function instead; we
 * forward the query with the shared service key and pass the response back.
 *
 * Phase C v1 is admin-only (the linking UI it feeds is admin-gated).
 * Mirrors verify-competition-athlete: Bearer auth + admin role check, then
 * a thin proxy with a hard timeout and failure-soft error mapping.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { ATHLETEDATA_PUBLIC_TIER } from "../_shared/feature-flags.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SEARCH_TIMEOUT_MS = 5_000;

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
    // any authenticated user (results are lightweight metadata only).
    if (!ATHLETEDATA_PUBLIC_TIER) {
      const { data: profile } = await supa
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role !== "admin") return json({ error: "FORBIDDEN" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const q = typeof body?.q === "string" ? body.q.trim() : "";
    const division = body?.division === "men" || body?.division === "women" ? body.division : "";
    const country = typeof body?.country === "string" ? body.country.trim() : "";
    const affiliate = typeof body?.affiliate === "string" ? body.affiliate.trim() : "";
    const limitRaw = Number(body?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 25;

    const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
    const serviceKey = Deno.env.get("COMPETITION_SERVICE_KEY");
    if (!baseUrl || !serviceKey) {
      console.error("[search-competition-athletes] missing COMPETITION_SERVICE_* env");
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    }

    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (division) params.set("division", division);
    if (country) params.set("country", country);
    if (affiliate) params.set("affiliate", affiliate);
    params.set("limit", String(limit));
    const url = `${baseUrl.replace(/\/$/, "")}/athlete-search?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
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
      // Pass through the competition-service status (200 with results, or its
      // 400 error sentinels like no_search_criteria / query_too_short).
      return json(payload, resp.status);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return json({ error: "TIMEOUT" }, 504);
      }
      console.error("[search-competition-athletes] fetch error:", (err as Error).message);
      return json({ error: "SERVICE_UNAVAILABLE" }, 503);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error("[search-competition-athletes] unexpected error:", err);
    return json({ error: "INTERNAL" }, 500);
  }
});
