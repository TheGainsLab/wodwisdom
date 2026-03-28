-- Multi-month program generation support
-- Adds month tracking to evaluations and programs for longitudinal progression

-- 1. profile_evaluations: track which month/program an evaluation belongs to
--    and control visibility (eval + program delivered together)
ALTER TABLE profile_evaluations
  ADD COLUMN IF NOT EXISTS month_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visible boolean DEFAULT true;

-- Index for efficient lookup of evaluations by program
CREATE INDEX IF NOT EXISTS idx_profile_evaluations_program_id
  ON profile_evaluations(program_id);

-- Index for efficient lookup of evaluation series for a user (longitudinal)
CREATE INDEX IF NOT EXISTS idx_profile_evaluations_user_month
  ON profile_evaluations(user_id, month_number);

-- 2. programs: add source = 'generated' default for AI-generated programs
--    (source column already exists from ai_log migration, just ensure generated programs use it)
-- No schema change needed — generate-program will set source = 'generated' on insert.

-- 3. program_workouts: add month_number for easy filtering of which month a workout belongs to
ALTER TABLE program_workouts
  ADD COLUMN IF NOT EXISTS month_number integer DEFAULT 1;

-- Index for filtering workouts by month within a program
CREATE INDEX IF NOT EXISTS idx_program_workouts_month
  ON program_workouts(program_id, month_number);

-- 4. Backfill existing workouts as month 1 (they already default to 1, but be explicit)
UPDATE program_workouts SET month_number = 1 WHERE month_number IS NULL;

-- 5. Backfill existing evaluations as month 1 and visible
UPDATE profile_evaluations SET month_number = 1 WHERE month_number IS NULL;
UPDATE profile_evaluations SET visible = true WHERE visible IS NULL;
