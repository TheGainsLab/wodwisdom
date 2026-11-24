/**
 * Tests for the one wording of "when does my next week arrive" (src/lib/weekSchedule).
 * Run: npm run test:calculators
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekArrivalText, weekWrittenBy } from '../src/lib/weekSchedule';

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
