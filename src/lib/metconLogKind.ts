/**
 * Which result a metcon's logger asks for — decided from the block's STORED
 * format, never from words in its title (2026-11-24).
 *
 * The logger used to look for "AMRAP" / "EMOM" in the title and treat
 * everything else as a race against the clock, so an interval piece (fixed
 * work and rest, no finish time) was asked for "Result (time)" and offered
 * "Hit the cap". The AI that writes the piece picks its format from a fixed
 * list and that choice is saved on the block (scheme_format.format, see
 * SCHEME_FORMATS in supabase/functions/_shared/v2-output-schema.ts): the
 * logger reads it and guesses nothing.
 *
 * A block with no stored format (written before mid-October 2026) gets the
 * open result: it cannot be known what it is, so nothing is assumed.
 */

export type MetconLogKind =
  /** A race against the clock: finish time, and "Hit the cap". */
  | 'time'
  /** As many rounds as possible: rounds + reps. */
  | 'rounds_reps'
  /** Anything else, or unknown: one optional free-text result, no cap. */
  | 'open';

export function metconLogKind(format: string | null | undefined): MetconLogKind {
  if (format === 'for_time' || format === 'rft') return 'time';
  if (format === 'amrap') return 'rounds_reps';
  return 'open';
}

/** The fields for each kind. `scoreType` is what the benchmark scorer is
 *  given; null means the result is not scored against a benchmark. */
export const METCON_LOG_FIELDS: Record<MetconLogKind, { label: string; placeholder: string; cap: boolean; scoreType: 'for_time' | 'amrap' | null }> = {
  time: { label: 'Result (time)', placeholder: 'e.g. 12:34', cap: true, scoreType: 'for_time' },
  rounds_reps: { label: 'Result (rounds + reps)', placeholder: 'e.g. 5+18', cap: false, scoreType: 'amrap' },
  open: { label: 'Result (optional)', placeholder: 'e.g. reps or pace per round', cap: false, scoreType: null },
};
