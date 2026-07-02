/**
 * Access policy for the competition / Athlete Data edge functions.
 *
 * Competition History is FREE for all authenticated users (decision D5 in
 * docs/portfolio/STRATEGY.md): `ATHLETEDATA_PUBLIC_TIER = true` on client and
 * server gates the VIEW surface (catalog browse, search, link, bundle) purely
 * on authentication — there is no separate view entitlement.
 *
 * Try-It logging + placement are likewise free. `hasCompetitionLogAccess` is
 * kept as an always-true shim so its two callers (competition-placement,
 * log-throwback) and the redeploy surface stay unchanged, and so the access
 * policy has one obvious home if it ever needs to be re-gated.
 *
 * History: an earlier design gated these on `athletedata` / `competition_log`
 * entitlements via a `hasAthleteDataAccess` view gate. That design was
 * abandoned when the feature went free; the gate and its helper were dead code
 * and have been removed. The `athletedata` / `competition_log` entitlements are
 * intentionally NOT wired into stripe-webhook's PLAN_ENTITLEMENTS.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Try-It logging + placement. Free for all authenticated users (callers
 *  verify auth before this check), so this always grants access. Kept as a
 *  function so callers + the redeploy surface are unchanged. */
export function hasCompetitionLogAccess(
  _supa: SupabaseClient,
  _userId: string,
): Promise<boolean> {
  return Promise.resolve(true);
}
