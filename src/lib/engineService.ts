/**
 * Engine Service — client-side data access for the Engine conditioning program.
 * All queries use the shared supabase client with session-based auth (RLS).
 */

import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────

export interface EngineWorkout {
  id: string;
  program_type: string;
  day_number: number;
  day_type: string;
  phase: number;
  block_count: number | null;
  set_rest_seconds: number | null;
  block_1_params: Record<string, unknown> | null;
  block_2_params: Record<string, unknown> | null;
  block_3_params: Record<string, unknown> | null;
  block_4_params: Record<string, unknown> | null;
  total_duration_minutes: number | null;
  base_intensity_percent: number | null;
  month: number | null;
  avg_work_rest_ratio: number | null;
}

export interface EngineDayType {
  id: string;
  name: string;
  phase_requirement: number;
  block_count: number;
  set_rest_seconds: number | null;
  block_1_params: Record<string, unknown> | null;
  block_2_params: Record<string, unknown> | null;
  block_3_params: Record<string, unknown> | null;
  block_4_params: Record<string, unknown> | null;
  max_duration_minutes: number | null;
  is_support_day: boolean;
}

export interface EngineProgramMapping {
  id: number;
  engine_program_id: string;
  engine_workout_day_number: number;
  program_sequence_order: number;
  week_number: number | null;
}

export interface EngineWorkoutSession {
  id: string;
  user_id: string;
  date: string;
  program_day: number | null;
  program_day_number: number | null;
  day_type: string | null;
  modality: string | null;
  units: string | null;
  target_pace: number | null;
  actual_pace: number | null;
  total_output: number | null;
  performance_ratio: number | null;
  calculated_rpm: number | null;
  average_heart_rate: number | null;
  peak_heart_rate: number | null;
  perceived_exertion: number | null;
  workout_data: Record<string, unknown> | null;
  completed: boolean;
  program_version: string;
  created_at: string;
}

export interface EngineTimeTrial {
  id: string;
  user_id: string;
  modality: string;
  date: string;
  total_output: number;
  calculated_rpm: number | null;
  units: string | null;
  is_current: boolean;
}

export interface EngineModalityPreference {
  modality: string;
  primary_unit: string | null;
  secondary_unit: string | null;
}

export interface EnginePerformanceMetrics {
  day_type: string;
  modality: string;
  learned_max_pace: number | null;
  rolling_avg_ratio: number | null;
  rolling_count: number;
  last_4_ratios: number[];
}

export interface EngineUserProgress {
  engine_program_version: string;
  engine_current_day: number;
  engine_months_unlocked: number;
}

export interface EngineProgram {
  id: string;
  name: string;
  description: string | null;
  days_per_week: number;
  total_days: number;
  sort_order: number;
  is_active: boolean;
}

// ─── Work duration calculation ────────────────────────────────────────

/**
 * Calculate the total work-only duration (in seconds) for a workout,
 * summing across all blocks. This is the value used for pacing —
 * rest time is excluded.
 */
export function calculateWorkDurationSeconds(workout: EngineWorkout): number {
  const blockParams: (Record<string, unknown> | null)[] = [
    workout.block_1_params,
    workout.block_2_params,
    workout.block_3_params,
    workout.block_4_params,
  ];
  const blockCount = workout.block_count ?? 1;
  let totalWork = 0;

  for (let b = 0; b < blockCount; b++) {
    const raw = blockParams[b];
    if (!raw) continue;

    const rounds = resolveNumParam(raw.rounds, 1);
    const workDur = resolveNumParam(raw.workDuration, 0);
    const workProg = raw.workProgression as string | undefined;

    if (workDur === 0) continue;

    // Flux & polarized: workDuration is the total continuous time (all work)
    if (workProg === 'alternating_paces' || workProg === 'continuous_with_bursts' || workProg === 'progressive_flux_intensity') {
      totalWork += workDur;

    // Progressive: work duration increases each round
    } else if (workProg === 'increasing' && typeof raw.workDurationIncrement === 'number' && raw.workDurationIncrement !== 0) {
      const inc = raw.workDurationIncrement;
      // round 0: workDur, round 1: workDur + inc, ..., round n-1: workDur + (n-1)*inc
      totalWork += rounds * workDur + inc * (rounds * (rounds - 1)) / 2;

    // Single or consistent: simple multiply
    } else {
      totalWork += rounds * workDur;
    }
  }

  return totalWork;
}

/** Calculate work duration in minutes (rounded). */
export function calculateWorkDurationMinutes(workout: EngineWorkout): number {
  return Math.round(calculateWorkDurationSeconds(workout) / 60);
}

function resolveNumParam(v: unknown, fallback = 0): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  return fallback;
}

// ─── Workouts (read-only reference data) ─────────────────────────────

/** Load all 720 workouts (or for a specific program_type). */
export async function loadWorkouts(
  programType = 'main_5day'
): Promise<EngineWorkout[]> {
  const { data, error } = await supabase
    .from('engine_workouts')
    .select('*')
    .eq('program_type', programType)
    .order('day_number');

  if (error) throw error;
  return data ?? [];
}

/** Load a single workout by day number. */
export async function loadWorkoutForDay(
  dayNumber: number,
  programType = 'main_5day'
): Promise<EngineWorkout | null> {
  const { data, error } = await supabase
    .from('engine_workouts')
    .select('*')
    .eq('program_type', programType)
    .eq('day_number', dayNumber)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Load all day type definitions. */
export async function loadDayTypes(): Promise<EngineDayType[]> {
  const { data, error } = await supabase
    .from('engine_day_types')
    .select('*')
    .order('name');

  if (error) throw error;
  return data ?? [];
}

/** Load a single day type by id. */
export async function loadDayType(id: string): Promise<EngineDayType | null> {
  const { data, error } = await supabase
    .from('engine_day_types')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ─── Program registry ────────────────────────────────────────────────

/** Load all active program variants. */
export async function loadPrograms(): Promise<EngineProgram[]> {
  const { data, error } = await supabase
    .from('engine_programs')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');

  if (error) throw error;
  return data ?? [];
}

// ─── Program mapping ─────────────────────────────────────────────────

/** Get program mapping for a given program variant (e.g. 'main_3day'). */
export async function getProgramMapping(
  programId: string
): Promise<EngineProgramMapping[]> {
  const { data, error } = await supabase
    .from('engine_program_mapping')
    .select('*')
    .eq('engine_program_id', programId)
    .order('program_sequence_order');

  if (error) throw error;
  return data ?? [];
}

// Legacy version strings → current program IDs
const VERSION_ALIASES: Record<string, string> = {
  '5-day': 'main_5day',
  '3-day': 'main_3day',
};

/**
 * Get workouts for a program version, in the variant's sequence order.
 * All variants (including main_5day) use the mapping table for uniform handling.
 */
export async function getWorkoutsForProgram(
  version: string
): Promise<EngineWorkout[]> {
  const normalizedVersion = VERSION_ALIASES[version] ?? version;
  const mapping = await getProgramMapping(normalizedVersion);
  if (mapping.length === 0) return [];

  const dayNumbers = mapping.map((m) => m.engine_workout_day_number);

  // Fetch catalog workouts in batches of 100 to avoid URL length limits
  const workouts: EngineWorkout[] = [];
  for (let i = 0; i < dayNumbers.length; i += 100) {
    const batch = dayNumbers.slice(i, i + 100);
    const { data, error } = await supabase
      .from('engine_workouts')
      .select('*')
      .eq('program_type', 'main_5day')
      .in('day_number', batch);

    if (error) throw error;
    if (data) workouts.push(...data);
  }

  // Return in mapping sequence order
  const byDay = new Map(workouts.map((w) => [w.day_number, w]));
  return mapping
    .map((m) => byDay.get(m.engine_workout_day_number))
    .filter((w): w is EngineWorkout => w != null);
}

// ─── Completed sessions (user-scoped) ────────────────────────────────

/** Load all completed workout sessions for the current user. */
export async function loadCompletedSessions(): Promise<EngineWorkoutSession[]> {
  const { data, error } = await supabase
    .from('engine_workout_sessions')
    .select('*')
    .eq('completed', true)
    .order('date', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/** Get a specific session by program day number. */
export async function getWorkoutSessionByDay(
  programDayNumber: number
): Promise<EngineWorkoutSession | null> {
  const { data, error } = await supabase
    .from('engine_workout_sessions')
    .select('*')
    .eq('program_day_number', programDayNumber)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Save a completed workout session. */
export async function saveWorkoutSession(
  session: Omit<EngineWorkoutSession, 'id' | 'user_id' | 'created_at'>
): Promise<EngineWorkoutSession> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('engine_workout_sessions')
    .insert({ ...session, user_id: user.id })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── Time trials ─────────────────────────────────────────────────────

/** Load current time trial baselines, optionally filtered by modality and units. */
export async function loadTimeTrialBaselines(
  modality?: string,
  units?: string
): Promise<EngineTimeTrial[]> {
  let query = supabase
    .from('engine_time_trials')
    .select('*')
    .eq('is_current', true)
    .order('date', { ascending: false });

  if (modality) {
    query = query.eq('modality', modality);
  }
  if (units) {
    query = query.eq('units', units);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** Save a new time trial result. Marks previous trials for this modality as not current. */
export async function saveTimeTrial(
  trial: Pick<EngineTimeTrial, 'modality' | 'total_output' | 'calculated_rpm' | 'units'>
): Promise<EngineTimeTrial> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Mark previous trials for this modality as not current
  await supabase
    .from('engine_time_trials')
    .update({ is_current: false })
    .eq('user_id', user.id)
    .eq('modality', trial.modality)
    .eq('is_current', true);

  const { data, error } = await supabase
    .from('engine_time_trials')
    .insert({
      user_id: user.id,
      modality: trial.modality,
      total_output: trial.total_output,
      calculated_rpm: trial.calculated_rpm,
      units: trial.units,
      is_current: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── Modality preferences ────────────────────────────────────────────

/** Load unit preference for a specific modality. */
export async function loadModalityPreference(
  modality: string
): Promise<EngineModalityPreference | null> {
  const { data, error } = await supabase
    .from('engine_user_modality_preferences')
    .select('modality, primary_unit, secondary_unit')
    .eq('modality', modality)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Save unit preference for a modality (upsert). */
export async function saveModalityPreference(
  pref: EngineModalityPreference
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('engine_user_modality_preferences')
    .upsert(
      {
        user_id: user.id,
        modality: pref.modality,
        primary_unit: pref.primary_unit,
        secondary_unit: pref.secondary_unit,
      },
      { onConflict: 'user_id,modality' }
    );

  if (error) throw error;
}

// ─── Performance metrics ─────────────────────────────────────────────

/** Get performance metrics for a specific day_type + modality. */
export async function getPerformanceMetrics(
  dayType: string,
  modality: string
): Promise<EnginePerformanceMetrics | null> {
  const { data, error } = await supabase
    .from('engine_user_performance_metrics')
    .select('day_type, modality, learned_max_pace, rolling_avg_ratio, rolling_count, last_4_ratios')
    .eq('day_type', dayType)
    .eq('modality', modality)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Get all performance metrics for the current user. */
export async function getAllPerformanceMetrics(): Promise<EnginePerformanceMetrics[]> {
  const { data, error } = await supabase
    .from('engine_user_performance_metrics')
    .select('day_type, modality, learned_max_pace, rolling_avg_ratio, rolling_count, last_4_ratios');

  if (error) throw error;
  return data ?? [];
}

/** Update performance metrics after a workout (calls the RPC function). */
export async function updatePerformanceMetrics(
  dayType: string,
  modality: string,
  performanceRatio: number,
  actualPace: number
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase.rpc('update_engine_performance_metrics', {
    p_user_id: user.id,
    p_day_type: dayType,
    p_modality: modality,
    p_performance_ratio: performanceRatio,
    p_actual_pace: actualPace,
  });

  if (error) throw error;
}

// ─── User progress (from athlete_profiles) ───────────────────────────

/** Load the user's Engine progress fields. */
export async function loadUserProgress(): Promise<EngineUserProgress | null> {
  const { data, error } = await supabase
    .from('athlete_profiles')
    .select('engine_program_version, engine_current_day, engine_months_unlocked')
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Save the user's chosen program version (initial selection). */
export async function saveProgramVersion(version: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('athlete_profiles')
    .upsert(
      { user_id: user.id, engine_program_version: version },
      { onConflict: 'user_id' }
    );

  if (error) throw error;
}

/** Load the user's current program version. */
export async function loadProgramVersion(): Promise<string> {
  const progress = await loadUserProgress();
  return progress?.engine_program_version ?? 'main_5day';
}

/**
 * Switch to a different program variant, preserving month position.
 * Looks up the user's current month, then sets engine_current_day to the
 * first sequence day of that month in the new variant.
 */
export async function switchProgram(newProgramId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Get current progress to find which month the user is in
  const progress = await loadUserProgress();
  let targetMonth = 1;

  if (progress && progress.engine_program_version) {
    // Resolve the current day's catalog workout to find its month
    const currentMapping = await getProgramMapping(progress.engine_program_version);
    const currentEntry = currentMapping.find(
      (m) => m.program_sequence_order === progress.engine_current_day
    );
    if (currentEntry) {
      const workout = await loadWorkoutForDay(currentEntry.engine_workout_day_number);
      if (workout?.month) {
        targetMonth = workout.month;
      }
    }
  }

  // Find the first sequence day of that month in the new variant
  const newMapping = await getProgramMapping(newProgramId);
  let newCurrentDay = 1;

  if (newMapping.length > 0) {
    // Fetch all catalog days referenced by the new mapping to find month boundaries
    const dayNumbers = newMapping.map((m) => m.engine_workout_day_number);
    const workouts: EngineWorkout[] = [];
    for (let i = 0; i < dayNumbers.length; i += 100) {
      const batch = dayNumbers.slice(i, i + 100);
      const { data, error } = await supabase
        .from('engine_workouts')
        .select('day_number, month')
        .eq('program_type', 'main_5day')
        .in('day_number', batch);
      if (error) throw error;
      if (data) workouts.push(...(data as EngineWorkout[]));
    }

    const monthByDay = new Map(workouts.map((w) => [w.day_number, w.month]));

    // Walk the new mapping in sequence order and find the first day in targetMonth
    for (const entry of newMapping) {
      const month = monthByDay.get(entry.engine_workout_day_number);
      if (month === targetMonth) {
        newCurrentDay = entry.program_sequence_order;
        break;
      }
    }

    // If targetMonth doesn't exist in the new variant (e.g. user was beyond its range),
    // fall back to the last available day
    if (newCurrentDay === 1 && targetMonth > 1) {
      newCurrentDay = newMapping[newMapping.length - 1].program_sequence_order;
    }
  }

  const { error } = await supabase
    .from('athlete_profiles')
    .update({
      engine_program_version: newProgramId,
      engine_current_day: newCurrentDay,
    })
    .eq('user_id', user.id);

  if (error) throw error;
}

/** Advance the user's current day (called after completing a workout). */
export async function advanceCurrentDay(newDay: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('athlete_profiles')
    .update({ engine_current_day: newDay })
    .eq('user_id', user.id);

  if (error) throw error;
}
