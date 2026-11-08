/**
 * engine-entitlement.ts — the ONE place that turns a Stripe subscription +
 * its paid invoices into "how many Engine months is this athlete entitled
 * to". Used by stripe-webhook (on every paid invoice), reconcile-engine-months
 * (nightly sweep) and monthly-generation-cron (quarterly drip), so the three
 * can never disagree about what a paid invoice is worth.
 *
 * Why count instead of add (2026-11-08 incident): the webhook used to add one
 * month per invoice and special-case the first invoice by its billing_reason.
 * Stripe labels the first invoice of a Checkout-created subscription
 * `subscription_update`, not `subscription_create`, so the special case never
 * matched and every new subscriber whose checkout event landed before their
 * invoice event got two months for one payment (11 of 16 since Oct 9). A
 * count derived from Stripe's own invoice list is independent of event order,
 * retries and labels: the write is always "raise to entitled, never above".
 *
 * Pure functions, no I/O — unit-tested without a DB or Stripe.
 */

export const ENGINE_MONTHS_CAP = 36;
const MS_PER_DAY = 86_400_000;

export interface InvoiceLike {
  billing_reason?: string | null;
  amount_paid?: number | null;
}

/**
 * Does this paid invoice buy a NEW period? create (first), cycle (renewal),
 * and an update ONLY when it charged real money (founder policy 2026-10-05:
 * a €0 plan flip paid by proration credit is the same month, not a new one).
 * The first invoice of a Checkout subscription arrives as `subscription_update`
 * with amount_paid > 0, so it counts — as it should.
 */
export function billsNewPeriod(inv: InvoiceLike): boolean {
  const r = inv.billing_reason;
  return r === "subscription_create" ||
    r === "subscription_cycle" ||
    (r === "subscription_update" && (inv.amount_paid ?? 0) > 0);
}

/** Number of paid periods across a subscription's paid invoices. */
export function countPaidPeriods(invoices: InvoiceLike[]): number {
  return invoices.filter(billsNewPeriod).length;
}

export type Cadence = "monthly" | "quarterly";

export interface SubscriptionLike {
  items?: { data?: Array<{ price?: { recurring?: { interval?: string; interval_count?: number } | null } | null }> } | null;
  current_period_start?: number | null;
}

/** Monthly, quarterly, or null for anything else (annual, weekly, unknown). */
export function subscriptionCadence(sub: SubscriptionLike): Cadence | null {
  const rec = sub.items?.data?.[0]?.price?.recurring ?? null;
  const interval = rec?.interval;
  const count = rec?.interval_count ?? 1;
  if (interval === "month" && count === 1) return "monthly";
  if ((interval === "month" && count === 3) || (interval === "quarter" && count === 1)) return "quarterly";
  return null;
}

export interface Entitlement {
  /** Months the athlete has paid for as of `nowMs`, capped. */
  entitled: number;
  /** 1..3 for quarterly (the in-quarter drip); always 1 for monthly. */
  monthsIntoCurrentQuarter: number;
}

/**
 * Entitled months by cadence:
 *   monthly:   one month per paid period.
 *   quarterly: 3 per completed period, plus 1/2/3 dripped through the current
 *              one by days since current_period_start (30-day months).
 * Returns null when it cannot be computed (no paid periods, or quarterly with
 * no period start) — callers must then NOT write anything.
 */
export function entitledEngineMonths(
  cadence: Cadence,
  paidPeriods: number,
  periodStartSec: number | null | undefined,
  nowMs: number = Date.now(),
): Entitlement | null {
  if (paidPeriods <= 0) return null;
  if (cadence === "monthly") {
    return { entitled: Math.min(paidPeriods, ENGINE_MONTHS_CAP), monthsIntoCurrentQuarter: 1 };
  }
  if (typeof periodStartSec !== "number" || !Number.isFinite(periodStartSec)) return null;
  const daysIntoPeriod = Math.max(0, (nowMs - periodStartSec * 1000) / MS_PER_DAY);
  const monthsIntoCurrentQuarter = Math.min(Math.floor(daysIntoPeriod / 30) + 1, 3);
  const entitled = Math.min((paidPeriods - 1) * 3 + monthsIntoCurrentQuarter, ENGINE_MONTHS_CAP);
  return { entitled, monthsIntoCurrentQuarter };
}

/**
 * When the most recent unlock "should" have happened, so the quarterly drip's
 * next step lands on schedule. Monthly: now (the next unlock is the next
 * invoice). Quarterly: periodStart + (m - 1) * 30 days.
 */
export function lastUnlockIso(cadence: Cadence, periodStartSec: number | null | undefined, monthsIntoCurrentQuarter: number, nowMs: number = Date.now()): string {
  if (cadence === "quarterly" && typeof periodStartSec === "number") {
    return new Date(periodStartSec * 1000 + (monthsIntoCurrentQuarter - 1) * 30 * MS_PER_DAY).toISOString();
  }
  return new Date(nowMs).toISOString();
}
