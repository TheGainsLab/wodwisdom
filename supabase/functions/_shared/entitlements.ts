import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Gym-channel entitlement features (ONE definition — grant-issuing + access-gating
//    must not drift). Engine Class seat -> engine_cohort (2a); Programmer roster ->
//    gym_programming (2b). ──────────────────────────────────────────────────────────

/** Features a wholesale grant may issue (BILLING_MECHANICS §7).
 *  - `engine` = the RETAIL Engine standalone product (Decision 9(i): Engine Class is pure
 *    distribution — a gym seat grants the exact retail `engine` feature, gym-scoped; the
 *    union entitlement read lights up all /engine/* surfaces with retail code untouched).
 *    Gym-sourced `engine` grants are excluded from the paid-subscriber classifiers, so it
 *    never inflates retail paid counts.
 *  - `engine_cohort` = the parked cohort-class seat (kept for the 2b Programmer).
 *  - `engine_class_view` = FREE F5 view tier (Decision 8; F5 deferred in v1 — the affiliate
 *    stops granting it, the key stays allowlisted for a future free surface).
 *  - `gym_programming` = 2b Programmer roster. */
export const ALLOWED_GRANT_FEATURES = ["engine", "engine_cohort", "gym_programming", "engine_class_view"] as const;

/**
 * SEAT access = the paid Engine Class seat (Decision 8): the log / leaderboard / TV
 * surfaces AND the cohort roster (gym-cohort-cron). `engine_cohort` ONLY —
 * `gym_programming` (2b Programmer roster) isn't on the cohort roster, and
 * `engine_class_view` is the free, non-seat tier.
 */
export const ENGINE_CLASS_SEAT_FEATURES = ["engine_cohort"] as const;

/**
 * VIEW access = who may see the F5 read-only workout (Decision 8): the paid seat OR the
 * free `engine_class_view` tier granted at join. This is the free-tier population the
 * decided gate creates — content STILL requires an active gym-granted entitlement, so
 * an ex-member (grants revoked) can't see it.
 */
export const ENGINE_CLASS_VIEW_FEATURES = ["engine_cohort", "engine_class_view"] as const;

/**
 * Check if a user has access to a specific feature.
 * Returns true if the user has an active entitlement OR is an admin.
 */
export async function checkEntitlement(
  supa: SupabaseClient,
  userId: string,
  feature: string
): Promise<boolean> {
  // Check admin role first (admins bypass all entitlement checks)
  const { data: profile } = await supa
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (profile?.role === "admin") return true;

  // Check for active entitlement
  const { data } = await supa
    .from("user_entitlements")
    .select("id")
    .eq("user_id", userId)
    .eq("feature", feature)
    .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
    .limit(1);

  return (data?.length ?? 0) > 0;
}

/**
 * Get all active features for a user.
 * Returns a Set of feature strings. Admins get an empty set
 * (use checkEntitlement for admin-aware checks).
 */
export async function getActiveFeatures(
  supa: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const { data } = await supa
    .from("user_entitlements")
    .select("feature")
    .eq("user_id", userId)
    .or("expires_at.is.null,expires_at.gt." + new Date().toISOString());

  const features = new Set<string>();
  if (data) {
    for (const row of data) {
      features.add(row.feature);
    }
  }
  return features;
}
