-- Add source_id to workout_reviews for caching reviews by program workout
ALTER TABLE workout_reviews
  ADD COLUMN source_id uuid REFERENCES program_workouts(id) ON DELETE SET NULL;

CREATE INDEX idx_workout_reviews_source_id ON workout_reviews(user_id, source_id)
  WHERE source_id IS NOT NULL;
