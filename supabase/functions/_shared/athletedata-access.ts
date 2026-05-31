/**
 * Access gates for the competition / Athlete Data edge functions.
 *
 * Two gates, each "admin OR an active entitlement":
 *
 *   hasAthleteDataAccess    — the VIEW gate. Catalog browse, athlete search,
 *     linking, bundle fetch. Entitlements: `athletedata` (free tier + beta
 *     cohort) or `programming` (AI Programming / all-access).
 *
 *   hasCompetitionLogAccess — the PAID-ACTION gate. Try-It logging + placement.
 *     Entitlements: `competition_log` or `programming`.
 *
 * The `programming` clause in both is a transition bridge — AI Programming
 * "includes everything", so once `athletedata` / `competition_log` are bundled
 * into the programming/all_access plans (+ backfill) it's redundant-but-harmless.
 *
 * Mirrors the frontend `useEntitlements` check (active = no expiry, or expiry
 * in the future) so server and client agree on who has access.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** admin, or an active `user_entitlements` row for any feature in `features`. */
async function hasAccess(
  supa: SupabaseClient,
  userId: string,
  features: string[],
): Promise<boolean> {
  const { data: profile } = await supa
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.role === "admin") return true;

  const { data: ents } = await supa
    .from("user_entitlements")
    .select("feature")
    .eq("user_id", userId)
    .in("feature", features)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  return Array.isArray(ents) && ents.length > 0;
}

/** View gate — Athlete Data surface (catalog browse, search, link, bundle). */
export function hasAthleteDataAccess(
  supa: SupabaseClient,
  userId: string,
): Promise<boolean> {
  return hasAccess(supa, userId, ["athletedata", "programming"]);
}

/** Paid-action gate — Try-It logging + placement. */
export function hasCompetitionLogAccess(
  supa: SupabaseClient,
  userId: string,
): Promise<boolean> {
  return hasAccess(supa, userId, ["competition_log", "programming"]);
}
