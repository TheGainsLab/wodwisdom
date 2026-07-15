-- Checkout breadcrumbs: record every checkout session created, mark the ones
-- that complete.
--
-- Until now the subscription funnel had only a terminal state (an entitlement
-- row appears when Stripe says paid); nobody could see who opened checkout
-- and walked away. create-checkout inserts a row when it creates the Stripe
-- session (best-effort — a logging failure must never block checkout);
-- stripe-webhook's checkout.session.completed handler flips it to completed.
-- An attempt that stays 'started' IS the abandonment signal — Stripe checkout
-- sessions expire after 24h, so no explicit 'expired' status is needed.
--
-- user_id is nullable: account-less checkouts (no Authorization header on
-- create-checkout) have no user yet; the webhook backfills user_id/email on
-- completion when it resolves the profile.
--
-- Surfaced as 'checkout' events in admin_user_timeline / admin_activity_feed
-- (updated in 20260717000300).

CREATE TABLE checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  plan text NOT NULL,
  billing_interval text NOT NULL DEFAULT 'monthly',
  stripe_session_id text UNIQUE,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_checkout_attempts_user ON checkout_attempts(user_id, created_at DESC);
CREATE INDEX idx_checkout_attempts_created ON checkout_attempts(created_at DESC);

-- Service-role writes only (edge functions); reads go through the admin RPCs
-- (SECURITY DEFINER). RLS on with no policies = invisible to clients, same
-- posture as programming_reconciliations.
ALTER TABLE checkout_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE checkout_attempts IS
  'One row per Stripe checkout session created by create-checkout. status stays ''started'' on abandonment (sessions expire in 24h); the checkout.session.completed webhook marks completion. Admin-surfaced via the timeline/activity-feed RPCs.';
