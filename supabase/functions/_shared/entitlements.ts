import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Gym-channel entitlement features (ONE definition — grant-issuing + access-gating
//    must not drift). Per-seat distribution products only (Decision 11 — Engine Class
//    removed; its `engine_cohort` / `engine_class_view` keys went with it). ───────────

/** Features a gym seat grant may issue (BILLING_MECHANICS §7; Decision 11).
 *  - `engine` = the RETAIL Engine standalone product. A gym seat grants the exact retail
 *    `engine` feature, gym-scoped; the union entitlement read lights up all /engine/*
 *    surfaces with retail code untouched. Gym-sourced `engine` grants are excluded from
 *    the paid-subscriber classifiers, so it never inflates retail paid counts.
 *  - `gym_engine` = the gym-shell Engine seat (Decision 10(a)): the FULL Engine program,
 *    NONE of the retail surround. Same Engine gates (union with `engine` via the shared
 *    access helper), but the client shell goes gym-variant when it's the member's only
 *    shell feature. Supersedes `engine` as what a seat grants (the `engine` key stays
 *    allowlisted for the migration window + admin use).
 *  - `gym_programming` = the gym's own generated program (gym program generation product).
 *  - `nutrition` = the RETAIL Nutrition product distributed through the gym channel.
 *    A gym seat grants the exact retail `nutrition` feature, gym-scoped
 *    (granted_by = gym_id); the union entitlement read lights up /nutrition +
 *    /nutrition/calendar with retail code untouched (the nutrition edge fns are
 *    auth-only). Gym-sourced grants are source_kind='gym_grant', so — like gym `engine`
 *    — they never inflate retail paid counts. v1 uses the plain retail `nutrition` key
 *    (retail-branded member experience); a gym-branded `gym_nutrition` shell variant is
 *    a future enhancement, mirroring how `gym_engine` relates to `engine`. Nutrition has
 *    NO months-drip (flat while the seat is active), so it is intentionally absent from
 *    ENGINE_DRIP_FEATURES. */
export const ALLOWED_GRANT_FEATURES = ["engine", "gym_engine", "gym_programming", "nutrition"] as const;

/** Grant features that carry the Engine months drip (Decision 10(d)): the grant-time
 *  Month-1 seed (gym-seat-claim) and the hourly advance (gym-engine-months-cron) apply
 *  to BOTH the legacy `engine` gym grant and the `gym_engine` seat. ONE list — the two
 *  callers must not drift. The retail Stripe drip is separate and keys on `engine` only
 *  (retail never has `gym_engine`). */
export const ENGINE_DRIP_FEATURES = ["engine", "gym_engine"] as const;

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
