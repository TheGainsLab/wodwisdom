-- Athlete activities + benchmarks — the "log anything" layer.
--
-- Athletes (AI Programming tier today; schema is deliberately product-agnostic
-- for the long-term AI Logger platform) log training done outside their
-- programs as free text; parse-activity structures it (Haiku), the athlete
-- confirms, and the row lands here. Consumed at three speeds: the chat coach
-- immediately (aggregates + recent detail), AI-Edit same-day (recent load),
-- and the monthly generator at the boundary (a facts-only outside_training
-- section on the Athlete Model). NEVER consumed by Engine pacing/calibration.
--
-- Activities are advisory context, not program truth, so athletes may edit
-- and delete their own rows (unlike program session records, which are
-- permanent). Benchmarks are facts-about-the-athlete: editable, not deletable
-- (the is_current retest chain must not get holes) — and they NEVER write to
-- the profile; lifts/conditioning stay athlete-declared in the profile UI.

CREATE TABLE athlete_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  -- The athlete's original words, always preserved (re-parse + audit).
  raw_text text NOT NULL,
  -- Parsed, athlete-confirmed structure. Query-critical fields as columns:
  activity_type text,                 -- ride | run | swim | hike | row | ski | strength | sport | test | other
  duration_minutes integer CHECK (duration_minutes IS NULL OR (duration_minutes > 0 AND duration_minutes < 1440)),
  distance numeric,
  distance_unit text,
  rpe integer CHECK (rpe IS NULL OR (rpe BETWEEN 1 AND 10)),
  avg_hr integer CHECK (avg_hr IS NULL OR (avg_hr BETWEEN 40 AND 250)),
  peak_hr integer CHECK (peak_hr IS NULL OR (peak_hr BETWEEN 40 AND 250)),
  -- Full parse payload (summary line, intensity descriptor, anything extra).
  parsed jsonb,
  is_benchmark boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_athlete_activities_user_date ON athlete_activities(user_id, date DESC);

ALTER TABLE athlete_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY aa_select_own ON athlete_activities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY aa_insert_own ON athlete_activities FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY aa_update_own ON athlete_activities FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY aa_delete_own ON athlete_activities FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE athlete_activities IS
  'Athlete-logged training outside their programs (free text -> AI parse -> athlete-confirmed). Advisory context for coaching + generation; never touches Engine calibration. Athlete-editable/deletable.';

CREATE TABLE athlete_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Free-named ("bike erg 20:00 FTP", "5k run", "max strict pull-ups") —
  -- no fixed taxonomy; retests match on (lower(name), unit).
  name text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL DEFAULT '',
  date date NOT NULL,
  -- Retest chain, same pattern as engine_time_trials: the newest result for a
  -- (name, unit) is current; prior rows stay as trend history.
  is_current boolean NOT NULL DEFAULT true,
  source_activity_id uuid REFERENCES athlete_activities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_athlete_benchmarks_user ON athlete_benchmarks(user_id, is_current);

ALTER TABLE athlete_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY ab_select_own ON athlete_benchmarks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY ab_insert_own ON athlete_benchmarks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY ab_update_own ON athlete_benchmarks FOR UPDATE USING (auth.uid() = user_id);
-- Deliberately NO delete policy: benchmarks are editable, not deletable.

COMMENT ON TABLE athlete_benchmarks IS
  'Observed test results logged via athlete_activities (FTP tests, PRs, max tests). Facts about the athlete with retest history. NEVER writes to the profile — lifts/conditioning stay athlete-declared there.';
