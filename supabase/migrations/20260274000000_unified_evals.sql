-- Unify profile_evaluations: single analysis column replaces per-segment columns
ALTER TABLE profile_evaluations ADD COLUMN analysis text;

-- Migrate any existing data (combine old columns into new)
UPDATE profile_evaluations
SET analysis = concat_ws(E'\n\n',
  CASE WHEN lifting_analysis IS NOT NULL THEN '**Strength**' || E'\n' || lifting_analysis END,
  CASE WHEN skills_analysis IS NOT NULL THEN '**Skills**' || E'\n' || skills_analysis END,
  CASE WHEN engine_analysis IS NOT NULL THEN '**Engine**' || E'\n' || engine_analysis END
)
WHERE analysis IS NULL AND (lifting_analysis IS NOT NULL OR skills_analysis IS NOT NULL OR engine_analysis IS NOT NULL);

-- Drop old columns
ALTER TABLE profile_evaluations DROP COLUMN lifting_analysis;
ALTER TABLE profile_evaluations DROP COLUMN skills_analysis;
ALTER TABLE profile_evaluations DROP COLUMN engine_analysis;
ALTER TABLE profile_evaluations DROP COLUMN type;

-- Drop the type index (no longer needed)
DROP INDEX IF EXISTS idx_profile_evaluations_user_type;

-- Training evaluations: separate table for training history analysis
CREATE TABLE training_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_snapshot jsonb NOT NULL DEFAULT '{}',
  training_snapshot text NOT NULL DEFAULT '',
  analysis text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_evaluations_user ON training_evaluations(user_id, created_at DESC);

ALTER TABLE training_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own" ON training_evaluations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert own" ON training_evaluations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
