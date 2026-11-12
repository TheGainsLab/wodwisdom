-- checkout_attempts.status gains 'claimed': the completion page exchanged
-- this paid session for a signed-in account (checkout-claim-account), which
-- must happen at most once per session. 'expired' is the reaper's value and
-- was already in the table (the first cut of this migration omitted it and
-- failed on existing rows; the corrected statement was run by hand 2026-11-11).
ALTER TABLE checkout_attempts DROP CONSTRAINT IF EXISTS checkout_attempts_status_check;
ALTER TABLE checkout_attempts
  ADD CONSTRAINT checkout_attempts_status_check
  CHECK (status IN ('started', 'completed', 'expired', 'claimed'));
