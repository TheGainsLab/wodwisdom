-- Billing events ledger (capture list item A, 2026-07-18): the durable
-- record of every billing-lifecycle moment. Until now cancellations DELETED
-- entitlements and kept nothing — churn was an unrecorded death; payment
-- failures, refunds, disputes, and plan changes likewise left no queryable
-- trace. stripe-webhook now appends here on every such event.
--
-- event_type:
--   purchased      — checkout completed (currency captured: the
--                    international-pricing scoreboard)
--   canceled       — subscription deleted (tenure_days = signup-to-death)
--   payment_churn  — terminal unpaid/incomplete_expired (involuntary churn)
--   payment_failed — a renewal attempt failed (may retry; one row per event)
--   refunded       — charge refunded
--   dispute        — chargeback opened
--   plan_changed   — upgrade/downgrade on a live subscription
--
-- Append-only; service-role writes; admin reads come later via RPCs/digest.

CREATE TABLE billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  stripe_customer_id text,
  stripe_subscription_id text,
  event_type text NOT NULL CHECK (event_type IN
    ('purchased', 'canceled', 'payment_churn', 'payment_failed', 'refunded', 'dispute', 'plan_changed')),
  plan text,
  currency text,
  amount_cents integer,
  tenure_days integer,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_events_user ON billing_events(user_id, created_at DESC);
CREATE INDEX idx_billing_events_type ON billing_events(event_type, created_at DESC);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
-- Service-role writes only; no client policies.

COMMENT ON TABLE billing_events IS
  'Append-only billing lifecycle ledger written by stripe-webhook: purchases (with currency), cancellations (with tenure), payment failures, refunds, disputes, plan changes. The churn dataset.';
