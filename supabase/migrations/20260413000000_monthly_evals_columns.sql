-- Add month_number and program_id to training_evaluations and nutrition_evaluations
-- so they can be grouped by month with profile_evaluations in the UI.

ALTER TABLE training_evaluations
  ADD COLUMN IF NOT EXISTS month_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visible boolean DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_training_evaluations_user_month
  ON training_evaluations(user_id, month_number DESC);

ALTER TABLE nutrition_evaluations
  ADD COLUMN IF NOT EXISTS month_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visible boolean DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_nutrition_evaluations_user_month
  ON nutrition_evaluations(user_id, month_number DESC);
