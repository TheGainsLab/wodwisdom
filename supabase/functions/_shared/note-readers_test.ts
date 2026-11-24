// deno test supabase/functions/_shared/note-readers_test.ts --no-check --allow-read
import { assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ENGINE_FIXED_ORDER, ENGINE_READS, NOTHING_READS_YET, noteReadBy, noteReadByLines, PROGRAMMING_READS } from "./note-readers.ts";

Deno.test("an Engine member on the fixed order is never told the Engine will read their note", () => {
  const t = noteReadBy({ hasProgramming: false, hasEngine: true, aiSequencing: false });
  assertEquals(t, ENGINE_FIXED_ORDER);
  assertNotMatch(t, /reads it/);
  assertMatch(t, /AI Sequencing in Settings/);
});

Deno.test("with AI Sequencing on, the Engine reads it at the next block, from month two", () => {
  const t = noteReadBy({ hasProgramming: false, hasEngine: true, aiSequencing: true });
  assertEquals(t, ENGINE_READS);
  assertMatch(t, /second month/);
  assertNotMatch(t, /within days/);
});

Deno.test("a Programming member is told about the next week; All Access gets both, each true for them", () => {
  assertEquals(noteReadByLines({ hasProgramming: true, hasEngine: false, aiSequencing: false }), [PROGRAMMING_READS]);
  assertEquals(noteReadByLines({ hasProgramming: true, hasEngine: true, aiSequencing: false }), [PROGRAMMING_READS, ENGINE_FIXED_ORDER]);
  assertEquals(noteReadByLines({ hasProgramming: true, hasEngine: true, aiSequencing: true }), [PROGRAMMING_READS, ENGINE_READS]);
});

Deno.test("a member with neither product is not promised anything reads it now", () => {
  assertEquals(noteReadBy({ hasProgramming: false, hasEngine: false, aiSequencing: true }), NOTHING_READS_YET);
});

Deno.test("the coach's instructions no longer promise the Engine reads every note", async () => {
  const notes = await Deno.readTextFile(new URL("./coach-notes.ts", import.meta.url));
  const chat = await Deno.readTextFile(new URL("../chat/index.ts", import.meta.url));
  assertNotMatch(notes, /read before every Engine block/);
  assertNotMatch(chat, /read before the Engine's next block \(within days\)/);
  assertMatch(chat, /noteReadBy\(/);
});
