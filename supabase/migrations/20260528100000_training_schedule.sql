-- training_schedule — the opt-in OVERLAY that puts otherwise timeline-less
-- training days onto real calendar dates.
--
-- Programs (program_workouts) and Engine (engine_workouts) are sequences, not
-- dated. This table lets a user assign a date to a whole DAY they plan to do.
-- The program/Engine stay dateless; the calendar is a view that merges this
-- (scheduled) with the already-dated completion logs (workout_logs,
-- engine_workout_sessions).
--
-- Dual nullable FK (program OR engine) with a CHECK that exactly one is set,
-- so ONE table + ONE unified calendar serves both program types. v1 only
-- writes program rows; Engine is additive later.

CREATE TABLE IF NOT EXISTS training_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_workout_id uuid REFERENCES program_workouts(id) ON DELETE CASCADE,
  engine_workout_id uuid REFERENCES engine_workouts(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- exactly one source
  CONSTRAINT training_schedule_one_source CHECK (
    (program_workout_id IS NOT NULL AND engine_workout_id IS NULL) OR
    (program_workout_id IS NULL AND engine_workout_id IS NOT NULL)
  )
);

-- One per SOURCE per date: a user may schedule one program day AND one engine
-- day on the same date (complementary), but not two of the same source.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_schedule_program_per_day
  ON training_schedule(user_id, scheduled_date)
  WHERE program_workout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_schedule_engine_per_day
  ON training_schedule(user_id, scheduled_date)
  WHERE engine_workout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_training_schedule_user_date
  ON training_schedule(user_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_training_schedule_program_workout
  ON training_schedule(program_workout_id) WHERE program_workout_id IS NOT NULL;

ALTER TABLE training_schedule ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'training_schedule' AND policyname = 'Users select own training_schedule') THEN
    CREATE POLICY "Users select own training_schedule" ON training_schedule
      FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'training_schedule' AND policyname = 'Users insert own training_schedule') THEN
    CREATE POLICY "Users insert own training_schedule" ON training_schedule
      FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'training_schedule' AND policyname = 'Users update own training_schedule') THEN
    CREATE POLICY "Users update own training_schedule" ON training_schedule
      FOR UPDATE USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'training_schedule' AND policyname = 'Users delete own training_schedule') THEN
    CREATE POLICY "Users delete own training_schedule" ON training_schedule
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END;
$$;
