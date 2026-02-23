/**
 * Formats recent workout logs into a compact text block for AI prompts.
 * Used by profile-analysis and chat to give the AI context about recent training.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface WorkoutLogRow {
  id: string;
  workout_date: string;
  workout_text: string;
  workout_type: string;
  score: string | null;
  rx: boolean;
}

export interface WorkoutLogEntryRow {
  log_id: string;
  movement: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  weight_unit: string;
  rpe: number | null;
  scaling_note: string | null;
  sort_order?: number;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPE_LABELS: Record<string, string> = {
  strength: "Strength",
  metcon: "Metcon",
  for_time: "For Time",
  amrap: "AMRAP",
  emom: "EMOM",
  other: "Other",
};

function formatMovementName(canonical: string): string {
  return canonical.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = DAY_NAMES[d.getDay()];
  const month = d.toLocaleString("en-US", { month: "short" });
  const date = d.getDate();
  return `${day} ${month} ${date}`;
}

/**
 * Format workout logs and entries into a compact string for AI context.
 * Returns empty string if no logs. Caller should omit the block entirely when empty.
 *
 * @param logs - Workout logs ordered by workout_date DESC (most recent first)
 * @param entries - Entries for those logs, grouped by log_id via Map
 * @param options.maxLines - Cap output length (default 30)
 */
export function formatRecentHistory(
  logs: WorkoutLogRow[],
  entries: WorkoutLogEntryRow[],
  options?: { maxLines?: number }
): string {
  if (logs.length === 0) return "";

  const entriesByLog = new Map<string, WorkoutLogEntryRow[]>();
  for (const e of entries) {
    const list = entriesByLog.get(e.log_id) || [];
    list.push(e);
    entriesByLog.set(e.log_id, list);
  }

  const lines: string[] = [];
  const maxLines = options?.maxLines ?? 30;

  for (const log of logs) {
    if (lines.length >= maxLines) break;

    const logEntries = (entriesByLog.get(log.id) || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const dateLabel = formatDate(log.workout_date);
    const typeLabel = TYPE_LABELS[log.workout_type] || log.workout_type;

    let summary = "";
    if (log.workout_type === "strength" && logEntries.length > 0) {
      const parts: string[] = [];
      for (const e of logEntries.slice(0, 3)) {
        let p = formatMovementName(e.movement);
        if (e.sets != null && e.reps != null) p += ` ${e.sets}×${e.reps}`;
        if (e.weight != null) p += ` @${e.weight}${e.weight_unit === "kg" ? "kg" : "lbs"}`;
        if (e.rpe != null) p += ` RPE ${e.rpe}`;
        parts.push(p);
      }
      summary = parts.join(", ");
    } else if (log.workout_type === "metcon" || log.workout_type === "for_time" || log.workout_type === "amrap" || log.workout_type === "emom") {
      const parts: string[] = [];
      if (log.score) parts.push(log.score);
      if (log.rx) parts.push("Rx");
      if (logEntries.length > 0) {
        parts.push(
          "(" +
            logEntries
              .slice(0, 3)
              .map((e) => {
                let s = formatMovementName(e.movement);
                if (e.scaling_note) s += ` ${e.scaling_note}`;
                return s;
              })
              .join(", ") +
            ")"
        );
      }
      summary = parts.length > 0 ? parts.join(" ") : log.workout_text.slice(0, 60).replace(/\n/g, " ");
    } else {
      summary = log.workout_text.slice(0, 80).replace(/\n/g, " ");
    }

    const line = `${dateLabel} — ${typeLabel}: ${summary}`.trim();
    lines.push(line);
  }

  return "RECENT TRAINING (last 14 days):\n" + lines.join("\n");
}

/**
 * Fetches last N days of workout logs and entries for a user, formats them for AI context.
 * Returns empty string if no logs. Use with Supabase service-role client (bypasses RLS).
 */
export async function fetchAndFormatRecentHistory(
  supa: SupabaseClient,
  userId: string,
  options?: { days?: number; maxLines?: number }
): Promise<string> {
  const days = options?.days ?? 14;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data: logs } = await supa
    .from("workout_logs")
    .select("id, workout_date, workout_text, workout_type, score, rx")
    .eq("user_id", userId)
    .gte("workout_date", cutoffStr)
    .order("workout_date", { ascending: false });

  if (!logs || (logs as WorkoutLogRow[]).length === 0) return "";

  const logIds = (logs as WorkoutLogRow[]).map((l) => l.id);
  const { data: entries } = await supa
    .from("workout_log_entries")
    .select("log_id, movement, sets, reps, weight, weight_unit, rpe, scaling_note, sort_order")
    .in("log_id", logIds);

  return formatRecentHistory(logs as WorkoutLogRow[], (entries || []) as WorkoutLogEntryRow[], { maxLines: options?.maxLines });
}
