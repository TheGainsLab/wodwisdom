/**
 * Display-only formatting for movement names.
 *
 * Handles both input shapes in the app:
 *   - canonical keys from the log/analytics side ("ghd_sit_up")
 *   - already title-cased display names from the program side ("Ghd Sit Up")
 *
 * Both arrive mangled on acronyms, because title-casing per word turns "hspu"
 * into "Hspu" and "ghd" into "Ghd". This applies an acronym map on top.
 *
 * Deliberately a render-layer fix, not a data migration:
 * `workout_log_entries.movement` is grouped by raw string in several places
 * (TrainingLogPage's byMovement, _shared/training-history.ts on the backend),
 * and that grouping is correct precisely because every row uses the same
 * stored form. Rewriting stored names would split those groups.
 *
 * NEVER apply this to an edit field — the edited value is written back to the
 * database, so formatting it there would corrupt the stored vocabulary. See
 * V3MovementEditRow, which intentionally binds the raw `movement.movement`.
 *
 * Scope note: acronym casing only. Hyphenating compound names ("Muscle Up" vs
 * "Muscle-Up", "Toes To Bar" vs "Toes-to-Bar") is a vocabulary decision rather
 * than a rendering bug — Tier 4 competition data uses hyphenated forms while
 * the program generator does not — and reconciling the two is separate.
 */

/** Lowercased word → canonical rendering. Extend as new acronyms appear. */
const ACRONYMS: Record<string, string> = {
  hspu: 'HSPU',
  ghd: 'GHD',
  kb: 'KB',
  db: 'DB',
  rdl: 'RDL',
  ohs: 'OHS',
  t2b: 'T2B',
  c2b: 'C2B',
  bmu: 'BMU',
  rmu: 'RMU',
};

export function formatMovementName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => {
      const acronym = ACRONYMS[word.toLowerCase()];
      if (acronym) return acronym;
      // Capitalise only all-lowercase words. Leaving mixed-case words alone
      // keeps already-correct forms intact — a blanket /\b\w/ title-case would
      // rewrite "Toes-to-Bar" as "Toes-To-Bar".
      return word === word.toLowerCase()
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word;
    })
    .join(' ');
}
