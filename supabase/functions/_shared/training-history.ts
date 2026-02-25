/**
 * Formats recent workout logs into a compact text block for AI prompts.
 * Used by profile-analysis and chat to give the AI context about recent training.
 *
 * Outputs one line per block (not per workout) so the AI sees full session structure:
 *   Mon Feb 24 — Strength: Back Squat 5×3 @275lbs RPE 8
 *   Mon Feb 24 — For Time: 4:48 Rx (Thruster, Pull Up)
 *   Mon Feb 24 — AMRAP 7: 6+3 (Burpee, Cal Row)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface WorkoutLogRow {
  id: string;
  workout_date: string;
  workout_text: string;
  workout_type: string;
}

export interface WorkoutLogBlockRow {
  log_id: string;
  block_type: string;
  block_label: string | null;
  block_text: string;
  score: string | null;
  rx: boolean;
  sort_order: number;
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
  block_label: string | null;
  set_number: number | null;
  // Skills-specific fields
  reps_completed: number | null;
  hold_seconds: number | null;
  distance: number | null;
  distance_unit: string | null;
  quality: string | null;
  variation: string | null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function getMetconTypeLabel(text: string): string {
  const t = text.toUpperCase();
  if (/AMRAP|AS MANY ROUNDS/.test(t)) return "AMRAP";
  if (/EMOM|E\d+MOM/.test(t)) return "EMOM";
  return "For Time";
}

/**
 * Format a single block into a summary string.
 */
function formatBlock(
  block: WorkoutLogBlockRow,
  blockEntries: WorkoutLogEntryRow[]
): string {
  const sorted = blockEntries.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  if (block.block_type === "strength") {
    // Group per-set entries by movement for compact summaries
    const byMovement = new Map<string, WorkoutLogEntryRow[]>();
    for (const e of sorted) {
      const list = byMovement.get(e.movement) || [];
      list.push(e);
      byMovement.set(e.movement, list);
    }

    const parts: string[] = [];
    let count = 0;
    for (const [movement, rows] of byMovement) {
      if (count >= 3) break;
      count++;
      let p = formatMovementName(movement);
      const isPerSet = rows.length > 1 && rows.every((r) => r.set_number != null);
      if (isPerSet) {
        const totalSets = rows.length;
        const reps = rows[0].reps;
        const weights = rows.map((r) => r.weight).filter((w) => w != null);
        const rpes = rows.map((r) => r.rpe).filter((r) => r != null);
        if (reps != null) p += ` ${totalSets}×${reps}`;
        if (weights.length > 0) {
          const unit = rows[0].weight_unit === "kg" ? "kg" : "lbs";
          const unique = [...new Set(weights)];
          p += unique.length === 1 ? ` @${unique[0]}${unit}` : ` @${Math.min(...weights)}-${Math.max(...weights)}${unit}`;
        }
        if (rpes.length > 0) {
          const min = Math.min(...rpes);
          const max = Math.max(...rpes);
          p += min === max ? ` RPE ${min}` : ` RPE ${min}-${max}`;
        }
      } else {
        const e = rows[0];
        if (e.sets != null && e.reps != null) p += ` ${e.sets}×${e.reps}`;
        if (e.weight != null) p += ` @${e.weight}${e.weight_unit === "kg" ? "kg" : "lbs"}`;
        if (e.rpe != null) p += ` RPE ${e.rpe}`;
      }
      parts.push(p);
    }
    return `Strength: ${parts.join(", ") || block.block_text.slice(0, 60).replace(/\n/g, " ")}`;
  }

  if (block.block_type === "metcon") {
    const typeLabel = getMetconTypeLabel(block.block_text);
    const parts: string[] = [];
    if (block.score) parts.push(block.score);
    if (block.rx) parts.push("Rx");
    if (sorted.length > 0) {
      parts.push(
        "(" +
          sorted
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
    return `${typeLabel}: ${parts.length > 0 ? parts.join(" ") : block.block_text.slice(0, 60).replace(/\n/g, " ")}`;
  }

  if (block.block_type === "warm-up" || block.block_type === "cool-down") {
    const label = block.block_type === "warm-up" ? "Warm-up" : "Cool-down";
    return `${label}: ${block.block_text.slice(0, 60).replace(/\n/g, " ")}`;
  }

  if (block.block_type === "skills") {
    if (sorted.length > 0) {
      const parts: string[] = [];
      for (const e of sorted.slice(0, 4)) {
        let p = formatMovementName(e.movement);
        if (e.variation) p += ` (${e.variation})`;
        if (e.sets != null && e.reps != null && e.reps_completed != null) {
          p += ` ${e.sets}×${e.reps_completed}/${e.reps}`;
        } else if (e.sets != null && e.reps != null) {
          p += ` ${e.sets}×${e.reps}`;
        }
        if (e.hold_seconds != null) p += ` ${e.hold_seconds}s hold`;
        if (e.distance != null) p += ` ${e.distance}${e.distance_unit || "ft"}`;
        if (e.weight != null) p += ` @${e.weight}${e.weight_unit === "kg" ? "kg" : "lbs"}`;
        if (e.rpe != null) p += ` RPE ${e.rpe}`;
        if (e.quality) p += ` Q:${e.quality}`;
        if (e.scaling_note) p += ` — ${e.scaling_note}`;
        parts.push(p);
      }
      return `Skills: ${parts.join(", ")}`;
    }
    return `Skills: ${block.block_text.slice(0, 60).replace(/\n/g, " ")}`;
  }

  // accessory / other
  const label = block.block_type === "accessory" ? "Accessory" : "Other";
  if (sorted.length > 0) {
    const parts = sorted.slice(0, 3).map((e) => {
      let p = formatMovementName(e.movement);
      if (e.sets != null && e.reps != null) p += ` ${e.sets}×${e.reps}`;
      return p;
    });
    return `${label}: ${parts.join(", ")}`;
  }
  return `${label}: ${block.block_text.slice(0, 60).replace(/\n/g, " ")}`;
}

/**
 * Format workout logs with per-block detail.
 *
 * @param logs - Workout logs ordered by workout_date DESC
 * @param blocks - Block rows for those logs
 * @param entries - Entry rows for those logs
 * @param options.maxLines - Cap output length (default 30)
 */
export function formatRecentHistory(
  logs: WorkoutLogRow[],
  blocks: WorkoutLogBlockRow[],
  entries: WorkoutLogEntryRow[],
  options?: { maxLines?: number }
): string {
  if (logs.length === 0) return "";

  const blocksByLog = new Map<string, WorkoutLogBlockRow[]>();
  for (const b of blocks) {
    const list = blocksByLog.get(b.log_id) || [];
    list.push(b);
    blocksByLog.set(b.log_id, list);
  }

  const entriesByLabel = new Map<string, WorkoutLogEntryRow[]>();
  for (const e of entries) {
    // key by log_id + block_label so entries match their block
    const key = `${e.log_id}::${e.block_label ?? ""}`;
    const list = entriesByLabel.get(key) || [];
    list.push(e);
    entriesByLabel.set(key, list);
  }

  const lines: string[] = [];
  const maxLines = options?.maxLines ?? 30;

  for (const log of logs) {
    if (lines.length >= maxLines) break;

    const dateLabel = formatDate(log.workout_date);
    const logBlocks = (blocksByLog.get(log.id) || []).sort(
      (a, b) => a.sort_order - b.sort_order
    );

    if (logBlocks.length === 0) {
      // Fallback for logs without blocks
      const line = `${dateLabel} — ${log.workout_text.slice(0, 80).replace(/\n/g, " ")}`;
      lines.push(line);
      continue;
    }

    for (const block of logBlocks) {
      if (lines.length >= maxLines) break;
      const key = `${log.id}::${block.block_label ?? ""}`;
      const blockEntries = entriesByLabel.get(key) || [];
      const summary = formatBlock(block, blockEntries);
      lines.push(`${dateLabel} — ${summary}`);
    }
  }

  return "RECENT TRAINING (last 14 days):\n" + lines.join("\n");
}

/**
 * Fetches last N days of workout logs, blocks, and entries for a user.
 * Formats them for AI context with per-block detail.
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
    .select("id, workout_date, workout_text, workout_type")
    .eq("user_id", userId)
    .gte("workout_date", cutoffStr)
    .order("workout_date", { ascending: false });

  if (!logs || (logs as WorkoutLogRow[]).length === 0) return "";

  const logIds = (logs as WorkoutLogRow[]).map((l) => l.id);

  // Fetch blocks and entries in parallel
  const [{ data: blocks }, { data: entries }] = await Promise.all([
    supa
      .from("workout_log_blocks")
      .select("log_id, block_type, block_label, block_text, score, rx, sort_order")
      .in("log_id", logIds),
    supa
      .from("workout_log_entries")
      .select("log_id, movement, sets, reps, weight, weight_unit, rpe, scaling_note, sort_order, block_label, set_number, reps_completed, hold_seconds, distance, distance_unit, quality, variation")
      .in("log_id", logIds),
  ]);

  return formatRecentHistory(
    logs as WorkoutLogRow[],
    (blocks || []) as WorkoutLogBlockRow[],
    (entries || []) as WorkoutLogEntryRow[],
    { maxLines: options?.maxLines }
  );
}
