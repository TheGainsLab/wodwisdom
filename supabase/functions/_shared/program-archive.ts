/**
 * Programming archive, server side (founder decisions, 2026-11-21).
 *
 * A generated program is archived (programs.archived_at) when its owner's
 * Programming access ends, or by an admin. To the generator, the billing
 * checks and the scheduled jobs an archived program does not exist: a
 * returning subscriber is a brand-new athlete who runs a fresh evaluation and
 * starts a new program at Month 1. Archived programs are view only; their
 * logged sessions stay in the training log and analytics.
 *
 * athlete_profiles.programs_archived_at is the person's most recent archive —
 * THE CUT-OFF for "since the archive". An evaluation only counts if it is
 * newer, and the generator and the AI Coach do not read evaluations, coach
 * states or program logs from before it. Null for everyone who was never
 * archived, and then nothing here filters anything.
 *
 * See migrations/20261121100000_program_archive.sql for the columns, the write
 * fence and archive_user_programs.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** What an athlete is told when they try to change or log an archived program. */
export const ARCHIVED_PROGRAM_ERROR =
  "This program is archived. You can still view it, but it can no longer be logged or changed.";

/** A returner who has paid and not built is left alone this long before the
 *  daily reconciler builds their first month for them (decision 8). */
export const RETURNER_BUILD_WAIT_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True when the program row carries an archive stamp. */
export function isArchived(program: { archived_at?: string | null } | null | undefined): boolean {
  return typeof program?.archived_at === "string" && program.archived_at.trim() !== "";
}

/** The cut-off as stored, or null when the athlete was never archived (or the
 *  value is not a date — then nothing is filtered, as before the archive existed). */
export function archiveCutoff(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Was this row created after the cut-off? No cut-off: always. */
export function isSinceArchive(createdAt: string | null | undefined, archivedAt: string | null): boolean {
  if (!archivedAt) return true;
  return typeof createdAt === "string" && Date.parse(createdAt) > Date.parse(archivedAt);
}

/** Keep only rows created after the cut-off. No cut-off keeps everything. */
export function sinceArchive<R extends { created_at?: string | null }>(rows: R[], archivedAt: string | null): R[] {
  if (!archivedAt) return rows;
  return rows.filter((r) => isSinceArchive(r.created_at, archivedAt));
}

/** Logs the AI Coach may read: everything except sessions of an archived
 *  program (decision 6). Judged by the day the log points at, not by date or
 *  source_type — workout_logs.source_type defaults to 'program' for manual
 *  logs too, and a pre-archive manual or gym-program log is not archived
 *  training. */
export function withoutArchivedDays<R extends { source_id?: string | null }>(rows: R[], archivedDayIds: Set<string>): R[] {
  if (archivedDayIds.size === 0) return rows;
  return rows.filter((r) => !r.source_id || !archivedDayIds.has(r.source_id));
}

/** Decision 8: a returner (no active program, at least one archived) who has
 *  paid is given RETURNER_BUILD_WAIT_DAYS from the start of the subscription
 *  to run their evaluation and build. An unknown start waits — building from
 *  numbers they have not looked at is the thing being avoided. */
export function returnerStillHasTheButton(subscriptionStartedAtMs: number | null, nowMs: number = Date.now()): boolean {
  if (subscriptionStartedAtMs == null || !Number.isFinite(subscriptionStartedAtMs)) return true;
  return nowMs - subscriptionStartedAtMs < RETURNER_BUILD_WAIT_DAYS * MS_PER_DAY;
}

/** The athlete's cut-off, or null. A read error reads as "no cut-off". */
export async function loadArchiveCutoff(supa: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supa
    .from("athlete_profiles")
    .select("programs_archived_at")
    .eq("user_id", userId)
    .maybeSingle();
  return archiveCutoff((data as { programs_archived_at?: unknown } | null)?.programs_archived_at);
}

/** Is this program archived? A program that does not exist is not. */
export async function isProgramArchived(supa: SupabaseClient, programId: string | null | undefined): Promise<boolean> {
  if (!programId) return false;
  const { data } = await supa.from("programs").select("archived_at").eq("id", programId).maybeSingle();
  return isArchived(data as { archived_at?: string | null } | null);
}

/** Is this program day (program_workouts.id) part of an archived program?
 *  For the write paths that reach a day without reading `programs`. */
export async function isProgramDayArchived(supa: SupabaseClient, programWorkoutId: string | null | undefined): Promise<boolean> {
  if (!programWorkoutId) return false;
  const { data } = await supa.from("program_workouts").select("program_id").eq("id", programWorkoutId).maybeSingle();
  return isProgramArchived(supa, (data as { program_id?: string | null } | null)?.program_id ?? null);
}

/** Is this workout log a session of an archived program? For the logging
 *  paths that start from a log id. Judged by the day it points at: a log with
 *  no source, or whose source is not a program day, never is. */
export async function isLogOfArchivedProgram(supa: SupabaseClient, logId: string | null | undefined): Promise<boolean> {
  if (!logId) return false;
  const { data } = await supa.from("workout_logs").select("source_id").eq("id", logId).maybeSingle();
  return isProgramDayArchived(supa, (data as { source_id?: string | null } | null)?.source_id ?? null);
}

/** Of these program-day ids, the ones that belong to an archived program.
 *  A read error returns none (the caller then filters nothing). */
export async function archivedProgramDayIds(supa: SupabaseClient, dayIds: Array<string | null | undefined>): Promise<Set<string>> {
  const ids = [...new Set(dayIds.filter((id): id is string => typeof id === "string" && id !== ""))];
  if (ids.length === 0) return new Set();
  const { data } = await supa
    .from("program_workouts")
    .select("id, programs!inner(archived_at)")
    .in("id", ids)
    .not("programs.archived_at", "is", null);
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
}

export interface ArchiveOutcome {
  archived: number;
  /** Why nothing was archived, when nothing was. */
  skipped?: "admin" | "has_programming" | "lookup_failed" | "nothing_to_archive" | "rpc_failed";
}

/**
 * Archive the user's generated programs IF their Programming access has ended.
 *
 * Safe to call from any billing event, in any order, any number of times: it
 * looks at what the user holds NOW (any source, not the subscription the event
 * is about), so a plan change that removes one grant and adds another, or an
 * old subscription's cancellation arriving after a new one's purchase, never
 * archives a paying athlete. Admins train without an entitlement row and are
 * never archived here. Any doubt (a failed read) archives nothing.
 * Never throws.
 */
export async function archiveProgramsIfAccessEnded(supa: SupabaseClient, userId: string): Promise<ArchiveOutcome> {
  try {
    const { data: profile, error: profileErr } = await supa
      .from("profiles").select("role").eq("id", userId).maybeSingle();
    if (profileErr) return { archived: 0, skipped: "lookup_failed" };
    if ((profile as { role?: string | null } | null)?.role === "admin") return { archived: 0, skipped: "admin" };

    const { data: ents, error: entErr } = await supa
      .from("user_entitlements")
      .select("id")
      .eq("user_id", userId)
      .eq("feature", "programming")
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
      .limit(1);
    if (entErr) return { archived: 0, skipped: "lookup_failed" };
    if ((ents ?? []).length > 0) return { archived: 0, skipped: "has_programming" };

    const { data, error } = await supa.rpc("archive_user_programs", { p_user_id: userId });
    if (error) {
      console.error(`[program-archive] archive_user_programs failed for ${userId}:`, error.message);
      return { archived: 0, skipped: "rpc_failed" };
    }
    const archived = typeof data === "number" ? data : 0;
    if (archived > 0) console.log(`[program-archive] archived ${archived} program(s) for ${userId} — Programming access ended`);
    return archived > 0 ? { archived } : { archived: 0, skipped: "nothing_to_archive" };
  } catch (e) {
    console.error(`[program-archive] archive check failed for ${userId}:`, e instanceof Error ? e.message : String(e));
    return { archived: 0, skipped: "lookup_failed" };
  }
}
