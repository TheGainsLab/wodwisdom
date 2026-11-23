/**
 * week-save-rollback.ts — undo a FAILED weekly save without touching the
 * rest of the month.
 *
 * Why (2026-11-23): saveProgramV3's failure path for an existing program was
 * written when a whole month was saved at once, so it deleted every
 * program_workouts row of that program + month. A week job (week 2, 3 or 4)
 * reused it: one failed insert would have deleted the weeks already written
 * and trained AND the outline of the weeks to come — after which the weekly
 * cron finds no outline weeks and skips the program for good.
 *
 * A failed week save now removes ONLY the rows that save inserted, puts back
 * the outline rows it cleared, and records the failure on the month so it is
 * visible and the cron's next tick retries the week. Earlier weeks are never
 * touched. Every step is best-effort and never throws: the caller re-throws
 * the original error.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface OutlineSkeleton {
  weeks: Array<{ week_num: number; days: Array<{ day_num: number }> }>;
}

export interface FailedWeekSave {
  programId: string;
  monthNumber: number;
  /** ids of the program_workouts rows THIS save inserted (empty if the insert never succeeded). */
  insertedWorkoutIds: string[];
  /** The first week whose outline rows this save deleted; null if that delete never ran. */
  clearedOutlineFromWeek: number | null;
  /** Used to rebuild outline rows when the month has no stored skeleton. */
  fallbackSkeleton?: OutlineSkeleton | null;
  error: unknown;
}

export interface RollbackReport {
  removed: number;
  outlineRestored: number;
  problems: string[];
}

export async function rollBackFailedWeekSave(supa: SupabaseClient, f: FailedWeekSave): Promise<RollbackReport> {
  const report: RollbackReport = { removed: 0, outlineRestored: 0, problems: [] };
  const note = (step: string, e: unknown) =>
    report.problems.push(`${step}: ${e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e)}`);

  // 1. Remove only what this save added (blocks and movements cascade).
  if (f.insertedWorkoutIds.length > 0) {
    try {
      const { error } = await supa.from("program_workouts").delete().in("id", f.insertedWorkoutIds);
      if (error) note("remove inserted rows", error.message);
      else report.removed = f.insertedWorkoutIds.length;
    } catch (e) { note("remove inserted rows", e); }
  }

  // 2. Put back the outline rows this save cleared, for every week from that
  //    point that now has no rows at all. The STORED skeleton is the truth
  //    (a failed re-plan was never stored); the in-flight one is the fallback.
  if (f.clearedOutlineFromWeek != null) {
    try {
      const { data: store } = await supa
        .from("program_month_skeletons").select("skeleton")
        .eq("program_id", f.programId).eq("month_number", f.monthNumber).maybeSingle();
      const skeleton = ((store?.skeleton as OutlineSkeleton | null) ?? f.fallbackSkeleton ?? null);
      const { data: present, error: readErr } = await supa
        .from("program_workouts").select("week_num")
        .eq("program_id", f.programId).eq("month_number", f.monthNumber);
      if (readErr) throw new Error(readErr.message);
      const have = new Set((present ?? []).map((r) => r.week_num as number));
      const rows: Array<Record<string, unknown>> = [];
      for (const wk of skeleton?.weeks ?? []) {
        if (wk.week_num < f.clearedOutlineFromWeek || have.has(wk.week_num)) continue;
        for (const day of wk.days ?? []) {
          rows.push({
            program_id: f.programId,
            week_num: wk.week_num,
            day_num: day.day_num,
            month_number: f.monthNumber,
            workout_text: null,
            status: "outline",
            sort_order: (f.monthNumber - 1) * 100 + (wk.week_num - 1) * 10 + day.day_num,
          });
        }
      }
      if (rows.length > 0) {
        const { error } = await supa.from("program_workouts").insert(rows);
        if (error) note("restore outline", error.message);
        else report.outlineRestored = rows.length;
      } else if (!skeleton) {
        note("restore outline", "no skeleton to rebuild the outline from");
      }
    } catch (e) { note("restore outline", e); }
  }

  // 3. Record the failure on the month (visible to admin; cleared by the next good save).
  try {
    const msg = f.error instanceof Error ? f.error.message : String(f.error);
    const tail = report.problems.length ? ` | rollback: ${report.problems.join("; ")}` : "";
    await supa.from("program_month_skeletons")
      .update({ last_fill_error: `save failed: ${msg}${tail}`.slice(0, 500), last_fill_attempt_at: new Date().toISOString() })
      .eq("program_id", f.programId).eq("month_number", f.monthNumber);
  } catch (e) { note("record failure", e); }

  if (report.problems.length) console.error(`[week-save-rollback] ${f.programId} m${f.monthNumber}: ${report.problems.join("; ")}`);
  return report;
}
