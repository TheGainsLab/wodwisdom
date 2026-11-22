// deno test supabase/functions/_shared/paid-periods_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ENGINE_MONTHS_CAP } from "./engine-entitlement.ts";
import {
  buildHistoryRows, buildPeriodRow, classifyPaidInvoices, type CountedPeriod, decidePeriod, entitledEngineMonthsFromPeriods,
  type HistoricalInvoice, invoiceCadence, invoiceFeatures, mergePeriods, monthsFor, monthsReleased, type PaidInvoice,
  type PaidPeriodRow, PLAN_CHANGE_MIN_DAYS, toPaidInvoice,
} from "./paid-periods.ts";

const DAY = 86_400;
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const inv = (id: string, created: number, billing_reason: string, amount_paid: number, subscription_id: string | null = "sub_A", has_period_line?: boolean): PaidInvoice =>
  ({ id, subscription_id, billing_reason, amount_paid, created, has_period_line });

// ── The rule ───────────────────────────────────────────────────────────────
// These first two replace the tests that pinned the old rule in
// engine-entitlement_test.ts, with the same invoice shapes.

Deno.test("the rule: renewals and a subscription's first invoice count; a 0.00 plan flip does not", () => {
  const t0 = at("2026-10-01T00:00:00Z");
  // The first invoice of a Checkout subscription is labelled subscription_update
  // (the 2026-11-08 incident shape). It counts because it is FIRST, not for its label.
  const d = classifyPaidInvoices([
    inv("in_1", t0, "subscription_update", 4499),
    inv("in_2", t0 + 30 * DAY, "subscription_cycle", 4499),
    inv("in_3", t0 + 31 * DAY, "subscription_update", 0),
  ]);
  assertEquals(d.get("in_1"), { counts: true, reason: "first_of_subscription" });
  assertEquals(d.get("in_2"), { counts: true, reason: "cycle" });
  assertEquals(d.get("in_3"), { counts: false, reason: "zero_or_other" });
  assertEquals(decidePeriod(inv("in_c", t0, "subscription_create", 4499), [], []), { counts: true, reason: "first_of_subscription" });
  // Not a subscription invoice, or a reason that is not a period.
  assertEquals(decidePeriod(inv("in_m", t0, "manual", 999, null), [], []), { counts: false, reason: "zero_or_other" });
  assertEquals(decidePeriod(inv("in_m2", t0 + DAY, "manual", 999), [], [inv("in_1", t0, "subscription_create", 100)]), { counts: false, reason: "zero_or_other" });
});

Deno.test("the rule: a paid plan change is NO LONGER always a period (was: any subscription_update that charged money)", () => {
  const t0 = at("2026-11-01T00:00:00Z");
  const first = inv("in_1", t0, "subscription_update", 2999);
  const soon = inv("in_2", t0 + 3 * DAY, "subscription_update", 4499);
  assertEquals(decidePeriod(soon, [], [first, soon]), { counts: false, reason: "plan_change_within_15d" });
});

Deno.test("joined Nov 1, upgraded Nov 29 for nearly a full period: the upgrade is a new period", () => {
  const first = inv("in_1", at("2026-11-01T10:00:00Z"), "subscription_update", 2999);
  const upgrade = inv("in_2", at("2026-11-29T10:00:00Z"), "subscription_update", 4099);
  assertEquals(decidePeriod(upgrade, [], [upgrade, first]), { counts: true, reason: "plan_change_after_15d" });
  // And the renewal a month after the upgrade is the third.
  const d = classifyPaidInvoices([first, upgrade, inv("in_3", at("2026-12-29T10:00:00Z"), "subscription_cycle", 4499)]);
  assertEquals([...d.values()].filter((x) => x.counts).length, 3);
});

Deno.test("three plan changes in two days (40.99, 27.06, 0.97): one period", () => {
  const t0 = at("2026-11-10T09:00:00Z");
  const d = classifyPaidInvoices([
    inv("in_c", t0 + 2 * DAY, "subscription_update", 97),
    inv("in_a", t0, "subscription_update", 4099),
    inv("in_b", t0 + DAY, "subscription_update", 2706),
  ]);
  assertEquals(d.get("in_a"), { counts: true, reason: "first_of_subscription" });
  assertEquals(d.get("in_b"), { counts: false, reason: "plan_change_within_15d" });
  assertEquals(d.get("in_c"), { counts: false, reason: "plan_change_within_15d" });
});

Deno.test("the 15 days are counted from the last COUNTED period, exactly, per person", () => {
  assertEquals(PLAN_CHANGE_MIN_DAYS, 15);
  const t0 = at("2026-11-01T00:00:00Z");
  const first = inv("in_1", t0, "subscription_create", 2999);
  const on15 = inv("in_2", t0 + 15 * DAY, "subscription_update", 500);
  const before15 = inv("in_2", t0 + 15 * DAY - 1, "subscription_update", 500);
  assertEquals(decidePeriod(on15, [], [first]).reason, "plan_change_after_15d");
  assertEquals(decidePeriod(before15, [], [first]).reason, "plan_change_within_15d");
  // An uncounted change does not move the reference: day 3 (no), day 16 (yes — measured from day 0).
  const d = classifyPaidInvoices([first, inv("in_x", t0 + 3 * DAY, "subscription_update", 500), inv("in_y", t0 + 16 * DAY, "subscription_update", 500)]);
  assertEquals(d.get("in_y")?.reason, "plan_change_after_15d");
  // A period counted under ANOTHER subscription 5 days ago holds a plan change here back.
  const other = t0 + 40 * DAY;
  const change = inv("in_z", other + 5 * DAY, "subscription_update", 500);
  assertEquals(decidePeriod(change, [other], [first, change]).reason, "plan_change_within_15d");
});

Deno.test("a 0.00 first invoice (100% promotion code) is still the person's first period", () => {
  const t0 = at("2026-11-01T00:00:00Z");
  assertEquals(decidePeriod(inv("in_1", t0, "subscription_update", 0), [], []), { counts: true, reason: "first_of_subscription" });
  // The paid renewal after it is the second.
  const d = classifyPaidInvoices([inv("in_1", t0, "subscription_update", 0), inv("in_2", t0 + 30 * DAY, "subscription_cycle", 2999)]);
  assertEquals([...d.values()].filter((x) => x.counts).length, 2);
});

Deno.test("when the subscription's invoices could not be read, only the label can say 'first'", () => {
  const t0 = at("2026-11-01T00:00:00Z");
  assertEquals(decidePeriod(inv("in_1", t0, "subscription_create", 2999), [], null).reason, "first_of_subscription");
  assertEquals(decidePeriod(inv("in_1", t0, "subscription_cycle", 2999), [], null).reason, "cycle");
  // A 0.00 update is not assumed to be a first invoice.
  assertEquals(decidePeriod(inv("in_1", t0, "subscription_update", 0), [], null), { counts: false, reason: "zero_or_other" });
  // A paid update: nothing known before it counts (the old behaviour); a counted period 3 days back does not.
  assertEquals(decidePeriod(inv("in_1", t0, "subscription_update", 2999), [], null), { counts: true, reason: "plan_change_no_prior" });
  assertEquals(decidePeriod(inv("in_1", t0, "subscription_update", 2999), [t0 - 3 * DAY], null).reason, "plan_change_within_15d");
});

Deno.test("a charge made only of proration lines has no period of its own", () => {
  const t0 = at("2026-11-01T00:00:00Z");
  const first = inv("in_1", t0, "subscription_create", 2999);
  assertEquals(decidePeriod(inv("in_2", t0 + 20 * DAY, "subscription_update", 800, "sub_A", false), [], [first]), { counts: false, reason: "zero_or_other" });
  // Not known (no line data) is not held against it.
  assertEquals(decidePeriod(inv("in_2", t0 + 20 * DAY, "subscription_update", 800, "sub_A", undefined), [], [first]).counts, true);
});

Deno.test("monthsFor", () => {
  assertEquals(monthsFor("monthly"), 1);
  assertEquals(monthsFor("quarterly"), 3);
  assertEquals(monthsFor("other"), 0);
  assertEquals(monthsFor(null), 0);
});

// ── Reading a Stripe invoice ───────────────────────────────────────────────

const line = (o: { proration?: boolean; interval?: string; count?: number; plan?: string; start?: number; end?: number }) => ({
  proration: o.proration ?? false,
  price: { recurring: o.interval ? { interval: o.interval, interval_count: o.count ?? 1 } : null, metadata: o.plan ? { plan: o.plan } : {} },
  period: { start: o.start ?? 0, end: o.end ?? 0 },
});
// deno-lint-ignore no-explicit-any
const stripeInvoice = (id: string, created: number, billing_reason: string, amount_paid: number, lines: any[], subscription = "sub_A") =>
  ({ id, created, billing_reason, amount_paid, subscription, customer: "cus_1", customer_email: "a@b.co", currency: "usd", lines: { data: lines } });

Deno.test("reading an invoice: cadence, features and the period come from the line that is not a proration", () => {
  const t0 = at("2026-11-01T00:00:00Z");
  const change = stripeInvoice("in_2", t0, "subscription_update", 4099, [
    line({ proration: true, interval: "month", plan: "engine" }),
    line({ interval: "month", count: 3, plan: "all_access", start: t0, end: t0 + 91 * DAY }),
  ]);
  assertEquals(invoiceCadence(change), "quarterly");
  assertEquals(invoiceFeatures(change)?.includes("programming"), true);
  assertEquals(toPaidInvoice(change).has_period_line, true);
  // Prorations only: no period line.
  assertEquals(toPaidInvoice(stripeInvoice("in_3", t0, "subscription_update", 500, [line({ proration: true, interval: "month" })])).has_period_line, false);
  // No line data at all: not known.
  assertEquals(toPaidInvoice({ id: "in_4", created: t0, billing_reason: "subscription_cycle", amount_paid: 1, subscription: "sub_A" }).has_period_line, undefined);
  // No price on the line: the period's length says monthly; no metadata: features not known.
  const bare = stripeInvoice("in_5", t0, "subscription_cycle", 2999, [{ period: { start: t0, end: t0 + 30 * DAY } }]);
  assertEquals(invoiceCadence(bare), "monthly");
  assertEquals(invoiceFeatures(bare), null);
  // The newer dialect's subscription path is read too.
  assertEquals(toPaidInvoice({ id: "in_6", created: t0, parent: { subscription_details: { subscription: "sub_Z" } } }).subscription_id, "sub_Z");
});

Deno.test("buildPeriodRow: months only when it counts, by the period's cadence", () => {
  const t0 = at("2026-11-01T00:00:00Z");
  const raw = stripeInvoice("in_1", t0, "subscription_cycle", 8999, [line({ interval: "month", count: 3, plan: "engine", start: t0, end: t0 + 91 * DAY })]);
  const row = buildPeriodRow(raw, { counts: true, reason: "cycle" }, { userId: "u1", cadence: "quarterly", includesEngine: true, includesProgramming: false, source: "webhook" });
  assertEquals([row.months, row.counts, row.count_reason, row.includes_engine, row.stripe_subscription_id, row.period_start], [3, true, "cycle", true, "sub_A", "2026-11-01T00:00:00.000Z"]);
  const not = buildPeriodRow(raw, { counts: false, reason: "plan_change_within_15d" }, { userId: null, cadence: "quarterly", includesEngine: true, includesProgramming: false, source: "webhook" });
  assertEquals([not.months, not.counts], [0, false]);
});

// ── The count ──────────────────────────────────────────────────────────────

const period = (id: string, started: number, o: Partial<CountedPeriod> = {}): CountedPeriod => ({
  invoice_id: id, subscription_id: "sub_A", started, cadence: "monthly", months: 1, counts: true, refunded: false,
  includes_engine: true, includes_programming: false, ...o,
});
const monthlySub = (id = "sub_A") => ({ id, items: { data: [{ price: { recurring: { interval: "month", interval_count: 1 } } }] }, current_period_start: null });
const quarterlySub = (id: string, start: number) => ({ id, items: { data: [{ price: { recurring: { interval: "month", interval_count: 3 } } }] }, current_period_start: start });

Deno.test("count: monthly is one month per counted period (unchanged)", () => {
  const t0 = at("2026-08-01T00:00:00Z");
  const three = [0, 1, 2].map((i) => period(`in_${i}`, t0 + i * 30 * DAY));
  assertEquals(entitledEngineMonthsFromPeriods(three, monthlySub())?.entitled, 3);
  assertEquals(entitledEngineMonthsFromPeriods([], monthlySub())?.entitled, 0);
});

Deno.test("count: a returner — three old monthly payments under another subscription and one new = 4", () => {
  const t0 = at("2026-03-01T00:00:00Z");
  const old = [0, 1, 2].map((i) => period(`in_old_${i}`, t0 + i * 30 * DAY, { subscription_id: "sub_OLD" }));
  const back = period("in_new", at("2026-11-20T00:00:00Z"), { subscription_id: "sub_NEW" });
  assertEquals(entitledEngineMonthsFromPeriods([...old, back], monthlySub("sub_NEW"))?.entitled, 4);
});

Deno.test("count: quarterly is 3 per finished quarter plus the drip through the current one (unchanged)", () => {
  const q1 = at("2026-07-17T00:00:00Z"), q2 = at("2026-10-17T00:00:00Z");
  const ps = [period("in_q1", q1, { cadence: "quarterly", months: 3 }), period("in_q2", q2, { cadence: "quarterly", months: 3 })];
  const nowAt = (days: number) => (q2 + days * DAY) * 1000;
  assertEquals(entitledEngineMonthsFromPeriods(ps, quarterlySub("sub_A", q2), nowAt(0))?.entitled, 4);
  assertEquals(entitledEngineMonthsFromPeriods(ps, quarterlySub("sub_A", q2), nowAt(29))?.entitled, 4);
  assertEquals(entitledEngineMonthsFromPeriods(ps, quarterlySub("sub_A", q2), nowAt(30))?.entitled, 5); // month 2 of the second quarter
  assertEquals(entitledEngineMonthsFromPeriods(ps, quarterlySub("sub_A", q2), nowAt(60))?.entitled, 6);
  assertEquals(entitledEngineMonthsFromPeriods(ps, quarterlySub("sub_A", q2), nowAt(200))?.entitled, 6); // never past the quarter
  assertEquals(entitledEngineMonthsFromPeriods(ps, quarterlySub("sub_A", q2), nowAt(30))?.monthsIntoCurrentQuarter, 2);
  // A quarter in progress with no period start cannot be computed: the caller writes nothing.
  assertEquals(entitledEngineMonthsFromPeriods(ps, { ...quarterlySub("sub_A", q2), current_period_start: null }, nowAt(0)), null);
});

Deno.test("count: three monthly periods then one quarterly = 3 + drip (the old formula said 10)", () => {
  const t0 = at("2026-07-01T00:00:00Z"), q = at("2026-10-01T00:00:00Z");
  const ps = [
    ...[0, 1, 2].map((i) => period(`in_m${i}`, t0 + i * 30 * DAY)),
    period("in_q", q, { cadence: "quarterly", months: 3 }),
  ];
  assertEquals(entitledEngineMonthsFromPeriods(ps, quarterlySub("sub_A", q), q * 1000)?.entitled, 4);
  assertEquals(entitledEngineMonthsFromPeriods(ps, quarterlySub("sub_A", q), (q + 45 * DAY) * 1000)?.entitled, 5);
  assertEquals(entitledEngineMonthsFromPeriods(ps, quarterlySub("sub_A", q), (q + 80 * DAY) * 1000)?.entitled, 6);
  // The same when the monthly ones were under an earlier subscription and are whole months there.
  const ret = ps.map((p) => (p.cadence === "monthly" ? { ...p, subscription_id: "sub_OLD" } : p));
  assertEquals(entitledEngineMonthsFromPeriods(ret, quarterlySub("sub_A", q), q * 1000)?.entitled, 4);
  // A finished quarter under an EARLIER subscription is three whole months, no drip.
  const oldQuarter = [period("in_oq", t0, { cadence: "quarterly", months: 3, subscription_id: "sub_OLD" }), period("in_now", q, { subscription_id: "sub_B" })];
  assertEquals(entitledEngineMonthsFromPeriods(oldQuarter, monthlySub("sub_B"), q * 1000)?.entitled, 4);
});

Deno.test("count: a refunded period gives nothing, and refunding the current quarter does not pass the drip back", () => {
  const t0 = at("2026-08-01T00:00:00Z");
  const three = [0, 1, 2].map((i) => period(`in_${i}`, t0 + i * 30 * DAY));
  three[1].refunded = true;
  assertEquals(entitledEngineMonthsFromPeriods(three, monthlySub())?.entitled, 2);
  const q1 = at("2026-07-17T00:00:00Z"), q2 = at("2026-10-17T00:00:00Z");
  const ps = [period("in_q1", q1, { cadence: "quarterly", months: 3 }), period("in_q2", q2, { cadence: "quarterly", months: 3, refunded: true })];
  assertEquals(entitledEngineMonthsFromPeriods(ps, quarterlySub("sub_A", q2), (q2 + 5 * DAY) * 1000)?.entitled, 3);
});

Deno.test("count: Programming-only periods, and periods that do not count, unlock no Engine months", () => {
  const t0 = at("2026-08-01T00:00:00Z");
  const ps = [
    period("in_p1", t0, { includes_engine: false, includes_programming: true }),
    period("in_p2", t0 + 30 * DAY, { includes_engine: false, includes_programming: true }),
    period("in_p3", t0 + 60 * DAY, { includes_engine: false, includes_programming: true }),
    period("in_x", t0 + 62 * DAY, { counts: false, months: 0 }),
    period("in_e", t0 + 90 * DAY),
  ];
  const ent = entitledEngineMonthsFromPeriods(ps, monthlySub());
  assertEquals([ent?.entitled, ent?.periods], [1, 1]);
});

Deno.test("count: capped", () => {
  const t0 = at("2020-01-01T00:00:00Z");
  const many = Array.from({ length: 50 }, (_, i) => period(`in_${i}`, t0 + i * 30 * DAY));
  assertEquals(entitledEngineMonthsFromPeriods(many, monthlySub())?.entitled, ENGINE_MONTHS_CAP);
});

Deno.test("monthsReleased: what a full refund takes back", () => {
  const start = at("2026-10-17T00:00:00Z");
  const now = (days: number) => (start + days * DAY) * 1000;
  assertEquals(monthsReleased({ months: 1, cadence: "monthly", startedSec: start }, now(3)), 1);
  assertEquals(monthsReleased({ months: 3, cadence: "quarterly", startedSec: start }, now(3)), 1);
  assertEquals(monthsReleased({ months: 3, cadence: "quarterly", startedSec: start }, now(31)), 2);
  assertEquals(monthsReleased({ months: 3, cadence: "quarterly", startedSec: start }, now(400)), 3);
  assertEquals(monthsReleased({ months: 3, cadence: "quarterly", startedSec: null }, now(3)), 3);
  assertEquals(monthsReleased({ months: 0, cadence: "monthly", startedSec: start }, now(3)), 0);
});

// ── The record merged with the subscription's own invoices ─────────────────

const row = (id: string, startIso: string, o: Partial<PaidPeriodRow> = {}): PaidPeriodRow => ({
  stripe_invoice_id: id, user_id: "u1", customer_email: null, stripe_customer_id: "cus_old", stripe_subscription_id: "sub_OLD",
  paid_at: startIso, period_start: startIso, period_end: null, amount_paid: 2999, currency: "usd", billing_reason: "subscription_cycle",
  cadence: "monthly", includes_engine: true, includes_programming: false, counts: true, count_reason: "cycle", months: 1,
  refunded_at: null, source: "backfill", ...o,
});
const monthlyInvoice = (id: string, created: number, reason = "subscription_cycle", amount = 2999, plan = "engine", subscription = "sub_NEW") =>
  stripeInvoice(id, created, reason, amount, [line({ interval: "month", plan, start: created, end: created + 30 * DAY })], subscription);

Deno.test("merge: before history is loaded an existing subscriber counts exactly as before (the list alone)", () => {
  const t0 = at("2026-08-01T00:00:00Z");
  const list = [2, 1, 0].map((i) => monthlyInvoice(`in_${i}`, t0 + i * 30 * DAY, i === 0 ? "subscription_update" : "subscription_cycle"));
  const m = mergePeriods([], list, monthlySub("sub_NEW"));
  assertEquals(m.subscriptionCounted, 3);
  assertEquals(entitledEngineMonthsFromPeriods(m.periods, monthlySub("sub_NEW"))?.entitled, 3);
});

Deno.test("merge: a returner — BEFORE the history load 1 (this subscription only), AFTER it 4", () => {
  const back = at("2026-11-20T00:00:00Z");
  const list = [monthlyInvoice("in_new", back, "subscription_update")];
  const before = mergePeriods([], list, monthlySub("sub_NEW"));
  assertEquals(entitledEngineMonthsFromPeriods(before.periods, monthlySub("sub_NEW"))?.entitled, 1);
  const history = [row("in_o1", "2026-03-01T00:00:00Z"), row("in_o2", "2026-03-31T00:00:00Z"), row("in_o3", "2026-04-30T00:00:00Z")];
  const after = mergePeriods(history, list, monthlySub("sub_NEW"));
  assertEquals(entitledEngineMonthsFromPeriods(after.periods, monthlySub("sub_NEW"))?.entitled, 4);
  // Per subscription it is still the new subscription's FIRST paid period.
  assertEquals(after.subscriptionCounted, 1);
});

Deno.test("merge: an invoice in both the record and the list is counted once", () => {
  const t0 = at("2026-10-01T00:00:00Z");
  const list = [monthlyInvoice("in_1", t0, "subscription_update"), monthlyInvoice("in_2", t0 + 30 * DAY)];
  const rec = [row("in_2", "2026-10-31T00:00:00Z", { stripe_subscription_id: "sub_NEW", source: "webhook" })];
  const m = mergePeriods(rec, list, monthlySub("sub_NEW"));
  assertEquals(m.periods.length, 2);
  assertEquals(entitledEngineMonthsFromPeriods(m.periods, monthlySub("sub_NEW"))?.entitled, 2);
});

Deno.test("merge: a refund in the record takes the invoice out of the subscription's own count too", () => {
  const t0 = at("2026-08-01T00:00:00Z");
  const list = [0, 1, 2].map((i) => monthlyInvoice(`in_${i}`, t0 + i * 30 * DAY, i === 0 ? "subscription_update" : "subscription_cycle"));
  // Recorded and refunded.
  const recorded = mergePeriods([row("in_1", "2026-08-31T00:00:00Z", { stripe_subscription_id: "sub_NEW", refunded_at: "2026-09-02T00:00:00Z" })], list, monthlySub("sub_NEW"));
  assertEquals(entitledEngineMonthsFromPeriods(recorded.periods, monthlySub("sub_NEW"))?.entitled, 2);
  assertEquals(recorded.subscriptionCounted, 2);
  // Refunded before it was ever recorded: the stub row (counts nothing itself) does the same.
  const stub = row("in_1", "2026-09-02T00:00:00Z", {
    stripe_subscription_id: null, period_start: null, paid_at: null, counts: false, months: 0, cadence: "other",
    count_reason: "refunded_unrecorded", includes_engine: false, refunded_at: "2026-09-02T00:00:00Z", source: "webhook",
  });
  const stubbed = mergePeriods([stub], list, monthlySub("sub_NEW"));
  assertEquals(entitledEngineMonthsFromPeriods(stubbed.periods, monthlySub("sub_NEW"))?.entitled, 2);
});

Deno.test("merge: only Engine plans count toward Engine months — Programming for three months, then All Access", () => {
  const t0 = at("2026-08-01T00:00:00Z");
  const list = [
    monthlyInvoice("in_0", t0, "subscription_update", 2999, "programming"),
    monthlyInvoice("in_1", t0 + 30 * DAY, "subscription_cycle", 2999, "programming"),
    monthlyInvoice("in_2", t0 + 60 * DAY, "subscription_cycle", 2999, "programming"),
    monthlyInvoice("in_3", t0 + 90 * DAY, "subscription_cycle", 4999, "all_access"),
  ];
  const m = mergePeriods([], list, monthlySub("sub_NEW"));
  assertEquals(entitledEngineMonthsFromPeriods(m.periods, monthlySub("sub_NEW"))?.entitled, 1);
  // For Programming all four are periods of this subscription.
  assertEquals(m.subscriptionCounted, 4);
  // A price with no metadata is not known to lack the Engine: counted, as the old count did.
  const bare = list.map((i) => ({ ...i, lines: { data: [{ period: i.lines.data[0].period, price: { recurring: { interval: "month", interval_count: 1 } } }] } }));
  assertEquals(entitledEngineMonthsFromPeriods(mergePeriods([], bare, monthlySub("sub_NEW")).periods, monthlySub("sub_NEW"))?.entitled, 4);
});

Deno.test("merge: the 15-day window sees the person's periods under other subscriptions", () => {
  const start = at("2026-11-01T00:00:00Z");
  // A second subscription's plan change 5 days after a period counted under the first.
  const list = [monthlyInvoice("in_a", start - 40 * DAY, "subscription_update"), monthlyInvoice("in_b", start + 5 * DAY, "subscription_update", 500)];
  const m = mergePeriods([row("in_other", "2026-11-01T00:00:00Z")], list, monthlySub("sub_NEW"));
  assertEquals(m.subscriptionCounted, 1);
});

Deno.test("merge: the monthly-to-quarterly switch inside one subscription uses each invoice's own cadence", () => {
  const t0 = at("2026-07-01T00:00:00Z"), q = at("2026-10-01T00:00:00Z");
  const list = [
    monthlyInvoice("in_0", t0, "subscription_update"),
    monthlyInvoice("in_1", t0 + 30 * DAY),
    monthlyInvoice("in_2", t0 + 60 * DAY),
    stripeInvoice("in_q", q, "subscription_update", 7999, [line({ proration: true, interval: "month", plan: "engine" }), line({ interval: "month", count: 3, plan: "engine", start: q, end: q + 91 * DAY })], "sub_NEW"),
  ];
  const m = mergePeriods([], list, quarterlySub("sub_NEW", q));
  assertEquals(entitledEngineMonthsFromPeriods(m.periods, quarterlySub("sub_NEW", q), (q + 31 * DAY) * 1000)?.entitled, 5);
});

// ── History load ───────────────────────────────────────────────────────────

const hist = (id: string, created: number, o: Partial<HistoricalInvoice> = {}): HistoricalInvoice => ({
  id, customer_id: "cus_1", customer_email: "a@b.co", subscription_id: "sub_A", created, amount_paid: 2999,
  billing_reason: "subscription_cycle", cadence: "monthly", includes_engine: true, includes_programming: false, ...o,
});

Deno.test("history: a returner across two customer records, any order in — rows in order, four counted", () => {
  const t0 = at("2026-03-01T00:00:00Z"), back = at("2026-11-20T00:00:00Z");
  const rows = buildHistoryRows("u1", [
    hist("in_new", back, { customer_id: "cus_2", subscription_id: "sub_B", billing_reason: "subscription_update" }),
    hist("in_o3", t0 + 60 * DAY),
    hist("in_o1", t0, { billing_reason: "subscription_update" }),
    hist("in_o2", t0 + 30 * DAY),
  ]);
  assertEquals(rows.map((r) => r.stripe_invoice_id), ["in_o1", "in_o2", "in_o3", "in_new"]);
  assertEquals(rows.map((r) => r.count_reason), ["first_of_subscription", "cycle", "cycle", "first_of_subscription"]);
  assertEquals(rows.every((r) => r.source === "backfill" && r.user_id === "u1" && r.months === 1), true);
  const periods = mergePeriods(rows, [], monthlySub("sub_B")).periods;
  assertEquals(entitledEngineMonthsFromPeriods(periods, monthlySub("sub_B"))?.entitled, 4);
});

Deno.test("history: three plan changes in two days load as one counted row and two uncounted", () => {
  const t0 = at("2026-11-10T09:00:00Z");
  const rows = buildHistoryRows("u1", [
    hist("in_c", t0 + 2 * DAY, { billing_reason: "subscription_update", amount_paid: 97 }),
    hist("in_b", t0 + DAY, { billing_reason: "subscription_update", amount_paid: 2706 }),
    hist("in_a", t0, { billing_reason: "subscription_update", amount_paid: 4099 }),
  ]);
  assertEquals(rows.map((r) => [r.stripe_invoice_id, r.counts, r.months]), [["in_a", true, 1], ["in_b", false, 0], ["in_c", false, 0]]);
});

Deno.test("history: a refunded invoice keeps its row, marked; quarterly is three; a non-subscription invoice never counts", () => {
  const t0 = at("2026-03-01T00:00:00Z");
  const rows = buildHistoryRows(null, [
    hist("in_1", t0, { billing_reason: "subscription_create", cadence: "quarterly" }),
    hist("in_2", t0 + 91 * DAY, { cadence: "quarterly", refunded_at: t0 + 93 * DAY }),
    hist("in_3", t0 + 95 * DAY, { subscription_id: null, billing_reason: "manual" }),
    hist("in_1", t0, { billing_reason: "subscription_create", cadence: "quarterly" }), // listed twice in the export
  ]);
  assertEquals(rows.length, 3);
  assertEquals(rows.map((r) => [r.counts, r.months, r.refunded_at != null]), [[true, 3, false], [true, 3, true], [false, 0, false]]);
  assertEquals(rows[0].user_id, null);
  assertEquals(entitledEngineMonthsFromPeriods(mergePeriods(rows, [], null).periods, null)?.entitled, 3);
});
