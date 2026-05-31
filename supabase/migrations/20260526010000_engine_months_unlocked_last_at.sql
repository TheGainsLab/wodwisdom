-- engine_months_unlocked_last_at: dedicated timestamp tracking the LAST TIME
-- engine_months_unlocked was raised. Replaces the previous use of
-- athlete_profiles.updated_at by the monthly-generation-cron, which was
-- broken because any profile write (bodyweight, lifts, equipment) reset the
-- 30-day clock and prevented quarterly subscribers from ever unlocking
-- months 2 and 3.
--
-- Writers (must update this column whenever they raise engine_months_unlocked):
--   - stripe-webhook invoice.payment_succeeded handler
--   - monthly-generation-cron quarterly drip
--   - admin override paths (manual unlock from the admin UI)
--
-- Refunds (charge.refunded handler) do NOT update this column — decrementing
-- shouldn't extend the next drip window. The "last unlock time" stays anchored
-- to when the unlock actually happened.

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS engine_months_unlocked_last_at timestamptz;

COMMENT ON COLUMN athlete_profiles.engine_months_unlocked_last_at IS
  'Timestamp of the most recent engine_months_unlocked increment. Read by monthly-generation-cron to gate quarterly drips. Never updated by general profile writes; only by unlock paths (stripe-webhook, cron, admin override).';

-- Backfill: for any user already at engine_months_unlocked > 0, seed the
-- column with updated_at. Imperfect (updated_at may have been bumped by a
-- later unrelated profile write) but a reasonable starting point — the cron
-- will simply not fire for a user until ≥30 days have elapsed from this seed,
-- which is the correct behavior. Users at 0 stay null.
UPDATE athlete_profiles
SET engine_months_unlocked_last_at = updated_at
WHERE engine_months_unlocked > 0
  AND engine_months_unlocked_last_at IS NULL;
