/**
 * activitiesService — client CRUD for athlete_activities + athlete_benchmarks.
 *
 * Entry flow: parseActivity (free text → structured card via the
 * parse-activity edge fn) → athlete confirms/edits → saveActivity. Benchmarks
 * detected at parse time save via saveBenchmark, which flips is_current on
 * the prior result for the same (name, unit) — the engine_time_trials retest
 * pattern. Activities are athlete-editable/deletable (advisory context, not
 * program truth); benchmarks are editable, never deletable (RLS enforces).
 */

import { supabase, getAuthHeaders, PARSE_ACTIVITY_ENDPOINT } from './supabase';

export interface ParsedActivity {
  activity_type: string;
  duration_minutes: number | null;
  distance: number | null;
  distance_unit: string | null;
  rpe: number | null;
  avg_hr: number | null;
  peak_hr: number | null;
  summary: string;
  is_benchmark: boolean;
  benchmark: { name: string; value: number; unit: string } | null;
}

export interface AthleteActivity extends Omit<ParsedActivity, 'benchmark'> {
  id: string;
  user_id: string;
  date: string;
  raw_text: string;
  parsed: Record<string, unknown> | null;
  created_at: string;
}

export interface AthleteBenchmark {
  id: string;
  name: string;
  value: number;
  unit: string;
  date: string;
  is_current: boolean;
}

export async function parseActivity(text: string): Promise<ParsedActivity> {
  const resp = await fetch(PARSE_ACTIVITY_ENDPOINT, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ text }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error || `Parse failed (${resp.status})`);
  return data.parsed as ParsedActivity;
}

export async function saveActivity(
  date: string,
  rawText: string,
  parsed: ParsedActivity,
): Promise<AthleteActivity> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('athlete_activities')
    .insert({
      user_id: user.id,
      date,
      raw_text: rawText,
      activity_type: parsed.activity_type,
      duration_minutes: parsed.duration_minutes,
      distance: parsed.distance,
      distance_unit: parsed.distance_unit,
      rpe: parsed.rpe,
      avg_hr: parsed.avg_hr,
      peak_hr: parsed.peak_hr,
      parsed: { summary: parsed.summary },
      is_benchmark: parsed.is_benchmark,
    })
    .select()
    .single();
  if (error) throw error;

  // Benchmark rides along: flip the prior current result for the same
  // (name, unit), then insert the new one as current.
  if (parsed.is_benchmark && parsed.benchmark && parsed.benchmark.value > 0) {
    const b = parsed.benchmark;
    const { data: priors } = await supabase
      .from('athlete_benchmarks')
      .select('id, name')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .eq('unit', b.unit)
      .ilike('name', b.name);
    if (priors && priors.length > 0) {
      await supabase
        .from('athlete_benchmarks')
        .update({ is_current: false })
        .in('id', priors.map((p) => p.id));
    }
    await supabase.from('athlete_benchmarks').insert({
      user_id: user.id,
      name: b.name,
      value: b.value,
      unit: b.unit,
      date,
      is_current: true,
      source_activity_id: (data as AthleteActivity).id,
    });
  }

  return data as AthleteActivity;
}

export async function listActivities(limit = 200): Promise<AthleteActivity[]> {
  const { data, error } = await supabase
    .from('athlete_activities')
    .select('*')
    .order('date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AthleteActivity[];
}

export async function deleteActivity(id: string): Promise<void> {
  const { error } = await supabase.from('athlete_activities').delete().eq('id', id);
  if (error) throw error;
}

export async function updateActivity(
  id: string,
  fields: Partial<Pick<AthleteActivity, 'date' | 'activity_type' | 'duration_minutes' | 'distance' | 'distance_unit' | 'rpe' | 'avg_hr' | 'peak_hr'>>,
): Promise<void> {
  const { error } = await supabase
    .from('athlete_activities')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function listBenchmarks(): Promise<AthleteBenchmark[]> {
  const { data, error } = await supabase
    .from('athlete_benchmarks')
    .select('id, name, value, unit, date, is_current')
    .order('date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AthleteBenchmark[];
}
