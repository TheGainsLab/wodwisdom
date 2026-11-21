// deno test supabase/functions/_shared/program-archive_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  archiveCutoff,
  archiveProgramsIfAccessEnded,
  isArchived,
  isSinceArchive,
  returnerStillHasTheButton,
  sinceArchive,
  withoutArchivedDays,
} from "./program-archive.ts";

const CUT = "2026-11-01T00:00:00Z";

Deno.test("isArchived: only a stamped program", () => {
  assertEquals(isArchived({ archived_at: CUT }), true);
  assertEquals(isArchived({ archived_at: null }), false);
  assertEquals(isArchived({}), false);
  assertEquals(isArchived(null), false);
});

Deno.test("archiveCutoff: a real date or nothing", () => {
  assertEquals(archiveCutoff(CUT), CUT);
  assertEquals(archiveCutoff(null), null);
  assertEquals(archiveCutoff(""), null);
  assertEquals(archiveCutoff("not a date"), null);
});

Deno.test("sinceArchive: an evaluation from before the archive does not count", () => {
  const evals = [
    { id: "old", created_at: "2026-08-01T10:00:00Z" },
    { id: "fresh", created_at: "2026-11-02T10:00:00Z" },
    { id: "undated", created_at: null },
  ];
  assertEquals(sinceArchive(evals, CUT).map((e) => e.id), ["fresh"]);
  assertEquals(isSinceArchive("2026-11-01T00:00:00Z", CUT), false); // the archive moment itself is not "after"
});

Deno.test("sinceArchive: never archived keeps everything", () => {
  const rows = [{ created_at: "2026-08-01T10:00:00Z" }, { created_at: null }];
  assertEquals(sinceArchive(rows, null).length, 2);
  assertEquals(isSinceArchive(null, null), true);
});

Deno.test("withoutArchivedDays: archived program training is hidden, every other log is kept", () => {
  const logs = [
    { id: "archived-program-day", source_id: "day-old" },
    { id: "manual", source_id: null },
    { id: "new-program-day", source_id: "day-new" },
  ];
  assertEquals(withoutArchivedDays(logs, new Set(["day-old"])).map((l) => l.id), ["manual", "new-program-day"]);
  assertEquals(withoutArchivedDays(logs, new Set()).length, 3);
});

Deno.test("returnerStillHasTheButton: seven days from the subscription start, then the reconciler builds", () => {
  const start = Date.parse("2026-11-10T00:00:00Z");
  assertEquals(returnerStillHasTheButton(start, start + 1 * 86400_000), true);
  assertEquals(returnerStillHasTheButton(start, start + 6.9 * 86400_000), true);
  assertEquals(returnerStillHasTheButton(start, start + 7 * 86400_000), false);
  // No start date to judge by: wait, never build blind.
  assertEquals(returnerStillHasTheButton(null, start), true);
});

// ── archiveProgramsIfAccessEnded against a hand-rolled client ──────────────

function fakeSupa(opts: { role?: string; programming?: boolean; entError?: boolean; rpcResult?: number; rpcError?: boolean }) {
  const calls: string[] = [];
  // deno-lint-ignore no-explicit-any
  const chain = (result: any) => {
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => q, eq: () => q, or: () => q,
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
          : { data: opts.programming ? [{ id: "e1" }] : [], error: null });
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string) => {
      calls.push(`rpc:${name}`);
      return Promise.resolve(opts.rpcError ? { data: null, error: { message: "nope" } } : { data: opts.rpcResult ?? 0, error: null });
    },
  };
  // deno-lint-ignore no-explicit-any
  return { supa: supa as any, calls };
}

Deno.test("archiveProgramsIfAccessEnded: an athlete who still holds Programming is never archived", async () => {
  const { supa, calls } = fakeSupa({ programming: true, rpcResult: 1 });
  assertEquals(await archiveProgramsIfAccessEnded(supa, "u1"), { archived: 0, skipped: "has_programming" });
  assertEquals(calls.includes("rpc:archive_user_programs"), false);
});

Deno.test("archiveProgramsIfAccessEnded: admins train without an entitlement and are never archived", async () => {
  const { supa, calls } = fakeSupa({ role: "admin", rpcResult: 1 });
  assertEquals(await archiveProgramsIfAccessEnded(supa, "u1"), { archived: 0, skipped: "admin" });
  assertEquals(calls.includes("rpc:archive_user_programs"), false);
});

Deno.test("archiveProgramsIfAccessEnded: no Programming access archives; a repeat call archives nothing", async () => {
  const first = fakeSupa({ rpcResult: 2 });
  assertEquals(await archiveProgramsIfAccessEnded(first.supa, "u1"), { archived: 2 });
  const again = fakeSupa({ rpcResult: 0 });
  assertEquals(await archiveProgramsIfAccessEnded(again.supa, "u1"), { archived: 0, skipped: "nothing_to_archive" });
});

Deno.test("archiveProgramsIfAccessEnded: a failed read or a failed RPC archives nothing and never throws", async () => {
  const badRead = fakeSupa({ entError: true, rpcResult: 1 });
  assertEquals(await archiveProgramsIfAccessEnded(badRead.supa, "u1"), { archived: 0, skipped: "lookup_failed" });
  assertEquals(badRead.calls.includes("rpc:archive_user_programs"), false);
  const badRpc = fakeSupa({ rpcError: true });
  assertEquals(await archiveProgramsIfAccessEnded(badRpc.supa, "u1"), { archived: 0, skipped: "rpc_failed" });
});
