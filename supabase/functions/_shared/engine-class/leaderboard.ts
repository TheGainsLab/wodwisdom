/**
 * engine-class/leaderboard.ts — build a gym Engine Class leaderboard from raw
 * entries + profiles + the affiliate moderation ledger. PURE (no DB / no HTTP) so
 * it's unit-tested and shared by the member board, the coach board, and TV mode.
 *
 * Order of operations MATTERS (moderation is authoritative and must apply BEFORE
 * ranking): exclude admins/opted-out → apply the ledger (drop `hide`, substitute
 * `adjust`, badge `flag`) → compute W·kg from the profile's LIVE bodyweight (ONE
 * PROFILE corollary a) → group by division (gender [+ modality]) → rank.
 *
 * Privacy: output carries only rank + display name + the metric + division — never
 * email, never user_id, never raw profile rows (mirrors the retail leaderboard RPCs).
 */

import { normalizeGender, toKg } from "../metcon-workcalc.ts";

export type ModerationDecision = "flag" | "hide" | "adjust";

export interface ModerationRow {
  result_ref: string;
  decision: ModerationDecision;
  adjustment?: { raw_score?: string | null; wkg_score?: number | null; note?: string | null } | null;
}

export interface LeaderboardEntry {
  result_ref: string;
  user_id: string;
  week_num: number;
  day_num: number;
  modality: string | null;
  score_type: string;
  score_display: string;
  score_sort: number | null; // raw ranking value, higher = better
  avg_power_watts: number | null;
  rx: boolean;
}

export interface ProfileInfo {
  full_name: string | null;
  leaderboard_anonymous: boolean;
  leaderboard_excluded: boolean;
  role: string | null;
  gender: string | null;
  bodyweight: number | null;
  units: string | null;
}

export type Metric = "wkg" | "raw";

export interface BoardRow {
  rnk: number;
  display_name: string;
  division: string;
  metric_value: number | null;
  score_display: string;
  rx: boolean;
  under_review: boolean; // `flag`
  is_viewer: boolean;
}

export interface Division {
  division: string;
  rows: BoardRow[];
}

const ANON = "Anonymous Athlete";

/** Opted-out OR blank name → "Anonymous Athlete" (never email — retail rule). */
function displayName(p: ProfileInfo): string {
  if (p.leaderboard_anonymous) return ANON;
  const n = (p.full_name ?? "").trim();
  return n === "" ? ANON : n;
}

function genderLabel(gender: string | null): string {
  const g = normalizeGender(gender);
  return g === "men" ? "M" : g === "women" ? "W" : "Open";
}

/** Parse a coach-corrected raw_score into a "higher is better" sort value, by type.
 *  Best-effort: for_time "mm:ss"/"m:ss"/seconds → negative seconds; otherwise the
 *  leading number. Returns null when unparseable (caller keeps the original sort). */
export function parseScoreSort(raw: string | null | undefined, scoreType: string): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "") return null;
  const timeMatch = s.match(/^(\d+):([0-5]?\d)$/);
  if (scoreType === "for_time") {
    if (timeMatch) return -(parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10));
    const secs = parseFloat(s);
    return Number.isFinite(secs) ? -secs : null;
  }
  const num = parseFloat(s);
  return Number.isFinite(num) ? num : null;
}

interface Prepared {
  user_id: string;
  division: string;
  display_name: string;
  metric_value: number | null;
  score_display: string;
  rx: boolean;
  under_review: boolean;
}

/** Apply moderation + privacy + W·kg to one entry. Returns null when the entry is
 *  dropped (hidden, excluded, or no profile). */
function prepare(
  entry: LeaderboardEntry,
  profiles: Map<string, ProfileInfo>,
  moderations: Map<string, ModerationRow>,
  metric: Metric,
  includeModality: boolean,
): Prepared | null {
  const p = profiles.get(entry.user_id);
  if (!p) return null;
  if (p.role === "admin" || p.leaderboard_excluded) return null;

  const mod = moderations.get(entry.result_ref);
  if (mod?.decision === "hide") return null;
  const under_review = mod?.decision === "flag";

  let score_display = entry.score_display;
  let score_sort = entry.score_sort;
  const adj = mod?.decision === "adjust" ? mod.adjustment ?? null : null;

  if (adj && typeof adj.raw_score === "string" && adj.raw_score.trim() !== "") {
    score_display = adj.raw_score;
    const parsed = parseScoreSort(adj.raw_score, entry.score_type);
    if (parsed != null) score_sort = parsed;
  }

  let metric_value: number | null;
  if (metric === "wkg") {
    if (adj && typeof adj.wkg_score === "number") {
      metric_value = adj.wkg_score; // coach-corrected W·kg wins
    } else {
      const massKg = toKg(p.bodyweight, p.units);
      metric_value = (entry.avg_power_watts != null && massKg != null && massKg > 0)
        ? entry.avg_power_watts / massKg
        : null;
    }
  } else {
    metric_value = score_sort;
  }

  const division = includeModality && entry.modality
    ? `${genderLabel(p.gender)} · ${entry.modality}`
    : genderLabel(p.gender);

  return { user_id: entry.user_id, division, display_name: displayName(p), metric_value, score_display, rx: entry.rx, under_review };
}

interface RankedPrepared extends Prepared { rnk: number; }

/** Rank prepared rows within each division (metric desc; nulls last). Retains
 *  user_id (internal) so season aggregation can key on it. */
function rankPrepared(prepared: Prepared[]): Map<string, RankedPrepared[]> {
  const byDiv = new Map<string, Prepared[]>();
  for (const pr of prepared) {
    if (!byDiv.has(pr.division)) byDiv.set(pr.division, []);
    byDiv.get(pr.division)!.push(pr);
  }
  const out = new Map<string, RankedPrepared[]>();
  for (const [division, rows] of byDiv) {
    rows.sort((a, b) => {
      if (a.metric_value == null && b.metric_value == null) return 0;
      if (a.metric_value == null) return 1;
      if (b.metric_value == null) return -1;
      return b.metric_value - a.metric_value;
    });
    out.set(division, rows.map((r, i) => ({ ...r, rnk: i + 1 })));
  }
  return out;
}

/** Per-workout board: entries are already filtered to one (week, day). Divisions =
 *  gender + the workout's (constant) modality. */
export function buildWorkoutBoard(
  entries: LeaderboardEntry[],
  profiles: Map<string, ProfileInfo>,
  moderations: Map<string, ModerationRow>,
  metric: Metric,
  viewerId: string | null,
): Division[] {
  const prepared = entries
    .map((e) => prepare(e, profiles, moderations, metric, true))
    .filter((x): x is Prepared => x !== null);
  const ranked = rankPrepared(prepared);
  const divisions: Division[] = [];
  for (const [division, rows] of ranked) {
    divisions.push({
      division,
      rows: rows.map((r) => ({
        rnk: r.rnk,
        display_name: r.display_name,
        division,
        metric_value: r.metric_value,
        score_display: r.score_display,
        rx: r.rx,
        under_review: r.under_review,
        is_viewer: viewerId != null && r.user_id === viewerId,
      })),
    });
  }
  divisions.sort((a, b) => a.division.localeCompare(b.division));
  return divisions;
}

export interface SeasonRow {
  rnk: number;
  display_name: string;
  division: string;
  points: number;
  workouts: number;
  is_viewer: boolean;
}

/**
 * Season standings across ALL entries in the program. For each (week, day) sub-board,
 * rank within division and award points = (participants − rnk + 1); sum per member.
 * Season divisions are by GENDER only (modality varies workout-to-workout, so the
 * season is the general standing; per-workout boards carry the modality axis).
 */
export function buildSeasonStandings(
  entries: LeaderboardEntry[],
  profiles: Map<string, ProfileInfo>,
  moderations: Map<string, ModerationRow>,
  metric: Metric,
  viewerId: string | null,
): SeasonRow[] {
  const byWorkout = new Map<string, LeaderboardEntry[]>();
  for (const e of entries) {
    const k = `${e.week_num}:${e.day_num}`;
    if (!byWorkout.has(k)) byWorkout.set(k, []);
    byWorkout.get(k)!.push(e);
  }

  const totals = new Map<string, { division: string; display_name: string; points: number; workouts: number }>();

  for (const workoutEntries of byWorkout.values()) {
    const prepared = workoutEntries
      .map((e) => prepare(e, profiles, moderations, metric, false)) // season: gender only
      .filter((x): x is Prepared => x !== null);
    const ranked = rankPrepared(prepared);
    for (const rows of ranked.values()) {
      const n = rows.length;
      for (const r of rows) {
        const award = r.metric_value == null ? 0 : (n - r.rnk + 1);
        const cur = totals.get(r.user_id) ?? { division: r.division, display_name: r.display_name, points: 0, workouts: 0 };
        cur.points += award;
        cur.workouts += 1;
        cur.division = r.division;
        cur.display_name = r.display_name;
        totals.set(r.user_id, cur);
      }
    }
  }

  const byDiv = new Map<string, Array<{ user_id: string; division: string; display_name: string; points: number; workouts: number }>>();
  for (const [user_id, t] of totals) {
    if (!byDiv.has(t.division)) byDiv.set(t.division, []);
    byDiv.get(t.division)!.push({ user_id, ...t });
  }
  const out: SeasonRow[] = [];
  for (const [division, rows] of byDiv) {
    rows.sort((a, b) => b.points - a.points);
    rows.forEach((r, i) => out.push({
      rnk: i + 1,
      display_name: r.display_name,
      division,
      points: r.points,
      workouts: r.workouts,
      is_viewer: viewerId != null && r.user_id === viewerId,
    }));
  }
  out.sort((a, b) => a.division.localeCompare(b.division) || a.rnk - b.rnk);
  return out;
}
