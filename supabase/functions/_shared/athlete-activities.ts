/**
 * athlete-activities.ts — shared read layer for athlete-logged outside
 * training (athlete_activities) + observed benchmarks (athlete_benchmarks).
 *
 * One fetch, three consumers at three speeds:
 *   - chat (immediate): buildActivityChatContext — whole-history aggregates
 *     (exact counts the model can cite without counting rows) + recent
 *     detail + benchmarks with previous-value trend.
 *   - adjust-workout (same-day): buildRecentLoadLine — compact last-7-days
 *     line for the AI-Edit athlete context.
 *   - monthly generation (boundary): buildOutsideTrainingFacts — facts-only
 *     slice for the Athlete Model's outside_training section (Step 1
 *     evidence; CoachState judges what it means).
 *
 * NEVER consumed by Engine pacing/calibration — outside work is load
 * context, not calibration data.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ActivityRow {
  date: string;
  raw_text: string;
  // v2 block-aligned category (conditioning|metcon|strength|skills|other);
  // null on pre-v2 rows.
  workout_type: string | null;
  activity_type: string | null;
  duration_minutes: number | null;
  distance: number | null;
  distance_unit: string | null;
  calories: number | null;
  score: string | null;
  rpe: number | null;
  avg_hr: number | null;
  peak_hr: number | null;
  parsed: Record<string, unknown> | null;
  is_benchmark: boolean;
}

export interface BenchmarkRow {
  name: string;
  value: number;
  unit: string;
  date: string;
  is_current: boolean;
}

export interface OutsideTraining {
  total_count: number;
  by_type: Record<string, number>;
  first_date: string | null;
  last30: { count: number; minutes: number };
  recent: ActivityRow[];
  benchmarks: BenchmarkRow[];
}

const RECENT_LIMIT = 10;

/** Fetch the full outside-training picture for one athlete. Returns null when
 *  the athlete has never logged anything (all consumers no-op on null). */
export async function fetchOutsideTraining(
  supa: SupabaseClient,
  userId: string,
): Promise<OutsideTraining | null> {
  const [{ data: acts }, { data: bms }] = await Promise.all([
    supa
      .from("athlete_activities")
      .select("date, raw_text, workout_type, activity_type, duration_minutes, distance, distance_unit, calories, score, rpe, avg_hr, peak_hr, parsed, is_benchmark")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(1000),
    supa
      .from("athlete_benchmarks")
      .select("name, value, unit, date, is_current")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(100),
  ]);

  const rows = (acts ?? []) as ActivityRow[];
  const benchmarks = (bms ?? []) as BenchmarkRow[];
  if (rows.length === 0 && benchmarks.length === 0) return null;

  const byType: Record<string, number> = {};
  let last30Count = 0;
  let last30Minutes = 0;
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  for (const r of rows) {
    const t = r.activity_type ?? "other";
    byType[t] = (byType[t] ?? 0) + 1;
    if (r.date >= cutoff) {
      last30Count += 1;
      last30Minutes += r.duration_minutes ?? 0;
    }
  }

  return {
    total_count: rows.length,
    by_type: byType,
    first_date: rows.length ? rows[rows.length - 1].date : null,
    last30: { count: last30Count, minutes: last30Minutes },
    recent: rows.slice(0, RECENT_LIMIT),
    benchmarks,
  };
}

function fmtActivity(r: ActivityRow): string {
  const bits: string[] = [r.date];
  const label = r.workout_type && r.workout_type !== "other"
    ? r.workout_type
    : (r.activity_type ? r.activity_type.replace(/_/g, " ") : "activity");
  bits.push(label);
  if (r.score) bits.push(`score ${r.score}`);
  if (r.duration_minutes != null) bits.push(`${r.duration_minutes} min`);
  if (r.calories != null) bits.push(`${r.calories} cal`);
  if (r.distance != null) bits.push(`${r.distance}${r.distance_unit ? ` ${r.distance_unit}` : ""}`);
  if (r.rpe != null) bits.push(`RPE ${r.rpe}`);
  if (r.avg_hr != null) bits.push(`HR ${r.avg_hr}`);
  const summary = (r.parsed?.summary as string | undefined) ?? null;
  return `- ${bits.join(" · ")}${summary ? ` — ${summary}` : ""}`;
}

/** Benchmarks grouped with their previous value, for trend lines. */
function benchmarkLines(benchmarks: BenchmarkRow[]): string[] {
  const byKey = new Map<string, BenchmarkRow[]>();
  for (const b of benchmarks) {
    const k = `${b.name.toLowerCase()}|${b.unit}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(b); // already date-desc
  }
  const lines: string[] = [];
  for (const group of byKey.values()) {
    const cur = group.find((b) => b.is_current) ?? group[0];
    const prev = group.find((b) => b !== cur);
    lines.push(
      `- ${cur.name}: ${cur.value}${cur.unit ? ` ${cur.unit}` : ""} (${cur.date})${prev ? ` — previous ${prev.value}${prev.unit ? ` ${prev.unit}` : ""} (${prev.date})` : ""}`,
    );
  }
  return lines;
}

/** Chat injection: exact whole-history aggregates + recent detail + benchmark
 *  trends. Empty string when nothing is logged. */
export function buildActivityChatContext(ot: OutsideTraining | null): string {
  if (!ot) return "";
  const parts: string[] = ["\n\nLOGGED ACTIVITIES (training the athlete logged outside their programs):"];
  if (ot.total_count > 0) {
    const mix = Object.entries(ot.by_type)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${n} ${t.replace(/_/g, " ")}`)
      .join(", ");
    parts.push(
      `Totals (exact — cite these for "how many" questions): ${ot.total_count} activities since ${ot.first_date} — ${mix}. ` +
        `Last 30 days: ${ot.last30.count} activities, ~${Math.round(ot.last30.minutes / 6) / 10} hrs.`,
    );
    parts.push(`Recent (newest first; full history is on the athlete's Training Log calendar):`);
    for (const r of ot.recent) parts.push(fmtActivity(r));
  }
  if (ot.benchmarks.length > 0) {
    parts.push("Benchmarks on file (observed test results — the profile's declared numbers still drive programming):");
    parts.push(...benchmarkLines(ot.benchmarks));
  }
  parts.push(
    "This work is context for coaching and load — it does NOT change Engine pacing targets. " +
      "For per-activity details older than the recent list, point the athlete to their Training Log calendar.",
  );
  return parts.join("\n");
}

/** AI-Edit line: compact last-7-days load so a "make this easier, I rode hard
 *  yesterday" request is grounded. Null when nothing in the window. */
export function buildRecentLoadLine(ot: OutsideTraining | null): string | null {
  if (!ot) return null;
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const week = ot.recent.filter((r) => r.date >= cutoff);
  if (week.length === 0) return null;
  const items = week.map((r) =>
    `${r.date}: ${r.workout_type && r.workout_type !== "other" ? r.workout_type : (r.activity_type ?? "activity")}${r.duration_minutes != null ? ` ${r.duration_minutes}min` : ""}${r.score ? ` ${r.score}` : ""}${r.rpe != null ? ` RPE${r.rpe}` : ""}`,
  );
  return `Outside training last 7 days (account for this load): ${items.join("; ")}`;
}

/** Facts-only slice for the Athlete Model's outside_training section. */
export interface OutsideTrainingFacts {
  total_count: number;
  by_type: Record<string, number>;
  last_30_days: { count: number; minutes: number };
  recent: Array<{ date: string; type: string; minutes: number | null; rpe: number | null }>;
  benchmarks: Array<{ name: string; value: number; unit: string; date: string }>;
}

/**
 * Sequencer context (gap #5 v1): everything the athlete trained in the last
 * 14 days that Engine did NOT prescribe — program strength sessions
 * (workout_log_entries, dual-product users) + logged activities
 * (roll-your-own athletes). Injected into the resequence prompt so weekly
 * day-type/intensity choices respect the athlete's whole recovery budget.
 * ADVISORY ONLY — the sequencer still cannot change program length, day
 * count, or pinned time trials. Returns "" when there's nothing to report
 * (single-product, nothing logged → prompt unchanged).
 */
export async function buildOtherTrainingLoadBlock(
  supa: SupabaseClient,
  userId: string,
): Promise<string> {
  const cutoff = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);

  const [{ data: entries }, { data: acts }] = await Promise.all([
    supa
      .from("workout_log_entries")
      .select("movement, weight, weight_unit, rpe, sets, reps, workout_logs!inner(user_id, workout_date)")
      .eq("workout_logs.user_id", userId)
      .gte("workout_logs.workout_date", cutoff),
    supa
      .from("athlete_activities")
      .select("date, workout_type, activity_type, duration_minutes, calories, score, rpe, parsed")
      .eq("user_id", userId)
      .gte("date", cutoff)
      .order("date", { ascending: false })
      .limit(30),
  ]);

  // Program strength: group by date; surface the heaviest movements per day.
  const byDate = new Map<string, Array<{ movement: string; weight: number | null; rpe: number | null }>>();
  for (const raw of entries ?? []) {
    const r = raw as Record<string, unknown>;
    const wl = r.workout_logs as { workout_date?: string } | Array<{ workout_date?: string }> | null;
    const date = Array.isArray(wl) ? (wl[0]?.workout_date ?? "") : (wl?.workout_date ?? "");
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push({
      movement: String(r.movement ?? ""),
      weight: (r.weight as number | null) ?? null,
      rpe: (r.rpe as number | null) ?? null,
    });
  }
  const programLines = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 14)
    .map(([date, movs]) => {
      const top = movs
        .filter((m) => m.weight != null)
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
        .slice(0, 3)
        .map((m) => m.movement);
      const maxRpe = movs.reduce((mx, m) => Math.max(mx, m.rpe ?? 0), 0);
      return `- ${date}: program session${top.length ? ` — ${top.join(", ")}` : ""}${maxRpe > 0 ? ` (top RPE ${maxRpe})` : ""}`;
    });

  const activityLines = ((acts ?? []) as Array<{ date: string; workout_type: string | null; activity_type: string | null; duration_minutes: number | null; calories: number | null; score: string | null; rpe: number | null; parsed: Record<string, unknown> | null }>)
    .map((a) => {
      const summary = (a.parsed?.summary as string | undefined) ?? null;
      const label = a.workout_type && a.workout_type !== "other"
        ? a.workout_type
        : (a.activity_type ?? "activity").replace(/_/g, " ");
      const base = summary ?? `${label}${a.duration_minutes != null ? `, ${a.duration_minutes} min` : ""}${a.calories != null ? `, ${a.calories} cal` : ""}${a.score ? `, ${a.score}` : ""}`;
      return `- ${a.date}: ${base}${a.rpe != null ? ` (RPE ${a.rpe})` : ""}`;
    });

  if (programLines.length === 0 && activityLines.length === 0) return "";

  const parts: string[] = ["OTHER TRAINING LOAD (last 14 days — real training Engine did NOT prescribe):"];
  if (programLines.length > 0) {
    parts.push("Program strength/conditioning sessions:");
    parts.push(...programLines);
  }
  if (activityLines.length > 0) {
    parts.push("Athlete-logged activities:");
    parts.push(...activityLines);
  }
  parts.push(
    "This work competes for the same recovery budget as the conditioning you are sequencing. " +
      "Weigh it in your intensity and day-type choices — e.g. avoid stacking maximal lower-body " +
      "anaerobic work right after heavy squat/deadlift days, and be conservative when the recent " +
      "combined load is high. Do NOT reduce the number of days or insert rest days — day count is fixed; " +
      "you express judgment through day-type selection and intensity within the envelopes.",
  );
  return parts.join("\n");
}

export function buildOutsideTrainingFacts(ot: OutsideTraining | null): OutsideTrainingFacts | null {
  if (!ot || (ot.total_count === 0 && ot.benchmarks.length === 0)) return null;
  return {
    total_count: ot.total_count,
    by_type: ot.by_type,
    last_30_days: ot.last30,
    recent: ot.recent.map((r) => ({
      date: r.date,
      type: r.activity_type ?? "other",
      minutes: r.duration_minutes,
      rpe: r.rpe,
    })),
    benchmarks: ot.benchmarks
      .filter((b) => b.is_current)
      .map((b) => ({ name: b.name, value: b.value, unit: b.unit, date: b.date })),
  };
}
