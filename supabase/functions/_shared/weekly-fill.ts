/**
 * weekly-fill — helpers for a WEEK JOB (weekly Programming PR 4): the stored
 * month (skeleton, composed metcons, written weeks) and the re-plan verdict
 * on the athlete's notes.
 *
 * Founder decisions 2026-11-13: a note that changes what the skeleton owns —
 * which lifts, how much lifting, the metcon focus, the kind of training
 * emphasised — re-plans the remaining weeks' skeleton (written weeks kept);
 * a note about what goes INSIDE a block (loads, accessory choice, metcon
 * movements, more of a thing already there) is the fill's business.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SkeletonOutput } from "./v3-output-schema.ts";
import type { WeekPrescription } from "./v2-output-schema.ts";
import type { ComposedMetcon } from "./metcon-composer.ts";
import { MODELS } from "./model-profiles.ts";
import { fetchWithTimeout } from "./fetch-with-timeout.ts";

/** What the skeleton was built from — the profile fields the skeleton's
 *  shape depends on. A change to any of them during the month re-plans the
 *  remaining weeks (founder, 2026-11-14: "if a user changes their profile
 *  days, the skeleton won't change until the next month" was the gap). */
export interface BuiltFrom {
  days_per_week: number;
  goal: string | null;
  session_length_minutes: number | null;
}

export function builtFromOf(tc: { days_per_week: number; goal_text?: string | null; session_length_minutes?: number | null }): BuiltFrom {
  return {
    days_per_week: tc.days_per_week,
    goal: (tc.goal_text ?? "").trim() || null,
    session_length_minutes: tc.session_length_minutes ?? null,
  };
}

/** Pure: the profile changes since the skeleton was built, as lines for the
 *  re-plan prompt. Empty = nothing drifted. `days` first: it is the one the
 *  fill cannot absorb (the fill tool is sized to the CURRENT days). */
export function profileDrift(built: BuiltFrom | null | undefined, now: BuiltFrom): string[] {
  if (!built) return [];
  const out: string[] = [];
  if (built.days_per_week !== now.days_per_week) {
    out.push(`training days per week changed from ${built.days_per_week} to ${now.days_per_week}`);
  }
  if ((built.goal ?? "") !== (now.goal ?? "")) {
    out.push(`goal changed from "${built.goal ?? "none"}" to "${now.goal ?? "none"}"`);
  }
  if ((built.session_length_minutes ?? null) !== (now.session_length_minutes ?? null)) {
    out.push(`session length changed from ${built.session_length_minutes ?? "unset"} to ${now.session_length_minutes ?? "unset"} minutes`);
  }
  return out;
}

export interface MonthStore {
  id: string;
  skeleton: SkeletonOutput;
  composed_metcons: ComposedMetcon[] | null;
  written_weeks: WeekPrescription[];
  replan_count: number | null;
  built_from: BuiltFrom | null;
}

export async function loadMonthStore(supa: SupabaseClient, programId: string, monthNumber: number): Promise<MonthStore | null> {
  const { data } = await supa
    .from("program_month_skeletons")
    .select("id, skeleton, composed_metcons, written_weeks, replan_count, built_from")
    .eq("program_id", programId)
    .eq("month_number", monthNumber)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    skeleton: data.skeleton as SkeletonOutput,
    composed_metcons: (data.composed_metcons as ComposedMetcon[] | null) ?? null,
    written_weeks: ((data.written_weeks as WeekPrescription[] | null) ?? []),
    replan_count: (data.replan_count as number | null) ?? 0,
    built_from: (data.built_from as BuiltFrom | null) ?? null,
  };
}

/** Pure: the question we ask about the notes. Exported for the test. */
export const REPLAN_SYSTEM =
  "You read an athlete's notes to their coach and answer ONE word. Answer 'replan' if ANY note asks to change the " +
  "STRUCTURE of the month: how many days a week they train (e.g. '3 days from now on', 'drop to 4 days'), which lifts " +
  "are trained (e.g. snatch/clean & jerk instead of presses), how much lifting or gymnastics or conditioning there is " +
  "overall, which kind of training is emphasised, or the metcon focus " +
  "(e.g. 'more long metcons', 'less conditioning', 'more Olympic lifting', 'more gymnastics days'). Answer 'fill' if " +
  "every note is about what goes INSIDE the existing days: loads (heavier/easier), a specific movement to include " +
  "or avoid for a week, equipment for a week (hotel gym), a tired week, a travel week, one metcon longer or shorter. " +
  "Reply with exactly one word: replan or fill.";

/** Cheap classifier (Haiku). Any failure → 'fill' (the safe, cheaper path). */
export async function classifyNotesForReplan(notes: string[]): Promise<"replan" | "fill"> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey || notes.length === 0) return "fill";
  try {
    const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELS.haiku,
        max_tokens: 5,
        system: REPLAN_SYSTEM,
        messages: [{ role: "user", content: notes.map((n) => `- ${n}`).join("\n") }],
      }),
    }, 10_000);
    if (!resp.ok) return "fill";
    const data = await resp.json();
    const text = ((data.content ?? []).find((b: { type?: string }) => b.type === "text")?.text ?? "").trim().toLowerCase();
    return text.startsWith("replan") ? "replan" : "fill";
  } catch {
    return "fill";
  }
}

/** Pure: which week a weekly program should fill next, and whether it may.
 *  `outlineWeeks` are the weeks still outline; `loggedDays` the (week, day)
 *  pairs logged; `daysInWeek` the day count per week. The gate is the LAST
 *  DAY of the week before (founder: "to get the next work, they have to do
 *  the work they have" — the week's last day is the gate; earlier days are
 *  theirs to do or not). Null when nothing is due. */
export function nextWeekToFill(
  outlineWeeks: number[],
  loggedDays: Array<{ week: number; day: number }>,
  daysInWeek: (week: number) => number,
): number | null {
  if (outlineWeeks.length === 0) return null;
  const target = Math.min(...outlineWeeks);
  const prev = target - 1;
  if (prev < 1) return target; // week 1 outline (shouldn't happen) — fill it
  const lastDay = daysInWeek(prev);
  const gateLogged = loggedDays.some((d) => d.week === prev && d.day >= lastDay) ||
    loggedDays.some((d) => d.week > prev);
  return gateLogged ? target : null;
}
