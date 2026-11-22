// deno test supabase/functions/_shared/engine-entitlement_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  entitledEngineMonths, ENGINE_MONTHS_CAP, lastUnlockIso, subscriptionCadence,
} from "./engine-entitlement.ts";

const DAY = 86_400_000;

// The two tests that stood here pinned the old label rule (billsNewPeriod /
// countPaidPeriods: "a paid subscription_update is always a new period").
// That rule was replaced on 2026-11-22; its tests, with the same invoice
// shapes, are in paid-periods_test.ts.

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
