-- checkout_attempts.status gains 'claimed': the completion page exchanged
-- this paid session for a signed-in account (checkout-claim-account), which
-- must happen at most once per session.
ALTER TABLE checkout_attempts DROP CONSTRAINT IF EXISTS checkout_attempts_status_check;
ALTER TABLE checkout_attempts
  ADD CONSTRAINT checkout_attempts_status_check
  CHECK (status IN ('started', 'completed', 'claimed'));
