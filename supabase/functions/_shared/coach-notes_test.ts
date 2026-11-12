// deno test supabase/functions/_shared/coach-notes_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { activeNotes, formatCoachNotes, recurringNotes, type CoachNote } from "./coach-notes.ts";

const note = (o: Partial<CoachNote> & { id: string; text: string }): CoachNote => ({
  horizon: "next_week", created_at: "2026-11-12T10:00:00Z", expires_at: null, week_num: null,
  consumed_engine_at: null, consumed_programming_at: null, ...o,
});
const now = new Date("2026-11-12T12:00:00Z");

Deno.test("a next_week note spent by the Engine is gone for the Engine, still there for Programming and the Coach", () => {
  const n = note({ id: "a", text: "more pull-ups", consumed_engine_at: "2026-11-12T11:00:00Z" });
  assertEquals(activeNotes([n], "engine", now).length, 0);
  assertEquals(activeNotes([n], "programming", now).length, 1);
  assertEquals(activeNotes([n], "coach", now).length, 1);
});

Deno.test("an until_removed note is never spent; an expired note is gone for everyone", () => {
  const standing = note({ id: "s", text: "keep running three days", horizon: "until_removed", consumed_engine_at: "2026-11-01T00:00:00Z" });
  const expired = note({ id: "e", text: "hotel gym", expires_at: "2026-11-10T00:00:00Z" });
  assertEquals(activeNotes([standing, expired], "engine", now).map((n) => n.id), ["s"]);
  assertEquals(activeNotes([standing, expired], "coach", now).map((n) => n.id), ["s"]);
});

Deno.test("format names the rule for the audience and is empty with nothing", () => {
  const out = formatCoachNotes([note({ id: "a", text: "more chest-to-bar" })], "engine");
  assertEquals(out.includes('"more chest-to-bar"'), true);
  assertEquals(out.includes("never changes the day count"), true);
  assertEquals(formatCoachNotes([], "engine"), "");
  assertEquals(formatCoachNotes([note({ id: "a", text: "x" })], "coach").includes("never claim one was applied"), true);
});

Deno.test("a note written three times on different days is recurring; the same day three times is not", () => {
  const three = [
    note({ id: "1", text: "More chest-to-bar pull-ups", created_at: "2026-10-20T10:00:00Z" }),
    note({ id: "2", text: "more chest to bar pull ups!", created_at: "2026-10-27T10:00:00Z" }),
    note({ id: "3", text: "more chest-to-bar pull-ups", created_at: "2026-11-03T10:00:00Z" }),
    note({ id: "4", text: "hotel gym", created_at: "2026-11-03T10:00:00Z" }),
  ];
  const r = recurringNotes(three);
  assertEquals(r.length, 1);
  assertEquals(r[0].times, 3);
  const sameDay = [1, 2, 3].map((i) => note({ id: String(i), text: "more rowing", created_at: "2026-11-03T10:00:00Z" }));
  assertEquals(recurringNotes(sameDay).length, 0);
});
