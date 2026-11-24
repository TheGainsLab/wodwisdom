/**
 * Tests for the one wording of "when does my next week arrive" (src/lib/weekSchedule).
 * Run: npm run test:calculators
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachNotesWeeks, weekArrivalText, weekWrittenBy, WEEK_BEING_WRITTEN } from '../src/lib/weekSchedule';

const BUILT = '2026-11-16T10:00:00.000Z';
const day = (n: number) => new Date(Date.parse(BUILT) + n * 86400000);

test('the latest date follows the server clock: week 2 at day 7, week 3 at 14, week 4 at 21, plus the hourly job', () => {
  assert.equal(weekWrittenBy(BUILT, 2)!.toISOString(), '2026-11-23T11:00:00.000Z');
  assert.equal(weekWrittenBy(BUILT, 3)!.toISOString(), '2026-11-30T11:00:00.000Z');
  assert.equal(weekWrittenBy(BUILT, 4)!.toISOString(), '2026-12-07T11:00:00.000Z');
});

test('no date is invented when the build time is unknown, or for week 1', () => {
  assert.equal(weekWrittenBy(null, 2), null);
  assert.equal(weekWrittenBy('not a date', 2), null);
  assert.equal(weekWrittenBy(BUILT, 1), null);
});

test('the next week names both ways it arrives: logging every day, or the date', () => {
  const t = weekArrivalText({ monthStartedAt: BUILT, weekInMonth: 2, previousWeekLabel: 1, isNext: true, now: day(2) });
  assert.match(t, /^Written when you've logged every day of week 1, or on .+ at the latest\.$/);
});

test('a later week gives its own date, not "7 days in"', () => {
  const w3 = weekArrivalText({ monthStartedAt: BUILT, weekInMonth: 3, previousWeekLabel: 2, isNext: false, now: day(2) });
  const w4 = weekArrivalText({ monthStartedAt: BUILT, weekInMonth: 4, previousWeekLabel: 3, isNext: false, now: day(2) });
  assert.match(w3, /^Written after week 2, on .+ at the latest\.$/);
  assert.match(w4, /^Written after week 3, on .+ at the latest\.$/);
  assert.notEqual(w3, w4.replace('week 3', 'week 2')); // different dates
});

test('a week past its date says it is being written, never a date in the past', () => {
  const t = weekArrivalText({ monthStartedAt: BUILT, weekInMonth: 2, previousWeekLabel: 1, isNext: true, now: day(8) });
  assert.equal(t, 'Due now. It is being written and will be here within the hour.');
});

test('with no build time the sentence still says how the week arrives, with no date', () => {
  assert.equal(weekArrivalText({ monthStartedAt: null, weekInMonth: 2, previousWeekLabel: 5, isNext: true }),
    "Written when you've logged every day of week 5.");
});

test('the month-2 label is the number the page shows', () => {
  const t = weekArrivalText({ monthStartedAt: BUILT, weekInMonth: 2, previousWeekLabel: 5, isNext: true, now: day(1) });
  assert.match(t, /every day of week 5/);
});

test('a week whose write is running says so, whatever its date', () => {
  assert.equal(weekArrivalText({ monthStartedAt: BUILT, weekInMonth: 2, previousWeekLabel: 1, isNext: true, beingWritten: true, now: day(2) }), WEEK_BEING_WRITTEN);
  assert.equal(weekArrivalText({ monthStartedAt: null, weekInMonth: 3, previousWeekLabel: 2, isNext: false, beingWritten: true }), WEEK_BEING_WRITTEN);
});

// ── Where the "Tell your coach" box sits ────────────────────────────────────
const wk = (week_num: number, done: boolean[], status = 'written', month_number = 1) =>
  done.map((d) => ({ month_number, week_num, status, done: d }));

test('the notes box sits on the latest written week', () => {
  assert.deepEqual([...coachNotesWeeks([...wk(1, [true, true]), ...wk(2, [false, false]), ...wk(3, [false], 'outline')])], [2]);
});

test('…and also on the week still being trained when a later week has been written', () => {
  // Week 2 has a day left; the clock has already written week 3.
  const days = [...wk(1, [true, true]), ...wk(2, [true, false]), ...wk(3, [false, false]), ...wk(4, [false], 'outline')];
  assert.deepEqual([...coachNotesWeeks(days)].sort(), [2, 3]);
});

test('an unwritten week never carries the box, and month 2 uses the numbers the page shows', () => {
  assert.equal(coachNotesWeeks(wk(1, [false], 'outline')).size, 0);
  assert.deepEqual([...coachNotesWeeks([...wk(4, [true]), ...wk(1, [false], 'written', 2)])], [5]);
});

test('everything done: only the latest written week has it', () => {
  assert.deepEqual([...coachNotesWeeks([...wk(1, [true]), ...wk(2, [true])])], [2]);
});
