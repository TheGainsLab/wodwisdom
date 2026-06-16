// Shared writer for the training_schedule overlay (the calendar).
//
// Programs and Engine are dateless sequences; this table assigns a date to a
// DAY the user plans to do. One row per source per date (DB partial unique
// indexes) — a collision surfaces as Postgres 23505.
//
// Both sources are once-and-done on the calendar:
//  - Program days: at most one schedule row per program day (reschedule = update
//    the existing row). Completed days drop from the pool.
//  - Engine days: at most one schedule row per engine day (DB unique
//    uniq_schedule_engine_once). You can repeat-DO an engine day, but you can't
//    schedule a repeat — reschedule = move the existing row instead.
import { supabase } from './supabase';

export interface ScheduleResult {
  id?: string;
  scheduled_date?: string;
  /** Friendly, source-aware error message (null on success). */
  error?: string;
}

function friendlyError(code: string | undefined, source: 'program' | 'engine', fallback: string, message?: string): string {
  if (code === '23505') {
    if (source === 'program') return 'That date already has a program day scheduled.';
    // Engine has two unique guards: once-per-engine-day, and one-per-date.
    if (message && message.includes('engine_once')) return 'That Engine day is already on your calendar.';
    return 'That date already has an Engine session scheduled.';
  }
  return fallback;
}

/** Schedule a program day onto a date (new row). 23505 → date taken. */
export async function scheduleProgramDay(userId: string, programWorkoutId: string, date: string): Promise<ScheduleResult> {
  const { data, error } = await supabase
    .from('training_schedule')
    .insert({ user_id: userId, program_workout_id: programWorkoutId, scheduled_date: date })
    .select('id, scheduled_date')
    .single();
  if (error || !data) return { error: friendlyError(error?.code, 'program', error?.message || 'Could not add to calendar.') };
  return { id: data.id as string, scheduled_date: data.scheduled_date as string };
}

/**
 * Schedule an Engine day onto a date (new row) — the engine_workout_id producer.
 * Once-and-done: the DB rejects a second row for the same engine day (23505 →
 * "already on your calendar"). To move it, use rescheduleRow instead.
 */
export async function scheduleEngineDay(userId: string, engineWorkoutId: string, date: string): Promise<ScheduleResult> {
  const { data, error } = await supabase
    .from('training_schedule')
    .insert({ user_id: userId, engine_workout_id: engineWorkoutId, scheduled_date: date })
    .select('id, scheduled_date')
    .single();
  if (error || !data) return { error: friendlyError(error?.code, 'engine', error?.message || 'Could not add to calendar.', error?.message) };
  return { id: data.id as string, scheduled_date: data.scheduled_date as string };
}

/** Move an existing schedule row to a new date. source only drives the error copy. */
export async function rescheduleRow(rowId: string, date: string, source: 'program' | 'engine'): Promise<ScheduleResult> {
  const { error } = await supabase.from('training_schedule').update({ scheduled_date: date }).eq('id', rowId);
  if (error) return { error: friendlyError(error.code, source, error.message || 'Could not reschedule.', error.message) };
  return { id: rowId, scheduled_date: date };
}

/** Remove a schedule row. */
export async function unschedule(rowId: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('training_schedule').delete().eq('id', rowId);
  return error ? { error: error.message || 'Could not remove.' } : {};
}
