/**
 * engine-class/gate.ts — the F5/F4 access gate (GYM_PORTAL_FLOWS §F5, decided in the
 * #550 review; free tier per Decision 8). A member sees a gym's Engine Class surfaces
 * ONLY when they have a `member_gym_links` row with status='joined' AND an ACTIVE
 * gym-granted entitlement `granted_by` that gym — NEVER the link alone (ex-members /
 * cancelled gyms would otherwise see the daily programming forever, since the
 * link-ending writer is a cross-repo follow-up).
 *
 * Two tiers (Decision 8): VIEW access (F5 read-only workout) = the paid seat
 * `engine_cohort` OR the free `engine_class_view` grant issued at join; SEAT access
 * (log / leaderboard) = `engine_cohort` only. resolveMemberGym returns the member's
 * held features so each surface applies the right tier.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ENGINE_CLASS_VIEW_FEATURES, ENGINE_CLASS_SEAT_FEATURES } from "../entitlements.ts";

export { ENGINE_CLASS_SEAT_FEATURES };

// The full set to READ (view tier is the widest — seat is a subset).
const ALL_ENGINE_CLASS_FEATURES = [...new Set<string>([...ENGINE_CLASS_VIEW_FEATURES, ...ENGINE_CLASS_SEAT_FEATURES])];

export interface MemberGym {
  gym_id: string;
  gym_name: string | null;
  class_name: string | null;
}

export interface MemberGymAccess {
  gym: MemberGym;
  /** The engine-class-family features this member holds for THIS gym (active). */
  features: Set<string>;
}

/**
 * Resolve the gym whose Engine Class this member may access (joined link + any active
 * engine-class-family entitlement granted_by that gym) and WHICH features they hold.
 * Returns null when the member is gated out entirely. `supa` must be a service-role
 * client. v1: the first qualifying gym (a member in multiple gym classes is an edge
 * case; the PWA can add a picker later).
 */
export async function resolveMemberGymAccess(
  supa: SupabaseClient,
  userId: string,
  nowIso: string,
): Promise<MemberGymAccess | null> {
  const { data: links, error: linkErr } = await supa
    .from("member_gym_links")
    .select("gym_id, gym_name, class_name")
    .eq("user_id", userId)
    .eq("status", "joined")
    .order("joined_at", { ascending: true }); // deterministic pick for a multi-gym member
  if (linkErr) throw new Error(`member_gym_links read failed: ${linkErr.message}`);
  const joined = (links ?? []) as MemberGym[];
  if (joined.length === 0) return null;

  const gymIds = joined.map((l) => l.gym_id);
  const { data: ents, error: entErr } = await supa
    .from("user_entitlements")
    .select("granted_by, feature")
    .eq("user_id", userId)
    .in("feature", ALL_ENGINE_CLASS_FEATURES)
    .in("granted_by", gymIds)
    .or("expires_at.is.null,expires_at.gt." + nowIso);
  if (entErr) throw new Error(`user_entitlements read failed: ${entErr.message}`);

  // gym_id → the features held there.
  const byGym = new Map<string, Set<string>>();
  for (const e of ents ?? []) {
    const row = e as { granted_by: string; feature: string };
    if (!byGym.has(row.granted_by)) byGym.set(row.granted_by, new Set());
    byGym.get(row.granted_by)!.add(row.feature);
  }

  const gym = joined.find((l) => byGym.has(l.gym_id));
  if (!gym) return null;
  return { gym, features: byGym.get(gym.gym_id)! };
}

/** True if the held feature set includes an active paid SEAT (log / leaderboard). */
export function hasSeat(features: Set<string>): boolean {
  return ENGINE_CLASS_SEAT_FEATURES.some((f) => features.has(f));
}

/**
 * Back-compat convenience: resolve the gym for a member who has SEAT access (the
 * original strict gate — log/leaderboard use this). Returns null if no seat.
 */
export async function resolveSeatGym(supa: SupabaseClient, userId: string, nowIso: string): Promise<MemberGym | null> {
  const access = await resolveMemberGymAccess(supa, userId, nowIso);
  return access && hasSeat(access.features) ? access.gym : null;
}
