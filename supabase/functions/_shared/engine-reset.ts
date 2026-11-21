/**
 * Engine reset, server side (founder decisions, 2026-11-21).
 *
 * When a person's Engine access ends the Engine is RESET for them: every
 * track is stamped as restarted, the program choice is cleared, the sequencer
 * is switched off, pacing calibration and the Continuum curve are cleared,
 * future Engine calendar entries are removed, and the sequencer's days are
 * archived (completed) or deleted (never done). On return they see the
 * two-question setup and start at Day 1. Sessions, time trials and months
 * unlocked are never touched.
 *
 * athlete_profiles.engine_reset_at is the person's most recent reset — THE
 * CUT-OFF for pacing: the Continuum curve is built only from sessions and
 * time trials logged after it. Null for everyone who was never reset, and
 * then nothing here filters anything.
 *
 * See migrations/20261121200000_engine_reset.sql for the columns, the
 * policies and reset_engine_for_user.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** The cut-off as stored, or null when the athlete was never reset (or the
 *  value is not a date — then nothing is filtered, as before the reset existed). */
export function resetCutoff(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Keep only rows created after the cut-off. No cut-off keeps everything. */
export function sinceReset<R extends { created_at?: string | null }>(rows: R[], resetAt: string | null): R[] {
  if (!resetAt) return rows;
  const cut = Date.parse(resetAt);
  return rows.filter((r) => typeof r.created_at === "string" && Date.parse(r.created_at) > cut);
}

export interface OverrideRecord {
  program_version: string;
  sequence_position: number;
  engine_workout_id: string;
  created_at: string;
  /** Set when a reset retired this day; null/absent while it is live. */
  archived_at?: string | null;
}

/**
 * The sequenced day that was LIVE at this position when the session was
 * logged, or null (the session trained the curated day).
 *
 * A session is matched only to a day written at or before it and not yet
 * archived at that moment. So an archived day still explains the session that
 * trained it, and a day the sequencer writes at the same position later — for
 * the athlete's next pass through the program — is never attributed to an old
 * session (2026-11-21; before this the lookup was by position alone). When
 * several qualify the most recently written wins. A session with an unreadable
 * timestamp matches nothing.
 */
export function overrideForSession(
  session: { program_version: string; sequence_position: number | null; created_at: string | null | undefined },
  overrides: OverrideRecord[],
): OverrideRecord | null {
  if (session.sequence_position == null || typeof session.created_at !== "string") return null;
  const at = Date.parse(session.created_at);
  if (!Number.isFinite(at)) return null;
  let best: OverrideRecord | null = null;
  let bestWritten = -Infinity;
  for (const o of overrides) {
    if (o.program_version !== session.program_version || o.sequence_position !== session.sequence_position) continue;
    const written = Date.parse(o.created_at);
    if (!Number.isFinite(written) || written > at) continue;
    if (typeof o.archived_at === "string" && o.archived_at.trim() !== "") {
      const archived = Date.parse(o.archived_at);
      if (!Number.isFinite(archived) || archived <= at) continue;
    }
    if (written > bestWritten) {
      best = o;
      bestWritten = written;
    }
  }
  return best;
}

export interface ResetOutcome {
  reset: boolean;
  /** Why nothing was reset, when nothing was. */
  skipped?: "admin" | "has_engine" | "lookup_failed" | "nothing_to_reset" | "rpc_failed";
}

/**
 * Reset the user's Engine IF their Engine access has ended.
 *
 * Safe to call from any billing event, in any order, any number of times: it
 * looks at what the user holds NOW (any source, not the subscription the event
 * is about), so a plan change that removes one grant and adds another, or an
 * old subscription's cancellation arriving after a new one's purchase, never
 * resets a paying athlete. Admins train without an entitlement row and are
 * never reset here. Any doubt (a failed read) resets nothing. A repeat call
 * for someone already reset changes nothing (reset_engine_for_user).
 * Never throws.
 */
export async function resetEngineIfAccessEnded(supa: SupabaseClient, userId: string): Promise<ResetOutcome> {
  try {
    const { data: profile, error: profileErr } = await supa
      .from("profiles").select("role").eq("id", userId).maybeSingle();
    if (profileErr) return { reset: false, skipped: "lookup_failed" };
    if ((profile as { role?: string | null } | null)?.role === "admin") return { reset: false, skipped: "admin" };

    const { data: ents, error: entErr } = await supa
      .from("user_entitlements")
      .select("id")
      .eq("user_id", userId)
      .eq("feature", "engine")
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
      .limit(1);
    if (entErr) return { reset: false, skipped: "lookup_failed" };
    if ((ents ?? []).length > 0) return { reset: false, skipped: "has_engine" };

    const { data, error } = await supa.rpc("reset_engine_for_user", { p_user_id: userId });
    if (error) {
      console.error(`[engine-reset] reset_engine_for_user failed for ${userId}:`, error.message);
      return { reset: false, skipped: "rpc_failed" };
    }
    const acted = (data as { acted?: unknown } | null)?.acted === true;
    if (acted) console.log(`[engine-reset] Engine reset for ${userId} — Engine access ended: ${JSON.stringify(data)}`);
    return acted ? { reset: true } : { reset: false, skipped: "nothing_to_reset" };
  } catch (e) {
    console.error(`[engine-reset] reset check failed for ${userId}:`, e instanceof Error ? e.message : String(e));
    return { reset: false, skipped: "lookup_failed" };
  }
}
