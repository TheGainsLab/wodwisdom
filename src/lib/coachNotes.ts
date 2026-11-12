import { supabase } from './supabase';

/**
 * "Tell your coach" notes (founder, 2026-11-12). The low-friction lever for
 * what an athlete wants more or less of, without touching the profile.
 * Written per week on the program page or saved from a Coach card; read by
 * the Engine sequencer, AI Programming generation and the Coach.
 *
 * Horizon: 'next_week' (default) is spent by the next generation of each
 * product and expires after 21 days regardless; 'until_removed' stays until
 * deleted. A standing preference belongs in the profile goal.
 */

export type NoteHorizon = 'next_week' | 'until_removed';

export interface CoachNote {
  id: string;
  text: string;
  horizon: NoteHorizon;
  program_id: string | null;
  week_num: number | null;
  source: 'program_page' | 'coach';
  created_at: string;
  expires_at: string | null;
  consumed_engine_at: string | null;
  consumed_programming_at: string | null;
}

const TTL_DAYS = 21;

/** Every unexpired note, newest first. */
export async function loadCoachNotes(): Promise<CoachNote[]> {
  const { data, error } = await supabase
    .from('coach_notes')
    .select('id, text, horizon, program_id, week_num, source, created_at, expires_at, consumed_engine_at, consumed_programming_at')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CoachNote[];
}

export async function addCoachNote(input: {
  text: string;
  horizon?: NoteHorizon;
  programId?: string | null;
  weekNum?: number | null;
  source?: 'program_page' | 'coach';
}): Promise<CoachNote> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const text = input.text.trim().slice(0, 500);
  if (!text) throw new Error('Empty note');
  const horizon = input.horizon ?? 'next_week';
  const row = {
    user_id: user.id,
    text,
    horizon,
    program_id: input.programId ?? null,
    week_num: input.weekNum ?? null,
    source: input.source ?? 'program_page',
    expires_at: horizon === 'next_week' ? new Date(Date.now() + TTL_DAYS * 864e5).toISOString() : null,
  };
  const { data, error } = await supabase.from('coach_notes').insert(row).select().single();
  if (error) throw error;
  return data as CoachNote;
}

export async function setCoachNoteHorizon(id: string, horizon: NoteHorizon): Promise<void> {
  const { error } = await supabase
    .from('coach_notes')
    .update({ horizon, expires_at: horizon === 'next_week' ? new Date(Date.now() + TTL_DAYS * 864e5).toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteCoachNote(id: string): Promise<void> {
  const { error } = await supabase.from('coach_notes').delete().eq('id', id);
  if (error) throw error;
}

/** "next week" / "until removed" / "used by the Engine", for the list. */
export function describeNote(n: CoachNote): string {
  if (n.horizon === 'until_removed') return 'until removed';
  const spent = [n.consumed_engine_at && 'Engine', n.consumed_programming_at && 'Programming'].filter(Boolean);
  return spent.length ? `read by ${spent.join(' and ')}` : 'next week';
}
