/**
 * When an unwritten week of a weekly program arrives — ONE wording, used by
 * the program page's banner, week headers and day rows (2026-11-24).
 *
 * The page used to explain it three ways, none exact: a week header that
 * dropped the clock ("written when you finish week 1"), and "7 days in" on
 * every week, which is true of week 2 only.
 *
 * The rule itself lives on the server (nextWeekToFill in
 * supabase/functions/_shared/weekly-fill.ts): a week is written when EITHER
 *  - every day of the week before has a log with a saved block, or
 *  - 7 × (week − 1) days have passed since the month was built
 *    (week 2 at day 7, week 3 at day 14, week 4 at day 21).
 * The weekly job runs once an hour, so the week is on the page within the
 * hour after it falls due.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The latest moment a week is written by: the clock gate plus the hourly
 *  job's interval. Null when the month's build time is not known. */
export function weekWrittenBy(monthStartedAt: string | null | undefined, weekInMonth: number): Date | null {
  if (!monthStartedAt) return null;
  const start = Date.parse(monthStartedAt);
  if (!Number.isFinite(start) || !(weekInMonth >= 2)) return null;
  return new Date(start + 7 * (weekInMonth - 1) * DAY_MS + HOUR_MS);
}

const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export interface WeekArrivalFacts {
  /** The month's build time (program_month_skeletons.created_at). */
  monthStartedAt: string | null | undefined;
  /** The unwritten week's number inside its month (2, 3 or 4). */
  weekInMonth: number;
  /** The number the page SHOWS for the week before it (e.g. 5 for month 2 week 1). */
  previousWeekLabel: number;
  /** True for the next week to be written (the lowest unwritten week of its month). */
  isNext: boolean;
  now?: Date;
}

/** The sentence for one unwritten week. */
export function weekArrivalText(f: WeekArrivalFacts): string {
  const by = weekWrittenBy(f.monthStartedAt, f.weekInMonth);
  const now = f.now ?? new Date();
  if (by && by.getTime() <= now.getTime()) return 'Due now. It is being written and will be here within the hour.';
  if (f.isNext) {
    return by
      ? `Written when you've logged every day of week ${f.previousWeekLabel}, or on ${fmt(by)} at the latest.`
      : `Written when you've logged every day of week ${f.previousWeekLabel}.`;
  }
  return by
    ? `Written after week ${f.previousWeekLabel}, on ${fmt(by)} at the latest.`
    : `Written after week ${f.previousWeekLabel}.`;
}
