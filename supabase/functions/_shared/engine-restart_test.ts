// deno test supabase/functions/_shared/engine-restart_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { restartAtFor, sinceRestart } from "./engine-restart.ts";

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
