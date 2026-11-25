/**
 * log-counts-toward.ts — a logged entry carries the same `counts_toward`
 * answer as the movement it was logged against (see counts-toward.ts).
 *
 * A log entry's movement is a copy of the prescribed movement's name on that
 * program day, so the answer is looked up on that day's own rows and copied
 * across. This is one row finding itself, not a reading of what a name means.
 * An entry with no program day, or whose movement is not on the day, is left
 * unlabelled; the label-movements function labels it later.
 *
 * Never throws and never blocks a log: any failure means "no labels".
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { storedCountsToward } from "./counts-toward.ts";

/** movement name (trimmed) → counts_toward, for one program day. */
export async function countsTowardForDay(supa: SupabaseClient, programWorkoutId: string | null | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!programWorkoutId) return out;
  try {
    const { data: blocks } = await supa.from("program_blocks_v2").select("id").eq("program_workout_id", programWorkoutId);
    const ids = (blocks ?? []).map((b: { id: string }) => b.id);
    if (ids.length === 0) return out;
    const { data: rows, error } = await supa.from("program_movements_v2").select("movement, counts_toward").in("block_id", ids);
    if (error) return out; // includes "column does not exist" before the migration
    for (const r of (rows ?? []) as Array<{ movement: string | null; counts_toward: string | null }>) {
      const name = (r.movement ?? "").trim();
      const v = storedCountsToward(r.counts_toward);
      if (name && v && !out.has(name)) out.set(name, v);
    }
  } catch { /* no labels */ }
  return out;
}

/**
 * Insert log entries with their labels. If the column is not there yet the
 * entries are saved without it, exactly as before. Returns the insert error,
 * if any, for the caller to log.
 */
export async function insertLogEntries<T extends { movement: string }>(
  supa: SupabaseClient,
  entries: T[],
  programWorkoutId: string | null | undefined,
): Promise<{ message: string } | null> {
  if (entries.length === 0) return null;
  const labels = await countsTowardForDay(supa, programWorkoutId);
  if (labels.size === 0) {
    const { error } = await supa.from("workout_log_entries").insert(entries);
    return error ? { message: error.message } : null;
  }
  const labelled = entries.map((e) => {
    const v = labels.get((e.movement ?? "").trim());
    return v ? { ...e, counts_toward: v } : e;
  });
  let { error } = await supa.from("workout_log_entries").insert(labelled);
  if (error && /counts_toward/.test(error.message ?? "")) {
    ({ error } = await supa.from("workout_log_entries").insert(entries));
  }
  return error ? { message: error.message } : null;
}
