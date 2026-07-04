import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Gym-channel entitlement features (ONE definition — grant-issuing + access-gating
//    must not drift). Engine Class seat -> engine_cohort (2a); Programmer roster ->
//    gym_programming (2b). ──────────────────────────────────────────────────────────

/** Features a wholesale grant may issue (BILLING_MECHANICS §7). */
export const ALLOWED_GRANT_FEATURES = ["engine_cohort", "gym_programming"] as const;

/**
 * Features that grant access to a gym's ENGINE CLASS surfaces (F4/F5). v1 = the Engine
 * Class seat ONLY. `gym_programming` does NOT put a member on the Engine Class cohort
 * roster/scaling, so it must not grant them the Engine Class view/log/leaderboard —
 * widen deliberately when 2b defines what a Programmer member sees on the Engine surface.
 */
export const ENGINE_CLASS_ACCESS_FEATURES = ["engine_cohort"] as const;

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
