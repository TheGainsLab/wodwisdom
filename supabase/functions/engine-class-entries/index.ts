/**
 * engine-class-entries — F4_MODERATION_CONTRACT seam 1: the endpoint the affiliate
 * moderation page reads to LIST a gym's logged Engine Class entries (so a coach can
 * flag/hide/adjust them). wodwisdom owns the score of record; the affiliate stores
 * only decisions keyed on the `result_ref` (= engine_class_results.id) returned here.
 *
 * Auth: server-to-server X-Service-Key (WODWISDOM_LEADERBOARD_KEY), constant-time via
 * the shared consumer-auth. verify_jwt=false. Input { gym_id, class_id? } — wodwisdom
 * keys on gym_id (its cohort program's tenant_id); class_id is echoed through (the
 * affiliate's ledger key; one Engine Class per gym at v1).
 *
 * Returns entries for the gym's CURRENT cohort program with the display context the
 * coach view needs (real member names — the gym's staff own leaderboard integrity, so
 * moderation is NOT anonymized, unlike the public board).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createConsumerAuth } from "../_shared/consumer-auth.ts";
import { loadLatestProgram, loadEntries, loadProfiles } from "../_shared/engine-class/queries.ts";
import { normalizeGender, toKg } from "../_shared/metcon-workcalc.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = createClient(SUPABASE_URL, SUPABASE_KEY);

// Single shared s2s key (no tenant map) — constant-time compare + fingerprint logging.
const auth = createConsumerAuth({
  serviceKey: Deno.env.get("WODWISDOM_LEADERBOARD_KEY"),
  consumerKeysRaw: undefined,
  label: "engine-class-entries",
});

function genderLabel(g: string | null): string {
  const n = normalizeGender(g);
  return n === "men" ? "M" : n === "women" ? "W" : "Open";
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!auth.configured()) return json({ error: "config_missing", detail: "WODWISDOM_LEADERBOARD_KEY not set" }, 500);
  const presented = req.headers.get("x-service-key");
  if (!presented) return json({ error: "forbidden" }, 401);
  const authed = await auth.authorize(presented);
  if (!authed) return json({ error: "forbidden" }, 401);

  let body: { gym_id?: unknown; class_id?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const gymId = typeof body.gym_id === "string" ? body.gym_id.trim() : "";
  if (!gymId) return json({ error: "invalid_request", detail: "gym_id required" }, 400);
  const classId = typeof body.class_id === "string" ? body.class_id : null;

  try {
    const program = await loadLatestProgram(svc, gymId);
    if (!program) return json({ gym_id: gymId, class_id: classId, cohort_program_id: null, entries: [] });

    const entries = await loadEntries(svc, gymId, program.id);
    const profiles = await loadProfiles(svc, entries.map((e) => e.user_id));

    const out = entries.map((e) => {
      const p = profiles.get(e.user_id);
      const massKg = p ? toKg(p.bodyweight, p.units) : null;
      const wkg = e.avg_power_watts != null && massKg != null && massKg > 0 ? e.avg_power_watts / massKg : null;
      const g = p ? genderLabel(p.gender) : "Open";
      return {
        result_ref: e.result_ref,               // REQ — the moderation key
        wodwisdom_user_id: e.user_id,            // REQ — whose score
        member_name: p?.full_name ?? null,       // coach context (not anonymized)
        workout_label: `Week ${e.week_num} · Day ${e.day_num}`,
        workout_date: null,                      // (date lives on the row; omitted from this projection)
        raw_score: e.score_display,
        wkg_score: wkg != null ? Math.round(wkg * 100) / 100 : null,
        division: e.modality ? `${g} · ${e.modality}` : g,
      };
    });

    return json({ gym_id: gymId, class_id: classId, cohort_program_id: program.id, entries: out });
  } catch (e) {
    console.error("[engine-class-entries]", gymId, e);
    return json({ error: "entries_failed", detail: (e as Error).message }, 500);
  }
});
