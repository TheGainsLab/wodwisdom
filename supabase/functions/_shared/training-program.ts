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
  workout_text: string;
  sort_order: number;
}

/**
 * Compress a full workout_text blob into a single short line.
 * Takes the first 120 chars, collapses newlines into " | ".
 */
function compressWorkoutText(text: string): string {
  const oneLine = text.replace(/\n+/g, " | ").replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? oneLine.slice(0, 117) + "..." : oneLine;
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
    .select("id, name")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!program) return "";

  const { data: workouts } = await supa
    .from("program_workouts")
    .select("week_num, day_num, workout_text, sort_order")
    .eq("program_id", program.id)
    .order("sort_order");

  if (!workouts || workouts.length === 0) return "";

  return formatProgramContext(
    program as ProgramRow,
    workouts as ProgramWorkoutRow[]
  );
}
