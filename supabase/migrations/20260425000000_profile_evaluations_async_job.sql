-- Profile evaluation async job pattern.
--
-- profile-analysis used to run synchronously and return the full analysis
-- text in the response. On iOS Safari, a 15-30s fetch routinely gets
-- dropped by the browser (especially when the screen locks or the tab
-- backgrounds), producing a "TypeError: Load failed" error with no
-- server-side log because the function completed fine — Safari just
-- hung up early.
--
-- The fix is the same async-job pattern that generate-program uses:
-- create the row immediately with status='pending', fire the heavy
-- work as a background task, and have the client poll a lightweight
-- status endpoint. These columns turn each profile_evaluations row
-- into its own job tracker — no separate jobs table needed.
--
--   status      — 'pending' | 'processing' | 'complete' | 'failed'
--   error       — non-null when status='failed'; failure message
--   ready_at    — timestamp when the analysis completed (or failed)

ALTER TABLE profile_evaluations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;

-- Existing rows are pre-migration synchronous evaluations; they already
-- have analysis populated and were always complete.
UPDATE profile_evaluations
SET status = 'complete',
    ready_at = created_at
WHERE status IS NULL OR status = 'pending';

CREATE INDEX IF NOT EXISTS idx_profile_evaluations_user_status
  ON profile_evaluations(user_id, status);
