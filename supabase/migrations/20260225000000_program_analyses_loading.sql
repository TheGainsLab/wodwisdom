-- Add loading analysis columns to program_analyses
ALTER TABLE program_analyses
  ADD COLUMN IF NOT EXISTS loading_ratio jsonb DEFAULT '{"loaded":0,"bodyweight":0}',
  ADD COLUMN IF NOT EXISTS distinct_loads integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS load_bands jsonb DEFAULT '{"0–95":0,"135–185":0,"225+":0}';
