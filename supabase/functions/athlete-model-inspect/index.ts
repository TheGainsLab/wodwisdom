/**
 * athlete-model-inspect/index.ts
 *
 * Read-only inspector for the deterministic Athlete Model (coaching-state
 * Step 1). THE first place to look when Strategy / a workout / a bug report
 * looks strange — it answers "what does the coach currently believe about
 * this athlete, and what would it believe if recomputed right now?"
 *
 * Returns BOTH:
 *   - persisted: the stored immutable versions (latest + recent history) —
 *     the exact facts programs were built on.
 *   - live: buildAthleteModel() recomputed from the CURRENT profile, WITHOUT
 *     persisting (this endpoint never writes). Diffing live vs the latest
 *     persisted version surfaces drift (profile changed since last gen).
 *
 * Access: admins may inspect any user (body.user_id); a non-admin may inspect
 * only themselves. No LLM, no mutation.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  type AthleteModelCompetitionInput,
  buildAthleteModel,
  MODEL_BUILDER_VERSION,
  profileStaticFromRow,
  type RawProfileRow,
  THRESHOLDS_VERSION,
} from "../_shared/athlete-model.ts";
import { fetchTier4Bundle } from "../_shared/fetch-tier4-bundle.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PROFILE_COLS =
  "age, height, bodyweight, gender, units, lifts, skills, conditioning, equipment, " +
  "competition_athlete_id, updated_at";

const MAX_VERSIONS = 25;

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401, cors);

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401, cors);

    const { data: caller } = await supa
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const isAdmin = caller?.role === "admin";

    let body: { user_id?: string } = {};
    if (req.method === "POST") {
      body = await req.json().catch(() => ({}));
    }
    const targetUserId = body.user_id ?? user.id;
    if (targetUserId !== user.id && !isAdmin) {
      return json({ error: "Forbidden", message: "Admins only for other users." }, 403, cors);
    }

    // --- Current profile → live recompute (NO persist) ---
    const { data: profile, error: profileErr } = await supa
      .from("athlete_profiles")
      .select(PROFILE_COLS)
      .eq("user_id", targetUserId)
      .maybeSingle<RawProfileRow & { competition_athlete_id: string | null; updated_at: string | null }>();

    if (profileErr) return json({ error: profileErr.message }, 500, cors);

    let live: unknown = null;
    let liveProfileStatic: unknown = null;
    let competitionLinked = false;
    if (profile) {
      const profileStatic = profileStaticFromRow(profile);
      liveProfileStatic = profileStatic;

      let competition: AthleteModelCompetitionInput | null = null;
      if (profile.competition_athlete_id) {
        competitionLinked = true;
        // Only the fields the model reads — keep the fetch light.
        const bundle = await fetchTier4Bundle(profile.competition_athlete_id, {
          include: ["power_profile"],
        });
        if (bundle) competition = bundle as AthleteModelCompetitionInput;
      }

      live = buildAthleteModel(profileStatic, competition, { asOf: profile.updated_at ?? null });
    }

    // --- Persisted versions (latest + recent history) ---
    const { data: rows, error: rowsErr } = await supa
      .from("athlete_models")
      .select(
        "version, profile_version, model_hash, profile_hash, model, thresholds_version, model_builder_version, created_at",
      )
      .eq("user_id", targetUserId)
      .order("version", { ascending: false })
      .limit(MAX_VERSIONS);

    if (rowsErr) return json({ error: rowsErr.message }, 500, cors);

    const versions = rows ?? [];
    const latest = versions[0] ?? null;

    // --- Latest CoachState (Step 2 — the judgment layer) ---
    // Read-only: the inspector shows what the coach currently believes beside
    // the facts, so a strange priority traces straight to its evidence keys.
    const { data: coachRows } = await supa
      .from("coach_states")
      .select("version, athlete_model_version, coach_state_builder_version, coach_state, created_at")
      .eq("user_id", targetUserId)
      .order("version", { ascending: false })
      .limit(1);
    const latestCoachState = coachRows?.[0] ?? null;

    return json({
      user_id: targetUserId,
      builder: { thresholds_version: THRESHOLDS_VERSION, model_builder_version: MODEL_BUILDER_VERSION },
      profile_exists: !!profile,
      competition_linked: competitionLinked,
      live: live ? { model: live, profile_static: liveProfileStatic } : null,
      coach_state: latestCoachState,
      persisted: {
        latest,
        // Lightweight history (no full model blob) for the version picker.
        versions: versions.map((v) => ({
          version: v.version,
          profile_version: v.profile_version,
          model_hash: v.model_hash,
          profile_hash: v.profile_hash,
          thresholds_version: v.thresholds_version,
          model_builder_version: v.model_builder_version,
          created_at: v.created_at,
        })),
        full_models: versions, // includes the model jsonb for client-side version diffing
      },
    }, 200, cors);
  } catch (err) {
    return json(
      { error: "Inspector failed", message: err instanceof Error ? err.message : String(err) },
      500,
      cors,
    );
  }
});
