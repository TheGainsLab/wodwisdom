-- engine_user_day_overrides — the per-user upcoming sequence the AI self-sequencer writes.
--
-- The Engine queue is position-based: the dashboard/runner resolve a day by its
-- sequence position (program_day_number; engine_current_day = highest completed + 1).
-- The static engine_program_mapping is the shared default. This table lets the AI
-- override the WORKOUT CONTENT at specific upcoming positions for one user, without
-- touching progression, access gating, or the UI: getWorkoutsForProgram and
-- loadWorkoutForDay swap in the generated engine_workout at an overridden position,
-- and fall back to the catalog everywhere else (sparse override).
--
-- Generated days live as engine_workouts rows (program_type 'gen:<user_id>'); this
-- table maps a user's sequence_position -> that generated workout. Re-running the
-- sequencer upserts (one row per position), so the next week replaces the prior one.

CREATE TABLE IF NOT EXISTS engine_user_day_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sequence_position integer NOT NULL,
  engine_workout_id uuid NOT NULL REFERENCES engine_workouts(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, sequence_position)
);

CREATE INDEX IF NOT EXISTS idx_engine_overrides_user ON engine_user_day_overrides(user_id, sequence_position);

ALTER TABLE engine_user_day_overrides ENABLE ROW LEVEL SECURITY;

-- Athletes read their own overrides (the frontend resolver). Writes are done by the
-- sequencer with the service role, which bypasses RLS; own-row write policies are
-- included for completeness/safety.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'engine_user_day_overrides' AND policyname = 'Users select own engine overrides') THEN
    CREATE POLICY "Users select own engine overrides" ON engine_user_day_overrides
      FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'engine_user_day_overrides' AND policyname = 'Users insert own engine overrides') THEN
    CREATE POLICY "Users insert own engine overrides" ON engine_user_day_overrides
      FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'engine_user_day_overrides' AND policyname = 'Users update own engine overrides') THEN
    CREATE POLICY "Users update own engine overrides" ON engine_user_day_overrides
      FOR UPDATE USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'engine_user_day_overrides' AND policyname = 'Users delete own engine overrides') THEN
    CREATE POLICY "Users delete own engine overrides" ON engine_user_day_overrides
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END;
$$;
