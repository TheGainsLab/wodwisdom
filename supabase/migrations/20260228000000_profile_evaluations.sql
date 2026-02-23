-- Profile evaluations: AI analysis snapshots with profile data at time of eval
CREATE TABLE profile_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_snapshot jsonb NOT NULL DEFAULT '{}',
  lifting_analysis text,
  skills_analysis text,
  engine_analysis text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profile_evaluations_user ON profile_evaluations(user_id, created_at DESC);

ALTER TABLE profile_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own" ON profile_evaluations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert own" ON profile_evaluations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
