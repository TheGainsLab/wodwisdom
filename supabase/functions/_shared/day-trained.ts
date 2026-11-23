/**
 * day-trained — the ONE definition of "this program day was trained".
 *
 * Why (2026-11-23): the weekly job opened the next week when every day had
 * ANY workout log, in progress included, while the evidence the week fill
 * reads (program-evidence.ts) counted only COMPLETED logs. A day that opened
 * the next week could then read as "NOT DONE" in the very fill it opened, and
 * its lifts were not progressed from.
 *
 * The rule, used by both (weekly-programming-cron and program-evidence):
 * a day counts as trained when it has a workout log, in progress or
 * completed, with at least one saved block. Saving one block is interacting
 * with the day, and an interaction is a completion as far as the generator is
 * concerned (founder, 2026-11-15).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** The log statuses that can make a day trained. */
export const TRAINED_LOG_STATUSES = ["in_progress", "completed"] as const;

export interface DayLog {
  id: string;
  /** The program_workouts id the log belongs to. */
  source_id: string;
  workout_date: string | null;
  status: string | null;
}

/**
 * Pure: the log that makes each day trained, keyed by program_workouts id.
 * A log with no saved block does not count. When a day has more than one
 * qualifying log, a completed one is preferred to one still in progress.
 */
export function trainedDayLogs(logs: DayLog[], logIdsWithBlocks: Iterable<string>): Map<string, DayLog> {
  const withBlocks = new Set(logIdsWithBlocks);
  const statuses = TRAINED_LOG_STATUSES as readonly string[];
  const out = new Map<string, DayLog>();
  for (const l of logs) {
    if (!l.source_id || !withBlocks.has(l.id)) continue;
    if (!statuses.includes(l.status ?? "")) continue;
    const have = out.get(l.source_id);
    if (!have || (have.status !== "completed" && l.status === "completed")) out.set(l.source_id, l);
  }
  return out;
}

/** The trained days among `workoutIds` for one athlete (see the rule above). */
export async function loadTrainedDayLogs(
  supa: SupabaseClient,
  userId: string,
  workoutIds: string[],
): Promise<Map<string, DayLog>> {
  if (workoutIds.length === 0) return new Map();
  const { data: logs } = await supa
    .from("workout_logs")
    .select("id, source_id, workout_date, status")
    .eq("user_id", userId)
    .eq("source_type", "program")
    .in("status", [...TRAINED_LOG_STATUSES])
    .in("source_id", workoutIds);
  const rows = (logs ?? []) as DayLog[];
  if (rows.length === 0) return new Map();
  const { data: blocks } = await supa
    .from("workout_log_blocks")
    .select("log_id")
    .in("log_id", rows.map((l) => l.id));
  return trainedDayLogs(rows, ((blocks ?? []) as Array<{ log_id: string }>).map((b) => b.log_id));
}
