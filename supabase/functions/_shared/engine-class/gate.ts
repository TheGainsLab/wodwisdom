/**
 * engine-class/gate.ts — the F5/F4 access gate (GYM_PORTAL_FLOWS §F5, decided in the
 * #550 review). A member sees a gym's Engine Class surfaces ONLY when they have a
 * `member_gym_links` row with status='joined' AND an ACTIVE engine_cohort-family
 * entitlement `granted_by` that gym — NEVER the link alone (ex-members / cancelled
 * gyms would otherwise see the daily programming forever, since the link-ending writer
 * is a cross-repo follow-up). The active entitlement is the authoritative "still
 * belongs" signal; the link supplies the gym name/context.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// The engine_cohort-family features that count as "belongs to an active gym class"
// (wholesale-grants ALLOWED_GRANT_FEATURES).
const ENTITLEMENT_FAMILY = ["engine_cohort", "gym_programming"];

export interface MemberGym {
  gym_id: string;
  gym_name: string | null;
  class_name: string | null;
}

/**
 * Resolve the gym whose Engine Class this member may access (joined link + active
 * family entitlement granted_by that gym). Returns null when the member is gated out.
 * `supa` must be a service-role client (reads member_gym_links + user_entitlements
 * across RLS). v1: returns the first qualifying gym (a member in multiple gym classes
 * is an edge case; the PWA can add a picker later).
 */
export async function resolveMemberGym(supa: SupabaseClient, userId: string, nowIso: string): Promise<MemberGym | null> {
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
    .select("granted_by")
    .eq("user_id", userId)
    .in("feature", ENTITLEMENT_FAMILY)
    .in("granted_by", gymIds)
    .or("expires_at.is.null,expires_at.gt." + nowIso);
  if (entErr) throw new Error(`user_entitlements read failed: ${entErr.message}`);
  const entitledGyms = new Set((ents ?? []).map((e) => (e as { granted_by: string }).granted_by));

  return joined.find((l) => entitledGyms.has(l.gym_id)) ?? null;
}
