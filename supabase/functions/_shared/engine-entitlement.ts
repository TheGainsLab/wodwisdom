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
 *
 * 2026-11-22: the Engine count is now taken over the person's whole history
 * (./paid-periods.ts: entitledEngineMonthsFromPeriods). entitledEngineMonths
 * below remains the per-subscription arithmetic — the quarterly Programming
 * drip in monthly-generation-cron still uses it.
 *
 * Pure functions, no I/O — unit-tested without a DB or Stripe.
 */

export const ENGINE_MONTHS_CAP = 36;
const MS_PER_DAY = 86_400_000;

// "Is this paid invoice a new period?" is no longer answered here. The label
// rule that lived in this file (create, cycle, and any update that charged
// money) counted every paid plan change as a period; it was replaced on
// 2026-11-22 by the one rule in ./paid-periods.ts (classifyPaidInvoices /
// decidePeriod), which every caller now uses. What stays here is the cadence
// and the per-subscription month arithmetic.

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
