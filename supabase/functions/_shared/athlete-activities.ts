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
  activity_type: string | null;
  duration_minutes: number | null;
  distance: number | null;
  distance_unit: string | null;
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
      .select("date, raw_text, activity_type, duration_minutes, distance, distance_unit, rpe, avg_hr, peak_hr, parsed, is_benchmark")
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
  bits.push(r.activity_type ? r.activity_type.replace(/_/g, " ") : "activity");
  if (r.duration_minutes != null) bits.push(`${r.duration_minutes} min`);
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
    `${r.date}: ${r.activity_type ?? "activity"}${r.duration_minutes != null ? ` ${r.duration_minutes}min` : ""}${r.rpe != null ? ` RPE${r.rpe}` : ""}`,
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
