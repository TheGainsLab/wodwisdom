/**
 * written-weeks — the weeks of a month AS THEY STAND NOW, rebuilt from the
 * program's own rows, for a week job to progress from.
 *
 * Why (2026-11-23): a week job got its "prior written weeks" from
 * program_month_skeletons.written_weeks — a copy taken when each week was
 * first written. When the athlete or the coach then edited a written day
 * (a swapped movement, a changed load: rows in program_blocks_v2 /
 * program_movements_v2), later weeks still progressed from the original. The
 * prior weeks are now read from the current rows; the stored copy is only the
 * fallback for when the rows cannot be read.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { BlockPrescription, MovementPrescription, WeekPrescription } from "./v2-output-schema.ts";

export interface WorkoutRow { id: string; week_num: number; day_num: number; sort_order?: number | null }
export interface BlockRow {
  id: string;
  program_workout_id: string;
  block_type: string;
  block_label?: string | null;
  block_scheme?: string | null;
  scheme_format?: unknown;
  time_cap_seconds?: number | null;
  block_notes?: string | null;
  cardio_modality?: string | null;
  expected_benchmark?: unknown;
  sort_order?: number | null;
}
export interface MovementRow {
  block_id: string;
  movement: string;
  sets?: number | null;
  reps?: number | null;
  rep_scheme?: number[] | null;
  weight?: number | null;
  weight_unit?: string | null;
  rpe?: number | null;
  time_seconds?: number | null;
  distance?: number | null;
  distance_scheme?: number[] | null;
  distance_unit?: string | null;
  calories?: number | null;
  cal_scheme?: number[] | null;
  max_effort?: boolean | null;
  cardio_modality?: string | null;
  scaling_note?: string | null;
  target_pct_1rm?: number | null;
  sort_order?: number | null;
}

const bySort = <T extends { sort_order?: number | null }>(a: T, b: T) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
const hasList = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0;

/** One stored movement row back in the writer's shape. Save stores the summed
 *  total next to a scheme; the writer's convention is the scheme alone. */
function movementFromRow(r: MovementRow): MovementPrescription {
  const m: Record<string, unknown> = { movement: r.movement };
  if (r.sets != null) m.sets = r.sets;
  if (hasList(r.rep_scheme)) m.rep_scheme = r.rep_scheme;
  else if (r.reps != null) m.reps = r.reps;
  if (r.weight != null) m.weight = r.weight;
  if (r.weight_unit != null) m.weight_unit = r.weight_unit;
  if (r.rpe != null) m.rpe = r.rpe;
  if (r.time_seconds != null) m.time_seconds = r.time_seconds;
  if (hasList(r.distance_scheme)) m.distance_scheme = r.distance_scheme;
  else if (r.distance != null) m.distance = r.distance;
  if (r.distance_unit != null) m.distance_unit = r.distance_unit;
  if (hasList(r.cal_scheme)) m.cal_scheme = r.cal_scheme;
  else if (r.calories != null) m.calories = r.calories;
  if (r.max_effort === true) m.max_effort = true;
  if (r.cardio_modality != null) m.cardio_modality = r.cardio_modality;
  if (r.scaling_note != null) m.scaling_note = r.scaling_note;
  if (r.target_pct_1rm != null) m.target_pct_1rm = r.target_pct_1rm;
  return m as unknown as MovementPrescription;
}

function blockFromRow(b: BlockRow, movements: MovementRow[]): BlockPrescription {
  const out: Record<string, unknown> = { block_type: b.block_type };
  if (b.block_label != null) out.block_label = b.block_label;
  if (b.block_scheme != null) out.block_scheme = b.block_scheme;
  if (b.scheme_format != null) out.scheme_format = b.scheme_format;
  if (b.time_cap_seconds != null) out.time_cap_seconds = b.time_cap_seconds;
  if (b.block_notes != null) out.block_notes = b.block_notes;
  if (b.cardio_modality != null) out.cardio_modality = b.cardio_modality;
  if (b.expected_benchmark != null) out.expected_benchmark = b.expected_benchmark;
  out.movements = [...movements].sort(bySort).map(movementFromRow);
  return out as unknown as BlockPrescription;
}

/**
 * Pure: the stored rows of a month's written days, as weeks in the writer's
 * shape, in week / day / block / movement order. If a day has more than one
 * row (an old duplicate), the first by sort order is used.
 */
export function weeksFromRows(workouts: WorkoutRow[], blocks: BlockRow[], movements: MovementRow[]): WeekPrescription[] {
  const movementsByBlock = new Map<string, MovementRow[]>();
  for (const m of movements) movementsByBlock.set(m.block_id, [...(movementsByBlock.get(m.block_id) ?? []), m]);
  const blocksByWorkout = new Map<string, BlockRow[]>();
  for (const b of blocks) blocksByWorkout.set(b.program_workout_id, [...(blocksByWorkout.get(b.program_workout_id) ?? []), b]);

  const weeks = new Map<number, WeekPrescription>();
  const seenDay = new Set<string>();
  for (const w of [...workouts].sort((a, b) => a.week_num - b.week_num || a.day_num - b.day_num || bySort(a, b))) {
    const key = `${w.week_num}-${w.day_num}`;
    if (seenDay.has(key)) continue;
    seenDay.add(key);
    const week = weeks.get(w.week_num) ?? { week_num: w.week_num, days: [] };
    week.days.push({
      day_num: w.day_num,
      blocks: [...(blocksByWorkout.get(w.id) ?? [])].sort(bySort).map((b) => blockFromRow(b, movementsByBlock.get(b.id) ?? [])),
    });
    weeks.set(w.week_num, week);
  }
  return [...weeks.values()].sort((a, b) => a.week_num - b.week_num);
}

const CHUNK = 50;

/** The written weeks before `beforeWeek` of one month, from the current rows.
 *  THROWS when any read fails — the caller falls back to the stored copy. */
export async function loadWrittenWeeksFromRows(
  supa: SupabaseClient,
  programId: string,
  monthNumber: number,
  beforeWeek: number,
): Promise<WeekPrescription[]> {
  const { data: pw, error: pwErr } = await supa
    .from("program_workouts")
    .select("id, week_num, day_num, sort_order")
    .eq("program_id", programId)
    .eq("month_number", monthNumber)
    .eq("status", "written")
    .lt("week_num", beforeWeek);
  if (pwErr) throw new Error(`program_workouts read failed: ${pwErr.message}`);
  const workouts = (pw ?? []) as WorkoutRow[];
  if (workouts.length === 0) return [];

  const blocks: BlockRow[] = [];
  const workoutIds = workouts.map((w) => w.id);
  for (let i = 0; i < workoutIds.length; i += CHUNK) {
    const { data, error } = await supa
      .from("program_blocks_v2")
      .select("id, program_workout_id, block_type, block_label, block_scheme, scheme_format, time_cap_seconds, block_notes, cardio_modality, expected_benchmark, sort_order")
      .in("program_workout_id", workoutIds.slice(i, i + CHUNK));
    if (error) throw new Error(`program_blocks_v2 read failed: ${error.message}`);
    blocks.push(...((data ?? []) as BlockRow[]));
  }

  const movements: MovementRow[] = [];
  const blockIds = blocks.map((b) => b.id);
  for (let i = 0; i < blockIds.length; i += CHUNK) {
    const { data, error } = await supa
      .from("program_movements_v2")
      .select("block_id, movement, sets, reps, rep_scheme, weight, weight_unit, rpe, time_seconds, distance, distance_scheme, distance_unit, calories, cal_scheme, max_effort, cardio_modality, scaling_note, target_pct_1rm, sort_order")
      .in("block_id", blockIds.slice(i, i + CHUNK));
    if (error) throw new Error(`program_movements_v2 read failed: ${error.message}`);
    movements.push(...((data ?? []) as MovementRow[]));
  }
  return weeksFromRows(workouts, blocks, movements);
}

/**
 * The prior weeks a week job progresses from: the program as it stands now,
 * edits included. Falls back to the stored copy (the weeks as first written)
 * only when the rows cannot be read.
 */
export async function priorWeeksForWeekJob(
  supa: SupabaseClient,
  programId: string,
  monthNumber: number,
  weekNum: number,
  storedWrittenWeeks: WeekPrescription[],
): Promise<{ weeks: WeekPrescription[]; source: "rows" | "stored" }> {
  try {
    return { weeks: await loadWrittenWeeksFromRows(supa, programId, monthNumber, weekNum), source: "rows" };
  } catch (e) {
    console.warn(`[written-weeks] ${programId} m${monthNumber}: current rows unreadable, using the stored copy:`, e instanceof Error ? e.message : String(e));
    return { weeks: storedWrittenWeeks.filter((w) => w.week_num < weekNum), source: "stored" };
  }
}
