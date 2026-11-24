// deno test supabase/functions/_shared/coach-logging-facts_test.ts --no-check --allow-read
//
// The coach's standing facts about correcting a logged session must match
// what the app allows (2026-11-24): it told members that program sessions
// could not be edited and to email a human, when the app has two edit paths.
import { assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));

Deno.test("the coach no longer says program sessions cannot be edited", async () => {
  const chat = await read("../chat/index.ts");
  assertNotMatch(chat, /Program\/Engine session records can NOT be edited or deleted/);
  assertMatch(chat, /AI PROGRAMMING sessions CAN be edited by the athlete/);
  assertMatch(chat, /ENGINE sessions can NOT be edited or deleted in the app/);
});

Deno.test("the edit paths the coach names exist in the app", async () => {
  // "Edit log" on a block of the day page.
  assertMatch(await read("../../../src/pages/ProgramDetailPage.tsx"), /fullyLogged \? 'Edit log' : 'Log'/);
  const log = await read("../../../src/pages/TrainingLogPage.tsx");
  // "Edit" on a session in the Training Log, and deleting one entry.
  assertMatch(log, /navigate\('\/workout\/start', \{ state: \{ edit_log_id: log\.id \} \}\)/);
  assertMatch(log, /body: \{ entry_id: entryId, delete: true \}/);
  // The Engine RPE correction.
  assertMatch(log, /update\(\{ perceived_exertion: rpeDraft \}\)/);
});
