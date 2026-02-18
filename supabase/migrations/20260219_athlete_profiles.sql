-- Athlete profiles: 1RM lifts and skills assessment per user
CREATE TABLE athlete_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  lifts jsonb NOT NULL DEFAULT '{}',
  skills jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE athlete_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own" ON athlete_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert own" ON athlete_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update own" ON athlete_profiles
  FOR UPDATE USING (auth.uid() = user_id);
