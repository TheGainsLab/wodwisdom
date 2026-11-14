// deno test supabase/functions/_shared/weekly-fill_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { builtFromOf, nextWeekToFill, profileDrift } from "./weekly-fill.ts";

const five = () => 5;

Deno.test("week 2 fills once week 1's last day is logged, even with earlier days skipped", () => {
  assertEquals(nextWeekToFill([2, 3, 4], [{ week: 1, day: 1 }, { week: 1, day: 5 }], five), 2);
});

Deno.test("not due while week 1's last day is unlogged", () => {
  assertEquals(nextWeekToFill([2, 3, 4], [{ week: 1, day: 1 }, { week: 1, day: 4 }], five), null);
});

Deno.test("logged past the week counts as the gate", () => {
  assertEquals(nextWeekToFill([3, 4], [{ week: 2, day: 2 }, { week: 2, day: 3 }], five), null);
  assertEquals(nextWeekToFill([3, 4], [{ week: 2, day: 5 }], five), 3);
});

Deno.test("nothing outline → nothing due", () => {
  assertEquals(nextWeekToFill([], [{ week: 4, day: 5 }], five), null);
});

Deno.test("profile drift: nothing changed → nothing to re-plan", () => {
  const b = builtFromOf({ days_per_week: 5, goal_text: " Get stronger ", session_length_minutes: 60 });
  assertEquals(profileDrift(b, builtFromOf({ days_per_week: 5, goal_text: "Get stronger", session_length_minutes: 60 })), []);
});

Deno.test("profile drift: days first, then goal, then session length", () => {
  const b = builtFromOf({ days_per_week: 5, goal_text: "Stay in shape", session_length_minutes: null });
  assertEquals(
    profileDrift(b, builtFromOf({ days_per_week: 3, goal_text: "Open prep", session_length_minutes: 75 })),
    [
      "training days per week changed from 5 to 3",
      'goal changed from "Stay in shape" to "Open prep"',
      "session length changed from unset to 75 minutes",
    ],
  );
});

Deno.test("profile drift: no stored built_from (older months) → never re-plans on profile", () => {
  assertEquals(profileDrift(null, builtFromOf({ days_per_week: 3, goal_text: null })), []);
});
