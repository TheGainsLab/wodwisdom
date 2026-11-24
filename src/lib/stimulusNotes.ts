/**
 * A conditioning piece's purpose note (program_blocks_v2.stimulus_note),
 * loaded on its own so the pages' main block queries never depend on the
 * column: if it is not there yet, or the read fails, the page simply shows
 * no note (2026-11-24).
 */
import { supabase } from './supabase';

/** blockId → note, for the metcon blocks among `blockIds` that have one. */
export async function loadStimulusNotes(blockIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    for (let i = 0; i < blockIds.length; i += 100) {
      const { data, error } = await supabase
        .from('program_blocks_v2')
        .select('id, stimulus_note')
        .in('id', blockIds.slice(i, i + 100))
        .not('stimulus_note', 'is', null);
      if (error) return out; // column not there yet, or unreadable: no notes
      for (const r of (data as Array<{ id: string; stimulus_note: string | null }> | null) ?? []) {
        if (r.stimulus_note?.trim()) out.set(r.id, r.stimulus_note.trim());
      }
    }
  } catch { /* best-effort */ }
  return out;
}
