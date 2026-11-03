/**
 * Observed Open medians — ground truth for the score-scale acceptance
 * protocol (design doc, 2026-11-02): the structure-only predictor must
 * predict each ratified workout's median from structure alone, and its
 * measured error becomes the obs_noise_var on structure-scored evidence.
 *
 * This fixture is deliberately NOT derived from anything the predictor
 * consumes (stage power curve, cohort anchors) — it is the leaderboard's
 * own observed statistics, pulled 2026-11-03 from the competition service
 * (pe.workout_percentile_curve, segment = 'general' ONLY — the view holds
 * eleven population segments per workout and pooling them interleaves
 * incompatible curves; the first pull made that mistake and 32 of 146
 * rows came back with impossible quartiles):
 *
 *   WITH oc AS (
 *     SELECT * FROM pe.workout_percentile_curve WHERE segment = 'general'
 *   ), q AS (
 *     SELECT workout_id,
 *       (array_agg(score_value ORDER BY abs(percentile-25)))[1] AS p25_score,
 *       (array_agg(score_value ORDER BY abs(percentile-50)))[1] AS p50_score,
 *       (array_agg(score_value ORDER BY abs(percentile-75)))[1] AS p75_score
 *     FROM oc GROUP BY workout_id)
 *   SELECT w.workout_name, f.gender, f.year,
 *          f.time_domain_seconds AS observed_median_s,
 *          f.time_cap_seconds, q.p25_score, q.p50_score, q.p75_score
 *   FROM pe.workout_features f
 *   JOIN crossfit.workouts_full w ON w.workout_id = f.workout_id AND w.tier = 'rx'
 *   JOIN q ON q.workout_id = f.workout_id
 *   WHERE f.competition_type = 'open'
 *   ORDER BY w.workout_name, f.gender;
 *
 * Seed-time validation (research audit, 2026-11-03): all 146 rows passed
 * direction checks — rep quartiles ascend with percentile, finisher-time
 * quartiles descend. Six rows (17.1, 21.2, 25.3 x both genders) carry
 * MIXED-UNIT quartiles (the p50/p75 straddle the finisher boundary on
 * capped for-time workouts); the action's non-monotone guard excludes
 * them from the percentile channel automatically. Upstream zeros for
 * "no cap" / "no fixed time domain" are seeded as null, NOT 0 — the
 * at-cap guard reads median >= cap*0.98, and cap=0 would wrongly mark
 * every uncapped workout (14.5, 15.5, 16.5) as capped and skip it.
 *
 * Known upstream data-quality bug: 17.3's time_domain_seconds is wrong
 * (see signature_censoring migration notes) — the harness skips it for the
 * seconds comparison.
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

export const OPEN_OBSERVED_MEDIANS: ObservedMedianRow[] = [
  { workout_name: "11.1", gender: "F", year: 2011, observed_median_s: 600, time_cap_seconds: 600, p25_score: 177, p50_score: 219, p75_score: 262 },
  { workout_name: "11.1", gender: "M", year: 2011, observed_median_s: 600, time_cap_seconds: 600, p25_score: 206, p50_score: 257, p75_score: 301 },
  { workout_name: "11.2", gender: "F", year: 2011, observed_median_s: 900, time_cap_seconds: 900, p25_score: 269, p50_score: 311, p75_score: 361 },
  { workout_name: "11.2", gender: "M", year: 2011, observed_median_s: 900, time_cap_seconds: 900, p25_score: 290, p50_score: 333, p75_score: 378 },
  { workout_name: "11.3", gender: "F", year: 2011, observed_median_s: 300, time_cap_seconds: 300, p25_score: 14, p50_score: 27, p75_score: 40 },
  { workout_name: "11.3", gender: "M", year: 2011, observed_median_s: 300, time_cap_seconds: 300, p25_score: 22, p50_score: 35, p75_score: 47 },
  { workout_name: "11.4", gender: "F", year: 2011, observed_median_s: 600, time_cap_seconds: 600, p25_score: 66, p50_score: 76, p75_score: 90 },
  { workout_name: "11.4", gender: "M", year: 2011, observed_median_s: 600, time_cap_seconds: 600, p25_score: 76, p50_score: 91, p75_score: 97 },
  { workout_name: "11.5", gender: "F", year: 2011, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 183, p50_score: 221, p75_score: 263 },
  { workout_name: "11.5", gender: "M", year: 2011, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 216, p50_score: 249, p75_score: 285 },
  { workout_name: "11.6", gender: "F", year: 2011, observed_median_s: 420, time_cap_seconds: 420, p25_score: 53, p50_score: 73, p75_score: 87 },
  { workout_name: "11.6", gender: "M", year: 2011, observed_median_s: 420, time_cap_seconds: 420, p25_score: 74, p50_score: 90, p75_score: 102 },
  { workout_name: "12.1", gender: "F", year: 2012, observed_median_s: 420, time_cap_seconds: 420, p25_score: 77, p50_score: 88, p75_score: 99 },
  { workout_name: "12.1", gender: "M", year: 2012, observed_median_s: 420, time_cap_seconds: 420, p25_score: 86, p50_score: 98, p75_score: 109 },
  { workout_name: "12.2", gender: "F", year: 2012, observed_median_s: 600, time_cap_seconds: 600, p25_score: 46, p50_score: 60, p75_score: 63 },
  { workout_name: "12.2", gender: "M", year: 2012, observed_median_s: 600, time_cap_seconds: 600, p25_score: 40, p50_score: 59, p75_score: 62 },
  { workout_name: "12.3", gender: "F", year: 2012, observed_median_s: 1080, time_cap_seconds: 1080, p25_score: 166, p50_score: 221, p75_score: 274 },
  { workout_name: "12.3", gender: "M", year: 2012, observed_median_s: 1080, time_cap_seconds: 1080, p25_score: 203, p50_score: 246, p75_score: 294 },
  { workout_name: "12.4", gender: "F", year: 2012, observed_median_s: 720, time_cap_seconds: 720, p25_score: 151, p50_score: 201, p75_score: 240 },
  { workout_name: "12.4", gender: "M", year: 2012, observed_median_s: 720, time_cap_seconds: 720, p25_score: 175, p50_score: 240, p75_score: 246 },
  { workout_name: "12.5", gender: "F", year: 2012, observed_median_s: 420, time_cap_seconds: 420, p25_score: 29, p50_score: 59, p75_score: 82 },
  { workout_name: "12.5", gender: "M", year: 2012, observed_median_s: 420, time_cap_seconds: 420, p25_score: 68, p50_score: 84, p75_score: 100 },
  { workout_name: "13.1", gender: "F", year: 2013, observed_median_s: 1020, time_cap_seconds: 1020, p25_score: 106, p50_score: 129, p75_score: 151 },
  { workout_name: "13.1", gender: "M", year: 2013, observed_median_s: 1020, time_cap_seconds: 1020, p25_score: 103, p50_score: 121, p75_score: 150 },
  { workout_name: "13.2", gender: "F", year: 2013, observed_median_s: 600, time_cap_seconds: 600, p25_score: 188, p50_score: 227, p75_score: 262 },
  { workout_name: "13.2", gender: "M", year: 2013, observed_median_s: 600, time_cap_seconds: 600, p25_score: 194, p50_score: 224, p75_score: 255 },
  { workout_name: "13.3", gender: "F", year: 2013, observed_median_s: 720, time_cap_seconds: 720, p25_score: 142, p50_score: 187, p75_score: 240 },
  { workout_name: "13.3", gender: "M", year: 2013, observed_median_s: 720, time_cap_seconds: 720, p25_score: 162, p50_score: 227, p75_score: 244 },
  { workout_name: "13.4", gender: "F", year: 2013, observed_median_s: 420, time_cap_seconds: 420, p25_score: 31, p50_score: 48, p75_score: 66 },
  { workout_name: "13.4", gender: "M", year: 2013, observed_median_s: 420, time_cap_seconds: 420, p25_score: 53, p50_score: 67, p75_score: 79 },
  { workout_name: "13.5", gender: "F", year: 2013, observed_median_s: 240, time_cap_seconds: 240, p25_score: 18, p50_score: 42, p75_score: 56 },
  { workout_name: "13.5", gender: "M", year: 2013, observed_median_s: 240, time_cap_seconds: 240, p25_score: 48, p50_score: 60, p75_score: 72 },
  { workout_name: "14.1", gender: "F", year: 2014, observed_median_s: 600, time_cap_seconds: 600, p25_score: 137, p50_score: 195, p75_score: 256 },
  { workout_name: "14.1", gender: "M", year: 2014, observed_median_s: 600, time_cap_seconds: 600, p25_score: 175, p50_score: 228, p75_score: 277 },
  { workout_name: "14.2", gender: "F", year: 2014, observed_median_s: null, time_cap_seconds: null, p25_score: 11, p50_score: 32, p75_score: 76 },
  { workout_name: "14.2", gender: "M", year: 2014, observed_median_s: null, time_cap_seconds: null, p25_score: 52, p50_score: 80, p75_score: 124 },
  { workout_name: "14.3", gender: "F", year: 2014, observed_median_s: 480, time_cap_seconds: 480, p25_score: 93, p50_score: 103, p75_score: 122 },
  { workout_name: "14.3", gender: "M", year: 2014, observed_median_s: 480, time_cap_seconds: 480, p25_score: 99, p50_score: 109, p75_score: 130 },
  { workout_name: "14.4", gender: "F", year: 2014, observed_median_s: 840, time_cap_seconds: 840, p25_score: 112, p50_score: 157, p75_score: 176 },
  { workout_name: "14.4", gender: "M", year: 2014, observed_median_s: 840, time_cap_seconds: 840, p25_score: 164, p50_score: 180, p75_score: 183 },
  { workout_name: "14.5", gender: "F", year: 2014, observed_median_s: 1154, time_cap_seconds: null, p25_score: 1428, p50_score: 1152, p75_score: 956 },
  { workout_name: "14.5", gender: "M", year: 2014, observed_median_s: 1104, time_cap_seconds: null, p25_score: 1341, p50_score: 1102, p75_score: 922 },
  { workout_name: "15.1", gender: "F", year: 2015, observed_median_s: 540, time_cap_seconds: 540, p25_score: 90, p50_score: 116, p75_score: 133 },
  { workout_name: "15.1", gender: "M", year: 2015, observed_median_s: 540, time_cap_seconds: 540, p25_score: 102, p50_score: 125, p75_score: 149 },
  { workout_name: "15.1a", gender: "F", year: 2015, observed_median_s: null, time_cap_seconds: 360, p25_score: 116, p50_score: 132, p75_score: 146 },
  { workout_name: "15.1a", gender: "M", year: 2015, observed_median_s: null, time_cap_seconds: 360, p25_score: 187, p50_score: 207, p75_score: 235 },
  { workout_name: "15.2", gender: "F", year: 2015, observed_median_s: null, time_cap_seconds: null, p25_score: 16, p50_score: 39, p75_score: 82 },
  { workout_name: "15.2", gender: "M", year: 2015, observed_median_s: null, time_cap_seconds: null, p25_score: 65, p50_score: 84, p75_score: 131 },
  { workout_name: "15.3", gender: "F", year: 2015, observed_median_s: 840, time_cap_seconds: 840, p25_score: 124, p50_score: 174, p75_score: 316 },
  { workout_name: "15.3", gender: "M", year: 2015, observed_median_s: 840, time_cap_seconds: 840, p25_score: 161, p50_score: 283, p75_score: 334 },
  { workout_name: "15.4", gender: "F", year: 2015, observed_median_s: 480, time_cap_seconds: 480, p25_score: 14, p50_score: 35, p75_score: 61 },
  { workout_name: "15.4", gender: "M", year: 2015, observed_median_s: 480, time_cap_seconds: 480, p25_score: 27, p50_score: 46, p75_score: 67 },
  { workout_name: "15.5", gender: "F", year: 2015, observed_median_s: 806, time_cap_seconds: null, p25_score: 950, p50_score: 807, p75_score: 688 },
  { workout_name: "15.5", gender: "M", year: 2015, observed_median_s: 716, time_cap_seconds: null, p25_score: 864, p50_score: 715, p75_score: 595 },
  { workout_name: "16.1", gender: "F", year: 2016, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 104, p50_score: 140, p75_score: 171 },
  { workout_name: "16.1", gender: "M", year: 2016, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 120, p50_score: 155, p75_score: 186 },
  { workout_name: "16.2", gender: "F", year: 2016, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 79, p50_score: 124, p75_score: 172 },
  { workout_name: "16.2", gender: "M", year: 2016, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 85, p50_score: 166, p75_score: 174 },
  { workout_name: "16.3", gender: "F", year: 2016, observed_median_s: 420, time_cap_seconds: 420, p25_score: 10, p50_score: 11, p75_score: 46 },
  { workout_name: "16.3", gender: "M", year: 2016, observed_median_s: 420, time_cap_seconds: 420, p25_score: 26, p50_score: 64, p75_score: 84 },
  { workout_name: "16.4", gender: "F", year: 2016, observed_median_s: 780, time_cap_seconds: 780, p25_score: 139, p50_score: 165, p75_score: 174 },
  { workout_name: "16.4", gender: "M", year: 2016, observed_median_s: 780, time_cap_seconds: 780, p25_score: 157, p50_score: 171, p75_score: 184 },
  { workout_name: "16.5", gender: "F", year: 2016, observed_median_s: 1066, time_cap_seconds: null, p25_score: 1287, p50_score: 1064, p75_score: 888 },
  { workout_name: "16.5", gender: "M", year: 2016, observed_median_s: 1046, time_cap_seconds: null, p25_score: 1271, p50_score: 1044, p75_score: 870 },
  { workout_name: "17.1", gender: "F", year: 2017, observed_median_s: 1045, time_cap_seconds: 1200, p25_score: 176, p50_score: 212, p75_score: 1122 },
  { workout_name: "17.1", gender: "M", year: 2017, observed_median_s: 1042, time_cap_seconds: 1200, p25_score: 184, p50_score: 216, p75_score: 1092 },
  { workout_name: "17.2", gender: "F", year: 2017, observed_median_s: 430, time_cap_seconds: 720, p25_score: 78, p50_score: 79, p75_score: 84 },
  { workout_name: "17.2", gender: "M", year: 2017, observed_median_s: 500, time_cap_seconds: 720, p25_score: 79, p50_score: 89, p75_score: 117 },
  { workout_name: "17.3", gender: "F", year: 2017, observed_median_s: 358, time_cap_seconds: 1440, p25_score: 43, p50_score: 46, p75_score: 67 },
  { workout_name: "17.3", gender: "M", year: 2017, observed_median_s: 366, time_cap_seconds: 1440, p25_score: 44, p50_score: 57, p75_score: 81 },
  { workout_name: "17.4", gender: "F", year: 2017, observed_median_s: 649, time_cap_seconds: 780, p25_score: 143, p50_score: 166, p75_score: 175 },
  { workout_name: "17.4", gender: "M", year: 2017, observed_median_s: 640, time_cap_seconds: 780, p25_score: 160, p50_score: 171, p75_score: 185 },
  { workout_name: "17.5", gender: "F", year: 2017, observed_median_s: 1163, time_cap_seconds: 2400, p25_score: 1675, p50_score: 1160, p75_score: 877 },
  { workout_name: "17.5", gender: "M", year: 2017, observed_median_s: 1101, time_cap_seconds: 2400, p25_score: 1518, p50_score: 1098, p75_score: 838 },
  { workout_name: "18.1", gender: "F", year: 2018, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 189, p50_score: 226, p75_score: 263 },
  { workout_name: "18.1", gender: "M", year: 2018, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 234, p50_score: 273, p75_score: 315 },
  { workout_name: "18.2", gender: "F", year: 2018, observed_median_s: 573, time_cap_seconds: 720, p25_score: 666, p50_score: 572, p75_score: 483 },
  { workout_name: "18.2", gender: "M", year: 2018, observed_median_s: 720, time_cap_seconds: 720, p25_score: 634, p50_score: 533, p75_score: 447 },
  { workout_name: "18.2a", gender: "F", year: 2018, observed_median_s: null, time_cap_seconds: 720, p25_score: 90, p50_score: 121, p75_score: 145 },
  { workout_name: "18.2a", gender: "M", year: 2018, observed_median_s: null, time_cap_seconds: 720, p25_score: 165, p50_score: 205, p75_score: 236 },
  { workout_name: "18.3", gender: "F", year: 2018, observed_median_s: 840, time_cap_seconds: 840, p25_score: 202, p50_score: 220, p75_score: 221 },
  { workout_name: "18.3", gender: "M", year: 2018, observed_median_s: 840, time_cap_seconds: 840, p25_score: 220, p50_score: 228, p75_score: 456 },
  { workout_name: "18.4", gender: "F", year: 2018, observed_median_s: 540, time_cap_seconds: 540, p25_score: 22, p50_score: 41, p75_score: 86 },
  { workout_name: "18.4", gender: "M", year: 2018, observed_median_s: 540, time_cap_seconds: 540, p25_score: 39, p50_score: 70, p75_score: 96 },
  { workout_name: "18.5", gender: "F", year: 2018, observed_median_s: 420, time_cap_seconds: 420, p25_score: 49, p50_score: 72, p75_score: 88 },
  { workout_name: "18.5", gender: "M", year: 2018, observed_median_s: 420, time_cap_seconds: 420, p25_score: 68, p50_score: 83, p75_score: 100 },
  { workout_name: "19.1", gender: "F", year: 2019, observed_median_s: 900, time_cap_seconds: 900, p25_score: 184, p50_score: 210, p75_score: 234 },
  { workout_name: "19.1", gender: "M", year: 2019, observed_median_s: 900, time_cap_seconds: 900, p25_score: 215, p50_score: 247, p75_score: 276 },
  { workout_name: "19.2", gender: "F", year: 2019, observed_median_s: 1134, time_cap_seconds: 1200, p25_score: 100, p50_score: 145, p75_score: 173 },
  { workout_name: "19.2", gender: "M", year: 2019, observed_median_s: 1163, time_cap_seconds: 1200, p25_score: 112, p50_score: 167, p75_score: 175 },
  { workout_name: "19.3", gender: "F", year: 2019, observed_median_s: 559, time_cap_seconds: 600, p25_score: 90, p50_score: 91, p75_score: 93 },
  { workout_name: "19.3", gender: "M", year: 2019, observed_median_s: 575, time_cap_seconds: 600, p25_score: 90, p50_score: 96, p75_score: 110 },
  { workout_name: "19.4", gender: "F", year: 2019, observed_median_s: 720, time_cap_seconds: 720, p25_score: 66, p50_score: 67, p75_score: 72 },
  { workout_name: "19.4", gender: "M", year: 2019, observed_median_s: 685, time_cap_seconds: 720, p25_score: 68, p50_score: 90, p75_score: 108 },
  { workout_name: "19.5", gender: "F", year: 2019, observed_median_s: 1051, time_cap_seconds: 1200, p25_score: 96, p50_score: 145, p75_score: 183 },
  { workout_name: "19.5", gender: "M", year: 2019, observed_median_s: 1044, time_cap_seconds: 1200, p25_score: 136, p50_score: 167, p75_score: 202 },
  { workout_name: "20.1", gender: "F", year: 2020, observed_median_s: 900, time_cap_seconds: 900, p25_score: 120, p50_score: 141, p75_score: 164 },
  { workout_name: "20.1", gender: "M", year: 2020, observed_median_s: 900, time_cap_seconds: 900, p25_score: 129, p50_score: 149, p75_score: 171 },
  { workout_name: "20.2", gender: "F", year: 2020, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 278, p50_score: 390, p75_score: 511 },
  { workout_name: "20.2", gender: "M", year: 2020, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 342, p50_score: 450, p75_score: 555 },
  { workout_name: "20.3", gender: "F", year: 2020, observed_median_s: 348, time_cap_seconds: 540, p25_score: 24, p50_score: 59, p75_score: 91 },
  { workout_name: "20.3", gender: "M", year: 2020, observed_median_s: 403, time_cap_seconds: 540, p25_score: 43, p50_score: 81, p75_score: 99 },
  { workout_name: "20.4", gender: "F", year: 2020, observed_median_s: 834, time_cap_seconds: 1200, p25_score: 129, p50_score: 160, p75_score: 168 },
  { workout_name: "20.4", gender: "M", year: 2020, observed_median_s: 890, time_cap_seconds: 1200, p25_score: 129, p50_score: 160, p75_score: 167 },
  { workout_name: "20.5", gender: "F", year: 2020, observed_median_s: 896, time_cap_seconds: 1200, p25_score: 200, p50_score: 201, p75_score: 201 },
  { workout_name: "20.5", gender: "M", year: 2020, observed_median_s: 941, time_cap_seconds: 1200, p25_score: 201, p50_score: 211, p75_score: 232 },
  { workout_name: "21.1", gender: "F", year: 2021, observed_median_s: 860, time_cap_seconds: 900, p25_score: 168, p50_score: 219, p75_score: 354 },
  { workout_name: "21.1", gender: "M", year: 2021, observed_median_s: 900, time_cap_seconds: 900, p25_score: 213, p50_score: 249, p75_score: 379 },
  { workout_name: "21.2", gender: "F", year: 2021, observed_median_s: 1017, time_cap_seconds: 1200, p25_score: 192, p50_score: 1180, p75_score: 1004 },
  { workout_name: "21.2", gender: "M", year: 2021, observed_median_s: 997, time_cap_seconds: 1200, p25_score: 201, p50_score: 1139, p75_score: 958 },
  { workout_name: "21.3", gender: "F", year: 2021, observed_median_s: 800, time_cap_seconds: 900, p25_score: 90, p50_score: 135, p75_score: 140 },
  { workout_name: "21.3", gender: "M", year: 2021, observed_median_s: 794, time_cap_seconds: 900, p25_score: 135, p50_score: 141, p75_score: 156 },
  { workout_name: "21.4", gender: "F", year: 2021, observed_median_s: null, time_cap_seconds: 420, p25_score: 111, p50_score: 126, p75_score: 145 },
  { workout_name: "21.4", gender: "M", year: 2021, observed_median_s: null, time_cap_seconds: 420, p25_score: 166, p50_score: 190, p75_score: 220 },
  { workout_name: "22.1", gender: "F", year: 2022, observed_median_s: 900, time_cap_seconds: 900, p25_score: 151, p50_score: 183, p75_score: 222 },
  { workout_name: "22.1", gender: "M", year: 2022, observed_median_s: 900, time_cap_seconds: 900, p25_score: 163, p50_score: 201, p75_score: 240 },
  { workout_name: "22.2", gender: "F", year: 2022, observed_median_s: 600, time_cap_seconds: 600, p25_score: 101, p50_score: 121, p75_score: 143 },
  { workout_name: "22.2", gender: "M", year: 2022, observed_median_s: 600, time_cap_seconds: 600, p25_score: 110, p50_score: 129, p75_score: 149 },
  { workout_name: "22.3", gender: "F", year: 2022, observed_median_s: 601, time_cap_seconds: 720, p25_score: 128, p50_score: 157, p75_score: 163 },
  { workout_name: "22.3", gender: "M", year: 2022, observed_median_s: 595, time_cap_seconds: 720, p25_score: 156, p50_score: 164, p75_score: 212 },
  { workout_name: "23.1", gender: "F", year: 2023, observed_median_s: 840, time_cap_seconds: 840, p25_score: 150, p50_score: 168, p75_score: 180 },
  { workout_name: "23.1", gender: "M", year: 2023, observed_median_s: 840, time_cap_seconds: 840, p25_score: 167, p50_score: 180, p75_score: 184 },
  { workout_name: "23.2A", gender: "F", year: 2023, observed_median_s: 900, time_cap_seconds: 900, p25_score: 94, p50_score: 107, p75_score: 121 },
  { workout_name: "23.2A", gender: "M", year: 2023, observed_median_s: 900, time_cap_seconds: 900, p25_score: 107, p50_score: 121, p75_score: 136 },
  { workout_name: "23.2B", gender: "F", year: 2023, observed_median_s: null, time_cap_seconds: 300, p25_score: 106, p50_score: 121, p75_score: 138 },
  { workout_name: "23.2B", gender: "M", year: 2023, observed_median_s: null, time_cap_seconds: 300, p25_score: 165, p50_score: 187, p75_score: 212 },
  { workout_name: "23.3", gender: "F", year: 2023, observed_median_s: 668, time_cap_seconds: 900, p25_score: 74, p50_score: 126, p75_score: 135 },
  { workout_name: "23.3", gender: "M", year: 2023, observed_median_s: 681, time_cap_seconds: 900, p25_score: 114, p50_score: 130, p75_score: 152 },
  { workout_name: "24.1", gender: "F", year: 2024, observed_median_s: 703, time_cap_seconds: 900, p25_score: 899, p50_score: 765, p75_score: 640 },
  { workout_name: "24.1", gender: "M", year: 2024, observed_median_s: 676, time_cap_seconds: 900, p25_score: 869, p50_score: 724, p75_score: 600 },
  { workout_name: "24.2", gender: "F", year: 2024, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 412, p50_score: 545, p75_score: 639 },
  { workout_name: "24.2", gender: "M", year: 2024, observed_median_s: 1200, time_cap_seconds: 1200, p25_score: 490, p50_score: 617, p75_score: 719 },
  { workout_name: "24.3", gender: "F", year: 2024, observed_median_s: 900, time_cap_seconds: 900, p25_score: 92, p50_score: 107, p75_score: 119 },
  { workout_name: "24.3", gender: "M", year: 2024, observed_median_s: 816, time_cap_seconds: 900, p25_score: 107, p50_score: 117, p75_score: 137 },
  { workout_name: "25.1", gender: "F", year: 2025, observed_median_s: 900, time_cap_seconds: 900, p25_score: 149, p50_score: 178, p75_score: 207 },
  { workout_name: "25.1", gender: "M", year: 2025, observed_median_s: 900, time_cap_seconds: 900, p25_score: 161, p50_score: 190, p75_score: 218 },
  { workout_name: "25.2", gender: "F", year: 2025, observed_median_s: 591, time_cap_seconds: 720, p25_score: 121, p50_score: 156, p75_score: 164 },
  { workout_name: "25.2", gender: "M", year: 2025, observed_median_s: 595, time_cap_seconds: 720, p25_score: 156, p50_score: 164, p75_score: 211 },
  { workout_name: "25.3", gender: "F", year: 2025, observed_median_s: 1089, time_cap_seconds: 1200, p25_score: 129, p50_score: 151, p75_score: 1190 },
  { workout_name: "25.3", gender: "M", year: 2025, observed_median_s: 1064, time_cap_seconds: 1200, p25_score: 139, p50_score: 170, p75_score: 1115 },
  { workout_name: "26.1", gender: "F", year: 2026, observed_median_s: 702, time_cap_seconds: 720, p25_score: 167, p50_score: 197, p75_score: 230 },
  { workout_name: "26.1", gender: "M", year: 2026, observed_median_s: 720, time_cap_seconds: 720, p25_score: 173, p50_score: 202, p75_score: 232 },
  { workout_name: "26.2", gender: "F", year: 2026, observed_median_s: 900, time_cap_seconds: 900, p25_score: 81, p50_score: 112, p75_score: 113 },
  { workout_name: "26.2", gender: "M", year: 2026, observed_median_s: 748, time_cap_seconds: 900, p25_score: 105, p50_score: 113, p75_score: 122 },
  { workout_name: "26.3", gender: "F", year: 2026, observed_median_s: 960, time_cap_seconds: 960, p25_score: 140, p50_score: 168, p75_score: 192 },
  { workout_name: "26.3", gender: "M", year: 2026, observed_median_s: 960, time_cap_seconds: 960, p25_score: 141, p50_score: 168, p75_score: 189 },
];
