// deno test supabase/functions/_shared/weekly-cron-plan_test.ts --no-check --allow-env
//
// The weekly job's picking (2026-11-23): every month with unwritten weeks,
// oldest first; programs in turn; a failing month backs off.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  builtFromForWeekSave,
  failStreakOf,
  fillBackoffMs,
  fillRetryAt,
  loadMonthFillStates,
  type MonthFillState,
  noteIdsToConsume,
  orderForKicks,
  pickMonthToFill,
  REPLAN_SYSTEM,
} from "./weekly-fill.ts";
import { memorySupa } from "./fixtures/memory-supa.ts";

const H = 60 * 60 * 1000;
const DAY = 24 * H;
const T0 = Date.parse("2026-11-01T00:00:00Z");
const at = (ms: number) => new Date(T0 + ms);
const iso = (ms: number) => at(ms).toISOString();

function month(month: number, over: Partial<MonthFillState> = {}): MonthFillState {
  return {
    month, outlineWeeks: [2, 3, 4], loggedDays: [], daysInWeek: () => 3, startedAt: iso(0),
    lastFillError: null, lastFillAttemptAt: null, failStreak: 0, lastFailedAt: null, ...over,
  };
}
const week1Trained = [1, 2, 3].map((day) => ({ week: 1, day }));

// ── Fix: every month with unwritten weeks, oldest first ─────────────────────

Deno.test("an older month's unwritten week is written before the newest month's", () => {
  // Month 1 still has week 4 as an outline; month 2 was built since and is waiting on week 2.
  const pick = pickMonthToFill([
    month(2, { startedAt: iso(30 * DAY) }),
    month(1, { outlineWeeks: [4] }),
  ], at(38 * DAY));
  assertEquals(pick, { action: "fill", month: 1, week: 4, reason: "clock", lastFillAttemptAt: null });
});

Deno.test("only one week per program per tick, even when two months are due", () => {
  const pick = pickMonthToFill([month(1, { outlineWeeks: [3, 4] }), month(2, { startedAt: iso(30 * DAY) })], at(60 * DAY));
  assertEquals(pick.action === "fill" && [pick.month, pick.week], [1, 3]); // the earliest week of the earliest month
});

Deno.test("the due rule is asked per month, on that month's own clock and logs", () => {
  // Month 1's week 4 is not due (day 10 of month 1, nothing trained in week 3);
  // month 2 has its week 1 fully trained, so its week 2 is due.
  const months = [
    month(1, { outlineWeeks: [4], startedAt: iso(0) }),
    month(2, { startedAt: iso(8 * DAY), loggedDays: week1Trained }),
  ];
  const pick = pickMonthToFill(months, at(10 * DAY));
  assertEquals(pick.action === "fill" && [pick.month, pick.week, pick.reason], [2, 2, "trained"]);
  // Month 2's logs do not open month 1's week.
  assertEquals(pickMonthToFill([months[0]], at(10 * DAY)).action, "skip");
});

Deno.test("a program with no unwritten weeks, or none due, gets nothing", () => {
  assertEquals(pickMonthToFill([], at(DAY)), { action: "skip", reason: "no outline weeks", detail: {} });
  assertEquals(pickMonthToFill([month(1, { outlineWeeks: [] })], at(40 * DAY)).action, "skip");
  const notDue = pickMonthToFill([month(1)], at(2 * DAY));
  assertEquals(notDue.action === "skip" && notDue.reason, "previous week not trained and clock not run");
});

Deno.test("the weekly job reads every month of the program that still has outline rows, not only the newest", async () => {
  const pw = (id: string, m: number, week: number, day: number, status: string) =>
    ({ id, program_id: "P", month_number: m, week_num: week, day_num: day, status });
  const { supa } = memorySupa({
    program_workouts: [
      pw("a", 1, 3, 1, "written"), pw("b", 1, 4, 1, "outline"),
      pw("c", 2, 1, 1, "written"), pw("d", 2, 2, 1, "outline"),
      pw("e", 3, 1, 1, "written"), // month 3: fully written, not looked at
      pw("x", 1, 4, 1, "outline", ), { id: "other", program_id: "OTHER", month_number: 1, week_num: 2, day_num: 1, status: "outline" },
    ],
    workout_logs: [{ id: "l", user_id: "U", source_type: "program", source_id: "c", status: "in_progress", workout_date: null }],
    workout_log_blocks: [{ id: "lb", log_id: "l" }],
    program_month_skeletons: [
      { program_id: "P", month_number: 1, created_at: iso(0), last_fill_error: "save failed: x", last_fill_attempt_at: iso(5 * DAY) },
      { program_id: "P", month_number: 2, created_at: iso(30 * DAY), last_fill_error: null, last_fill_attempt_at: null },
    ],
    program_jobs: [
      { program_id: "P", status: "failed", created_at: iso(5 * DAY), month: 1, fill: { weekNum: 4 } },
      { program_id: "P", status: "complete", created_at: iso(30 * DAY), month: 2, fill: null },
    ],
  });
  const states = await loadMonthFillStates(supa, "P", "U");
  assertEquals(states.map((s) => s.month), [1, 2]);
  assertEquals(states[0].outlineWeeks, [4]);
  assertEquals([states[0].failStreak, states[0].lastFillError, states[0].startedAt], [1, "save failed: x", iso(0)]);
  assertEquals(states[1].loggedDays, [{ week: 1, day: 1 }]);
  assertEquals(states[1].daysInWeek(1), 1);
  assertEquals(states[1].failStreak, 0);
});

// ── Fix: programs in turn; a failing month backs off ────────────────────────

Deno.test("programs are taken in turn: never attempted first, then the one attempted longest ago", () => {
  const c = (id: string, lastFillAttemptAt: string | null) => ({ id, lastFillAttemptAt });
  const order = orderForKicks([c("recent", iso(9 * H)), c("never-1", null), c("old", iso(1 * H)), c("never-2", null), c("middle", iso(4 * H))]);
  assertEquals(order.map((x) => x.id), ["never-1", "never-2", "old", "middle", "recent"]);
});

Deno.test("back-off between attempts is 1h, 2h, 4h, 8h, then 24h", () => {
  assertEquals([0, 1, 2, 3, 4, 5, 6, 30].map((n) => fillBackoffMs(n) / H), [0, 1, 2, 4, 8, 24, 24, 24]);
});

Deno.test("the failure streak is the run of failed week jobs for that month since it was built and since the last one that did not fail", () => {
  const j = (status: string, hours: number, m = 1, isWeekJob = true) => ({ status, created_at: iso(hours * H), month: m, isWeekJob });
  assertEquals(failStreakOf([j("failed", 30), j("failed", 20), j("complete", 10), j("failed", 5)], 1, iso(0)), { streak: 2, lastFailedAt: iso(30 * H) });
  assertEquals(failStreakOf([j("complete", 30), j("failed", 20)], 1, iso(0)).streak, 0); // the last attempt worked
  assertEquals(failStreakOf([j("failed", 30, 2), j("failed", 20, 1, false)], 1, iso(0)).streak, 0); // another month; a month build
  assertEquals(failStreakOf([j("failed", 30), j("failed", 5)], 1, iso(10 * H)).streak, 1); // failures before a rebuild do not count
  assertEquals(failStreakOf([j("processing", 31), j("failed", 30)], 1, iso(0)).streak, 0); // one is running now
});

Deno.test("a month whose last attempt failed is skipped until its back-off has run, then tried again", () => {
  const failing = (streak: number) => month(1, { failStreak: streak, lastFailedAt: iso(8 * DAY), lastFillAttemptAt: iso(8 * DAY), lastFillError: "save failed: x" });
  const after = (hours: number) => at(8 * DAY + hours * H);
  // One failure: an hourly job tries again at its next tick (the slack keeps "1 hour" from becoming two).
  assertEquals(pickMonthToFill([failing(1)], after(0.5)).action, "skip");
  assertEquals(pickMonthToFill([failing(1)], after(0.97)).action, "fill");
  // Three in a row: not for four hours.
  assertEquals(pickMonthToFill([failing(3)], after(3)).action, "skip");
  assertEquals(pickMonthToFill([failing(3)], after(4)).action, "fill");
  // Five or more: once a day.
  const skip = pickMonthToFill([failing(7)], after(20));
  assertEquals(skip.action === "skip" && skip.reason, "last attempt failed; backing off");
  assertEquals(pickMonthToFill([failing(7)], after(24)).action, "fill");
});

Deno.test("a refused kick with no failed job on file still counts as one failure; a month with no failure never waits", () => {
  const refused = { lastFillError: "kick 500: {}", lastFillAttemptAt: iso(0), failStreak: 0, lastFailedAt: null };
  assertEquals(fillRetryAt(refused)!.getTime(), T0 + 1 * H - 5 * 60 * 1000);
  assertEquals(fillRetryAt({ lastFillError: null, lastFillAttemptAt: iso(0), failStreak: 0, lastFailedAt: null }), null);
  // Failed jobs with no error recorded on the month (a failure in a stage before the save) back off all the same.
  assertEquals(fillRetryAt({ lastFillError: null, lastFillAttemptAt: iso(0), failStreak: 2, lastFailedAt: iso(1000) })!.getTime(), T0 + 1000 + 2 * H - 5 * 60 * 1000);
});

Deno.test("while an older month backs off, a later month of the same program can still get its week", () => {
  const pick = pickMonthToFill([
    month(1, { outlineWeeks: [4], failStreak: 4, lastFailedAt: iso(40 * DAY), lastFillAttemptAt: iso(40 * DAY) }),
    month(2, { startedAt: iso(30 * DAY) }),
  ], at(40 * DAY + 2 * H));
  assertEquals(pick.action === "fill" && [pick.month, pick.week], [2, 2]);
});

// ── Fix: a failed re-plan is not recorded as applied ────────────────────────

const NOW_PROFILE = { days_per_week: 4, goal: "Hyrox in March", session_length_minutes: 45 };

Deno.test("a failed re-plan keeps the old built_from, so the next week job sees the same change and tries again", () => {
  assertEquals(builtFromForWeekSave(true, NOW_PROFILE), null); // null = leave the stored value alone
});

Deno.test("a re-plan that succeeded, or a week that needed none, records the current profile", () => {
  assertEquals(builtFromForWeekSave(false, NOW_PROFILE), NOW_PROFILE);
});

// ── Fix: a note is marked used only when it was read and acted on ───────────

Deno.test("only the notes that were in the payload this job read are marked used", () => {
  const ok = { failed: false, notesNeededIt: false };
  assertEquals(noteIdsToConsume(["n1", "n2", "n1"], ok), ["n1", "n2"]);
  assertEquals(noteIdsToConsume([], ok), []);
  assertEquals(noteIdsToConsume(undefined, ok), []); // a job started before ids were kept: nothing is marked
});

Deno.test("notes that asked for a re-plan are not marked used when that re-plan failed", () => {
  assertEquals(noteIdsToConsume(["n1"], { failed: true, notesNeededIt: true }), []);
});

Deno.test("when the re-plan failed for a profile change the notes did not ask for, the notes the week was written with are still marked used", () => {
  assertEquals(noteIdsToConsume(["n1"], { failed: true, notesNeededIt: false }), ["n1"]);
});

// ── Fix: a days-per-week note is not a re-plan trigger ──────────────────────

Deno.test("the re-plan question no longer lists the day count as structure, and says a days note is 'fill'", () => {
  const structure = REPLAN_SYSTEM.slice(0, REPLAN_SYSTEM.indexOf("Answer 'fill'"));
  assertEquals(/how many days|days a week|drop to \d days|\d days from now on/i.test(structure), false);
  assertEquals(REPLAN_SYSTEM.includes("fewer or more days a week"), true);
  assertEquals(/fewer or more days a week \(e\.g\.[^)]*\) is 'fill'/.test(REPLAN_SYSTEM), true);
  assertEquals(REPLAN_SYSTEM.includes("set in the athlete's profile, not by a note"), true);
});
