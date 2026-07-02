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
import { getCompetitionCatalog } from "../_shared/competition-catalog-cache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json", ...extra },
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

    // Cached, deduped fetch of the near-static catalog. The catalog is the
    // same for every user, so this collapses per-click traffic on the shared
    // COMPETITION_SERVICE_KEY into ~1 upstream fetch per TTL window, serves a
    // stale copy through upstream blips, and negative-caches failures (see
    // _shared/competition-catalog-cache.ts).
    const result = await getCompetitionCatalog();
    if (result.payload !== null) {
      // Cacheable per-user (auth-gated, near-static). Shorter max-age when the
      // payload is stale so a client refreshes sooner once upstream recovers.
      return json(result.payload, 200, {
        "Cache-Control": result.stale ? "private, max-age=60" : "private, max-age=3600",
        "X-Cache": result.stale ? "stale" : "hit",
      });
    }
    // Hard miss (failure, no stale copy). Pass the upstream status through so a
    // 429 (rate-limited) is distinguishable from an outage and clients back off.
    if (result.status === 429) {
      return json({ error: "RATE_LIMITED" }, 429, { "Retry-After": "5" });
    }
    return json({ error: "SERVICE_UNAVAILABLE" }, result.status ?? 503);
  } catch (err) {
    console.error("[competition-catalog] unexpected error:", err);
    return json({ error: "INTERNAL" }, 500);
  }
});
