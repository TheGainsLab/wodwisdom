-- User entitlements: controls feature access for all products
-- Decouples "what can this user do" from billing/subscription status

CREATE TABLE user_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (user_id, feature, source)
);

CREATE INDEX idx_entitlements_user_feature ON user_entitlements(user_id, feature);

ALTER TABLE user_entitlements ENABLE ROW LEVEL SECURITY;

-- Users can read their own entitlements (needed for frontend access checks)
CREATE POLICY "select own" ON user_entitlements
  FOR SELECT USING (auth.uid() = user_id);

-- Only service_role (edge functions, webhooks) can insert/update/delete entitlements
-- No insert/update/delete policies for authenticated users —
-- entitlements are managed server-side only
