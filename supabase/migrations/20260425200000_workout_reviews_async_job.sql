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

ALTER TABLE workout_reviews
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;

-- Existing rows are pre-migration synchronous reviews; they already have
-- review populated and were always complete.
UPDATE workout_reviews
SET status = 'complete',
    ready_at = created_at
WHERE status IS NULL OR status = 'pending';

CREATE INDEX IF NOT EXISTS idx_workout_reviews_user_status
  ON workout_reviews(user_id, status);
