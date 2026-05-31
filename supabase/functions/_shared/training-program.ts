/**
 * Formats the user's most recent training program into a compact text block
 * for AI chat context. Shows the program name and a one-line-per-day summary
 * for the current week (based on program structure, not calendar).
 *
 * Output example:
 *   TRAINING PROGRAM: "Strength Block" (12 weeks)
 *   Week 1, Day 1: Back Squat 5×5 @80%, RDL 3×10, Plank 3×45s
 *   Week 1, Day 2: Bench Press 5×5 @80%, Barbell Row 4×8
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ProgramRow {
  id: string;
  name: string;
}

interface ProgramWorkoutRow {
  week_num: number;
  day_num: number;
  workout_text: string | null;
  sort_order: number;
}

/**
 * Compress a full workout_text blob into a single short line.
 * Takes the first 120 chars, collapses newlines into " | ".
 * Null-safe: v3 days leave workout_text NULL (structure lives in the typed
 * tables) — those are summarized via the v3 path, not here.
 */
function compressWorkoutText(text: string | null): string {
  if (!text) return "";
  const oneLine = text.replace(/\n+/g, " | ").replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? oneLine.slice(0, 117) + "..." : oneLine;
}

/** Compact one-movement summary for the program-context line (no scaling/RPE). */
// deno-lint-ignore no-explicit-any
function compactMovement(m: any): string {
  let s = String(m.movement ?? "").trim();
  const arr: number[] | null = Array.isArray(m.rep_scheme) ? m.rep_scheme : null;
  if (m.calories != null && m.calories > 0) s += ` ${m.calories}cal`;
  else if (arr && arr.length > 1 && !arr.every((n: number) => n === arr[0])) s += ` ${arr.join("-")}`;
  else if (m.sets != null && m.reps != null) s += ` ${m.sets}×${m.reps}`;
  else if (m.reps != null) s += ` ${m.reps}`;
  if (m.weight != null) s += ` ${m.weight}${m.weight_unit ?? "lbs"}`;
  else if (m.distance != null) s += ` ${m.distance}${m.distance_unit ?? ""}`;
  else if (m.time_seconds != null) s += ` ${m.time_seconds}s`;
  return s.trim();
}

/**
 * Format program workouts into a compact text block.
 */
export function formatProgramContext(
  program: ProgramRow,
  workouts: ProgramWorkoutRow[]
): string {
  if (workouts.length === 0) return "";

  const maxWeek = Math.max(...workouts.map((w) => w.week_num));
  const sorted = [...workouts].sort(
    (a, b) => a.week_num - b.week_num || a.day_num - b.day_num || a.sort_order - b.sort_order
  );

  const lines: string[] = [
    `TRAINING PROGRAM: "${program.name}" (${maxWeek} week${maxWeek === 1 ? "" : "s"})`,
  ];

  for (const w of sorted) {
    lines.push(`Week ${w.week_num}, Day ${w.day_num}: ${compressWorkoutText(w.workout_text)}`);
  }

  return lines.join("\n");
}

/**
 * Fetch the user's most recent program and format it for AI context.
 * Returns an empty string if the user has no programs.
 */
export async function fetchAndFormatProgramContext(
  supa: SupabaseClient,
  userId: string
): Promise<string> {
  // Grab the most recently created program
  const { data: program } = await supa
    .from("programs")
    .select("id, name, program_version")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!program) return "";

  const { data: workouts } = await supa
    .from("program_workouts")
    .select("id, week_num, day_num, workout_text, sort_order")
    .eq("program_id", program.id)
    .order("sort_order");

  if (!workouts || workouts.length === 0) return "";

  // v3 programs leave workout_text NULL — summarize from the structured rows.
  if ((program as { program_version?: string }).program_version === "v3") {
    return await formatV3ProgramContext(
      supa,
      program as ProgramRow,
      workouts as Array<ProgramWorkoutRow & { id: string }>,
    );
  }

  return formatProgramContext(
    program as ProgramRow,
    workouts as ProgramWorkoutRow[]
  );
}

/**
 * v3 program context — batch-fetch blocks + movements for all the program's
 * days and build one compressed line per day, matching the v1 density.
 */
async function formatV3ProgramContext(
  supa: SupabaseClient,
  program: ProgramRow,
  workouts: Array<ProgramWorkoutRow & { id: string }>,
): Promise<string> {
  const workoutIds = workouts.map((w) => w.id);
  const { data: blocks } = await supa
    .from("program_blocks_v2")
    .select("id, program_workout_id, sort_order")
    .in("program_workout_id", workoutIds)
    .order("sort_order");

  const blockIds = (blocks || []).map((b) => (b as { id: string }).id);
  const { data: movements } = blockIds.length
    ? await supa
        .from("program_movements_v2")
        .select("block_id, movement, sets, reps, rep_scheme, weight, weight_unit, time_seconds, distance, distance_unit, calories, sort_order")
        .in("block_id", blockIds)
        .order("sort_order")
    : { data: [] as unknown[] };

  // deno-lint-ignore no-explicit-any
  const movsByBlock = new Map<string, any[]>();
  // deno-lint-ignore no-explicit-any
  for (const m of (movements || []) as any[]) {
    const arr = movsByBlock.get(m.block_id) ?? [];
    arr.push(m);
    movsByBlock.set(m.block_id, arr);
  }
  // block_id list per workout, in sort order
  const blockIdsByWorkout = new Map<string, string[]>();
  // deno-lint-ignore no-explicit-any
  for (const b of (blocks || []) as any[]) {
    const arr = blockIdsByWorkout.get(b.program_workout_id) ?? [];
    arr.push(b.id);
    blockIdsByWorkout.set(b.program_workout_id, arr);
  }

  const maxWeek = Math.max(...workouts.map((w) => w.week_num));
  const sorted = [...workouts].sort(
    (a, b) => a.week_num - b.week_num || a.day_num - b.day_num || a.sort_order - b.sort_order
  );

  const lines: string[] = [
    `TRAINING PROGRAM: "${program.name}" (${maxWeek} week${maxWeek === 1 ? "" : "s"})`,
  ];
  for (const w of sorted) {
    const movStrs: string[] = [];
    for (const bid of blockIdsByWorkout.get(w.id) ?? []) {
      for (const m of movsByBlock.get(bid) ?? []) movStrs.push(compactMovement(m));
    }
    const summary = movStrs.join(", ");
    lines.push(
      `Week ${w.week_num}, Day ${w.day_num}: ${summary.length > 120 ? summary.slice(0, 117) + "..." : summary}`
    );
  }
  return lines.join("\n");
}
