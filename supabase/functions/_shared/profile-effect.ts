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

export interface EffectFacts {
  hasProgramming: boolean;
  hasEngine: boolean;
  /** The athlete's live generated program, if any. */
  program: { weekly: boolean; outlineWeeksLeft: number } | null;
  /** Engine: has chosen a program / has AI sequencing on. */
  engineProgramChosen: boolean;
  engineSequencing: boolean;
}

export interface AppliedChange {
  days?: boolean;
  goal?: boolean;
  injuries?: boolean;
  session?: boolean;
  equipment?: boolean;
}

/** Sentences for the athlete, in order. Never empty when something changed. */
export function describeEffect(change: AppliedChange, f: EffectFacts): string[] {
  const out: string[] = [];
  const planChange = !!(change.days || change.goal || change.session);

  if (f.hasProgramming) {
    if (planChange) {
      if (!f.program) out.push("Your program will be built from it.");
      else if (f.program.weekly && f.program.outlineWeeksLeft > 0) {
        out.push("The weeks of this month that aren't written yet are re-planned from it when your next week is written. Weeks already written stay as they are.");
      } else {
        out.push("It applies from your next month. Weeks already written stay as they are; to change one of those days, open it and ask me there.");
      }
    }
    if (change.injuries) {
      out.push(f.program
        ? "Every week written from now on is checked against it. Weeks already written stay as they are; to change one of those days, open it and ask me there."
        : "Your program will be built around it.");
    }
    if (change.equipment) {
      out.push(f.program
        ? "New weeks are written without the equipment you don't have. Weeks already written stay as they are; to change one of those days, open it and ask me there."
        : "Your program will be built with the equipment you have.");
    }
  }

  if (f.hasEngine) {
    if (change.goal) {
      out.push(f.engineSequencing
        ? "The Engine uses it the next time it chooses your sessions."
        : "Your Engine sessions follow a fixed order, so this doesn't change them unless you turn on AI Sequencing.");
    }
    if (change.days) {
      out.push("This doesn't change your Engine week: Engine days per week come from your Engine program, which you can change with Switch Program.");
    }
  }

  // Engine-only: neither setting is read by the Engine. Say so rather than
  // leave "Saved to your profile" to imply a change to their training.
  if (f.hasEngine && !f.hasProgramming) {
    if (change.session) {
      out.push("This doesn't change your Engine sessions: session length is an AI Programming setting, and each Engine day has its own length.");
    }
    if (change.equipment) {
      out.push("This doesn't change your Engine days: you pick your machine when you open each Engine day.");
    }
  }

  if (out.length === 0) {
    out.push(f.hasProgramming || f.hasEngine ? "Saved to your profile." : "Saved to your profile. It's used when you start a program.");
  }
  return out;
}

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
