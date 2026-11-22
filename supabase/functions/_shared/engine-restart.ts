/**
 * Engine restarts, server side.
 *
 * athlete_profiles.engine_restarts maps a program id to the moment the athlete
 * last restarted it. Sessions created before that moment are archived out of
 * program PROGRESS (they stay for records and analytics). The app has honoured
 * this since 2026-07 (engineService.loadCompletedSessions); the sequencer did
 * not, so an athlete who restarted at Day 1 with sequencing on had their next
 * block written out at their OLD position and then nothing until they reached
 * it (found 2026-11-21).
 */

/** The restart moment for one program, or null when it was never restarted. */
export function restartAtFor(restarts: unknown, programId: string): string | null {
  if (!restarts || typeof restarts !== "object") return null;
  const v = (restarts as Record<string, unknown>)[programId];
  return typeof v === "string" && v.trim() !== "" && Number.isFinite(Date.parse(v)) ? v : null;
}

/** Keep only rows created after the restart. No restart keeps everything. */
export function sinceRestart<R extends { created_at?: string | null }>(rows: R[], restartAt: string | null): R[] {
  if (!restartAt) return rows;
  const cut = Date.parse(restartAt);
  return rows.filter((r) => typeof r.created_at === "string" && Date.parse(r.created_at) > cut);
}

/**
 * Is this session part of the athlete's CURRENT pass through their program —
 * the chosen program, logged since its last restart? The Training Log uses
 * it to decide whether a logged session can link to its day page: day pages
 * address positions in the current program, so a session from another
 * program, from before a restart, or (no program chosen — the Engine was
 * reset when access ended, 2026-11-21) any session at all would open the
 * wrong day or the setup screen. The session's result is shown either way.
 */
export function isCurrentPassSession(
  s: { program_version?: string | null; created_at?: string | null },
  programId: string | null | undefined,
  restartAt: string | null | undefined,
): boolean {
  if (!programId || s.program_version !== programId) return false;
  if (!restartAt) return true;
  const cut = Date.parse(restartAt);
  if (!Number.isFinite(cut)) return true;
  return typeof s.created_at === "string" && Date.parse(s.created_at) > cut;
}
