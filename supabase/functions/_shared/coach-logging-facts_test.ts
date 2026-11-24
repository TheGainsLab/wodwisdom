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

// ── More standing facts checked against the app (2026-11-24) ────────────────

Deno.test("billing: the coach sends members to the self-service buttons that exist in Settings", async () => {
  const chat = await read("../chat/index.ts");
  const settings = await read("../../../src/pages/SettingsPage.tsx");
  for (const name of ["Manage Billing", "Upgrade Plan"]) {
    assertMatch(chat, new RegExp(`'${name}'`));
    assertMatch(settings, new RegExp(name));
  }
});

Deno.test("outside activities: the coach uses the names the app shows", async () => {
  const chat = await read("../chat/index.ts");
  assertMatch(await read("../../../src/components/Nav.tsx"), />Add External\s*$/m);
  assertMatch(await read("../../../src/pages/TrainingLogPage.tsx"), /Add External Activity/);
  assertMatch(chat, /'Add External' in the sidebar, and 'Add External Activity'/);
  // "Log Activity" survives only inside the sentence that says the app does not use it.
  assertNotMatch(chat.replace("the app does NOT say 'Log Activity'", ""), /Log Activity/);
  assertNotMatch(chat, /considered when the NEXT month generates/);
});

Deno.test("nothing is called unlimited: the daily cap is stated from the real number", async () => {
  const chat = await read("../chat/index.ts");
  assertNotMatch(chat, /proposals are unlimited|edits are unlimited/);
  assertMatch(chat, /DAILY MESSAGE CAP of " \+ DAILY_LIMIT \+ " across all chats/);
  assertMatch(chat, /const DAILY_LIMIT = \d+;/);
});

Deno.test("the Switch Program screen is described as the app shows it", async () => {
  const chat = await read("../chat/index.ts");
  assertMatch(chat, /GEAR icon at the top right of the Engine dashboard/);
  assertMatch(await read("../../../src/pages/EngineDashboardPage.tsx"), /title="Program settings"[\s\S]{0,40}<Settings size=\{20\}/);
  const screen = await read("../../../src/components/engine/ProgramSelection.tsx");
  assertMatch(screen, /sequencing \? 'Days per week' : isSwitching \? 'Switch Program'/);
  assertMatch(screen, /Restart current program from Day 1/);
});

Deno.test("the human-coach message limit the coach states is the server's", async () => {
  const chat = await read("../chat/index.ts");
  assertMatch(chat, /TWO such messages per 24 hours/);
  assertMatch(await read("../contact-coach/index.ts"), /2 DELIVERED sends per rolling 24h/);
});

// ── The plan rule and the coach's identity (founder, 2026-11-24) ────────────

Deno.test("one rule about the plan: the three conflicting instructions are gone", async () => {
  const chat = await read("../chat/index.ts");
  assertNotMatch(chat, /Hold your position: never reverse a recommendation/);
  assertNotMatch(chat, /Do not defend the plan against the athlete/);
  assertMatch(chat, /THE PROGRAM STANDS UNLESS THE ATHLETE CHANGES IT/);
  assertMatch(chat, /A QUESTION IS NOT A REQUEST/);
  assertMatch(chat, /IF THEY SAY THEY WANT THE CHANGE, MAKE IT/);
  assertMatch(chat, /NO NEGOTIATION/);
  assertMatch(chat, /A NUMBER ONCE QUOTED STAYS/);
});

Deno.test("the coach is not told to give its opinion of an alternative", async () => {
  const chat = await read("../chat/index.ts");
  assertMatch(chat, /Do not offer your opinion of an alternative/);
});

Deno.test("the plan block still says to explain the plan, which the rule relies on", async () => {
  const state = await read("./coach-state.ts");
  assertMatch(state, /never re-litigate the coach's priorities or deprioritizations — explain them instead/);
});

Deno.test("asked sincerely, the coach says it is the AI Coach", async () => {
  const chat = await read("../chat/index.ts");
  assertNotMatch(chat, /Never describe yourself as an AI\./);
  assertMatch(chat, /you are the AI Coach, and a human coach is available through the Message a human coach button/);
  assertMatch(chat, /Never deny being an AI, never dodge the question, never imply you are a person/);
});
