-- Add a proper FK from workout_log_entries to workout_log_blocks,
-- replacing the loose block_label text join.

-- 1. Add the column (nullable so existing rows aren't broken)
ALTER TABLE workout_log_entries ADD COLUMN block_id uuid REFERENCES workout_log_blocks(id) ON DELETE CASCADE;

-- 2. Backfill existing rows by matching on log_id + block_label
UPDATE workout_log_entries e
SET block_id = b.id
FROM workout_log_blocks b
WHERE e.log_id = b.log_id
  AND e.block_label IS NOT NULL
  AND e.block_label = b.block_label;

-- 3. Index for fast joins
CREATE INDEX idx_workout_log_entries_block_id ON workout_log_entries(block_id);
