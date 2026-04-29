-- Workout review async job pattern.
--
-- workout-review used to run synchronously and return the full review JSON
-- in the response. The function makes 4+ parallel Claude calls (intent +
-- metcon + strength + skills) and routinely takes 15-30s. iOS Safari
-- abandons fetches that long when the screen locks, the tab backgrounds,
-- or memory pressure spikes — sometimes as a TypeError, sometimes the
-- promise just hangs forever, leaving users stuck on the Coach loading
-- screen with no way out.
--
-- Mirrors the profile_evaluations async-job pattern (20260425000000):
-- workout-review now inserts a row immediately with status='pending',
-- fires the heavy work as a background task, and returns a review_id.
-- The client polls workout-review-status until terminal.
--
--   status      — 'pending' | 'processing' | 'complete' | 'failed'
--   error       — non-null when status='failed'; failure message
--   ready_at    — timestamp when the review completed (or failed)
--
-- Self-sufficient: creates the table + RLS + indexes if the earlier
-- workout_reviews migrations were never applied. ALTER ADD COLUMN
-- IF NOT EXISTS makes the migration safely idempotent against any
-- environment.

CREATE TABLE IF NOT EXISTS workout_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_text text NOT NULL,
  review jsonb,
  source_id uuid REFERENCES program_workouts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Earlier migration versions had review NOT NULL because reviews were
-- only inserted on completion. With the async-job pattern we insert at
-- kickoff (review null) and fill it in when the background task finishes,
-- so drop the NOT NULL if it's there. Safe no-op if it was already null-
-- able or if the table was just created above.
ALTER TABLE workout_reviews ALTER COLUMN review DROP NOT NULL;

-- Backfill columns from the older migrations in case they were skipped.
ALTER TABLE workout_reviews
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES program_workouts(id) ON DELETE SET NULL;

-- New async-job columns.
ALTER TABLE workout_reviews
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;

-- Existing rows are pre-migration synchronous reviews; they already have
-- review populated and were always complete.
UPDATE workout_reviews
SET status = 'complete',
    ready_at = created_at
WHERE status IS NULL OR (status = 'pending' AND review IS NOT NULL);

-- Indexes (idempotent; older migrations may have created the first two).
CREATE INDEX IF NOT EXISTS idx_workout_reviews_user_id
  ON workout_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_reviews_created_at
  ON workout_reviews(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workout_reviews_source_id
  ON workout_reviews(user_id, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workout_reviews_user_status
  ON workout_reviews(user_id, status);

-- RLS + per-user policies. CREATE POLICY has no IF NOT EXISTS in
-- Postgres < 15, so guard with a DO block that checks pg_policies first.
ALTER TABLE workout_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workout_reviews'
      AND policyname = 'Users can insert own'
  ) THEN
    CREATE POLICY "Users can insert own" ON workout_reviews
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workout_reviews'
      AND policyname = 'Users can select own'
  ) THEN
    CREATE POLICY "Users can select own" ON workout_reviews
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END
$$;
