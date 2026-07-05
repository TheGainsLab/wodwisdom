/**
 * gym-engine-months-cron — the grant-based Engine months drip (Decision 9(i)).
 *
 * Engine Class is pure distribution of the retail Engine: a gym seat grants the retail
 * `engine` feature — and per Decision 10 the affiliate now grants the distinct
 * `gym_engine` seat instead; BOTH drip (shared ENGINE_DRIP_FEATURES list, one cadence).
 * But the retail month drip is hard-keyed to Stripe, so a gym-granted
 * member (no stripe_customer_id) would sit at engine_months_unlocked=0 with every day
 * locked. This cron drips their months off the GRANT timestamp instead — 1 month at
 * activation, +1 per 30 days, only-raise, cap 36 — mirroring the retail $6/month cadence.
 *
 * Keys on the grant row's ORIGINAL granted_at (the wholesale-grants upsert preserves it
 * across re-grant — see grant-row.ts), and drips ONLY currently-active grants
 * (expires_at IS NULL OR > now) so a deactivated (expired-not-deleted) seat pauses. Skips
 * members who ALSO hold a retail_stripe `engine` row — Stripe drives those (no double
 * source). Uses the SAME only-raise write as the grant path (raiseEngineMonthsFromGrant),
 * so a double-fire is harmless. Scheduled HOURLY: month 1 is already seeded at grant time
 * (wholesale-grants), so this only advances the ongoing drip — hourly keeps every edge tight.
 *
 * AUTH: verify_jwt=false (pg_cron can't mint a JWT); fail-closed X-Cron-Key
 * (GYM_ENGINE_MONTHS_CRON_KEY), same discipline as gym-cohort-cron.
 * RETAIL-UNTOUCHED: this NEW function writes only gym-granted members' rows; the three
 * Stripe drip paths are byte-identical.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { raiseEngineMonthsFromGrant } from "../_shared/engine-months-drip.ts";
import { ENGINE_DRIP_FEATURES } from "../_shared/entitlements.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("GYM_ENGINE_MONTHS_CRON_KEY");
// The retail Stripe skip-guard: Stripe only ever drives the retail `engine` feature
// (retail never holds `gym_engine`), so the skip check stays on the literal.
const RETAIL_ENGINE_FEATURE = "engine";

Deno.serve(async (req) => {
  if (!CRON_KEY) return json({ error: "config_missing", detail: "GYM_ENGINE_MONTHS_CRON_KEY not set" }, 500);
  if (req.headers.get("x-cron-key") !== CRON_KEY) return json({ error: "forbidden" }, 401);

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const nowIso = new Date().toISOString();

  try {
    // 1. Active gym-grant Engine rows — `engine` (legacy 9(i)) OR `gym_engine`
    //    (Decision 10), the shared ENGINE_DRIP_FEATURES list (expires_at null or future).
    const { data: grants, error: grantErr } = await supa
      .from("user_entitlements")
      .select("user_id, granted_at")
      .in("feature", [...ENGINE_DRIP_FEATURES])
      .eq("source_kind", "gym_grant")
      .or("expires_at.is.null,expires_at.gt." + nowIso);
    if (grantErr) return json({ error: "grants_read_failed", detail: grantErr.message }, 500);
    const rows = (grants ?? []) as { user_id: string; granted_at: string }[];
    if (rows.length === 0) return json({ message: "no active gym engine grants", updated: 0 });

    // Earliest grant per user (a member in two gyms drips from their FIRST activation).
    const earliest = new Map<string, string>();
    for (const r of rows) {
      const cur = earliest.get(r.user_id);
      if (!cur || Date.parse(r.granted_at) < Date.parse(cur)) earliest.set(r.user_id, r.granted_at);
    }
    const userIds = [...earliest.keys()];

    // 2. Skip members who ALSO hold a retail_stripe `engine` row — Stripe drives them.
    const { data: retail, error: retailErr } = await supa
      .from("user_entitlements")
      .select("user_id")
      .eq("feature", RETAIL_ENGINE_FEATURE)
      .eq("source_kind", "retail_stripe")
      .in("user_id", userIds)
      .or("expires_at.is.null,expires_at.gt." + nowIso);
    if (retailErr) return json({ error: "retail_read_failed", detail: retailErr.message }, 500);
    const stripeDriven = new Set((retail ?? []).map((r) => (r as { user_id: string }).user_id));

    // 3. Only-raise each candidate to their grant-based target via the SHARED write the
    //    grant path also uses (insert-if-missing + `.lt`-guarded raise). One implementation.
    const candidates = userIds.filter((u) => !stripeDriven.has(u));
    if (candidates.length === 0) return json({ message: "all candidates stripe-driven", updated: 0 });
    let updated = 0;
    let created = 0;
    const failures: string[] = [];
    for (const userId of candidates) {
      const res = await raiseEngineMonthsFromGrant(supa, userId, earliest.get(userId)!, nowIso);
      if (res.error) failures.push(userId);
      else { if (res.created) created++; if (res.raised) updated++; }
    }

    if (failures.length > 0) console.error("[gym-engine-months-cron] write failures:", failures);
    return json({
      active_grants: rows.length, candidates: candidates.length,
      stripe_driven: stripeDriven.size, updated, created, failures: failures.length,
    });
  } catch (e) {
    console.error("[gym-engine-months-cron]", e);
    return json({ error: "drip_failed", detail: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
