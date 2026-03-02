-- Add scoring columns to workout_log_blocks for metcon percentile tracking.

ALTER TABLE workout_log_blocks
  ADD COLUMN IF NOT EXISTS percentile smallint,
  ADD COLUMN IF NOT EXISTS performance_tier text,
  ADD COLUMN IF NOT EXISTS median_benchmark text,
  ADD COLUMN IF NOT EXISTS excellent_benchmark text;

COMMENT ON COLUMN workout_log_blocks.percentile IS 'Calculated percentile (1-99) based on score vs benchmarks';
COMMENT ON COLUMN workout_log_blocks.performance_tier IS 'Elite/Advanced/Good/Average/Below Average/Needs Improvement';
COMMENT ON COLUMN workout_log_blocks.median_benchmark IS 'Computed p50 benchmark score (e.g. 6:30 or 8+15)';
COMMENT ON COLUMN workout_log_blocks.excellent_benchmark IS 'Computed p90 benchmark score (e.g. 4:15 or 11+3)';
