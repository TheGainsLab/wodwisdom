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
  /** Total work (J) at log time — lets a for_time `adjust` recompute corrected watts. */
  total_joules?: number | null;
  rx: boolean;
  /** Display context for seam 1 (the affiliate moderation feed); unused by ranking. */
  workout_date?: string | null;
  logged_at?: string | null;
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
  /** null = UNRANKED (no metric value in this metric — e.g. a physics failure on the
   *  W·kg board). Never a silently-fabricated sequential rank. */
  rnk: number | null;
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

export type NameStyle = "full" | "short";

/** Opted-out OR blank name → "Anonymous Athlete" (never email — retail rule). `short`
 *  (used on the public TV wall) renders "First L." — a full name on a URL that lives in
 *  wall devices / browser histories is more exposure than an authed board warrants. */
function displayName(p: ProfileInfo, style: NameStyle): string {
  if (p.leaderboard_anonymous) return ANON;
  const n = (p.full_name ?? "").trim();
  if (n === "") return ANON;
  if (style === "short") {
    const parts = n.split(/\s+/);
    return parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  }
  return n;
}

export function genderLabel(gender: string | null): string {
  const g = normalizeGender(gender);
  return g === "men" ? "M" : g === "women" ? "W" : "Open";
}

const LB_PER_KG = 2.2046226218;

/** Parse a coach-corrected raw_score into a "higher is better" sort value — using the
 *  SAME encoding engine-class-log writes for each score_type, so an adjusted entry
 *  ranks on the same scale as the un-adjusted ones (a mismatch buried corrected
 *  athletes). Returns null when unparseable (caller keeps the original sort). */
export function parseScoreSort(raw: string | null | undefined, scoreType: string): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "") return null;

  if (scoreType === "for_time") {
    const timeMatch = s.match(/^(\d+):([0-5]?\d)$/);
    if (timeMatch) return -(parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10));
    // Looks like a time but isn't valid mm:ss (e.g. "12:99") → don't guess via
    // parseFloat (which would read "12"); treat as unparseable.
    if (s.includes(":")) return null;
    const secs = parseFloat(s);
    return Number.isFinite(secs) ? -secs : null;
  }

  if (scoreType === "rounds_reps") {
    // log encodes rounds*1000 + reps; "6+7" must parse the same way, not parseFloat→6.
    const m = s.match(/^(\d+)\s*\+\s*(\d+)$/);
    if (m) return parseInt(m[1], 10) * 1000 + parseInt(m[2], 10);
    const rOnly = s.match(/^(\d+)$/);
    return rOnly ? parseInt(rOnly[1], 10) * 1000 : null;
  }

  if (scoreType === "load") {
    // log normalizes to lbs; a "95 kg" correction must convert, not compare kg-vs-lb.
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(kg|lb|lbs)?$/i);
    if (!m) return null;
    const v = parseFloat(m[1]);
    if (!Number.isFinite(v)) return null;
    return (m[2] && m[2].toLowerCase() === "kg") ? v * LB_PER_KG : v;
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
  nameStyle: NameStyle,
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
    const massKg = toKg(p.bodyweight, p.units);
    if (adj && typeof adj.wkg_score === "number" && Number.isFinite(adj.wkg_score)) {
      metric_value = adj.wkg_score; // an explicit coach-corrected W·kg always wins
    } else if (adj && typeof adj.raw_score === "string" && adj.raw_score.trim() !== "") {
      // A raw-only adjust must NOT keep the stale original power (JOINT-1: that made a
      // raw-only correction a silent no-op on the W·kg wall). For for_time we can
      // recompute exactly — work is fixed, so corrected watts = total_joules /
      // corrected_seconds. For any other type we can't, so W·kg is null (unranked here;
      // still ranks on the raw board).
      const corrSort = parseScoreSort(adj.raw_score, entry.score_type); // -seconds for for_time
      if (entry.score_type === "for_time" && entry.total_joules != null && corrSort != null && corrSort < 0 &&
          massKg != null && massKg > 0) {
        const seconds = -corrSort;
        metric_value = (entry.total_joules / seconds) / massKg;
      } else {
        metric_value = null;
      }
    } else {
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

  return { user_id: entry.user_id, division, display_name: displayName(p, nameStyle), metric_value, score_display, rx: entry.rx, under_review };
}

interface RankedPrepared extends Prepared { rnk: number | null; }

/** Rank prepared rows within each division (metric desc; nulls last). A row with a
 *  null metric_value is UNRANKED (rnk null) — not assigned an arbitrary sequential
 *  number. Retains user_id (internal) so season aggregation can key on it. */
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
    // Nulls sort last, so index+1 is the true rank for the non-null rows; null → unranked.
    out.set(division, rows.map((r, i) => ({ ...r, rnk: r.metric_value == null ? null : i + 1 })));
  }
  return out;
}

/** True when at least one row anywhere on the board has a rank (a non-null metric).
 *  The endpoints use this to fall back from W·kg to raw for a whole board with no
 *  power values (e.g. a strength day, or a total physics-service outage). */
export function anyRanked(divisions: Division[]): boolean {
  return divisions.some((d) => d.rows.some((r) => r.rnk != null));
}

/** Per-workout board: entries are already filtered to one (week, day). Divisions =
 *  gender + the workout's (constant) modality. */
export function buildWorkoutBoard(
  entries: LeaderboardEntry[],
  profiles: Map<string, ProfileInfo>,
  moderations: Map<string, ModerationRow>,
  metric: Metric,
  viewerId: string | null,
  nameStyle: NameStyle = "full",
): Division[] {
  const prepared = entries
    .map((e) => prepare(e, profiles, moderations, metric, true, nameStyle))
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
      .map((e) => prepare(e, profiles, moderations, metric, false, "full")) // season: gender only, full names (authed)
      .filter((x): x is Prepared => x !== null);
    const ranked = rankPrepared(prepared);
    for (const rows of ranked.values()) {
      // Only rankable (non-null metric) rows count toward participant points; null
      // rows sort last, get award 0, and must not inflate everyone else's points.
      const n = rows.filter((r) => r.metric_value != null).length;
      for (const r of rows) {
        const award = (r.metric_value == null || r.rnk == null) ? 0 : (n - r.rnk + 1);
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
