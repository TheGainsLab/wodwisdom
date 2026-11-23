// deno test supabase/functions/_shared/programming-months_test.ts --no-check --allow-env
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type CountedPeriod, entitledProgrammingMonths } from "./paid-periods.ts";

const DAY = 86_400;
const T0 = Date.UTC(2026, 9, 21) / 1000; // Oct 21 2026, the first payment
const at = (days: number) => (T0 + days * DAY) * 1000;
const monthlySub = (id = "sub_A") => ({ id, items: { data: [{ price: { recurring: { interval: "month", interval_count: 1 } } }] }, current_period_start: null });
const quarterlySub = (id: string, startSec: number) => ({ id, items: { data: [{ price: { recurring: { interval: "month", interval_count: 3 } } }] }, current_period_start: startSec });
const period = (o: Partial<CountedPeriod> & { started: number }): CountedPeriod => ({
  invoice_id: `in_${o.started}`, subscription_id: "sub_A", cadence: "monthly", months: 1, counts: true, refunded: false,
  includes_engine: false, includes_programming: true, ...o,
});
const owed = (p: CountedPeriod[], sub: unknown, nowMs: number) => entitledProgrammingMonths(p, sub as never, nowMs)?.entitled;

// THE REAL CASE: one month paid Oct 21, switched to quarterly Nov 16 on the same subscription.
const SWITCH = T0 + 26 * DAY;
const salvatore = [
  period({ started: T0 }),
  period({ started: SWITCH, cadence: "quarterly", months: 3 }),
];

Deno.test("a month paid before switching to quarterly is ONE month: 2 owed at the switch, not 4", () => {
  assertEquals(owed(salvatore, quarterlySub("sub_A", SWITCH), at(26)), 2);
  assertEquals(owed(salvatore, quarterlySub("sub_A", SWITCH), at(28)), 2); // two days later: still 2 (he was built 3 and 4 here)
});

Deno.test("the quarter's months are released one a month: 3 at day 30, 4 at day 60, never more", () => {
  const sub = quarterlySub("sub_A", SWITCH);
  assertEquals(owed(salvatore, sub, at(26 + 29)), 2);
  assertEquals(owed(salvatore, sub, at(26 + 30)), 3);
  assertEquals(owed(salvatore, sub, at(26 + 60)), 4);
  assertEquals(owed(salvatore, sub, at(26 + 89)), 4);
});

Deno.test("plain monthly: one month per paid period", () => {
  const p = [0, 30, 60].map((d) => period({ started: T0 + d * DAY }));
  assertEquals(owed(p, monthlySub(), at(61)), 3);
});

Deno.test("plain quarterly gives exactly what the old formula gave", () => {
  const q1 = period({ started: T0, cadence: "quarterly", months: 3 });
  const q2 = period({ started: T0 + 90 * DAY, cadence: "quarterly", months: 3 });
  assertEquals(owed([q1], quarterlySub("sub_A", T0), at(0)), 1);
  assertEquals(owed([q1], quarterlySub("sub_A", T0), at(45)), 2);
  assertEquals(owed([q1, q2], quarterlySub("sub_A", T0 + 90 * DAY), at(91)), 4); // (2 − 1) × 3 + 1
  assertEquals(owed([q1, q2], quarterlySub("sub_A", T0 + 90 * DAY), at(151)), 6);
});

Deno.test("switching the other way: a finished quarter stays three months once the member is monthly", () => {
  const p = [period({ started: T0, cadence: "quarterly", months: 3 }), period({ started: T0 + 90 * DAY })];
  assertEquals(owed(p, monthlySub(), at(91)), 4); // the old monthly branch said 2
});

Deno.test("a refunded period is not owed; a period that does not count is not owed; another subscription's periods are not this one's", () => {
  const p = [
    period({ started: T0 }),
    period({ started: T0 + 30 * DAY, refunded: true }),
    period({ started: T0 + 35 * DAY, counts: false, months: 0 }),
    period({ started: T0 - 200 * DAY, subscription_id: "sub_OLD" }),
  ];
  assertEquals(owed(p, monthlySub(), at(40)), 1);
});

Deno.test("a quarter in progress with no period start cannot be worked out: build nothing", () => {
  assertEquals(entitledProgrammingMonths(salvatore, quarterlySub("sub_A", NaN) as never, at(30)), null);
});

Deno.test("no subscription: nothing owed", () => {
  assertEquals(owed(salvatore, null, at(30)), 0);
});
