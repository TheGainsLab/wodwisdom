-- Idempotency ledger for Stripe webhook deliveries.
--
-- Stripe retries any delivery that doesn't 2xx fast enough, and the handler
-- does slow work inline (entitlement grants, engine month unlocks, month
-- generation triggers with 30s timeouts). A retried invoice.payment_succeeded
-- used to re-run the +1 unlock — the phantom engine months the nightly sweep
-- kept flagging (mason.king's renewal double, 2026-10-21).
--
-- The webhook claims event.id here before processing: first delivery wins,
-- a duplicate no-ops with a 200. If processing FAILS, the handler releases
-- the claim so Stripe's retry can succeed.
--
-- Service-role only: RLS on with no policies.

CREATE TABLE stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- Deliveries older than Stripe's retry window are dead weight; a weekly
-- cleanup can prune, but at this volume (a few rows/day) it can also wait.
CREATE INDEX idx_stripe_webhook_events_received ON stripe_webhook_events (received_at);
