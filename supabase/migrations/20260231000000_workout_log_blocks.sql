-- Normalize block-level data from workout logs into a queryable table.
-- Replaces the workout_logs.blocks JSONB blob and the top-level score/rx columns.

-- 1. New table: one row per block in a logged workout
CREATE TABLE workout_log_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  block_type text NOT NULL CHECK (block_type IN ('warm-up', 'skills', 'strength', 'metcon', 'cool-down', 'accessory', 'other')),
  block_label text,
  block_text text NOT NULL,
  score text,
  rx boolean NOT NULL DEFAULT false,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workout_log_blocks_log_id ON workout_log_blocks(log_id);
CREATE INDEX idx_workout_log_blocks_type ON workout_log_blocks(block_type);

ALTER TABLE workout_log_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own workout log blocks" ON workout_log_blocks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM workout_logs WHERE workout_logs.id = log_id AND workout_logs.user_id = auth.uid())
  );

CREATE POLICY "Users can insert own workout log blocks" ON workout_log_blocks
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM workout_logs WHERE workout_logs.id = log_id AND workout_logs.user_id = auth.uid())
  );

CREATE POLICY "Users can update own workout log blocks" ON workout_log_blocks
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM workout_logs WHERE workout_logs.id = log_id AND workout_logs.user_id = auth.uid())
  );

CREATE POLICY "Users can delete own workout log blocks" ON workout_log_blocks
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM workout_logs WHERE workout_logs.id = log_id AND workout_logs.user_id = auth.uid())
  );

-- 2. Drop the now-redundant columns from workout_logs
ALTER TABLE workout_logs DROP COLUMN score;
ALTER TABLE workout_logs DROP COLUMN rx;
ALTER TABLE workout_logs DROP COLUMN blocks;
