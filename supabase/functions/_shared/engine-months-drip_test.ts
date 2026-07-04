// deno test supabase/functions/_shared/engine-months-drip_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeUnlockedMonths, MONTHS_CAP } from "./engine-months-drip.ts";

const START = "2026-07-04T00:00:00.000Z";
const plusDays = (d: number) => new Date(Date.parse(START) + d * 86_400_000).toISOString();

Deno.test("computeUnlockedMonths: 1 at activation, +1 per 30 days, only counts full months", () => {
  assertEquals(computeUnlockedMonths(START, START), 1);          // day 0 → month 1
  assertEquals(computeUnlockedMonths(START, plusDays(29)), 1);   // 29 days → still month 1
  assertEquals(computeUnlockedMonths(START, plusDays(30)), 2);   // 30 days → month 2
  assertEquals(computeUnlockedMonths(START, plusDays(59)), 2);   // 59 days → month 2
  assertEquals(computeUnlockedMonths(START, plusDays(60)), 3);   // 60 days → month 3
});

Deno.test("computeUnlockedMonths: caps at MONTHS_CAP (36)", () => {
  assertEquals(computeUnlockedMonths(START, plusDays(35 * 30)), MONTHS_CAP);   // month 36
  assertEquals(computeUnlockedMonths(START, plusDays(100 * 30)), MONTHS_CAP);  // way past → still 36
});

Deno.test("computeUnlockedMonths: never below 1; future/garbage timestamps clamp to 1", () => {
  assertEquals(computeUnlockedMonths(plusDays(10), START), 1);   // grant in the future → 1
  assertEquals(computeUnlockedMonths("not-a-date", START), 1);
  assertEquals(computeUnlockedMonths(START, "not-a-date"), 1);
});
