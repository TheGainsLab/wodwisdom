/**
 * engine-months-drip.ts — the grant-based Engine months-unlock cadence.
 *
 * Decision 9(i): a gym seat grants the retail `engine` feature, but the retail month
 * drip is hard-keyed to Stripe (reconcile-engine-months returns no_stripe_customer),
 * so a gym-granted member would sit at engine_months_unlocked=0 (all days locked). This
 * mirrors the retail 1-month/30-days cadence off the GRANT timestamp instead of Stripe
 * invoices, so a $6 gym member drips exactly like a $6 retail member (never binges the
 * full catalog). Pure so it's unit-tested without a DB.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30;
/** Same cap the retail drip uses (stripe-webhook / reconcile-engine-months). */
export const MONTHS_CAP = 36;

/**
 * Months a gym-granted member should have unlocked given their ORIGINAL grant timestamp.
 * 1 month at activation, +1 per full 30 days elapsed, capped at MONTHS_CAP. The gap while
 * a seat is deactivated (expired grant) still elapses — a returning member comes back a
 * bit ahead, which is the accepted (generous-to-returners) failure direction for content
 * metering. Combined with only-raise at the write site, this is idempotent + monotonic.
 */
export function computeUnlockedMonths(grantedAtIso: string, nowIso: string, cap: number = MONTHS_CAP): number {
  const granted = Date.parse(grantedAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(granted) || !Number.isFinite(now)) return 1;
  const days = Math.floor((now - granted) / DAY_MS);
  const months = Math.floor(Math.max(0, days) / MONTH_DAYS) + 1;
  return Math.min(cap, Math.max(1, months));
}

export interface MonthsRaiseResult { target: number; created: boolean; raised: boolean; error?: string }

/**
 * The ONE only-raise write, shared by the grant path (seed month 1 at activation, closing
 * the fresh-seat-locked-until-cron gap) and the cron (ongoing drip). Given a member + their
 * ORIGINAL grant timestamp, raise engine_months_unlocked to the grant-based target:
 *   1. insert-if-missing (ON CONFLICT DO NOTHING — never overwrites/lowers an existing row);
 *   2. only-raise update guarded by `.lt` (so a concurrent run / double-fire can't lower it).
 * Best-effort: never throws — returns the outcome (+ error string) for the caller to log; a
 * seed failure must not fail the grant (the cron heals it).
 */
export async function raiseEngineMonthsFromGrant(
  supa: SupabaseClient,
  userId: string,
  grantedAtIso: string,
  nowIso: string,
): Promise<MonthsRaiseResult> {
  const target = computeUnlockedMonths(grantedAtIso, nowIso);
  try {
    // 1. Create the athlete_profiles row iff absent, seeded at target — DO NOTHING on
    //    conflict so an existing (possibly higher) value is never clobbered.
    const ins = await supa
      .from("athlete_profiles")
      .upsert(
        { user_id: userId, engine_months_unlocked: target, engine_months_unlocked_last_at: nowIso },
        { onConflict: "user_id", ignoreDuplicates: true },
      )
      .select("user_id");
    if (ins.error) return { target, created: false, raised: false, error: ins.error.message };
    const created = (ins.data?.length ?? 0) > 0;

    // 2. Only-raise an existing row (no-op if already at/above target).
    const upd = await supa
      .from("athlete_profiles")
      .update({ engine_months_unlocked: target, engine_months_unlocked_last_at: nowIso })
      .eq("user_id", userId)
      .lt("engine_months_unlocked", target)
      .select("user_id");
    if (upd.error) return { target, created, raised: false, error: upd.error.message };
    return { target, created, raised: (upd.data?.length ?? 0) > 0 };
  } catch (e) {
    return { target, created: false, raised: false, error: (e as Error).message };
  }
}
