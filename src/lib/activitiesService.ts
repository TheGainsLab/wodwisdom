/**
 * activitiesService — client CRUD for athlete_activities + athlete_benchmarks.
 *
 * Entry flow (v2): parseActivity (free text and/or screenshot → one or more
 * structured cards via the parse-activity edge fn) → athlete confirms/edits
 * each → saveActivity per card. Benchmarks detected at parse time save via
 * the same call, flipping is_current on the prior result for the same
 * (name, unit) — the engine_time_trials retest pattern. Activities are
 * athlete-editable/deletable (advisory context, not program truth);
 * benchmarks are editable, never deletable (RLS enforces).
 *
 * Screenshots upload to the private activity-images bucket AT SAVE TIME (an
 * abandoned parse leaves no orphaned files), keyed <userId>/<uuid>.<ext> so
 * the bucket's owner-prefix RLS applies.
 */

import { supabase, getAuthHeaders, PARSE_ACTIVITY_ENDPOINT } from './supabase';

export const WORKOUT_TYPES = ['conditioning', 'metcon', 'strength', 'skills', 'other'] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export interface ParsedActivity {
  workout_type: WorkoutType;
  activity_type: string;
  duration_minutes: number | null;
  rpe: number | null;
  avg_hr: number | null;
  peak_hr: number | null;
  summary: string;
  calories: number | null;
  distance: number | null;
  distance_unit: string | null;
  score: string | null;
  movement: string | null;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  weight_unit: 'lbs' | 'kg' | null;
  detail: { movements: unknown[] } | null;
  is_benchmark: boolean;
  benchmark: { name: string; value: number; unit: string } | null;
}

export interface AthleteActivity {
  id: string;
  user_id: string;
  date: string;
  raw_text: string;
  workout_type: WorkoutType | null;
  activity_type: string | null;
  duration_minutes: number | null;
  rpe: number | null;
  avg_hr: number | null;
  peak_hr: number | null;
  calories: number | null;
  distance: number | null;
  distance_unit: string | null;
  score: string | null;
  movement: string | null;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  weight_unit: string | null;
  image_path: string | null;
  is_benchmark: boolean;
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

export interface ActivityImage {
  base64: string; // bare base64, no data: prefix
  type: 'jpeg' | 'png' | 'webp';
}

export async function parseActivity(text: string, image?: ActivityImage): Promise<ParsedActivity[]> {
  const resp = await fetch(PARSE_ACTIVITY_ENDPOINT, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      text,
      ...(image ? { image_base64: image.base64, image_type: image.type } : {}),
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error || `Parse failed (${resp.status})`);
  // v2 returns activities[]; tolerate a v1 function (single `parsed`) across
  // the deploy boundary.
  if (Array.isArray(data.activities) && data.activities.length > 0) return data.activities as ParsedActivity[];
  if (data.parsed) return [data.parsed as ParsedActivity];
  throw new Error('Parse failed');
}

async function uploadActivityImage(userId: string, image: ActivityImage): Promise<string | null> {
  const path = `${userId}/${crypto.randomUUID()}.${image.type === 'jpeg' ? 'jpg' : image.type}`;
  const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
  const { error } = await supabase.storage
    .from('activity-images')
    .upload(path, bytes, { contentType: `image/${image.type}`, upsert: false });
  // The image is provenance, not the record — a failed upload shouldn't lose
  // the confirmed log. Save without it.
  if (error) return null;
  return path;
}

export async function activityImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('activity-images').createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function saveActivity(
  date: string,
  rawText: string,
  parsed: ParsedActivity,
  image?: ActivityImage,
): Promise<AthleteActivity> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const imagePath = image ? await uploadActivityImage(user.id, image) : null;

  const { data, error } = await supabase
    .from('athlete_activities')
    .insert({
      user_id: user.id,
      date,
      raw_text: rawText || parsed.summary,
      workout_type: parsed.workout_type,
      activity_type: parsed.activity_type,
      duration_minutes: parsed.duration_minutes,
      rpe: parsed.rpe,
      avg_hr: parsed.avg_hr,
      peak_hr: parsed.peak_hr,
      calories: parsed.calories,
      distance: parsed.distance,
      distance_unit: parsed.distance_unit,
      score: parsed.score,
      movement: parsed.movement,
      sets: parsed.sets,
      reps: parsed.reps,
      weight: parsed.weight,
      weight_unit: parsed.weight_unit,
      image_path: imagePath,
      parsed: { summary: parsed.summary, ...(parsed.detail ? { detail: parsed.detail } : {}) },
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

/** A blank card for the manual-entry path (skip the parse entirely). */
export function emptyParsedActivity(): ParsedActivity {
  return {
    workout_type: 'other',
    activity_type: 'other',
    duration_minutes: null,
    rpe: null,
    avg_hr: null,
    peak_hr: null,
    summary: '',
    calories: null,
    distance: null,
    distance_unit: null,
    score: null,
    movement: null,
    sets: null,
    reps: null,
    weight: null,
    weight_unit: null,
    detail: null,
    is_benchmark: false,
    benchmark: null,
  };
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
  fields: Partial<Pick<AthleteActivity, 'date' | 'workout_type' | 'activity_type' | 'duration_minutes' | 'distance' | 'distance_unit' | 'rpe' | 'avg_hr' | 'peak_hr' | 'calories' | 'score' | 'movement' | 'sets' | 'reps' | 'weight' | 'weight_unit'>>,
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
