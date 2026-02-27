-- Standalone workout analysis: paste any workout, get coaching analysis.
-- Completely independent of programs.

CREATE TABLE workout_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_text text NOT NULL,
  analysis jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workout_analyses_user_id ON workout_analyses(user_id);

ALTER TABLE workout_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own analyses" ON workout_analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can select own analyses" ON workout_analyses
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own analyses" ON workout_analyses
  FOR DELETE USING (auth.uid() = user_id);
