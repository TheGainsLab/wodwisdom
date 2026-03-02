-- Add work rate columns to movements table for metcon scoring engine.
-- work_rate: reps per minute at median (50th percentile) sustainable pace.
-- weight_degradation_rate: speed penalty factor for heavier barbell loads (0.7–1.0).

ALTER TABLE movements
  ADD COLUMN IF NOT EXISTS work_rate numeric(5,2),
  ADD COLUMN IF NOT EXISTS weight_degradation_rate numeric(3,2);

COMMENT ON COLUMN movements.work_rate IS 'Reps per minute at median (p50) sustainable pace';
COMMENT ON COLUMN movements.weight_degradation_rate IS 'Speed penalty factor for barbell loads (0.7=mild, 0.8=medium, 1.0=high)';
