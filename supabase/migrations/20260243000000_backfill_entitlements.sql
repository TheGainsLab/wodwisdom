-- Backfill entitlements for existing AI Suite subscribers
-- Anyone with an active subscription (active, canceling, past_due) gets all AI Suite features

INSERT INTO user_entitlements (user_id, feature, source)
SELECT p.id, f.feature, 'backfill'
FROM profiles p
CROSS JOIN (
  VALUES ('ai_chat'), ('program_gen'), ('workout_review'), ('workout_log')
) AS f(feature)
WHERE p.subscription_status IN ('active', 'canceling', 'past_due')
ON CONFLICT (user_id, feature, source) DO NOTHING;
