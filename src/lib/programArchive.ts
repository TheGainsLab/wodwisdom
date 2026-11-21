/**
 * Programming archive, app side (2026-11-21).
 *
 * A generated program is archived when the athlete's Programming access ends
 * (or by an admin). An archived program is view only, and to everything that
 * asks "does this athlete have a program?" it does not exist — a returner
 * sees what a new subscriber sees. athlete_profiles.programs_archived_at is
 * the moment of their most recent archive: an evaluation only counts toward
 * a new program if it was run after it.
 */

/** Was this row created after the athlete's most recent archive? Never archived: always. */
export function isSinceArchive(createdAt: string | null | undefined, archivedAt: string | null | undefined): boolean {
  if (!archivedAt) return true;
  return typeof createdAt === 'string' && Date.parse(createdAt) > Date.parse(archivedAt);
}

/** Keep only rows created after the athlete's most recent archive. */
export function sinceArchive<R extends { created_at?: string | null }>(rows: R[], archivedAt: string | null | undefined): R[] {
  if (!archivedAt) return rows;
  return rows.filter((r) => isSinceArchive(r.created_at, archivedAt));
}

/** "Mar 3, 2026" */
export function formatArchiveDate(s: string | null | undefined): string {
  if (!s) return '';
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
