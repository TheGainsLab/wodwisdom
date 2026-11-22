// deno test supabase/functions/_shared/engine-restart_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isCurrentPassSession, restartAtFor, sinceRestart } from "./engine-restart.ts";

Deno.test("restartAtFor: the program's own stamp, nothing else", () => {
  const restarts = { main_5day: "2026-11-01T00:00:00Z", hyrox_3day: "" };
  assertEquals(restartAtFor(restarts, "main_5day"), "2026-11-01T00:00:00Z");
  assertEquals(restartAtFor(restarts, "main_3day"), null);
  assertEquals(restartAtFor(restarts, "hyrox_3day"), null);
  assertEquals(restartAtFor(null, "main_5day"), null);
  assertEquals(restartAtFor({ main_5day: "not a date" }, "main_5day"), null);
});

Deno.test("sinceRestart: sessions from before the restart do not count as progress", () => {
  const rows = [
    { created_at: "2026-08-01T10:00:00Z", sequence_position: 60 },
    { created_at: "2026-11-02T10:00:00Z", sequence_position: 1 },
  ];
  assertEquals(sinceRestart(rows, "2026-11-01T00:00:00Z").map((r) => r.sequence_position), [1]);
});

Deno.test("sinceRestart: never restarted keeps everything", () => {
  const rows = [{ created_at: "2026-08-01T10:00:00Z" }, { created_at: null }];
  assertEquals(sinceRestart(rows, null).length, 2);
});

Deno.test("isCurrentPassSession: only the chosen program, only since its last restart", () => {
  const RESTART = "2026-11-01T00:00:00Z";
  const before = { program_version: "main_5day", created_at: "2026-10-20T00:00:00Z" };
  const after = { program_version: "main_5day", created_at: "2026-11-05T00:00:00Z" };
  assertEquals(isCurrentPassSession(after, "main_5day", RESTART), true);
  assertEquals(isCurrentPassSession(before, "main_5day", RESTART), false);
  // Never restarted: every session of the program is the current pass.
  assertEquals(isCurrentPassSession(before, "main_5day", null), true);
  // Another program's session never opens a day of this one.
  assertEquals(isCurrentPassSession(after, "main_3day", RESTART), false);
  assertEquals(isCurrentPassSession({ program_version: null, created_at: after.created_at }, "main_5day", null), false);
});

Deno.test("isCurrentPassSession: no program chosen (Engine reset) — no session has a day to open", () => {
  const s = { program_version: "main_5day", created_at: "2026-11-05T00:00:00Z" };
  assertEquals(isCurrentPassSession(s, null, null), false);
  assertEquals(isCurrentPassSession(s, undefined, "2026-11-01T00:00:00Z"), false);
  assertEquals(isCurrentPassSession(s, "", null), false);
});
