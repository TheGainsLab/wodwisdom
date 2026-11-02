/**
 * Observed Open medians — ground truth for the score-scale acceptance
 * protocol (design doc, 2026-11-02): the structure-only predictor must
 * predict each ratified workout's median from structure alone, and its
 * measured error becomes the obs_noise_var on structure-scored evidence.
 *
 * This fixture is deliberately NOT derived from anything the predictor
 * consumes (stage power curve, cohort anchors) — it is the leaderboard's
 * own observed statistics, pulled once from the competition service:
 *
 *   WITH q AS (
 *     SELECT pc.workout_id,
 *            (array_agg(pc.score_value ORDER BY abs(pc.percentile-25)))[1] AS p25_score,
 *            (array_agg(pc.score_value ORDER BY abs(pc.percentile-50)))[1] AS p50_score,
 *            (array_agg(pc.score_value ORDER BY abs(pc.percentile-75)))[1] AS p75_score
 *     FROM pe.workout_percentile_curve pc GROUP BY pc.workout_id)
 *   SELECT w.workout_name, f.gender, f.year,
 *          f.time_domain_seconds AS observed_median_s,
 *          f.time_cap_seconds, q.p25_score, q.p50_score, q.p75_score
 *   FROM pe.workout_features f
 *   JOIN crossfit.workouts_full w ON w.workout_id = f.workout_id AND w.tier = 'rx'
 *   JOIN q ON q.workout_id = f.workout_id
 *   WHERE f.competition_type = 'open'
 *   ORDER BY w.workout_name, f.gender;
 *
 * Known upstream data-quality bug: 17.3's time_domain_seconds is wrong
 * (see signature_censoring migration notes) — the harness skips it for the
 * seconds comparison.
 *
 * Empty until the pull lands; the scorescale_acceptance action reports
 * NEEDS_FIXTURE while it is.
 */

export interface ObservedMedianRow {
  workout_name: string;
  gender: "M" | "F";
  year: number;
  /** observed median duration in seconds (cap-aware cohort statistic) */
  observed_median_s: number | null;
  time_cap_seconds: number | null;
  /** score-space quartiles (reps for rep-ranked fields, seconds for time) */
  p25_score: number | null;
  p50_score: number | null;
  p75_score: number | null;
}

export const OPEN_OBSERVED_MEDIANS: ObservedMedianRow[] = [];
