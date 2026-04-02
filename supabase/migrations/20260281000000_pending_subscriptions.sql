-- Pending subscriptions: holds Stripe subscription data for users
-- who paid before creating an account
CREATE TABLE pending_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL,
  plan text NOT NULL,
  entitlements text[] NOT NULL DEFAULT '{}',
  claimed boolean NOT NULL DEFAULT false,
  claimed_by uuid REFERENCES auth.users(id),
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for looking up by email during account creation
CREATE INDEX idx_pending_subscriptions_email ON pending_subscriptions(email) WHERE NOT claimed;

-- Index for looking up by subscription ID (webhook updates)
CREATE UNIQUE INDEX idx_pending_subscriptions_sub_id ON pending_subscriptions(stripe_subscription_id);
