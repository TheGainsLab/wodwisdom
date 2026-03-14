CREATE TABLE nutrition_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nutrition_snapshot jsonb NOT NULL DEFAULT '{}',
  profile_snapshot jsonb NOT NULL DEFAULT '{}',
  training_snapshot text NOT NULL DEFAULT '',
  analysis text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nutrition_evaluations_user ON nutrition_evaluations(user_id, created_at DESC);

ALTER TABLE nutrition_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own" ON nutrition_evaluations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert own" ON nutrition_evaluations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
