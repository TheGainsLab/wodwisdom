// deno test supabase/functions/_shared/goal-text_test.ts --no-check --allow-read
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GOAL_MAX_CHARS, goalForPrompt } from "./goal-text.ts";

Deno.test("a goal under the cap is read whole", () => {
  const goal = "Get strong. ".repeat(100) + "Nov 2026: hold 5 sets of strict HSPU";
  assert(goal.length > 500 && goal.length < GOAL_MAX_CHARS);
  assertEquals(goalForPrompt(`  ${goal}  `), goal);
  assertEquals(goalForPrompt(null), "");
});

Deno.test("over the cap, the START is cut and the newest text survives", () => {
  const goal = "OLDEST " + "x".repeat(GOAL_MAX_CHARS) + " NEWEST ADDITION";
  const read = goalForPrompt(goal);
  assert(read.endsWith("NEWEST ADDITION"));
  assert(!read.includes("OLDEST"));
  assert(read.length <= GOAL_MAX_CHARS + 1);
});

Deno.test("the Engine sequencer reads the goal through goalForPrompt, not a 500-character slice", () => {
  const src = Deno.readTextFileSync(new URL("./run-resequence.ts", import.meta.url));
  assert(src.includes("goalForPrompt(prof.engine_goal)"));
  assert(!/engine_goal\.trim\(\)\.slice\(0,/.test(src));
});
