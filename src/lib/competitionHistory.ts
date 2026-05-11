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
  time_domain: { bucket: 'short' | 'mid' | 'long' | string; seconds: number | null };
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
}

/** A normalized entry = the raw AllResultsEntry plus a few derived flags. */
export interface CompetitionWorkoutEntry extends AllResultsEntry {
  /** Dual-scoring workout where the athlete finished under the cap (vs capped out). */
  finished_under_cap: boolean;
  /** The score that "ranks" for sorting: finishers above capped on dual-scoring; otherwise just the raw score with its direction. */
  is_finisher_score: boolean;
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

function decorate(entry: AllResultsEntry): CompetitionWorkoutEntry {
  const finished_under_cap = entry.workout.is_dual_scoring && entry.result.scoring_unit === 'time';
  return {
    ...entry,
    finished_under_cap,
    is_finisher_score: !entry.workout.is_dual_scoring || finished_under_cap,
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

/**
 * Flatten the unique movements across all of the athlete's results, with how
 * many of their workouts each appeared in. Newest-first ordering is preserved
 * in `workoutIds` so a "workouts including X" drill-down can show recent first.
 */
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
