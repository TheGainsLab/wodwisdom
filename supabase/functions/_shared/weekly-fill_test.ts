// deno test supabase/functions/_shared/weekly-fill_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { builtFromOf, nextWeekToFill, profileDrift, weeksToCarryForward } from "./weekly-fill.ts";

const five = () => 5;
const three = () => 3;
const built = "2026-11-14T12:00:00Z";
const daysLater = (d: number) => new Date(Date.parse(built) + d * 24 * 60 * 60 * 1000);
const w1 = (...days: number[]) => days.map((day) => ({ week: 1, day }));

Deno.test("week 2 fills once every day of week 1 was trained", () => {
  assertEquals(nextWeekToFill([2, 3, 4], w1(1, 2, 3, 4, 5), five, built, daysLater(3)), { week: 2, reason: "trained" });
  assertEquals(nextWeekToFill([2, 3, 4], w1(1, 2, 3), three, built, daysLater(2)), { week: 2, reason: "trained" });
});

Deno.test("not due while a day of week 1 is unlogged and the clock has not run", () => {
  assertEquals(nextWeekToFill([2, 3, 4], w1(1, 3, 4, 5), five, built, daysLater(3)), null);
  // the last day alone no longer opens the week
  assertEquals(nextWeekToFill([2, 3, 4], w1(5), five, built, daysLater(3)), null);
});

Deno.test("clock: week 2 at day 7, week 3 at day 14, week 4 at day 21, whatever was logged", () => {
  assertEquals(nextWeekToFill([2, 3, 4], [], five, built, daysLater(6.9)), null);
  assertEquals(nextWeekToFill([2, 3, 4], [], five, built, daysLater(7)), { week: 2, reason: "clock" });
  assertEquals(nextWeekToFill([3, 4], [], five, built, daysLater(13.9)), null);
  assertEquals(nextWeekToFill([3, 4], [], five, built, daysLater(14)), { week: 3, reason: "clock" });
  assertEquals(nextWeekToFill([4], [], five, built, daysLater(21)), { week: 4, reason: "clock" });
});

Deno.test("clock is the floor: a trained week comes forward, the next clock date is unchanged", () => {
  // week 2 was written on day 3 (trained); week 3 waits for day 14 unless week 2 is trained
  assertEquals(nextWeekToFill([3, 4], w1(1, 2, 3, 4, 5), five, built, daysLater(9)), null);
  assertEquals(nextWeekToFill([3, 4], [...w1(1, 2, 3, 4, 5), ...[1, 2, 3, 4, 5].map((day) => ({ week: 2, day }))], five, built, daysLater(9)), { week: 3, reason: "trained" });
});

Deno.test("no month start known → trained gate only", () => {
  assertEquals(nextWeekToFill([2, 3, 4], [], five, null, daysLater(30)), null);
  assertEquals(nextWeekToFill([2, 3, 4], w1(1, 2, 3, 4, 5), five, null, daysLater(1)), { week: 2, reason: "trained" });
});

Deno.test("nothing outline → nothing due", () => {
  assertEquals(nextWeekToFill([], [{ week: 4, day: 5 }], five, built, daysLater(40)), null);
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

// A week job must hand on only the week it wrote. Handing on the earlier weeks
// too made the save insert them again (week 1 listed twice, 2026-11-21).
Deno.test("week job: only the week just written goes on to the save", () => {
  const w1 = { week_num: 1 }, w2 = { week_num: 2 }, w3 = { week_num: 3 };
  assertEquals(weeksToCarryForward(true, [w1], w2), [w2]);
  assertEquals(weeksToCarryForward(true, [w1, w2], w3), [w3]);
});

Deno.test("month build: weeks accumulate as before", () => {
  const w1 = { week_num: 1 }, w2 = { week_num: 2 };
  assertEquals(weeksToCarryForward(false, [], w1), [w1]);
  assertEquals(weeksToCarryForward(false, [w1], w2), [w1, w2]);
});
