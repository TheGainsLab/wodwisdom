// deno test supabase/functions/_shared/returner_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { returnerStartsFresh } from "./returner.ts";

const now = new Date("2026-11-21T12:00:00Z");

Deno.test("renewal (no returner flag) always continues, however old the last month", () => {
  assertEquals(returnerStartsFresh(null, "2026-06-01T00:00:00Z", now), false);
  assertEquals(returnerStartsFresh(undefined, "2026-06-01T00:00:00Z", now), false);
});

Deno.test("returner whose last month is older than 30 days starts a new program", () => {
  assertEquals(returnerStartsFresh("2026-11-21T10:00:00Z", "2026-08-21T01:18:00Z", now), true);
  assertEquals(returnerStartsFresh("2026-11-21T10:00:00Z", "2026-10-21T02:12:00Z", now), true); // 31 days
});

Deno.test("returner who came straight back continues where they were", () => {
  assertEquals(returnerStartsFresh("2026-11-21T10:00:00Z", "2026-11-10T00:00:00Z", now), false);
  assertEquals(returnerStartsFresh("2026-11-21T10:00:00Z", "2026-10-22T12:00:00Z", now), false); // exactly 30 days
});

Deno.test("no dated month, or an unreadable date, continues", () => {
  assertEquals(returnerStartsFresh("2026-11-21T10:00:00Z", null, now), false);
  assertEquals(returnerStartsFresh("2026-11-21T10:00:00Z", "not a date", now), false);
});
