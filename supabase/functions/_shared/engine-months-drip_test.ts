// deno test supabase/functions/_shared/engine-months-drip_test.ts --no-check
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeUnlockedMonths, MONTHS_CAP, raiseEngineMonthsFromGrant } from "./engine-months-drip.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

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

// A tiny fake supabase client that records the fluent-builder calls so we can assert the
// only-raise write semantics without a real DB.
function fakeSupa(existingRowCollides: boolean) {
  const calls: { op: string; payload?: unknown; opts?: unknown; filters: Record<string, unknown> }[] = [];
  const builder = (op: string, payload?: unknown, opts?: unknown) => {
    const rec = { op, payload, opts, filters: {} as Record<string, unknown> };
    calls.push(rec);
    const chain: Any = {
      eq(col: string, v: unknown) { rec.filters["eq:" + col] = v; return chain; },
      lt(col: string, v: unknown) { rec.filters["lt:" + col] = v; return chain; },
      select() {
        // upsert(ignoreDuplicates): DO NOTHING → 0 rows if the row already exists.
        if (op === "upsert") return Promise.resolve({ data: existingRowCollides ? [] : [{ user_id: "u1" }], error: null });
        // update(.lt): 1 row raised (assume below target for the test).
        return Promise.resolve({ data: [{ user_id: "u1" }], error: null });
      },
    };
    return chain;
  };
  return {
    calls,
    from(_t: string) {
      return {
        upsert(payload: unknown, opts: unknown) { return builder("upsert", payload, opts); },
        update(payload: unknown) { return builder("update", payload); },
      };
    },
  } as Any;
}

Deno.test("raiseEngineMonthsFromGrant: insert-if-missing (DO NOTHING) + only-raise update guarded by .lt(target)", async () => {
  const supa = fakeSupa(/*existingRowCollides*/ true); // row already exists
  const res = await raiseEngineMonthsFromGrant(supa, "u1", START, plusDays(60)); // → target 3
  assertEquals(res.target, 3);
  assertEquals(res.created, false);   // upsert DO NOTHING (row existed)
  assertEquals(res.raised, true);

  const upsert = supa.calls.find((c: Any) => c.op === "upsert");
  assertEquals((upsert.opts as Any).ignoreDuplicates, true); // never overwrites/lowers an existing row
  assertEquals((upsert.payload as Any).engine_months_unlocked, 3);

  const update = supa.calls.find((c: Any) => c.op === "update");
  assertEquals(update.filters["lt:engine_months_unlocked"], 3); // ONLY-RAISE guard at the DB
  assertEquals(update.filters["eq:user_id"], "u1");
  assertEquals((update.payload as Any).engine_months_unlocked, 3);
});

Deno.test("raiseEngineMonthsFromGrant: brand-new member → created=true (seeds month 1 at grant time)", async () => {
  const supa = fakeSupa(/*existingRowCollides*/ false); // no row yet
  const res = await raiseEngineMonthsFromGrant(supa, "u1", START, START); // → target 1
  assertEquals(res.target, 1);
  assert(res.created, "a fresh seat must seed the profile row so the dashboard isn't fully locked");
});
