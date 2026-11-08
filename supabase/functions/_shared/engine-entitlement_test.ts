// deno test supabase/functions/_shared/engine-entitlement_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  billsNewPeriod, countPaidPeriods, entitledEngineMonths, ENGINE_MONTHS_CAP, lastUnlockIso, subscriptionCadence,
} from "./engine-entitlement.ts";

const DAY = 86_400_000;

Deno.test("billsNewPeriod: create and cycle always count; update only when it charged money", () => {
  assertEquals(billsNewPeriod({ billing_reason: "subscription_create", amount_paid: 4499 }), true);
  assertEquals(billsNewPeriod({ billing_reason: "subscription_cycle", amount_paid: 4499 }), true);
  // The first invoice of a Checkout subscription — the 2026-11-08 incident shape.
  assertEquals(billsNewPeriod({ billing_reason: "subscription_update", amount_paid: 4499 }), true);
  // A €0 plan flip paid by proration credit is NOT a new period.
  assertEquals(billsNewPeriod({ billing_reason: "subscription_update", amount_paid: 0 }), false);
  assertEquals(billsNewPeriod({ billing_reason: "manual", amount_paid: 999 }), false);
  assertEquals(billsNewPeriod({}), false);
});

Deno.test("countPaidPeriods ignores non-period invoices", () => {
  assertEquals(countPaidPeriods([
    { billing_reason: "subscription_update", amount_paid: 4499 },
    { billing_reason: "subscription_cycle", amount_paid: 4499 },
    { billing_reason: "subscription_update", amount_paid: 0 },
  ]), 2);
  assertEquals(countPaidPeriods([]), 0);
});

Deno.test("subscriptionCadence", () => {
  const mk = (interval: string, interval_count: number) => ({ items: { data: [{ price: { recurring: { interval, interval_count } } }] } });
  assertEquals(subscriptionCadence(mk("month", 1)), "monthly");
  assertEquals(subscriptionCadence(mk("month", 3)), "quarterly");
  assertEquals(subscriptionCadence(mk("quarter", 1)), "quarterly");
  assertEquals(subscriptionCadence(mk("year", 1)), null);
  assertEquals(subscriptionCadence({}), null);
});

Deno.test("monthly: entitled = paid periods, order-independent, capped", () => {
  // Emma: one paid invoice → exactly 1, however many events raced.
  assertEquals(entitledEngineMonths("monthly", 1, null)?.entitled, 1);
  assertEquals(entitledEngineMonths("monthly", 3, null)?.entitled, 3);
  assertEquals(entitledEngineMonths("monthly", 50, null)?.entitled, ENGINE_MONTHS_CAP);
  assertEquals(entitledEngineMonths("monthly", 0, null), null);
});

Deno.test("quarterly: 3 per completed period plus a 30-day drip through the current one", () => {
  const start = Date.parse("2026-10-17T00:00:00Z") / 1000;
  const at = (days: number) => start * 1000 + days * DAY;
  assertEquals(entitledEngineMonths("quarterly", 1, start, at(0))?.entitled, 1);
  assertEquals(entitledEngineMonths("quarterly", 1, start, at(29))?.entitled, 1);
  assertEquals(entitledEngineMonths("quarterly", 1, start, at(30))?.entitled, 2);
  assertEquals(entitledEngineMonths("quarterly", 1, start, at(60))?.entitled, 3);
  assertEquals(entitledEngineMonths("quarterly", 1, start, at(200))?.entitled, 3); // drip never exceeds the period
  assertEquals(entitledEngineMonths("quarterly", 2, start, at(0))?.entitled, 4);
  assertEquals(entitledEngineMonths("quarterly", 1, null, at(0)), null); // cannot compute → caller writes nothing
});

Deno.test("lastUnlockIso anchors quarterly to the period, monthly to now", () => {
  const start = Date.parse("2026-10-17T00:00:00Z") / 1000;
  assertEquals(lastUnlockIso("quarterly", start, 2, 0), "2026-11-16T00:00:00.000Z");
  assertEquals(lastUnlockIso("monthly", start, 1, Date.parse("2026-11-08T12:00:00Z")), "2026-11-08T12:00:00.000Z");
});
