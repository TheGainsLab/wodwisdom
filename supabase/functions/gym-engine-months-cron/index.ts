/**
 * gym-engine-months-cron — the grant-based Engine months drip (Decision 9(i)).
 *
 * Engine Class is pure distribution of the retail Engine: a gym seat grants the retail
 * `engine` feature. But the retail month drip is hard-keyed to Stripe, so a gym-granted
 * member (no stripe_customer_id) would sit at engine_months_unlocked=0 with every day
 * locked. This cron drips their months off the GRANT timestamp instead — 1 month at
 * activation, +1 per 30 days, only-raise, cap 36 — mirroring the retail $6/month cadence.
 *
 * Keys on the grant row's ORIGINAL granted_at (the wholesale-grants upsert preserves it
 * across re-grant — see grant-row.ts), and drips ONLY currently-active grants
 * (expires_at IS NULL OR > now) so a deactivated (expired-not-deleted) seat pauses. Skips
 * members who ALSO hold a retail_stripe `engine` row — Stripe drives those (no double
 * source). Every write is only-raise, so a double-fire is harmless.
 *
 * AUTH: verify_jwt=false (pg_cron can't mint a JWT); fail-closed X-Cron-Key
 * (GYM_ENGINE_MONTHS_CRON_KEY), same discipline as gym-cohort-cron.
 * RETAIL-UNTOUCHED: this NEW function writes only gym-granted members' rows; the three
 * Stripe drip paths are byte-identical.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeUnlockedMonths } from "../_shared/engine-months-drip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("GYM_ENGINE_MONTHS_CRON_KEY");
const ENGINE_FEATURE = "engine";

Deno.serve(async (req) => {
  if (!CRON_KEY) return json({ error: "config_missing", detail: "GYM_ENGINE_MONTHS_CRON_KEY not set" }, 500);
  if (req.headers.get("x-cron-key") !== CRON_KEY) return json({ error: "forbidden" }, 401);

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const nowIso = new Date().toISOString();

  try {
    // 1. Active gym-grant `engine` rows (expires_at null or in the future).
    const { data: grants, error: grantErr } = await supa
      .from("user_entitlements")
      .select("user_id, granted_at")
      .eq("feature", ENGINE_FEATURE)
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
      .eq("feature", ENGINE_FEATURE)
      .eq("source_kind", "retail_stripe")
      .in("user_id", userIds)
      .or("expires_at.is.null,expires_at.gt." + nowIso);
    if (retailErr) return json({ error: "retail_read_failed", detail: retailErr.message }, 500);
    const stripeDriven = new Set((retail ?? []).map((r) => (r as { user_id: string }).user_id));

    // 3. Current unlocked months per candidate (engine-join creates the row; guard for a
    //    missing one anyway).
    const candidates = userIds.filter((u) => !stripeDriven.has(u));
    if (candidates.length === 0) return json({ message: "all candidates stripe-driven", updated: 0 });
    const { data: profs, error: profErr } = await supa
      .from("athlete_profiles")
      .select("user_id, engine_months_unlocked")
      .in("user_id", candidates);
    if (profErr) return json({ error: "profiles_read_failed", detail: profErr.message }, 500);
    const currentByUser = new Map(
      (profs ?? []).map((p) => [(p as { user_id: string }).user_id, (p as { engine_months_unlocked: number | null }).engine_months_unlocked ?? 0]),
    );

    // 4. Only-raise each member to their grant-based target.
    let updated = 0;
    let created = 0;
    const failures: string[] = [];
    for (const userId of candidates) {
      const target = computeUnlockedMonths(earliest.get(userId)!, nowIso);
      if (!currentByUser.has(userId)) {
        // No athlete_profiles row yet — create it with the target (rare).
        const { error } = await supa.from("athlete_profiles").insert({
          user_id: userId, engine_months_unlocked: target, engine_months_unlocked_last_at: nowIso,
        });
        if (error) failures.push(userId); else created++;
        continue;
      }
      if (target <= (currentByUser.get(userId) ?? 0)) continue; // already at/above — only-raise
      // Only-raise at the DB too (`lt` filter) so a concurrent run can't lower it.
      const { data, error } = await supa
        .from("athlete_profiles")
        .update({ engine_months_unlocked: target, engine_months_unlocked_last_at: nowIso })
        .eq("user_id", userId)
        .lt("engine_months_unlocked", target)
        .select("user_id");
      if (error) failures.push(userId);
      else if (data && data.length > 0) updated++;
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
