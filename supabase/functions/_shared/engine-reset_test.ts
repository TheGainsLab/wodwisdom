// deno test supabase/functions/_shared/engine-reset_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { overrideForSession, resetCutoff, resetEngineIfAccessEnded, sinceReset, type OverrideRecord } from "./engine-reset.ts";

const CUT = "2026-11-01T00:00:00Z";

Deno.test("resetCutoff: a real date or nothing", () => {
  assertEquals(resetCutoff(CUT), CUT);
  assertEquals(resetCutoff(null), null);
  assertEquals(resetCutoff(""), null);
  assertEquals(resetCutoff("not a date"), null);
});

Deno.test("sinceReset: sessions from before the reset do not feed pacing", () => {
  const rows = [
    { id: "old", created_at: "2026-10-20T00:00:00Z" },
    { id: "new", created_at: "2026-11-05T00:00:00Z" },
    { id: "undated", created_at: null },
  ];
  assertEquals(sinceReset(rows, CUT).map((r) => r.id), ["new"]);
  // Never reset: nothing is filtered.
  assertEquals(sinceReset(rows, null).length, 3);
});

// ── overrideForSession: what a PAST session prescribed ─────────────────────

const ov = (id: string, created: string, archived: string | null = null, pos = 21, program = "main_5day"): OverrideRecord =>
  ({ program_version: program, sequence_position: pos, engine_workout_id: id, created_at: created, archived_at: archived });
const sess = (created: string | null, pos: number | null = 21, program = "main_5day") =>
  ({ program_version: program, sequence_position: pos, created_at: created });

Deno.test("overrideForSession: an archived day still explains the session that trained it", () => {
  const archived = ov("gen-old", "2026-10-01T00:00:00Z", CUT);
  assertEquals(overrideForSession(sess("2026-10-03T00:00:00Z"), [archived])?.engine_workout_id, "gen-old");
});

Deno.test("overrideForSession: a day written later at the same position is never given to an old session", () => {
  const archived = ov("gen-old", "2026-10-01T00:00:00Z", CUT);
  const live = ov("gen-new", "2026-12-01T00:00:00Z");
  // The old session keeps the archived day; the returner's new session gets the live one.
  assertEquals(overrideForSession(sess("2026-10-03T00:00:00Z"), [live, archived])?.engine_workout_id, "gen-old");
  assertEquals(overrideForSession(sess("2026-12-05T00:00:00Z"), [live, archived])?.engine_workout_id, "gen-new");
  // A session logged on the curated day, before any sequenced day existed there: nothing.
  assertEquals(overrideForSession(sess("2026-09-01T00:00:00Z"), [live, archived]), null);
});

Deno.test("overrideForSession: a session after the reset, with no new day yet, trained the curated day", () => {
  const archived = ov("gen-old", "2026-10-01T00:00:00Z", CUT);
  assertEquals(overrideForSession(sess("2026-11-20T00:00:00Z"), [archived]), null);
});

Deno.test("overrideForSession: scoped to program and position; unreadable timestamps match nothing", () => {
  const live = ov("gen", "2026-10-01T00:00:00Z");
  assertEquals(overrideForSession(sess("2026-10-03T00:00:00Z", 22), [live]), null);
  assertEquals(overrideForSession(sess("2026-10-03T00:00:00Z", 21, "main_3day"), [live]), null);
  assertEquals(overrideForSession(sess("2026-10-03T00:00:00Z", null), [live]), null);
  assertEquals(overrideForSession(sess(null), [live]), null);
  assertEquals(overrideForSession(sess("garbage"), [live]), null);
  assertEquals(overrideForSession(sess("2026-10-03T00:00:00Z"), [ov("gen", "garbage")]), null);
});

Deno.test("overrideForSession: of several that qualify, the most recently written", () => {
  const first = ov("gen-1", "2026-08-01T00:00:00Z", "2026-12-01T00:00:00Z");
  const second = ov("gen-2", "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z");
  assertEquals(overrideForSession(sess("2026-10-03T00:00:00Z"), [first, second])?.engine_workout_id, "gen-2");
});

// ── resetEngineIfAccessEnded against a hand-rolled client ──────────────────

function fakeSupa(opts: { role?: string; engine?: boolean; entError?: boolean; rpcResult?: unknown; rpcError?: boolean; rpcThrows?: boolean }) {
  const calls: string[] = [];
  // deno-lint-ignore no-explicit-any
  const chain = (result: any) => {
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => q,
      eq: (col: string, val: unknown) => { calls.push(`eq:${col}=${val}`); return q; },
      or: () => q,
      limit: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
    };
    return q;
  };
  const supa = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      if (table === "profiles") return chain({ data: { role: opts.role ?? "user" }, error: null });
      if (table === "user_entitlements") {
        return chain(opts.entError
          ? { data: null, error: { message: "boom" } }
          : { data: opts.engine ? [{ id: "e1" }] : [], error: null });
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string) => {
      calls.push(`rpc:${name}`);
      if (opts.rpcThrows) throw new Error("network");
      return Promise.resolve(opts.rpcError ? { data: null, error: { message: "nope" } } : { data: opts.rpcResult ?? { acted: false }, error: null });
    },
  };
  // deno-lint-ignore no-explicit-any
  return { supa: supa as any, calls };
}

Deno.test("resetEngineIfAccessEnded: an athlete who still holds the Engine from any source is never reset", async () => {
  const { supa, calls } = fakeSupa({ engine: true, rpcResult: { acted: true } });
  assertEquals(await resetEngineIfAccessEnded(supa, "u1"), { reset: false, skipped: "has_engine" });
  assertEquals(calls.includes("rpc:reset_engine_for_user"), false);
  // The check is on the `engine` feature, not on the subscription the event was about.
  assertEquals(calls.includes("eq:feature=engine"), true);
  assertEquals(calls.some((c) => c.startsWith("eq:source")), false);
});

Deno.test("resetEngineIfAccessEnded: admins train without an entitlement and are never reset", async () => {
  const { supa, calls } = fakeSupa({ role: "admin", rpcResult: { acted: true } });
  assertEquals(await resetEngineIfAccessEnded(supa, "u1"), { reset: false, skipped: "admin" });
  assertEquals(calls.includes("rpc:reset_engine_for_user"), false);
});

Deno.test("resetEngineIfAccessEnded: no Engine access resets; a repeat call resets nothing", async () => {
  const first = fakeSupa({ rpcResult: { acted: true, days_archived: 3 } });
  assertEquals(await resetEngineIfAccessEnded(first.supa, "u1"), { reset: true });
  const again = fakeSupa({ rpcResult: { acted: false } });
  assertEquals(await resetEngineIfAccessEnded(again.supa, "u1"), { reset: false, skipped: "nothing_to_reset" });
});

Deno.test("resetEngineIfAccessEnded: a failed read, a failed RPC or a thrown error resets nothing and never throws", async () => {
  const badRead = fakeSupa({ entError: true, rpcResult: { acted: true } });
  assertEquals(await resetEngineIfAccessEnded(badRead.supa, "u1"), { reset: false, skipped: "lookup_failed" });
  assertEquals(badRead.calls.includes("rpc:reset_engine_for_user"), false);
  const badRpc = fakeSupa({ rpcError: true });
  assertEquals(await resetEngineIfAccessEnded(badRpc.supa, "u1"), { reset: false, skipped: "rpc_failed" });
  const thrown = fakeSupa({ rpcThrows: true });
  assertEquals(await resetEngineIfAccessEnded(thrown.supa, "u1"), { reset: false, skipped: "lookup_failed" });
  // An RPC answer in an unexpected shape is not a reset.
  const odd = fakeSupa({ rpcResult: 1 });
  assertEquals(await resetEngineIfAccessEnded(odd.supa, "u1"), { reset: false, skipped: "nothing_to_reset" });
});
