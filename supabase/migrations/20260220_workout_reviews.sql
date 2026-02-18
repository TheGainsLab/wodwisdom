-- Workout reviews: stores past reviews for usage limits and optional history
CREATE TABLE workout_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_text text NOT NULL,
  review jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workout_reviews_user_id ON workout_reviews(user_id);
CREATE INDEX idx_workout_reviews_created_at ON workout_reviews(user_id, created_at);

ALTER TABLE workout_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own" ON workout_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can select own" ON workout_reviews
  FOR SELECT USING (auth.uid() = user_id);
