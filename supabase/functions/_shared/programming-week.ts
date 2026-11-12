/**
 * programming-week — the athlete's NEXT UNLOGGED WEEK of AI Programming, as
 * load for the Engine sequencer to balance its block against.
 *
 * Founder decisions 2026-11-12 (docs/engine_self_sequencing_plan.md):
 *  - Both products are ordered sequences consumed by LOGGING; nothing is
 *    keyed to dates. "Next week" = the week containing the first program
 *    day after the furthest logged one.
 *  - Neither side owns dates, so the Engine balances its block against the
 *    Programming week AS A WHOLE (total load, hard days, systems), never day
 *    by day. It shapes intensity and placement, never day count.
 *  - Programming's week is written first; the Engine block fits around it.
 *
 * Pure helpers (pickNextWeek, summarizeProgramDay, formatUpcomingProgrammingWeek)
 * are tested; loadUpcomingProgrammingWeek does the I/O.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ProgramDayRow {
  id: string;
  week_num: number;
  day_num: number;
  day_type: string | null;
  classified_archetype: string | null;
  workout_text: string | null;
}

export interface ProgramDaySummary {
  week: number;
  day: number;
  kind: string;
  summary: string;
}

/** The week containing the first day after the furthest LOGGED day (in
 *  week/day order). Null when nothing is left. */
export function pickNextWeek(days: ProgramDayRow[], loggedIds: Set<string>): ProgramDayRow[] | null {
  const ordered = [...days].sort((a, b) => a.week_num - b.week_num || a.day_num - b.day_num);
  let furthest = -1;
  ordered.forEach((d, i) => { if (loggedIds.has(d.id)) furthest = i; });
  const next = ordered[furthest + 1];
  if (!next) return null;
  return ordered.filter((d) => d.week_num === next.week_num && (d.week_num > (ordered[furthest]?.week_num ?? 0) || d.day_num > (ordered[furthest]?.day_num ?? 0) || furthest < 0));
}

const SECTION_RE = /^(warm-?up[^:]*|skills?|strength|accessory|metcon|conditioning|cool-?down)[^:]*:\s*$/i;

/** One line per program day: the strength prescription and the metcon
 *  header, which is what the Engine needs to size its own load against.
 *  Warm-up, accessory and cool-down are dropped. */
export function summarizeProgramDay(text: string | null | undefined, maxLen = 160): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const parts: string[] = [];
  let section = "";
  let taken = 0;
  for (const line of lines) {
    if (!line) continue;
    const m = line.match(SECTION_RE);
    if (m) { section = m[1].toLowerCase(); taken = 0; continue; }
    if (section.startsWith("strength") && taken < 2) { parts.push(line); taken++; continue; }
    if ((section.startsWith("metcon") || section.startsWith("conditioning")) && taken < 2) { parts.push(line); taken++; continue; }
    if (section.startsWith("skill") && taken < 1) { parts.push(line); taken++; continue; }
  }
  const out = parts.join(" · ").replace(/\s+/g, " ");
  return out.length > maxLen ? out.slice(0, maxLen - 1) + "…" : out;
}

export function formatUpcomingProgrammingWeek(days: ProgramDaySummary[]): string {
  if (days.length === 0) return "";
  const lines = days.map((d) => `  W${d.week}D${d.day} ${d.kind}: ${d.summary || "(no detail)"}`);
  return (
    `UPCOMING AI-PROGRAMMING WEEK (All Access — the athlete trains this alongside the Engine, in their own order; ` +
    `it is written first and this block fits AROUND it). Balance your block against it AS A WHOLE — total load, ` +
    `number of hard days, which systems it already taxes — not day by day; neither side owns dates. ` +
    `Shape intensity and placement; never the day count.\n` +
    lines.join("\n") + `\n`
  );
}

/** The athlete's next unlogged Programming week, summarised; "" when they
 *  have no committed program or nothing left in it. Best-effort. */
export async function loadUpcomingProgrammingWeek(supa: SupabaseClient, userId: string): Promise<string> {
  const { data: prog } = await supa
    .from("programs")
    .select("id")
    .eq("user_id", userId)
    .eq("committed", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prog?.id) return "";

  const { data: days } = await supa
    .from("program_workouts")
    .select("id, week_num, day_num, day_type, classified_archetype, workout_text")
    .eq("program_id", prog.id);
  const rows = (days ?? []) as ProgramDayRow[];
  if (rows.length === 0) return "";

  const { data: logs } = await supa
    .from("workout_logs")
    .select("source_id")
    .eq("user_id", userId)
    .eq("source_type", "program")
    .eq("status", "completed")
    .in("source_id", rows.map((r) => r.id));
  const logged = new Set<string>((logs ?? []).map((l) => l.source_id as string).filter(Boolean));

  const week = pickNextWeek(rows, logged);
  if (!week) return "";
  return formatUpcomingProgrammingWeek(
    week.map((d) => ({
      week: d.week_num,
      day: d.day_num,
      kind: d.classified_archetype ?? d.day_type ?? "day",
      summary: summarizeProgramDay(d.workout_text),
    })),
  );
}
