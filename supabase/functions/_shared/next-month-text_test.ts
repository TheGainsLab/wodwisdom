// deno test supabase/functions/_shared/next-month-text_test.ts --no-check --allow-read
import { assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { nextMonthLine, NEXT_MONTH_MONTHLY, NEXT_MONTH_QUARTERLY } from "./next-month-text.ts";

Deno.test("a monthly member is told the next month comes at renewal", () => {
  assertEquals(nextMonthLine("monthly"), NEXT_MONTH_MONTHLY);
  assertMatch(NEXT_MONTH_MONTHLY, /renews/);
});

Deno.test("a quarterly member is NOT told to wait for renewal: every 30 days within the quarter", () => {
  const t = nextMonthLine("quarterly");
  assertEquals(t, NEXT_MONTH_QUARTERLY);
  assertMatch(t, /do NOT wait for renewal/);
  assertMatch(t, /every 30 days/);
});

Deno.test("an unknown cadence adds no line, so nothing is asserted about this athlete", () => {
  for (const c of [null, undefined, "", "annual"]) assertEquals(nextMonthLine(c), "");
});

Deno.test("the coach's standing instructions give both rules and no longer one rule for everyone", async () => {
  const chat = await Deno.readTextFile(new URL("../chat/index.ts", import.meta.url));
  assertNotMatch(chat, /The NEXT MONTH is built when the subscription RENEWS — one month per paid period — NOT/);
  assertMatch(chat, /QUARTERLY/);
  assertMatch(chat, /nextMonthLine\(/);
});
