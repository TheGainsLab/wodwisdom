/**
 * next-month-text.ts — when an athlete's NEXT MONTH of AI Programming is
 * built, said for how THEY pay. Pure and import-free.
 *
 * Why (2026-11-24): the coach was told one rule for everyone — "built when
 * the subscription renews, one month per paid period" — and to send anyone to
 * a human if a renewal passed with no new month. A quarterly member renews
 * every three months but is released a month every 30 days within the paid
 * quarter (entitledProgrammingMonths in paid-periods.ts: 30-day steps from
 * the start of the period). The coach did not know how anyone was billed.
 */

export type BillingCadence = "monthly" | "quarterly";

export const NEXT_MONTH_MONTHLY =
  "NEXT MONTH for this athlete: they pay MONTHLY. A new month is built when their subscription renews, one per payment.";
export const NEXT_MONTH_QUARTERLY =
  "NEXT MONTH for this athlete: they pay QUARTERLY. They do NOT wait for renewal: one payment covers three months, released " +
  "one at a time — the first at payment, then one every 30 days from the start of the paid quarter (day 30, day 60). A daily " +
  "job builds it, usually within a day of falling due.";

/** The line for the coach's context. "" when the cadence is not known: the
 *  standing instructions then give both rules. */
export function nextMonthLine(cadence: string | null | undefined): string {
  if (cadence === "monthly") return NEXT_MONTH_MONTHLY;
  if (cadence === "quarterly") return NEXT_MONTH_QUARTERLY;
  return "";
}
