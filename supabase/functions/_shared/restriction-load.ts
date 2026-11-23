/**
 * restriction-load.ts — read one athlete's restrictions for the restriction
 * gate, the same way for every route that needs them.
 *
 * The gate itself (restriction-gate.ts) is pure; this is its only reader.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeMergedAvoidance, fetchVocabulary } from "./build-writer-payload.ts";
import { activeNotes, loadCoachNotes } from "./coach-notes.ts";
import { athleteWordsElsewhere, type Restrictions } from "./restriction-gate.ts";

export interface LoadOptions {
  /**
   * true  = only names the athlete's INJURIES rule out (equipment-derived
   *         bans left out). For a change the athlete asked for in chat: the
   *         equipment checklist can be out of date and the coach is told to
   *         take their word on equipment, but never on an injury.
   * false = the full avoid list (injury + equipment), as the generator uses.
   */
  injuryNamesOnly: boolean;
}

export async function loadRestrictions(supa: SupabaseClient, userId: string, opts: LoadOptions): Promise<Restrictions> {
  const [{ data: profile }, notes, vocabulary] = await Promise.all([
    supa.from("athlete_profiles")
      .select("equipment, injuries_constraints, injuries_structured, injuries_constraints_hash, injuries_avoidance_confirmed, coaching_intake")
      .eq("user_id", userId).maybeSingle(),
    loadCoachNotes(supa, userId).catch(() => []),
    fetchVocabulary(supa).catch(() => [] as string[]),
  ]);
  // deno-lint-ignore no-explicit-any
  const prof = (profile ?? {}) as any;
  const merged = computeMergedAvoidance(prof).injuries_structured;
  const by = merged.blocked_by ?? {};
  const doNotProgram = opts.injuryNamesOnly
    ? merged.do_not_program.filter((m) => by[m] === "injury" || by[m] === "both")
    : merged.do_not_program;
  return {
    injuriesText: typeof prof.injuries_constraints === "string" ? prof.injuries_constraints : null,
    doNotProgram,
    otherWords: athleteWordsElsewhere(prof.coaching_intake, activeNotes(notes, "coach").map((n) => n.text)),
    suggestedSubs: merged.suggested_subs ?? [],
    vocabulary,
  };
}
