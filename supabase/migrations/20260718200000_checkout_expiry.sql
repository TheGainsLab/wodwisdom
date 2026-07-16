-- Checkout recovery: give checkout_attempts an explicit 'expired' status.
--
-- Until now abandonment was implicit ("status stays 'started'"); the
-- checkout.session.expired webhook (stripe-webhook) now marks it explicitly —
-- which is also the trigger for the one-shot recovery email. expired_at
-- doubles as the recovery-email dedup anchor (one per identity per 7 days).
--
-- REQUIRED MANUAL STEP: add `checkout.session.expired` to the webhook
-- endpoint's subscribed events in the Stripe dashboard (Developers →
-- Webhooks → the endpoint → add event), or Stripe never sends it.

ALTER TABLE checkout_attempts DROP CONSTRAINT IF EXISTS checkout_attempts_status_check;
ALTER TABLE checkout_attempts ADD CONSTRAINT checkout_attempts_status_check
  CHECK (status IN ('started', 'completed', 'expired'));

ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS expired_at timestamptz;

COMMENT ON TABLE checkout_attempts IS
  'One row per Stripe checkout session created by create-checkout. The checkout.session.completed webhook marks completion; checkout.session.expired marks abandonment (24h after open) and triggers the recovery email. Admin-surfaced via the timeline/activity-feed RPCs.';
