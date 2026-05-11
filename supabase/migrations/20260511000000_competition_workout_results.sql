-- Competition History "Try it" — where our users' logged throwbacks live.
--
-- The competition-service holds the real, scraped competition results (its
-- crossfit.workout_results) and is the reference source for placements /
-- percentile curves. This table is OUR store: a row per (user, competition
-- workout, attempt) when a user does an old competition workout outside
-- competition and logs their score. Rows reference the catalog by
-- competition_workout_id (= crossfit.workouts.id, the same id carried on
-- programming-profile recent_raw_results / all_results) — not a FK, since
-- that table lives in the other project's database.
--
-- This is the data-flywheel store: (athlete-profile -> workout-composition ->
-- result) points that exist nowhere else. Multiple attempts of the same
-- workout are allowed (each is its own row); no uniqueness constraint.

CREATE TABLE competition_workout_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  competition_workout_id uuid NOT NULL,

  -- Normalized score. score_value is in the unit implied by score_type:
  --   'time' -> seconds, 'reps' -> count, 'load_lbs' -> pounds, 'distance' -> meters.
  score_type text NOT NULL CHECK (score_type IN ('time', 'reps', 'load_lbs', 'distance')),
  score_value numeric NOT NULL CHECK (score_value >= 0),
  -- Dual-scoring (time-capped) workouts: true = finished under the cap (scored
  -- by time), false = hit the cap (scored by reps). null = single-scoring (N/A).
  finished boolean,

  performed_at date NOT NULL DEFAULT CURRENT_DATE,
  -- How this result entered our DB. v1 is always 'throwback' (a logged attempt
  -- of an old competition workout). Real competition results come from the
  -- competition-service feed, not this table.
  source text NOT NULL DEFAULT 'throwback',
  -- RX-only for v1; column kept in case scaled/foundations tiers are cataloged later.
  scaling_level text NOT NULL DEFAULT 'rx',
  -- Self-attested "I judged it to competition standards"; null = not asked / unknown.
  standards_met boolean,
  notes text,
  -- Optional link to the generic workout-log row if the user also logged this
  -- as a regular training session. Nullable; intentionally not a FK.
  workout_log_entry_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Per-user lookup ("my throwbacks", "did I do workout X", "attempts of X").
CREATE INDEX idx_competition_workout_results_user
  ON competition_workout_results (user_id, competition_workout_id, performed_at DESC);
-- Workout-keyed, for future cross-user aggregates.
CREATE INDEX idx_competition_workout_results_workout
  ON competition_workout_results (competition_workout_id);

ALTER TABLE competition_workout_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own" ON competition_workout_results
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own" ON competition_workout_results
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own" ON competition_workout_results
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete own" ON competition_workout_results
  FOR DELETE USING (auth.uid() = user_id);
