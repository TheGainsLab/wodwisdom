-- One free profile evaluation per user.
--
-- Every athlete_profiles row gets eval_credits_remaining=1 by default.
-- profile-analysis decrements it atomically on each successful kickoff
-- (admins bypass the check). Subscribers keep receiving monthly auto-
-- evaluations through generate-next-month, which runs as month_number>1
-- and doesn't consume this pool.
--
-- Existing users who already have a completed month=1 evaluation are
-- backfilled to 0 so the migration can't grant them a second one.

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS eval_credits_remaining int NOT NULL DEFAULT 1;

UPDATE athlete_profiles ap
SET eval_credits_remaining = 0
WHERE EXISTS (
  SELECT 1 FROM profile_evaluations pe
  WHERE pe.user_id = ap.user_id
    AND pe.month_number = 1
    AND pe.status = 'complete'
);

-- Atomic credit consumption. Returns the new remaining count on success,
-- or -1 if the user has no credits left. Used by profile-analysis as the
-- single source of truth — concurrent calls (double-tap, two tabs) are
-- safe because Postgres serializes the UPDATE.
CREATE OR REPLACE FUNCTION consume_eval_credit(p_user_id uuid)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  remaining int;
BEGIN
  UPDATE athlete_profiles
  SET eval_credits_remaining = eval_credits_remaining - 1
  WHERE user_id = p_user_id AND eval_credits_remaining > 0
  RETURNING eval_credits_remaining INTO remaining;
  RETURN COALESCE(remaining, -1);
END;
$$;
