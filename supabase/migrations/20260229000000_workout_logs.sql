-- Workout logs: user-logged workout history
-- Run this in Supabase SQL Editor, or via: supabase db push / supabase migration up

CREATE TABLE workout_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_date date NOT NULL,
  workout_text text NOT NULL,
  workout_type text NOT NULL CHECK (workout_type IN ('for_time', 'amrap', 'emom', 'strength', 'other')),
  score text,
  rx boolean NOT NULL DEFAULT false,
  source_type text NOT NULL CHECK (source_type IN ('review', 'program', 'manual')),
  source_id uuid,
  notes text,
  blocks jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workout_logs_user_date ON workout_logs(user_id, workout_date DESC);

ALTER TABLE workout_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own workout logs" ON workout_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workout logs" ON workout_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workout logs" ON workout_logs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own workout logs" ON workout_logs
  FOR DELETE USING (auth.uid() = user_id);

-- Workout log entries: movements/sets/reps/weights within a logged workout
CREATE TABLE workout_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  movement text NOT NULL,
  sets smallint,
  reps smallint,
  weight numeric,
  weight_unit text NOT NULL DEFAULT 'lbs' CHECK (weight_unit IN ('lbs', 'kg')),
  rpe smallint CHECK (rpe >= 1 AND rpe <= 10),
  scaling_note text,
  sort_order smallint NOT NULL DEFAULT 0,
  block_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workout_log_entries_log_id ON workout_log_entries(log_id);

ALTER TABLE workout_log_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own workout log entries" ON workout_log_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM workout_logs WHERE workout_logs.id = log_id AND workout_logs.user_id = auth.uid())
  );

CREATE POLICY "Users can insert own workout log entries" ON workout_log_entries
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM workout_logs WHERE workout_logs.id = log_id AND workout_logs.user_id = auth.uid())
  );

CREATE POLICY "Users can update own workout log entries" ON workout_log_entries
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM workout_logs WHERE workout_logs.id = log_id AND workout_logs.user_id = auth.uid())
  );

CREATE POLICY "Users can delete own workout log entries" ON workout_log_entries
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM workout_logs WHERE workout_logs.id = log_id AND workout_logs.user_id = auth.uid())
  );
