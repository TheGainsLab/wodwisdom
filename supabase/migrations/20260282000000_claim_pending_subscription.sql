-- After a new user signs up, check if they have a pending subscription
-- and grant entitlements if found
CREATE OR REPLACE FUNCTION claim_pending_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  pending RECORD;
BEGIN
  -- Look for unclaimed pending subscription matching this email
  SELECT * INTO pending
  FROM pending_subscriptions
  WHERE email = NEW.email
    AND NOT claimed
  ORDER BY created_at DESC
  LIMIT 1;

  IF pending IS NOT NULL THEN
    -- Store stripe_customer_id on profiles
    UPDATE profiles
    SET stripe_customer_id = pending.stripe_customer_id
    WHERE id = NEW.id;

    -- Grant entitlements
    FOR i IN 1..array_length(pending.entitlements, 1) LOOP
      INSERT INTO user_entitlements (user_id, feature, source)
      VALUES (NEW.id, pending.entitlements[i], pending.stripe_subscription_id)
      ON CONFLICT (user_id, feature, source) DO NOTHING;
    END LOOP;

    -- Mark as claimed
    UPDATE pending_subscriptions
    SET claimed = true,
        claimed_by = NEW.id,
        claimed_at = now()
    WHERE id = pending.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Fire after the profile is created (handle_new_user creates the profile)
CREATE TRIGGER on_profile_created_claim_subscription
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION claim_pending_subscription();
