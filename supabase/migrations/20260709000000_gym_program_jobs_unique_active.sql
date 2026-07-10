-- Enforce "one active gym program job per gym" at the DATABASE.
--
-- gym_program_jobs' one-active-job guard was app-level only: gym-cohort-cron
-- and the new gym-program `start` both do `select … where status in
-- (processing, awaiting_approval)` then insert. The cron serializes cron-vs-cron
-- via claim_due_gym_cohort's FOR UPDATE SKIP LOCKED, but a portal `start` racing
-- the cron (or a second `start`) both read empty and both insert — each a full
-- paid LLM run + a duplicate cohort program. A UNIQUE partial index closes the
-- race in the DB; the app maps 23505 to a clean 409 (GymJobConflictError).
--
-- One-time cleanup first: if any gym already has >1 active job, keep the newest
-- and fail the rest (nulling the fencing token so their workers no-op), so the
-- unique index can be created.

BEGIN;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY gym_id ORDER BY created_at DESC) AS rn
    FROM gym_program_jobs
   WHERE status IN ('processing', 'awaiting_approval')
)
UPDATE gym_program_jobs g
   SET status      = 'failed',
       error       = 'superseded (unique-active cleanup)',
       next_stage  = NULL,
       stage       = NULL,
       claim_token = NULL,
       locked_at   = NULL,
       updated_at  = now()
  FROM ranked r
 WHERE g.id = r.id
   AND r.rn > 1;

-- Replace the plain partial index with a UNIQUE one (same predicate).
DROP INDEX IF EXISTS idx_gym_program_jobs_gym_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_program_jobs_gym_active
  ON gym_program_jobs (gym_id)
  WHERE status IN ('processing', 'awaiting_approval');

COMMIT;
