/**
 * verify-competition-athlete — admin-only Tier 4 linkage helper.
 *
 * Frontend posts a competition_athlete_id; this function fetches the bundle
 * via fetchTier4Bundle and returns the full bundle so the linking UI can
 * (a) render an "Is this you?" identity card from the verify response, and
 * (b) reuse the same bundle to render the rich Linked-state view without a
 * second round-trip after the user confirms.
 *
 * Phase B v1 is admin-only. The same endpoint will be reused (or split)
 * when this opens to non-admins; for now, restricting at the function
 * boundary keeps the surface area zero for everyone else.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchTier4Bundle } from "../_shared/fetch-tier4-bundle.ts";
import { ATHLETEDATA_PUBLIC_TIER } from "../_shared/feature-flags.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supa
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const isAdmin = (profile as { role: string | null } | null)?.role === "admin";

    const body = await req.json().catch(() => ({}));
    const competitionAthleteId = typeof body?.competition_athlete_id === "string"
      ? body.competition_athlete_id.trim()
      : "";
    if (!competitionAthleteId) {
      return new Response(
        JSON.stringify({ error: "MISSING_ID" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Access gate. Two modes:
    //   - Flag off (today): admin-only. Defense-in-depth alongside frontend.
    //   - Flag on (GA shape): admins fetch any athlete; everyone else can
    //     only fetch their linked athlete, with a pre-link verify carve-out
    //     so unlinked users can preview a candidate during the linking flow.
    if (!ATHLETEDATA_PUBLIC_TIER) {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "FORBIDDEN" }), {
          status: 403,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    } else if (!isAdmin) {
      const { data: athleteProfile } = await supa
        .from("athlete_profiles")
        .select("competition_athlete_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const linkedId = (athleteProfile as { competition_athlete_id: string | null } | null)?.competition_athlete_id ?? null;
      const allowed = linkedId === null || linkedId === competitionAthleteId;
      if (!allowed) {
        return new Response(
          JSON.stringify({ error: "FORBIDDEN" }),
          { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
    }

    // Optional ?include= passthrough — e.g. body.include = ["all_results"] for
    // the rich Linked-state render; omitted for the lightweight verify step.
    const include = Array.isArray(body?.include)
      ? body.include.filter((s: unknown): s is string => typeof s === "string" && s.length > 0)
      : undefined;
    const since = typeof body?.since === "number" && Number.isFinite(body.since)
      ? body.since
      : undefined;

    const bundle = await fetchTier4Bundle(competitionAthleteId, { include, since });
    if (!bundle) {
      // fetchTier4Bundle is failure-soft and collapses 404 / network /
      // malformed-response into null. v1 surfaces a single NOT_FOUND code
      // — refine later if the frontend needs to distinguish the cases.
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ bundle }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[verify-competition-athlete] unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "INTERNAL" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
