/**
 * paid-periods.ts — THE rule for "is this paid invoice a new billing period?"
 * and the month count built on it (founder decisions, 2026-11-22).
 *
 * One implementation, used by stripe-webhook (every paid invoice),
 * reconcile-engine-months and monthly-generation-cron (the recounts),
 * reconcile-programming-months, and the history loader. The webhook used to
 * carry its own inline copy of the rule and the Programming sweep counted raw
 * invoices; three answers to one question is how months got minted twice.
 *
 * THE RULE. A paid invoice of a subscription is a new period when it is
 *   - a renewal (billing_reason subscription_cycle); or
 *   - the first paid invoice of its subscription — by POSITION, not by label:
 *     Stripe labels the first invoice of a Checkout subscription
 *     subscription_update. It counts at amount 0 too (a 100% promotion code
 *     is still the person's first period); or
 *   - a plan-change invoice (subscription_update) that charged money AND comes
 *     at least PLAN_CHANGE_MIN_DAYS after the person's last counted period
 *     started. Joined Nov 1, upgraded Nov 29 for nearly a full period: a new
 *     period. Three plan changes in two days ($40.99, $27.06, $0.97): one.
 * Everything else is not a period.
 *
 * THE COUNT. Engine months = the months of every counted, unrefunded period
 * of a plan that includes the Engine, over the person's whole history (the
 * paid_periods record, migration 20261122100000). Monthly = 1, quarterly = 3
 * released one per 30 days through the CURRENT quarter only.
 *
 * Pure functions, no I/O — unit-tested without a DB or Stripe. The two small
 * DB helpers at the bottom never throw.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type Cadence, ENGINE_MONTHS_CAP, subscriptionCadence, type SubscriptionLike } from "./engine-entitlement.ts";
import { featuresFromMetadata } from "./plan-entitlements.ts";

/** A paid plan change is a new period only this long after the last one began. */
export const PLAN_CHANGE_MIN_DAYS = 15;

const SEC_PER_DAY = 86_400;
const MS_PER_DAY = 86_400_000;

export type CountReason =
  | "first_of_subscription"
  | "cycle"
  | "plan_change_after_15d"
  | "plan_change_within_15d"
  /** A paid plan change with nothing known before it (the subscription's
   *  invoice list could not be read and the record holds no earlier period).
   *  Counts — what the old rule did with every paid plan change. */
  | "plan_change_no_prior"
  | "zero_or_other"
  /** A stub written when a charge was refunded before its invoice was ever
   *  recorded. Never counts; exists so recounts leave that invoice out. */
  | "refunded_unrecorded";

export type PeriodCadence = Cadence | "other";

/** What the rule needs to know about one paid invoice. Times are unix seconds. */
export interface PaidInvoice {
  id: string;
  subscription_id: string | null;
  billing_reason: string | null;
  amount_paid: number | null;
  /** When the invoice was created = when the period it bills begins. */
  created: number;
  /** false ONLY when every line is a proration line (a mid-period charge with
   *  no period of its own). undefined = not known; then it is not held against
   *  the invoice. */
  has_period_line?: boolean;
}

export interface PeriodDecision {
  counts: boolean;
  reason: CountReason;
}

/** 1 for a monthly period, 3 for a quarterly one, 0 for anything else. */
export function monthsFor(cadence: PeriodCadence | null | undefined): number {
  return cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 0;
}

/**
 * Apply the rule to a set of paid invoices in chronological order.
 *
 * `priorCountedStarts`: when the person's already-counted periods OUTSIDE this
 * set began (other subscriptions, other customer records) — the 15-day window
 * is per person, not per subscription.
 * `completeSubscriptions` false = the set is not known to hold each
 * subscription's whole history, so "first of its subscription" is taken from
 * the label only (subscription_create), never from position.
 */
export function classifyPaidInvoices(
  invoices: PaidInvoice[],
  priorCountedStarts: number[] = [],
  completeSubscriptions = true,
): Map<string, PeriodDecision> {
  const ordered = [...invoices].sort((a, b) => (a.created - b.created) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const starts = priorCountedStarts.filter((s) => Number.isFinite(s));
  const seenSubscription = new Set<string>();
  const out = new Map<string, PeriodDecision>();
  for (const inv of ordered) {
    if (out.has(inv.id)) continue; // the same invoice listed twice is one invoice
    let decision: PeriodDecision = { counts: false, reason: "zero_or_other" };
    const sub = inv.subscription_id;
    const reason = inv.billing_reason;
    if (sub) {
      const firstByPosition = completeSubscriptions && !seenSubscription.has(sub);
      if (reason === "subscription_cycle") {
        decision = { counts: true, reason: "cycle" };
      } else if (reason === "subscription_create" || firstByPosition) {
        decision = { counts: true, reason: "first_of_subscription" };
      } else if (reason === "subscription_update" && (inv.amount_paid ?? 0) > 0 && inv.has_period_line !== false) {
        let last: number | null = null;
        for (const s of starts) if (s <= inv.created && (last == null || s > last)) last = s;
        if (last == null) decision = { counts: true, reason: "plan_change_no_prior" };
        else if (inv.created - last >= PLAN_CHANGE_MIN_DAYS * SEC_PER_DAY) decision = { counts: true, reason: "plan_change_after_15d" };
        else decision = { counts: false, reason: "plan_change_within_15d" };
      }
      seenSubscription.add(sub);
    }
    if (decision.counts) starts.push(inv.created);
    out.set(inv.id, decision);
  }
  return out;
}

/**
 * Is THIS invoice a new period?
 *   priorCountedStarts    when the person's counted periods outside this
 *                         subscription's list began (from the record).
 *   subscriptionInvoices  the subscription's paid invoices (the invoice itself
 *                         need not be in it yet). null = could not be read:
 *                         then only the label can say "first".
 */
export function decidePeriod(
  invoice: PaidInvoice,
  priorCountedStarts: number[],
  subscriptionInvoices: PaidInvoice[] | null,
): PeriodDecision {
  const set = subscriptionInvoices == null
    ? [invoice]
    : [invoice, ...subscriptionInvoices.filter((i) => i.id !== invoice.id)];
  return classifyPaidInvoices(set, priorCountedStarts, subscriptionInvoices != null).get(invoice.id)!;
}

// ── Reading a Stripe invoice ───────────────────────────────────────────────
// Invoices are read in the ACCOUNT's API dialect (the plain API's answer, see
// fetchInvoiceCanonical in stripe-webhook): lines carry `proration`, `price`
// and `period`. Anything missing reads as "not known", never as a guess.

// deno-lint-ignore no-explicit-any
type Raw = any;

function realLines(raw: Raw): Raw[] | null {
  const lines = raw?.lines?.data;
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return lines.filter((l: Raw) => l?.proration !== true);
}

/** The subscription a Stripe invoice belongs to (both dialects' paths). */
export function invoiceSubscriptionId(raw: Raw): string | null {
  const v = raw?.subscription ?? raw?.parent?.subscription_details?.subscription ?? null;
  return typeof v === "string" && v !== "" ? v : null;
}

/** A Stripe invoice as the rule sees it. */
export function toPaidInvoice(raw: Raw): PaidInvoice {
  const real = realLines(raw);
  return {
    id: String(raw?.id ?? ""),
    subscription_id: invoiceSubscriptionId(raw),
    billing_reason: typeof raw?.billing_reason === "string" ? raw.billing_reason : null,
    amount_paid: typeof raw?.amount_paid === "number" ? raw.amount_paid : null,
    created: typeof raw?.created === "number" ? raw.created : 0,
    has_period_line: real == null ? undefined : real.length > 0,
  };
}

/** Monthly / quarterly from the invoice's own period line (its price, else the
 *  length of the period it bills); null when it cannot be told. */
export function invoiceCadence(raw: Raw): Cadence | null {
  for (const line of realLines(raw) ?? []) {
    const rec = line?.price?.recurring ?? line?.plan ?? null;
    const viaPrice = rec ? subscriptionCadence({ items: { data: [{ price: { recurring: { interval: rec.interval, interval_count: rec.interval_count } } }] } }) : null;
    if (viaPrice) return viaPrice;
    const start = line?.period?.start, end = line?.period?.end;
    if (typeof start === "number" && typeof end === "number" && end > start) {
      const days = (end - start) / SEC_PER_DAY;
      if (days >= 27 && days <= 32) return "monthly";
      if (days >= 88 && days <= 93) return "quarterly";
    }
  }
  return null;
}

/** The features this invoice's period line(s) grant, read from the price
 *  metadata EMBEDDED in the invoice (no Stripe call). null = not known. */
export function invoiceFeatures(raw: Raw): string[] | null {
  const out = new Set<string>();
  for (const line of realLines(raw) ?? []) {
    for (const f of featuresFromMetadata(line?.price?.metadata)) out.add(f);
  }
  return out.size > 0 ? [...out] : null;
}

/** Start and end (unix seconds) of the period the invoice bills, from its
 *  period line; the invoice's own creation time when there is none. */
export function invoicePeriod(raw: Raw): { start: number | null; end: number | null } {
  for (const line of realLines(raw) ?? []) {
    const start = line?.period?.start, end = line?.period?.end;
    if (typeof start === "number") return { start, end: typeof end === "number" ? end : null };
  }
  return { start: typeof raw?.created === "number" ? raw.created : null, end: null };
}

// ── The record ─────────────────────────────────────────────────────────────

/** One row of paid_periods, as the database returns it. */
export interface PaidPeriodRow {
  stripe_invoice_id: string;
  user_id: string | null;
  customer_email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
  amount_paid: number | null;
  currency: string | null;
  billing_reason: string | null;
  cadence: PeriodCadence;
  includes_engine: boolean;
  includes_programming: boolean;
  counts: boolean;
  count_reason: CountReason;
  months: number;
  refunded_at: string | null;
  source: "webhook" | "backfill";
}

const isoOf = (sec: number | null | undefined): string | null =>
  typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000).toISOString() : null;

const secOf = (iso: string | null | undefined): number | null => {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/** When the period a record row holds began (unix seconds), for the 15-day rule. */
export function rowStart(row: Pick<PaidPeriodRow, "period_start" | "paid_at">): number | null {
  return secOf(row.period_start) ?? secOf(row.paid_at);
}

/** The record row for one Stripe invoice, given the decision and what it bills. */
export function buildPeriodRow(
  raw: Raw,
  decision: PeriodDecision,
  opts: {
    userId: string | null;
    cadence: PeriodCadence;
    includesEngine: boolean;
    includesProgramming: boolean;
    source: "webhook" | "backfill";
    refundedAt?: string | null;
  },
): PaidPeriodRow {
  const period = invoicePeriod(raw);
  return {
    stripe_invoice_id: String(raw?.id ?? ""),
    user_id: opts.userId,
    customer_email: typeof raw?.customer_email === "string" ? raw.customer_email : null,
    stripe_customer_id: typeof raw?.customer === "string" ? raw.customer : null,
    stripe_subscription_id: invoiceSubscriptionId(raw),
    paid_at: isoOf(raw?.status_transitions?.paid_at) ?? isoOf(raw?.created),
    period_start: isoOf(period.start),
    period_end: isoOf(period.end),
    amount_paid: typeof raw?.amount_paid === "number" ? raw.amount_paid : null,
    currency: typeof raw?.currency === "string" ? raw.currency : null,
    billing_reason: typeof raw?.billing_reason === "string" ? raw.billing_reason : null,
    cadence: opts.cadence,
    includes_engine: opts.includesEngine,
    includes_programming: opts.includesProgramming,
    counts: decision.counts,
    count_reason: decision.reason,
    months: decision.counts ? monthsFor(opts.cadence) : 0,
    refunded_at: opts.refundedAt ?? null,
    source: opts.source,
  };
}

// ── Counting ───────────────────────────────────────────────────────────────

/** One paid period as the count sees it. */
export interface CountedPeriod {
  invoice_id: string;
  subscription_id: string | null;
  /** unix seconds */
  started: number;
  cadence: PeriodCadence;
  months: number;
  counts: boolean;
  refunded: boolean;
  includes_engine: boolean;
  includes_programming: boolean;
}

export function periodFromRow(row: PaidPeriodRow): CountedPeriod {
  return {
    invoice_id: row.stripe_invoice_id,
    subscription_id: row.stripe_subscription_id,
    started: rowStart(row) ?? 0,
    cadence: row.cadence,
    months: row.months,
    counts: row.counts === true,
    refunded: row.refunded_at != null,
    includes_engine: row.includes_engine === true,
    includes_programming: row.includes_programming === true,
  };
}

export interface MergedPeriods {
  /** The person's periods: the record, plus this subscription's invoices the
   *  record does not hold. One entry per invoice. */
  periods: CountedPeriod[];
  /** Counted, unrefunded periods of THIS subscription — the per-subscription
   *  number ("is this its first paid period?", the Programming month count). */
  subscriptionCounted: number;
}

/**
 * The person's periods = the record ∪ the current subscription's own paid
 * invoices.
 *
 * WHY BOTH (2026-11-22). The record starts empty and only holds invoices paid
 * after it shipped until the founder-approved history load; counting from it
 * alone would undercount every existing subscriber. The subscription's own
 * invoice list is what the count was always derived from, so reading it too
 * means nobody's computed total drops on deploy. Merged by invoice id (never
 * added together), so an invoice in both is counted once. Once history is
 * loaded, the record alone holds everything and the subscription-list half
 * can be retired: it then only repeats rows the record already has.
 *
 * For an invoice in both, the record wins on what only it knows — a refund,
 * and which products the period included — and "counts" is true if either
 * says so (the record never turns a counted period into an uncounted one).
 * For an invoice only in the list: the rule is applied afresh, its cadence is
 * the invoice's own (else the subscription's), and it is taken to include a
 * product unless its price metadata says otherwise (what the old count
 * assumed for every invoice).
 */
export function mergePeriods(
  recordRows: PaidPeriodRow[],
  subscriptionInvoicesRaw: Raw[] | null,
  subscription: (SubscriptionLike & { id?: string | null }) | null,
): MergedPeriods {
  const rawList = (subscriptionInvoicesRaw ?? []).filter((r) => r && typeof r.id === "string");
  const listIds = new Set<string>(rawList.map((r) => r.id as string));
  const rowById = new Map(recordRows.map((r) => [r.stripe_invoice_id, r]));
  const subCadence = subscription ? subscriptionCadence(subscription) : null;

  // The 15-day window is per person: periods the record counted outside this list.
  const priors: number[] = [];
  for (const r of recordRows) {
    if (r.counts && !listIds.has(r.stripe_invoice_id)) {
      const s = rowStart(r);
      if (s != null) priors.push(s);
    }
  }
  const fresh = classifyPaidInvoices(rawList.map(toPaidInvoice), priors);

  const periods: CountedPeriod[] = [];
  let subscriptionCounted = 0;
  for (const raw of rawList) {
    const row = rowById.get(raw.id);
    const decision = fresh.get(raw.id) ?? { counts: false, reason: "zero_or_other" as CountReason };
    let p: CountedPeriod;
    if (row && row.counts) {
      p = periodFromRow(row);
    } else {
      const cadence: PeriodCadence = invoiceCadence(raw) ?? subCadence ?? "other";
      const features = invoiceFeatures(raw);
      p = {
        invoice_id: raw.id,
        subscription_id: invoiceSubscriptionId(raw),
        started: typeof raw.created === "number" ? raw.created : 0,
        cadence,
        months: decision.counts ? monthsFor(cadence) : 0,
        counts: decision.counts,
        refunded: row ? row.refunded_at != null : false,
        includes_engine: row ? row.includes_engine : features == null || features.includes("engine"),
        includes_programming: row ? row.includes_programming : features == null || features.includes("programming"),
      };
    }
    if (p.counts && !p.refunded) subscriptionCounted += 1;
    periods.push(p);
  }
  for (const r of recordRows) if (!listIds.has(r.stripe_invoice_id)) periods.push(periodFromRow(r));
  return { periods, subscriptionCounted };
}

export interface PeriodEntitlement {
  /** Engine months paid for as of `nowMs`, capped. */
  entitled: number;
  /** 1..3 when the current subscription is quarterly (the in-quarter drip); else 1. */
  monthsIntoCurrentQuarter: number;
  /** How many periods were counted toward it. */
  periods: number;
}

/**
 * Engine months from a person's periods: the months of every counted,
 * unrefunded period that included the Engine.
 *
 * QUARTERLY DRIP — on the current quarter only. When the current subscription
 * is quarterly, its most recent counted period is the quarter in progress and
 * contributes 1, 2 or 3 months by days since current_period_start (30-day
 * months) instead of its full 3. Every earlier period contributes its own
 * months: 1 if it was monthly, 3 if quarterly. (The old formula,
 * (periods − 1) × 3 + drip, priced EVERY earlier period as a quarter, so three
 * monthly periods followed by one quarterly one computed as 10, not 4.)
 *
 * Returns null when it cannot be computed (the current subscription is
 * quarterly, has a quarter in progress, and no period start) — callers must
 * then NOT write anything.
 */
export function entitledEngineMonthsFromPeriods(
  periods: CountedPeriod[],
  current: (SubscriptionLike & { id?: string | null }) | null,
  nowMs: number = Date.now(),
): PeriodEntitlement | null {
  const engine = periods.filter((p) => p.counts && p.includes_engine);
  const currentCadence = current ? subscriptionCadence(current) : null;

  // The quarter in progress: the latest counted Engine period of the current
  // subscription — picked BEFORE refunds are dropped, so refunding it does not
  // pass the drip to the quarter before.
  let inProgress: CountedPeriod | null = null;
  if (currentCadence === "quarterly" && current?.id) {
    for (const p of engine) {
      if (p.subscription_id === current.id && (inProgress == null || p.started > inProgress.started)) inProgress = p;
    }
  }

  let monthsIntoCurrentQuarter = 1;
  if (inProgress) {
    const startSec = current?.current_period_start;
    if (typeof startSec !== "number" || !Number.isFinite(startSec)) return null;
    const daysIntoPeriod = Math.max(0, (nowMs - startSec * 1000) / MS_PER_DAY);
    monthsIntoCurrentQuarter = Math.min(Math.floor(daysIntoPeriod / 30) + 1, 3);
  }

  let total = 0;
  let counted = 0;
  for (const p of engine) {
    if (p.refunded) continue;
    counted += 1;
    total += p === inProgress ? monthsIntoCurrentQuarter : p.months;
  }
  return { entitled: Math.min(total, ENGINE_MONTHS_CAP), monthsIntoCurrentQuarter, periods: counted };
}

/**
 * PROGRAMMING months owed on the current subscription: every counted,
 * unrefunded period of THIS subscription at its own value — a monthly period
 * is one month, a quarterly period three — with the quarter in progress
 * released one month at a time (30-day steps from current_period_start).
 *
 * Why (2026-11-23): both Programming jobs still used the old formula,
 * (periods − 1) × 3 + drip, which prices EVERY earlier period as a quarter.
 * A member who paid one MONTH and then switched to quarterly was worked out
 * as owed 4 months, not 2, and was built months 3 and 4 on the two days after
 * the switch — two months early, with his real month then left unwritten.
 * The Engine's count was corrected for the same fault the day before.
 *
 * Per subscription, as the Programming drip has always been (a returner's new
 * subscription starts a new program). A period whose length is not monthly or
 * quarterly is valued as the current subscription's cadence, which is what
 * the old formula did with it.
 *
 * Returns null when it cannot be computed (a quarter in progress with no
 * period start) — callers must then build nothing.
 */
export function entitledProgrammingMonths(
  periods: CountedPeriod[],
  current: (SubscriptionLike & { id?: string | null }) | null,
  nowMs: number = Date.now(),
): PeriodEntitlement | null {
  if (!current?.id) return { entitled: 0, monthsIntoCurrentQuarter: 1, periods: 0 };
  const mine = periods.filter((p) => p.counts && p.subscription_id === current.id);
  const currentCadence = subscriptionCadence(current);

  // The quarter in progress: this subscription's latest counted period, when
  // the subscription is quarterly now. Picked BEFORE refunds are dropped.
  let inProgress: CountedPeriod | null = null;
  if (currentCadence === "quarterly") {
    for (const p of mine) if (inProgress == null || p.started > inProgress.started) inProgress = p;
  }
  let monthsIntoCurrentQuarter = 1;
  if (inProgress) {
    const startSec = current.current_period_start;
    if (typeof startSec !== "number" || !Number.isFinite(startSec)) return null;
    const daysIntoPeriod = Math.max(0, (nowMs - startSec * 1000) / MS_PER_DAY);
    monthsIntoCurrentQuarter = Math.min(Math.floor(daysIntoPeriod / 30) + 1, 3);
  }

  let total = 0;
  let counted = 0;
  for (const p of mine) {
    if (p.refunded) continue;
    counted += 1;
    if (p === inProgress) { total += monthsIntoCurrentQuarter; continue; }
    total += p.months > 0 ? p.months : monthsFor(currentCadence);
  }
  return { entitled: total, monthsIntoCurrentQuarter, periods: counted };
}

/**
 * How many of a period's months have been RELEASED by `nowMs` — what a full
 * refund of it takes back. Monthly: its 1. Quarterly: 1, 2 or 3 by 30-day
 * steps since it began, so refunding a quarter in its first month takes back
 * the one month it had released, not three.
 */
export function monthsReleased(period: { months: number; cadence: PeriodCadence; startedSec: number | null }, nowMs: number = Date.now()): number {
  if (period.months <= 0) return 0;
  if (period.cadence !== "quarterly" || period.startedSec == null) return period.months;
  const days = Math.max(0, (nowMs - period.startedSec * 1000) / MS_PER_DAY);
  return Math.min(Math.floor(days / 30) + 1, period.months);
}

// ── History load (pure; runs nothing) ──────────────────────────────────────

/** One paid invoice from a Stripe export, as the loader hands it over. The
 *  column list and how to fill each one is at the top of the migration. */
export interface HistoricalInvoice {
  id: string;
  customer_id: string | null;
  customer_email: string | null;
  subscription_id: string | null;
  /** unix seconds */
  created: number;
  paid_at?: number | null;
  period_start?: number | null;
  period_end?: number | null;
  amount_paid: number | null;
  currency?: string | null;
  billing_reason: string | null;
  cadence: PeriodCadence;
  includes_engine: boolean;
  includes_programming: boolean;
  /** When the invoice's charge was FULLY refunded (unix seconds), else null. */
  refunded_at?: number | null;
  has_period_line?: boolean;
}

/**
 * The rows the record should hold for ONE person's whole paid history — every
 * subscription, every customer record, any order in. The rule is applied in
 * chronological order across all of it, so the 15-day window and "first of
 * its subscription" come out exactly as they would have live.
 * A refunded invoice still gets its row (counted as the rule says, with
 * refunded_at set): the count leaves it out, and the next plan change is still
 * measured from when it began.
 */
export function buildHistoryRows(userId: string | null, invoices: HistoricalInvoice[]): PaidPeriodRow[] {
  const decisions = classifyPaidInvoices(invoices.map((i) => ({
    id: i.id,
    subscription_id: i.subscription_id,
    billing_reason: i.billing_reason,
    amount_paid: i.amount_paid,
    created: i.created,
    has_period_line: i.has_period_line,
  })));
  const seen = new Set<string>();
  const rows: PaidPeriodRow[] = [];
  for (const i of [...invoices].sort((a, b) => (a.created - b.created) || (a.id < b.id ? -1 : 1))) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    const d = decisions.get(i.id)!;
    rows.push({
      stripe_invoice_id: i.id,
      user_id: userId,
      customer_email: i.customer_email,
      stripe_customer_id: i.customer_id,
      stripe_subscription_id: i.subscription_id,
      paid_at: isoOf(i.paid_at ?? i.created),
      period_start: isoOf(i.period_start ?? i.created),
      period_end: isoOf(i.period_end ?? null),
      amount_paid: i.amount_paid,
      currency: i.currency ?? null,
      billing_reason: i.billing_reason,
      cadence: i.cadence,
      includes_engine: i.includes_engine,
      includes_programming: i.includes_programming,
      counts: d.counts,
      count_reason: d.reason,
      months: d.counts ? monthsFor(i.cadence) : 0,
      refunded_at: isoOf(i.refunded_at ?? null),
      source: "backfill",
    });
  }
  return rows;
}

// ── The two DB calls (never throw) ─────────────────────────────────────────

/** The person's record rows (by user, and by Stripe customer for rows not yet
 *  tied to a user). A failed read returns none — the caller then counts from
 *  the subscription's own invoices, as before the record existed. */
export async function loadPaidPeriods(supa: SupabaseClient, userId: string | null, stripeCustomerId: string | null): Promise<PaidPeriodRow[]> {
  if (!userId && !stripeCustomerId) return [];
  try {
    const { data, error } = await supa.rpc("paid_periods_for_person", { p_user_id: userId, p_stripe_customer_id: stripeCustomerId });
    if (error) {
      console.error(`[paid-periods] READ FAILED for user=${userId} customer=${stripeCustomerId}: ${error.message}`);
      return [];
    }
    return (data ?? []) as PaidPeriodRow[];
  } catch (e) {
    console.error(`[paid-periods] READ FAILED for user=${userId} customer=${stripeCustomerId}: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/** Write one row (idempotent; see record_paid_period). Returns the row as
 *  stored, or null when the write failed — logged loudly, never thrown: the
 *  record must not be able to fail a webhook or hold up an entitlement. */
export async function recordPaidPeriod(supa: SupabaseClient, row: PaidPeriodRow): Promise<PaidPeriodRow | null> {
  try {
    const { data, error } = await supa.rpc("record_paid_period", { p_row: row });
    if (error) {
      console.error(`[paid-periods] RECORD WRITE FAILED for invoice ${row.stripe_invoice_id}: ${error.message}`);
      return null;
    }
    return (data ?? null) as PaidPeriodRow | null;
  } catch (e) {
    console.error(`[paid-periods] RECORD WRITE FAILED for invoice ${row.stripe_invoice_id}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
