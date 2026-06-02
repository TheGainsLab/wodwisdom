// Canonical movement vocabulary for typeahead in the manual editor.
//
// Backed by the `movements` reference table (display_name + aliases, the latter
// now carrying shorthand like T2B/DU/CTB after the 2026-05-30 alias backfill).
// Matching is case-insensitive, so "t2b" → "Toes To Bar". The vocab is global
// and static, so it's fetched once and cached at module scope.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface MovementVocabEntry {
  display_name: string;
  /** Lowercased [display_name, ...aliases] for matching. */
  search: string[];
}

let cache: MovementVocabEntry[] | null = null;
let inflight: Promise<MovementVocabEntry[]> | null = null;

function load(): Promise<MovementVocabEntry[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = (async () => {
      const { data } = await supabase.from('movements').select('display_name, aliases');
      const rows = (data ?? []) as { display_name: string; aliases: string[] | null }[];
      const entries = rows.map((r) => ({
        display_name: r.display_name,
        search: [r.display_name, ...(r.aliases ?? [])].map((s) => s.toLowerCase()),
      }));
      cache = entries;
      return entries;
    })();
  }
  return inflight;
}

/** Returns the cached vocab, fetching once on first use. */
export function useMovementVocab(): MovementVocabEntry[] {
  const [vocab, setVocab] = useState<MovementVocabEntry[]>(cache ?? []);
  useEffect(() => {
    let active = true;
    if (!cache) load().then((v) => { if (active) setVocab(v); });
    return () => { active = false; };
  }, []);
  return vocab;
}

/**
 * Rank canonical display_names against a free-text query (case-insensitive).
 * Exact match > prefix match > substring match, across display_name + aliases.
 * Returns up to `limit` canonical display_names.
 */
export function matchMovements(vocab: MovementVocabEntry[], query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { dn: string; score: number }[] = [];
  for (const m of vocab) {
    let best = Infinity;
    for (const s of m.search) {
      if (s === q) { best = 0; break; }
      if (s.startsWith(q)) best = Math.min(best, 1);
      else if (s.includes(q)) best = Math.min(best, 2);
    }
    if (best !== Infinity) scored.push({ dn: m.display_name, score: best });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.dn.localeCompare(b.dn))
    .slice(0, limit)
    .map((s) => s.dn);
}
