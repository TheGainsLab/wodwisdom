/**
 * profile-effect.ts — after a profile change is applied, say truthfully what
 * it changes and when.
 *
 * Why (2026-11-23): the coach's card, the coach's own reply and the tool
 * result all told athletes "your next month builds from this" and sent anyone
 * who wanted it sooner to a human. Programs are written a week at a time: a
 * change to days, goal or session length re-plans the REST OF THE CURRENT
 * MONTH when the next week is written. And for an Engine-only athlete a
 * days-per-week change alters nothing at all, which the card never said.
 *
 * Session length and equipment (2026-11-23, when the card learned to change
 * them): session length behaves like days and goal for Programming (the
 * unwritten weeks are re-planned) and does nothing for the Engine; equipment
 * is read by every week written from then on, and the Engine does not read
 * the checklist at all (the machine is picked on each Engine day).
 *
 * `describeEffect` is pure; `loadEffectFacts` reads what it needs.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkEntitlement } from "./entitlements.ts";

import { describeEffect, type AppliedChange, type EffectFacts } from "./profile-effect-text.ts";
export { describeEffect, type AppliedChange, type EffectFacts };

export async function loadEffectFacts(supa: SupabaseClient, userId: string): Promise<EffectFacts> {
  const [hasProgramming, hasEngine] = await Promise.all([
    checkEntitlement(supa, userId, "programming").catch(() => false),
    checkEntitlement(supa, userId, "engine").catch(() => false),
  ]);
  const { data: ap } = await supa.from("athlete_profiles")
    .select("engine_program_version, engine_ai_sequencing").eq("user_id", userId).maybeSingle();
  let program: EffectFacts["program"] = null;
  const { data: prog } = await supa.from("programs")
    .select("id, weekly_mode").eq("user_id", userId).eq("source", "generated").is("archived_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (prog?.id) {
    const { data: outline } = await supa.from("program_workouts")
      .select("week_num, month_number").eq("program_id", prog.id).eq("status", "outline");
    const weeks = new Set((outline ?? []).map((r) => `${r.month_number}-${r.week_num}`));
    program = { weekly: prog.weekly_mode === true, outlineWeeksLeft: weeks.size };
  }
  return {
    hasProgramming,
    hasEngine,
    program,
    engineProgramChosen: !!ap?.engine_program_version,
    engineSequencing: ap?.engine_ai_sequencing === true,
  };
}
