/**
 * weekly-fill — helpers for a WEEK JOB (weekly Programming PR 4): the stored
 * month (skeleton, composed metcons, written weeks) and the re-plan verdict
 * on the athlete's notes.
 *
 * Founder decisions 2026-11-13: a note that changes what the skeleton owns —
 * which lifts, how much lifting, the metcon focus, the kind of training
 * emphasised — re-plans the remaining weeks' skeleton (written weeks kept);
 * a note about what goes INSIDE a block (loads, accessory choice, metcon
 * movements, more of a thing already there) is the fill's business.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SkeletonOutput } from "./v3-output-schema.ts";
import type { WeekPrescription } from "./v2-output-schema.ts";
import type { ComposedMetcon } from "./metcon-composer.ts";
import { MODELS } from "./model-profiles.ts";
import { fetchWithTimeout } from "./fetch-with-timeout.ts";
import { loadTrainedDayLogs } from "./day-trained.ts";

/** What the skeleton was built from — the profile fields the skeleton's
 *  shape depends on. A change to any of them during the month re-plans the
 *  remaining weeks (founder, 2026-11-14: "if a user changes their profile
 *  days, the skeleton won't change until the next month" was the gap). */
export interface BuiltFrom {
  days_per_week: number;
  goal: string | null;
  session_length_minutes: number | null;
}

export function builtFromOf(tc: { days_per_week: number; goal_text?: string | null; session_length_minutes?: number | null }): BuiltFrom {
  return {
    days_per_week: tc.days_per_week,
    goal: (tc.goal_text ?? "").trim() || null,
    session_length_minutes: tc.session_length_minutes ?? null,
  };
}

/** Pure: the profile changes since the skeleton was built, as lines for the
 *  re-plan prompt. Empty = nothing drifted. `days` first: it is the one the
 *  fill cannot absorb (the fill tool is sized to the CURRENT days). */
export function profileDrift(built: BuiltFrom | null | undefined, now: BuiltFrom): string[] {
  if (!built) return [];
  const out: string[] = [];
  if (built.days_per_week !== now.days_per_week) {
    out.push(`training days per week changed from ${built.days_per_week} to ${now.days_per_week}`);
  }
  if ((built.goal ?? "") !== (now.goal ?? "")) {
    out.push(`goal changed from "${built.goal ?? "none"}" to "${now.goal ?? "none"}"`);
  }
  if ((built.session_length_minutes ?? null) !== (now.session_length_minutes ?? null)) {
    out.push(`session length changed from ${built.session_length_minutes ?? "unset"} to ${now.session_length_minutes ?? "unset"} minutes`);
  }
  return out;
}

export interface MonthStore {
  id: string;
  skeleton: SkeletonOutput;
  composed_metcons: ComposedMetcon[] | null;
  written_weeks: WeekPrescription[];
  replan_count: number | null;
  built_from: BuiltFrom | null;
}

export async function loadMonthStore(supa: SupabaseClient, programId: string, monthNumber: number): Promise<MonthStore | null> {
  const { data } = await supa
    .from("program_month_skeletons")
    .select("id, skeleton, composed_metcons, written_weeks, replan_count, built_from")
    .eq("program_id", programId)
    .eq("month_number", monthNumber)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    skeleton: data.skeleton as SkeletonOutput,
    composed_metcons: (data.composed_metcons as ComposedMetcon[] | null) ?? null,
    written_weeks: ((data.written_weeks as WeekPrescription[] | null) ?? []),
    replan_count: (data.replan_count as number | null) ?? 0,
    built_from: (data.built_from as BuiltFrom | null) ?? null,
  };
}

/** Pure: the question we ask about the notes. Exported for the test.
 *
 *  (2026-11-23) A note asking for fewer or more training days is NOT a
 *  re-plan trigger any more. The day count is the profile's: the re-plan is
 *  sized to the profile's days and cannot change them, so a "3 days from now
 *  on" note bought a full skeleton rewrite that changed nothing. A real
 *  change of days arrives as a profile update, which profileDrift() picks up. */
export const REPLAN_SYSTEM =
  "You read an athlete's notes to their coach and answer ONE word. Answer 'replan' if ANY note asks to change the " +
  "STRUCTURE of the month: which lifts " +
  "are trained, how much lifting or gymnastics or conditioning there is " +
  "overall, which kind of training is emphasised, or the metcon focus. Answer 'fill' if " +
  "every note is about what goes INSIDE the existing days: loads (heavier/easier), a specific movement to include " +
  "or avoid for a week, equipment available for a week, how they feel this week, one metcon longer or shorter. " +
  "A note that only asks to train fewer or more days a week is 'fill': the number of training days is set in the athlete's profile, not by a note, and a re-plan " +
  "cannot change it. " +
  "Reply with exactly one word: replan or fill.";

/** Cheap classifier (Haiku). Any failure → 'fill' (the safe, cheaper path). */
export async function classifyNotesForReplan(notes: string[]): Promise<"replan" | "fill"> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey || notes.length === 0) return "fill";
  try {
    const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELS.haiku,
        max_tokens: 5,
        system: REPLAN_SYSTEM,
        messages: [{ role: "user", content: notes.map((n) => `- ${n}`).join("\n") }],
      }),
    }, 10_000);
    if (!resp.ok) return "fill";
    const data = await resp.json();
    const text = ((data.content ?? []).find((b: { type?: string }) => b.type === "text")?.text ?? "").trim().toLowerCase();
    return text.startsWith("replan") ? "replan" : "fill";
  } catch {
    return "fill";
  }
}

export const WEEK_CLOCK_DAYS = 7;

export type WeekGateReason = "trained" | "clock";

/** Pure: which week a weekly program should fill next, and why it is due.
 *  `outlineWeeks` are the weeks still outline; `loggedDays` the (week, day)
 *  pairs that were TRAINED — the shared rule in day-trained.ts: a workout
 *  log, in progress or completed, with at least one saved block (saving one
 *  block is interacting with the day, and for the generator an interaction
 *  is a completion); `daysInWeek` the day count per week; `monthStartedAt`
 *  when the month was built.
 *
 *  Founder decisions 2026-11-15 — two gates, either opens the week:
 *   - trained: every day of the week before has a log. The athlete did
 *     something on each day — a metcon score alone is enough.
 *   - clock:   7 × (week − 1) days have passed since the month was built.
 *     Week 2 at day 7, week 3 at day 14, week 4 at day 21, whatever the
 *     athlete has done: the whole month is delivered inside the payment
 *     window, with no responsibility beyond payment.
 *  Interaction can only bring a week forward; the clock is the floor.
 *  Null when nothing is due. */
export function nextWeekToFill(
  outlineWeeks: number[],
  loggedDays: Array<{ week: number; day: number }>,
  daysInWeek: (week: number) => number,
  monthStartedAt: Date | string | null | undefined,
  now: Date = new Date(),
): { week: number; reason: WeekGateReason } | null {
  if (outlineWeeks.length === 0) return null;
  const target = Math.min(...outlineWeeks);
  const prev = target - 1;
  if (prev < 1) return { week: target, reason: "clock" }; // week 1 outline (shouldn't happen) — fill it

  const startMs = monthStartedAt ? new Date(monthStartedAt).getTime() : NaN;
  if (Number.isFinite(startMs)) {
    const dueMs = startMs + prev * WEEK_CLOCK_DAYS * 24 * 60 * 60 * 1000;
    if (now.getTime() >= dueMs) return { week: target, reason: "clock" };
  }

  const n = daysInWeek(prev);
  if (n > 0) {
    const logged = new Set(loggedDays.filter((d) => d.week === prev).map((d) => d.day));
    let all = true;
    for (let day = 1; day <= n; day++) if (!logged.has(day)) { all = false; break; }
    if (all) return { week: target, reason: "trained" };
  }
  return null;
}

/**
 * The weeks a fill stage hands on to the audits and the save.
 *
 * A month build accumulates: every week written so far plus the new one. A
 * WEEK JOB hands on ONLY the week it just wrote — the earlier weeks it loaded
 * (priorWrittenWeeks) are there for the writer to progress from and are
 * already saved. Passing them on re-saved them: every week fill inserted a
 * second copy of each earlier week's days (2026-11-20 and 2026-11-21, two
 * subscribers, week 1 listed twice on the program page).
 */
export function weeksToCarryForward<W>(isWeekJob: boolean, priorWeeks: W[], justWritten: W): W[] {
  return isWeekJob ? [justWritten] : [...priorWeeks, justWritten];
}

// ── What a week job records after a re-plan (2026-11-23) ───────────────────

/**
 * Pure: the `built_from` a WEEK JOB's save should store, or null to leave the
 * stored one alone.
 *
 * A failed re-plan must not be recorded as applied (2026-11-23): the week was
 * then filled from the OLD skeleton, and storing the current profile as "what
 * this skeleton was built from" meant the next week saw no drift and the
 * change never reached the rest of the month. Keeping the old value makes the
 * next week job try the re-plan again.
 */
export function builtFromForWeekSave(replanFailed: boolean, current: BuiltFrom): BuiltFrom | null {
  return replanFailed ? null : current;
}

/**
 * Pure: the ids of the one-week notes a finished job may mark as used.
 *
 * A note is used only when it was actually read and acted on (2026-11-23):
 *  - only the notes that were in the payload THIS job read (a note written
 *    after the payload was built has not been seen by anyone);
 *  - none of them when they asked for a re-plan and that re-plan failed.
 */
export function noteIdsToConsume(
  payloadNoteIds: string[] | null | undefined,
  replan: { failed: boolean; notesNeededIt: boolean },
): string[] {
  if (replan.failed && replan.notesNeededIt) return [];
  return [...new Set(payloadNoteIds ?? [])];
}

// ── The weekly job's plan for one tick (2026-11-23) ────────────────────────

/** Hours to wait after the 1st, 2nd, 3rd, 4th failure in a row; 24 after that. */
export const FILL_BACKOFF_HOURS = [1, 2, 4, 8];
export const FILL_BACKOFF_MAX_HOURS = 24;
/** The job runs hourly: without a little slack a "1 hour" wait measured from
 *  a kick at :00:05 would skip the tick at :00:02 and become two hours. */
export const FILL_BACKOFF_SLACK_MS = 5 * 60 * 1000;

export function fillBackoffMs(failStreak: number): number {
  if (failStreak <= 0) return 0;
  const hours = FILL_BACKOFF_HOURS[failStreak - 1] ?? FILL_BACKOFF_MAX_HOURS;
  return hours * 60 * 60 * 1000;
}

export interface WeekJobRecord {
  status: string | null;
  created_at: string;
  /** resume_state.continuation.monthNumber */
  month: number | null;
  /** True when the job is a week job (resume_state.weeklyFill is set). */
  isWeekJob: boolean;
}

/**
 * Pure: how many week jobs in a row have failed for one month, newest first,
 * and when the newest of them was started. No counter column exists, so the
 * streak is read from the jobs themselves (program_jobs): the run of failed
 * week jobs for this month since the month was built and since the last one
 * that did not fail.
 */
export function failStreakOf(
  jobs: WeekJobRecord[],
  month: number,
  monthBuiltAt: string | null | undefined,
): { streak: number; lastFailedAt: string | null } {
  const since = monthBuiltAt ? new Date(monthBuiltAt).getTime() : NaN;
  const mine = jobs
    .filter((j) => j.isWeekJob && j.month === month)
    .filter((j) => !Number.isFinite(since) || new Date(j.created_at).getTime() >= since)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  let streak = 0;
  for (const j of mine) {
    if (j.status !== "failed") break;
    streak += 1;
  }
  return { streak, lastFailedAt: streak > 0 ? mine[0].created_at : null };
}

export interface MonthFillState {
  month: number;
  outlineWeeks: number[];
  loggedDays: Array<{ week: number; day: number }>;
  daysInWeek: (week: number) => number;
  /** program_month_skeletons.created_at — the month's clock. */
  startedAt: string | null;
  lastFillError: string | null;
  lastFillAttemptAt: string | null;
  failStreak: number;
  lastFailedAt: string | null;
}

/** Pure: when a month whose last attempt failed may be tried again; null when
 *  it is not backing off. A recorded error with no failed job on file (the
 *  kick itself was refused) counts as one failure. */
export function fillRetryAt(m: Pick<MonthFillState, "lastFillError" | "lastFillAttemptAt" | "failStreak" | "lastFailedAt">): Date | null {
  const streak = Math.max(m.failStreak, m.lastFillError ? 1 : 0);
  if (streak <= 0) return null;
  const times = [m.lastFillAttemptAt, m.lastFailedAt]
    .map((t) => (t ? new Date(t).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return null; // no attempt time on file: nothing to wait from
  return new Date(Math.max(...times) + fillBackoffMs(streak) - FILL_BACKOFF_SLACK_MS);
}

/** One program's state, month by month, for pickMonthToFill (the weekly
 *  job's reads; the picking itself is pure). */
export async function loadMonthFillStates(supa: SupabaseClient, pid: string, userId: string): Promise<MonthFillState[]> {
  // Which months still have an outline week — every month, not only the newest.
  const { data: outline } = await supa
    .from("program_workouts")
    .select("month_number")
    .eq("program_id", pid)
    .eq("status", "outline");
  const monthOf = (r: { month_number: number | null }) => r.month_number ?? 1;
  const months = [...new Set(((outline ?? []) as Array<{ month_number: number | null }>).map(monthOf))].sort((a, b) => a - b);
  if (months.length === 0) return [];

  const { data: days } = await supa
    .from("program_workouts")
    .select("id, month_number, week_num, day_num, status")
    .eq("program_id", pid)
    .in("month_number", months);
  const inScope = (days ?? []) as Array<{ id: string; month_number: number | null; week_num: number; day_num: number; status: string | null }>;
  // "Trained" is the shared rule (day-trained.ts): a log, in progress or
  // completed, with at least one saved block.
  const trained = await loadTrainedDayLogs(supa, userId, inScope.filter((r) => r.status !== "outline").map((r) => r.id));
  // Each month's clock starts when that month was built (save-v3 stamps
  // created_at on a fresh build, so an admin rebuild restarts it).
  const { data: stores } = await supa
    .from("program_month_skeletons")
    .select("month_number, created_at, last_fill_error, last_fill_attempt_at")
    .eq("program_id", pid);
  const storeByMonth = new Map(((stores ?? []) as Array<{ month_number: number; created_at: string | null; last_fill_error: string | null; last_fill_attempt_at: string | null }>)
    .map((st) => [st.month_number, st]));
  // The failure streak is read from the week jobs themselves: there is no
  // counter column, and a job that fails in a later stage writes nothing
  // back to the month.
  const { data: jobs } = await supa
    .from("program_jobs")
    .select("status, created_at, month:resume_state->continuation->monthNumber, fill:resume_state->weeklyFill")
    .eq("program_id", pid)
    .order("created_at", { ascending: false })
    .limit(20);
  const jobRecords: WeekJobRecord[] = ((jobs ?? []) as Array<{ status: string | null; created_at: string; month: unknown; fill: unknown }>)
    .map((j) => ({ status: j.status, created_at: j.created_at, month: typeof j.month === "number" ? j.month : Number(j.month) || null, isWeekJob: j.fill != null }));

  return months.map((month) => {
    const mine = inScope.filter((r) => monthOf(r) === month);
    const store = storeByMonth.get(month);
    const streak = failStreakOf(jobRecords, month, store?.created_at ?? null);
    return {
      month,
      outlineWeeks: [...new Set(mine.filter((r) => r.status === "outline").map((r) => r.week_num))],
      loggedDays: mine.filter((r) => trained.has(r.id)).map((r) => ({ week: r.week_num, day: r.day_num })),
      daysInWeek: (w: number) => Math.max(0, ...mine.filter((r) => r.week_num === w).map((r) => r.day_num)),
      startedAt: store?.created_at ?? null,
      lastFillError: store?.last_fill_error ?? null,
      lastFillAttemptAt: store?.last_fill_attempt_at ?? null,
      failStreak: streak.streak,
      lastFailedAt: streak.lastFailedAt,
    };
  });
}

export type MonthFillPick =
  | { action: "fill"; month: number; week: number; reason: WeekGateReason; lastFillAttemptAt: string | null }
  | { action: "skip"; reason: string; detail: Record<string, unknown> };

/**
 * Pure: the ONE week a program gets this tick.
 *
 * Every month that still has outline weeks is considered, lowest month first
 * (2026-11-23: only the newest month used to be looked at, so outline weeks
 * left in an older month when the next month was built were never written).
 * The week-due rule is unchanged and is asked per month, on that month's own
 * clock and logs. A month whose last attempt failed is passed over until its
 * back-off has run; the first month with a due week wins.
 */
export function pickMonthToFill(months: MonthFillState[], now: Date = new Date()): MonthFillPick {
  const withOutline = months.filter((m) => m.outlineWeeks.length > 0).sort((a, b) => a.month - b.month);
  if (withOutline.length === 0) return { action: "skip", reason: "no outline weeks", detail: {} };
  const notDue: number[] = [];
  const backingOff: Array<{ month: number; retry_at: string; failures: number }> = [];
  for (const m of withOutline) {
    const gate = nextWeekToFill(m.outlineWeeks, m.loggedDays, m.daysInWeek, m.startedAt, now);
    if (gate == null) { notDue.push(m.month); continue; }
    const retryAt = fillRetryAt(m);
    if (retryAt && now.getTime() < retryAt.getTime()) {
      backingOff.push({ month: m.month, retry_at: retryAt.toISOString(), failures: Math.max(m.failStreak, 1) });
      continue;
    }
    return { action: "fill", month: m.month, week: gate.week, reason: gate.reason, lastFillAttemptAt: m.lastFillAttemptAt };
  }
  if (backingOff.length > 0) {
    return { action: "skip", reason: "last attempt failed; backing off", detail: { backing_off: backingOff, not_due_months: notDue } };
  }
  return { action: "skip", reason: "previous week not trained and clock not run", detail: { months: notDue } };
}

/** Pure: programs are taken in turn — never attempted first, then the one
 *  attempted longest ago (2026-11-23: the order used to be whatever the
 *  database returned, so the same programs could take the tick's slots every
 *  hour). */
export function orderForKicks<T extends { lastFillAttemptAt: string | null }>(candidates: T[]): T[] {
  const t = (c: T) => (c.lastFillAttemptAt ? new Date(c.lastFillAttemptAt).getTime() : -Infinity);
  return candidates.map((c, i) => ({ c, i })).sort((a, b) => (t(a.c) - t(b.c)) || (a.i - b.i)).map((x) => x.c);
}
