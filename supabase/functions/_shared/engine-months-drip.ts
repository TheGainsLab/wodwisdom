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
