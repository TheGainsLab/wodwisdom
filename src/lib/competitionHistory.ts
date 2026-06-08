/**
 * Competition History — types + normalizer for the Tier 4 `all_results` array
 * (programming-profile bundle 1.3.0, fetched via ?include=all_results).
 *
 * The normalizer is a pure transform: it groups the flat `all_results` list
 * into season → stage → workouts, indexes by competition_workout_id, and
 * tags each entry with a couple of derived convenience flags. It does NOT
 * reshape the entry objects themselves — the grid / workout-detail / lens
 * components read `entry.workout.*` and `entry.result.*` directly off the
 * raw shape the API returns.
 */

export type ScoringUnit = 'time' | 'reps' | 'load_lbs' | 'distance';
export type CompetitionStage =
  | 'open'
  | 'quarterfinals'
  | 'semifinals'
  | 'regional'
  | 'games'
  | string;

export interface CompetitionWorkoutMovement {
  name: string;
  family: string;
  position: number;
  equipment: string[];
  mgw_category: string | null;        // "M" | "G" | "W" | "O"
  rounds: number | null;
  reps_total: number | null;
  reps_per_round: number | null;
  reps_scheme: string | null;
  calories: number | null;
  load_lbs: number | null;
  load_descriptor: string | null;
  load_progression: string | null;
  distance_unit: string | null;
  distance_value: number | null;
  variant_tags: string[] | null;
}

export interface CompetitionWorkoutSpec {
  classification: string;
  description: string;
  scoring_unit: ScoringUnit;
  scoring_direction: 'lower_is_better' | 'higher_is_better';
  is_dual_scoring: boolean;
  time_cap_seconds: number | null;
  rep_target: number | null;
  time_domain: { bucket: 'short' | 'medium' | 'long' | string; seconds: number | null };
  movements: CompetitionWorkoutMovement[];
}

export interface CompetitionResult {
  valid: boolean;
  raw_score: number;
  raw_score_text: string | null;
  scoring_unit: ScoringUnit;          // may differ from workout.scoring_unit on dual-scoring: 'time' => finished, 'reps' => capped
  workout_rank: number;
  cohort_percentile: number;
  worldwide_percentile: number;
  cohort_n: number;
  worldwide_n: number;
  // Top-1% (p99) score within the athlete's own gender/division cohort + its
  // unit (may differ from scoring_unit on dual-scoring workouts). Used to
  // estimate the top-1% W/kg per workout (see p99WPerKg). Bundle 1.6.0+.
  cohort_p99_threshold?: number | null;
  cohort_p99_threshold_unit?: ScoringUnit | null;
  // Per-result work/power (bundle 1.7.0). For COMPETED results these are at a
  // population-default mass (body_mass_basis "default_84m_64w"); rescale to the
  // athlete via `joules_bodyweight_component` (see personalizedPower). For
  // LOGGED throwbacks these are already at the athlete's real mass. All nullable.
  joules?: number | null;
  joules_bodyweight_component?: number | null;
  avg_power_watts?: number | null;
  avg_w_per_kg?: number | null;
  body_mass_basis?: string;
}

export interface AllResultsEntry {
  competition_workout_id: string;
  year: number;
  stage: CompetitionStage;
  ordinal: number | null;
  workout_name: string;
  division: number;
  scaled_tier: string;                // "rx" | "scaled" | "foundations" | ...
  workout: CompetitionWorkoutSpec;
  result: CompetitionResult;
  /** 'competed' = official result from the bundle (default); 'logged' = a Try-It
   *  throwback the athlete logged. Bundle entries omit it → treated as competed. */
  source?: 'competed' | 'logged';
}

/** A normalized entry = the raw AllResultsEntry plus a few derived flags. */
export interface CompetitionWorkoutEntry extends AllResultsEntry {
  /** Dual-scoring workout where the athlete finished under the cap (vs capped out). */
  finished_under_cap: boolean;
  /** The score that "ranks" for sorting: finishers above capped on dual-scoring; otherwise just the raw score with its direction. */
  is_finisher_score: boolean;
  /** 'competed' | 'logged' — always set (defaults to 'competed'). */
  source: 'competed' | 'logged';
}

export interface StageGroup {
  stage: CompetitionStage;
  entries: CompetitionWorkoutEntry[]; // ordinal asc; null-ordinal (named, e.g. Games "Mary") last, by name
}

export interface SeasonGroup {
  year: number;
  stages: StageGroup[];               // competition order: open → quarterfinals → semifinals/regional → games
}

export interface NormalizedCompetitionHistory {
  seasons: SeasonGroup[];             // year desc
  byId: Record<string, CompetitionWorkoutEntry>;
  total: number;                      // number of workouts the athlete has a result for
  yearsCompeted: number[];            // desc
  stagesSeen: CompetitionStage[];     // in competition order, only stages the athlete has entries in
}

const STAGE_ORDER: Record<string, number> = {
  open: 1,
  quarterfinals: 2,
  semifinals: 3,
  regional: 3, // pre-2019 name for the same tier
  games: 4,
};

function stageRank(stage: string): number {
  return STAGE_ORDER[stage] ?? 99;
}

/** Competition stages in order — used to pick the "deepest field" (= earliest)
 *  stage when summarising per-stage stats. */
export const STAGE_ORDER_LIST: CompetitionStage[] = ['open', 'quarterfinals', 'semifinals', 'regional', 'games'];

/** Short stage labels for tight summary lines (`Open · QF · Semis · …`). */
export const STAGE_ABBR: Record<string, string> = {
  open: 'Open',
  quarterfinals: 'QF',
  semifinals: 'Semis',
  regional: 'Regionals',
  games: 'Games',
};

function decorate(entry: AllResultsEntry): CompetitionWorkoutEntry {
  const finished_under_cap = entry.workout.is_dual_scoring && entry.result.scoring_unit === 'time';
  return {
    ...entry,
    finished_under_cap,
    is_finisher_score: !entry.workout.is_dual_scoring || finished_under_cap,
    source: entry.source ?? 'competed',
  };
}

/** Order workouts within a stage: numbered (by ordinal asc) first, then named (by name asc). */
function compareWithinStage(a: CompetitionWorkoutEntry, b: CompetitionWorkoutEntry): number {
  const ao = a.ordinal;
  const bo = b.ordinal;
  if (ao != null && bo != null) return ao - bo;
  if (ao != null) return -1;
  if (bo != null) return 1;
  return a.workout_name.localeCompare(b.workout_name);
}

export function normalizeCompetitionHistory(
  allResults: AllResultsEntry[] | undefined | null,
): NormalizedCompetitionHistory {
  const entries = (allResults ?? []).map(decorate);

  const byId: Record<string, CompetitionWorkoutEntry> = {};
  for (const e of entries) byId[e.competition_workout_id] = e;

  // year -> stage -> entries
  const byYear = new Map<number, Map<string, CompetitionWorkoutEntry[]>>();
  for (const e of entries) {
    let stages = byYear.get(e.year);
    if (!stages) { stages = new Map(); byYear.set(e.year, stages); }
    let list = stages.get(e.stage);
    if (!list) { list = []; stages.set(e.stage, list); }
    list.push(e);
  }

  const seasons: SeasonGroup[] = Array.from(byYear.entries())
    .sort(([a], [b]) => b - a) // year desc
    .map(([year, stages]) => ({
      year,
      stages: Array.from(stages.entries())
        .sort(([a], [b]) => stageRank(a) - stageRank(b))
        .map(([stage, list]) => ({
          stage,
          entries: list.slice().sort(compareWithinStage),
        })),
    }));

  const stageSet = new Set<string>();
  for (const e of entries) stageSet.add(e.stage);
  const stagesSeen = Array.from(stageSet).sort((a, b) => stageRank(a) - stageRank(b));

  return {
    seasons,
    byId,
    total: entries.length,
    yearsCompeted: seasons.map((s) => s.year),
    stagesSeen,
  };
}

/** A logged-throwback row (competition_workout_results) with its persisted placement. */
export interface ThrowbackRow {
  competition_workout_id: string;
  score_type: string;
  score_value: number;
  finished: boolean | null;
  cohort_percentile: number | null;
  worldwide_percentile: number | null;
  worldwide_rank: number | null;
  field_size: number | null;
  cohort_size: number | null;
  // Power computed at the athlete's REAL mass at log time (no rescale needed).
  joules: number | null;
  avg_power_watts: number | null;
  avg_w_per_kg: number | null;
}

/**
 * Turn logged throwbacks into `AllResultsEntry`s (source: 'logged') so they flow
 * through the same grid / movement / detail pipelines as competed results. The
 * workout shell comes from the catalog (movements are name-only — enough for the
 * movement list); the result comes from the persisted placement. Throwbacks whose
 * workout isn't in the catalog are skipped (can't place them on the grid).
 */
export function throwbacksToEntries(
  throwbacks: ThrowbackRow[],
  catalogById: Record<string, CatalogWorkoutSummary>,
): AllResultsEntry[] {
  const out: AllResultsEntry[] = [];
  for (const t of throwbacks) {
    const w = catalogById[t.competition_workout_id];
    if (!w) continue;
    const unit = (w.scoring?.scoring_unit ?? (t.score_type as ScoringUnit));
    out.push({
      competition_workout_id: t.competition_workout_id,
      year: w.season,
      stage: w.stage,
      ordinal: w.ordinal,
      workout_name: w.workout_name,
      division: w.division ?? 0,
      scaled_tier: w.scaled_tier,
      source: 'logged',
      workout: {
        classification: '',
        description: '',
        scoring_unit: unit,
        scoring_direction: w.scoring?.scoring_direction ?? 'higher_is_better',
        is_dual_scoring: w.scoring?.is_dual_scoring ?? false,
        time_cap_seconds: w.scoring?.time_cap_seconds ?? null,
        rep_target: null,
        time_domain: w.time_domain ?? { bucket: '', seconds: null },
        movements: (w.movements ?? []).map((name, i) => ({
          name, family: name, position: i, equipment: [], mgw_category: null,
          rounds: null, reps_total: null, reps_per_round: null, reps_scheme: null,
          calories: null, load_lbs: null, load_descriptor: null, load_progression: null,
          distance_unit: null, distance_value: null, variant_tags: null,
        })),
      },
      result: {
        valid: true,
        raw_score: t.score_value,
        raw_score_text: null,
        scoring_unit: t.score_type as ScoringUnit,
        workout_rank: t.worldwide_rank ?? 0,
        cohort_percentile: t.cohort_percentile ?? NaN,
        worldwide_percentile: t.worldwide_percentile ?? NaN,
        cohort_n: t.cohort_size ?? 0,
        worldwide_n: t.field_size ?? 0,
        // Throwback power is already at the athlete's real mass.
        joules: t.joules,
        avg_power_watts: t.avg_power_watts,
        avg_w_per_kg: t.avg_w_per_kg,
        body_mass_basis: 'athlete',
      },
    });
  }
  return out;
}

/**
 * Normalize the bundle's competed results merged with logged throwbacks. A
 * throwback for a workout the athlete also COMPETED in is dropped (the official
 * result wins). Everything else flows through `normalizeCompetitionHistory`.
 */
export function normalizeWithThrowbacks(
  allResults: AllResultsEntry[] | undefined | null,
  throwbackEntries: AllResultsEntry[],
): NormalizedCompetitionHistory {
  const competed = allResults ?? [];
  const competedIds = new Set(competed.map((e) => e.competition_workout_id));
  const merged = [...competed, ...throwbackEntries.filter((t) => !competedIds.has(t.competition_workout_id))];
  return normalizeCompetitionHistory(merged);
}

/**
 * The watts / W·kg to display for an entry, personalized to the athlete's mass.
 *  - logged throwback: power was computed at the athlete's real mass → as-is.
 *  - competed: bundle power is at a population-default mass (84 M / 64 W by
 *    division); rescale joules via `joules_bodyweight_component`, then watts
 *    (workout duration is mass-invariant). Falls back to the default numbers if
 *    body mass or the rescale component is missing.
 * Returns null when there's no power to show. `estimated` = true for competed
 * (modeled from the cohort), false for a logged throwback (the athlete's effort).
 */
export function personalizedPower(
  entry: CompetitionWorkoutEntry,
  userKg: number | null | undefined,
): { watts: number; wPerKg: number | null; estimated: boolean } | null {
  const r = entry.result;
  if (r.avg_power_watts == null) return null;

  if (entry.source === 'logged') {
    return { watts: r.avg_power_watts, wPerKg: r.avg_w_per_kg ?? (userKg ? r.avg_power_watts / userKg : null), estimated: false };
  }

  if (userKg && userKg > 0 && r.joules != null && r.joules > 0 && r.joules_bodyweight_component != null) {
    const defaultKg = entry.division === 2 ? 64 : 84;
    const workSeconds = r.joules / r.avg_power_watts; // mass-invariant
    const joulesPersonal = r.joules + r.joules_bodyweight_component * (userKg / defaultKg - 1);
    const watts = workSeconds > 0 ? joulesPersonal / workSeconds : r.avg_power_watts;
    return { watts, wPerKg: watts / userKg, estimated: true };
  }
  return { watts: r.avg_power_watts, wPerKg: r.avg_w_per_kg ?? null, estimated: true };
}

/**
 * Estimate the top-1% (p99) W/kg for a workout, on the SAME basis as the
 * athlete's displayed wPerKg (so "you vs top 1%" share one scale). The p99 is
 * already scoped to the athlete's own gender/division cohort upstream. We scale
 * the athlete's own W/kg by the score ratio:
 *   - time workouts → power ∝ 1/time, so × (your_time / p99_time). Exact — the
 *     work is identical (fixed reps), only the time differs.
 *   - rep/AMRAP     → power ∝ reps,   so × (p99_reps / your_reps). Approximate
 *     (assumes linear work-per-rep across movements).
 * Returns null when there's no p99, the units don't match (dual-scoring), or the
 * scoring unit isn't time/reps (load/distance power models are ambiguous).
 */
export function p99WPerKg(entry: CompetitionWorkoutEntry, athleteWPerKg: number): number | null {
  const r = entry.result;
  const p99 = r.cohort_p99_threshold;
  const score = r.raw_score;
  if (p99 == null || !Number.isFinite(p99) || p99 <= 0) return null;
  if (!Number.isFinite(score) || score <= 0) return null;
  // The ratio is only valid when the p99 is in the same unit as the athlete's score.
  const p99Unit = r.cohort_p99_threshold_unit ?? r.scoring_unit;
  if (p99Unit !== r.scoring_unit) return null;
  let ratio: number;
  if (r.scoring_unit === 'time') {
    ratio = score / p99;       // faster (smaller) top-1% time → higher power
  } else if (r.scoring_unit === 'reps') {
    ratio = p99 / score;       // more top-1% reps → higher power
  } else {
    return null;               // load / distance: power model is ambiguous
  }
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return athleteWPerKg * ratio;
}

// ============================================================
// Placement (POST /workouts/{id}/placement) — "where you'd have landed"
// ============================================================

export interface PlacementResult {
  field_size: number;
  worldwide_percentile: number;
  worldwide_rank: number;
  cohort?: {
    age_band: string;
    cohort_size: number;
    cohort_percentile?: number;
    cohort_rank?: number;
    note?: string;
  };
}

/** The competition-service's 7 age buckets, from an age in years. null if unknown. */
export function ageBandFor(age: number | null | undefined): string | undefined {
  if (age == null || !Number.isFinite(age) || age <= 0) return undefined;
  if (age < 18) return 'under_18';
  if (age <= 34) return 'open_18_34';
  if (age <= 39) return 'masters_35_39';
  if (age <= 44) return 'masters_40_44';
  if (age <= 49) return 'masters_45_49';
  if (age <= 54) return 'masters_50_54';
  return 'masters_55_plus';
}

// ============================================================
// Catalog (every competition workout) — for the "All"-scope grid
// ============================================================

/** A row from GET /workouts (the catalog list endpoint). Lighter than an
 *  AllResultsEntry — movement names only, no `result`. NOTE: the list endpoint
 *  does not currently expose a division — it returns separate M/W rows per
 *  workout (distinct competition_workout_id, same season/stage/ordinal/name).
 *  `division`/`division_name` are declared optional for when that lands. */
export interface CatalogWorkoutSummary {
  competition_workout_id: string;
  season: number;
  stage: CompetitionStage;
  ordinal: number | null;
  workout_name: string;
  scaled_tier: string;
  movements: string[];
  time_domain: { bucket: string; seconds: number | null } | null;
  scoring: {
    scoring_unit: ScoringUnit;
    scoring_direction: 'lower_is_better' | 'higher_is_better';
    is_dual_scoring: boolean;
    time_cap_seconds: number | null;
  } | null;
  field_size: number | null;
  /**
   * Prose prescription (e.g. "AMRAP 20: ..."). UPSTREAM ASK (Option 1): add
   * `description` to GET /workouts so not-done workouts show instructions, same
   * as done workouts (which get it from the results bundle). Optional/renders
   * only when present, so this is safe before the catalog exposes it.
   */
  description?: string | null;
  /** Not yet returned by GET /workouts; here for when the catalog exposes it. */
  division?: number;          // 1 = Men, 2 = Women (crossfit.competitions.division code)
  division_name?: string;     // "Men" | "Women"
}

export interface CatalogStageGroup {
  stage: CompetitionStage;
  workouts: CatalogWorkoutSummary[]; // ordinal asc; named (null ordinal) last
}
export interface CatalogSeasonGroup {
  season: number;
  stages: CatalogStageGroup[];       // competition order
}
export interface NormalizedCatalog {
  seasons: CatalogSeasonGroup[];     // season desc
  byId: Record<string, CatalogWorkoutSummary>;
  total: number;
}

/**
 * @param preferIds when deduping the remaining rows of a workout (e.g. rx vs
 *   scaled tiers), keep the entry whose id is in this set (the athlete's own
 *   competition_workout_id) — else the rx entry, else first-seen.
 * @param division the athlete's division (1 = Men, 2 = Women, from
 *   all_results[].division). When the catalog exposes `division`, the list is
 *   filtered to this division first so each workout appears once.
 */
export function normalizeCatalog(
  workouts: CatalogWorkoutSummary[] | undefined | null,
  preferIds?: Set<string>,
  division?: number,
): NormalizedCatalog {
  let raw = workouts ?? [];

  // Filter to the athlete's division when the catalog exposes it and we know it.
  if (division != null && raw.some((w) => w.division != null)) {
    raw = raw.filter((w) => w.division == null || w.division === division);
  }

  // Dedupe to one entry per (season, stage, ordinal ?? workout_name) — collapses
  // any remaining duplicates (e.g. rx/scaled/foundations tiers of the same workout).
  const groups = new Map<string, CatalogWorkoutSummary[]>();
  for (const w of raw) {
    const key = `${w.season}|${w.stage}|${w.ordinal != null ? `o${w.ordinal}` : `n${w.workout_name}`}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(w);
  }
  const all: CatalogWorkoutSummary[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) { all.push(g[0]); continue; }
    const picked =
      (preferIds && g.find((w) => preferIds.has(w.competition_workout_id))) ||
      g.find((w) => w.scaled_tier === 'rx') ||
      g[0];
    all.push(picked);
  }

  const byId: Record<string, CatalogWorkoutSummary> = {};
  for (const w of all) byId[w.competition_workout_id] = w;

  const byYear = new Map<number, Map<string, CatalogWorkoutSummary[]>>();
  for (const w of all) {
    let stages = byYear.get(w.season);
    if (!stages) { stages = new Map(); byYear.set(w.season, stages); }
    let list = stages.get(w.stage);
    if (!list) { list = []; stages.set(w.stage, list); }
    list.push(w);
  }

  const cmp = (a: CatalogWorkoutSummary, b: CatalogWorkoutSummary): number => {
    if (a.ordinal != null && b.ordinal != null) return a.ordinal - b.ordinal;
    if (a.ordinal != null) return -1;
    if (b.ordinal != null) return 1;
    return a.workout_name.localeCompare(b.workout_name);
  };

  const seasons: CatalogSeasonGroup[] = Array.from(byYear.entries())
    .sort(([a], [b]) => b - a)
    .map(([season, stages]) => ({
      season,
      stages: Array.from(stages.entries())
        .sort(([a], [b]) => stageRank(a) - stageRank(b))
        .map(([stage, list]) => ({ stage, workouts: list.slice().sort(cmp) })),
    }));

  return { seasons, byId, total: all.length };
}

/** Which season years to render collapsed by default — all of them. The user
 *  expands the years they care about (and "Expand all" un-collapses everything).
 *  `seasonsNewestFirst` is the season list in display order (year desc). */
export function initialCollapsedSeasons(seasonsNewestFirst: number[]): Set<number> {
  return new Set(seasonsNewestFirst);
}

/** Mean cohort_percentile across a set of the athlete's entries (skips
 *  non-finite values); null when nothing usable. Used for the collapsed
 *  per-season summary lines in the grid / map. */
export function avgCohortPercentile(
  entries: ReadonlyArray<CompetitionWorkoutEntry | undefined>,
): number | null {
  const ps: number[] = [];
  for (const e of entries) {
    const p = e?.result?.cohort_percentile;
    if (typeof p === 'number' && Number.isFinite(p)) ps.push(p);
  }
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
}

export interface DurationBucketStat {
  bucket: 'short' | 'medium' | 'long';
  /** Workouts in this bucket. */
  n: number;
  /** Mean cohort percentile across those workouts; null if none have one. */
  avgPct: number | null;
}

/**
 * Per-time-domain rollup of the athlete's results, bucketed by each workout's
 * `time_domain.bucket` — the SAME per-workout field the Map's time filter uses,
 * so the Summary's "Across durations" counts and the Map's filtered counts
 * agree by construction. The bundle's fitness_signature.stimulus_breakdown.
 * time_domain is a separate upstream aggregation that buckets differently —
 * don't source a count from one surface and a count from the other.
 */
export function timeDomainBreakdown(
  history: NormalizedCompetitionHistory,
): DurationBucketStat[] {
  const buckets: Array<'short' | 'medium' | 'long'> = ['short', 'medium', 'long'];
  return buckets.map((bucket) => {
    const entries = Object.values(history.byId).filter(
      (e) => e.workout.time_domain?.bucket === bucket,
    );
    return { bucket, n: entries.length, avgPct: avgCohortPercentile(entries) };
  });
}

export interface WkgBucketStat {
  bucket: 'short' | 'medium' | 'long';
  /** Items in this bucket. */
  n: number;
  /** Items in this bucket that had a usable W/kg. */
  nWithPower: number;
  /** Mean W/kg across the items that had power; null if none did. */
  avgWkg: number | null;
}

/**
 * Generic per-time-domain W/kg rollup. Both the program metcons (Analytics) and
 * the linked competition results flow through this single helper so the two
 * surfaces bucket identically and can't drift — the bucket key ('short' |
 * 'medium' | 'long') is ours, defined the same way on both sides. `getBucket`
 * returns the item's bucket (anything outside the three is ignored); `getWkg`
 * returns the item's W/kg (personalized for program, population-default for
 * competition), null when unavailable.
 */
export function bucketByTimeDomain<T>(
  items: T[],
  getBucket: (item: T) => string | null | undefined,
  getWkg: (item: T) => number | null | undefined,
): WkgBucketStat[] {
  const buckets: Array<'short' | 'medium' | 'long'> = ['short', 'medium', 'long'];
  return buckets.map((bucket) => {
    const inBucket = items.filter((it) => getBucket(it) === bucket);
    const wkgs: number[] = [];
    for (const it of inBucket) {
      const w = getWkg(it);
      if (typeof w === 'number' && Number.isFinite(w) && w > 0) wkgs.push(w);
    }
    return {
      bucket,
      n: inBucket.length,
      nWithPower: wkgs.length,
      avgWkg: wkgs.length ? wkgs.reduce((a, b) => a + b, 0) / wkgs.length : null,
    };
  });
}

/**
 * Flatten the unique movements across all of the athlete's results, with how
 * many of their workouts each appeared in. Newest-first ordering is preserved
 * in `workoutIds` so a "workouts including X" drill-down can show recent first.
 */
/**
 * Catalog movement slug → display name. Handles hyphen- and underscore-
 * separated slugs ("lateral-burpee-over-dumbbell" → "Lateral Burpee Over
 * Dumbbell"). Title-casing matches the canonical `movements` table convention
 * (e.g. "Ghd Sit Up", "Clean And Jerk"), so it reads consistently across the app.
 */
export function prettyMovementName(slug: string): string {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function movementExposure(history: NormalizedCompetitionHistory): Array<{
  name: string;
  family: string;
  workoutCount: number;
  workoutIds: string[];
}> {
  const map = new Map<string, { name: string; family: string; workoutIds: string[] }>();
  // Walk seasons newest-first → workoutIds end up recent-first.
  for (const season of history.seasons) {
    for (const stage of season.stages) {
      for (const entry of stage.entries) {
        for (const m of entry.workout.movements) {
          let rec = map.get(m.name);
          if (!rec) { rec = { name: m.name, family: m.family, workoutIds: [] }; map.set(m.name, rec); }
          if (!rec.workoutIds.includes(entry.competition_workout_id)) {
            rec.workoutIds.push(entry.competition_workout_id);
          }
        }
      }
    }
  }
  return Array.from(map.values())
    .map((r) => ({ name: r.name, family: r.family, workoutCount: r.workoutIds.length, workoutIds: r.workoutIds }))
    .sort((a, b) => b.workoutCount - a.workoutCount || a.name.localeCompare(b.name));
}

/** Per-stage rollup for one movement: how many of the athlete's workouts in
 *  that stage included it, and the mean cohort percentile of those workouts. */
export interface MovementStageStat {
  stage: CompetitionStage;
  n: number;
  /** Mean cohort percentile of the workouts in this stage that include the movement; null if none have a usable percentile. */
  avgPct: number | null;
  /** True when every workout behind this stat is a logged throwback (not competed) — drives the "logged" flag in the UI. */
  logged: boolean;
}

export interface MovementPerformance {
  name: string;
  family: string;
  totalWorkouts: number;          // distinct workouts including the movement, all stages
  byStage: MovementStageStat[];   // only stages with >=1 such workout, in competition order (deepest field first)
  /** byStage[0] — the deepest-field stage the athlete faced the movement in (usually the Open). null only if totalWorkouts is 0. */
  headline: MovementStageStat | null;
}

/**
 * For every movement the athlete has competed with, the per-stage performance
 * proxy: each workout containing the movement contributes its cohort percentile
 * to that movement's stage bucket. Noisy per-workout (a snatch + five other
 * things still counts toward "snatch") but it evens out over enough workouts —
 * label it "on workouts including X", not "your snatch percentile".
 * Percentiles are NOT pooled across stages: an Open workout's field is ~300k, a
 * Games event's is ~40, so each stage keeps its own number.
 * Returned sorted by totalWorkouts desc (callers re-sort as needed).
 */
export function movementPerformance(history: NormalizedCompetitionHistory): MovementPerformance[] {
  return movementExposure(history).map((m) => {
    const byStageIds = new Map<CompetitionStage, string[]>();
    for (const id of m.workoutIds) {
      const e = history.byId[id];
      if (!e) continue;
      const list = byStageIds.get(e.stage) ?? [];
      list.push(id);
      byStageIds.set(e.stage, list);
    }
    const orderedStages = [
      ...STAGE_ORDER_LIST.filter((s) => byStageIds.has(s)),
      ...Array.from(byStageIds.keys()).filter((s) => !STAGE_ORDER_LIST.includes(s)),
    ];
    const byStage: MovementStageStat[] = orderedStages.map((stage) => {
      const ids = byStageIds.get(stage)!;
      return {
        stage,
        n: ids.length,
        avgPct: avgCohortPercentile(ids.map((id) => history.byId[id])),
        logged: ids.every((id) => history.byId[id]?.source === 'logged'),
      };
    });
    return {
      name: m.name,
      family: m.family,
      totalWorkouts: m.workoutCount,
      byStage,
      headline: byStage[0] ?? null,
    };
  });
}
