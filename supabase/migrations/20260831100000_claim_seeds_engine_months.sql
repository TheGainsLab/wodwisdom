-- Claim path seeds Engine month 1 (Carlos incident, 2026-08-31).
--
-- The checkout webhook seeds engine_months_unlocked=1 when it grants an
-- engine entitlement directly — but when the checkout email doesn't match a
-- profile (case mismatch, or pay-before-signup), the purchase parks in
-- pending_subscriptions and _do_claim_pending_subscription does the granting
-- instead. That path granted entitlements and backfilled stripe_customer_id
-- but NEVER seeded Engine months, leaving paying Engine subscribers at a
-- fully locked catalog until the daily reconciler (up to 24h). Two users hit
-- this in the last two days alone (carlos.acevedo2, and the reconciler healed
-- tziegler.cs the same way on 08-30).
--
-- Fix: the claim helper now mirrors the webhook's seed — insert-if-missing,
-- only-raise to 1, COALESCE-guarded so a NULL months value can't dodge the
-- comparison. Idempotent; a claim retry or an invoice event that already
-- unlocked more months is never lowered.
--
-- Body is the 20260414010000 hardened version plus the seed block.

CREATE OR REPLACE FUNCTION public._do_claim_pending_subscription(
  p_user_id uuid,
  p_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pending RECORD;
BEGIN
  IF p_user_id IS NULL OR p_email IS NULL OR p_email = '' THEN
    RETURN 0;
  END IF;

  SELECT * INTO pending
  FROM pending_subscriptions
  WHERE lower(email) = lower(p_email)
    AND NOT claimed
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE profiles
  SET stripe_customer_id = pending.stripe_customer_id
  WHERE id = p_user_id
    AND (stripe_customer_id IS NULL OR stripe_customer_id = pending.stripe_customer_id);

  IF pending.entitlements IS NOT NULL THEN
    FOR i IN 1..array_length(pending.entitlements, 1) LOOP
      INSERT INTO user_entitlements (user_id, feature, source)
      VALUES (p_user_id, pending.entitlements[i], pending.stripe_subscription_id)
      ON CONFLICT (user_id, feature, source) DO NOTHING;
    END LOOP;

    -- Seed Engine month 1, exactly as the webhook's direct-grant path does
    -- (raiseEngineMonthsFromGrant): a paying Engine subscriber must never
    -- sit at a locked catalog waiting for the daily reconciler.
    IF 'engine' = ANY(pending.entitlements) THEN
      INSERT INTO athlete_profiles (user_id, engine_months_unlocked, engine_months_unlocked_last_at)
      VALUES (p_user_id, 1, now())
      ON CONFLICT (user_id) DO NOTHING;

      UPDATE athlete_profiles
      SET engine_months_unlocked = 1,
          engine_months_unlocked_last_at = now()
      WHERE user_id = p_user_id
        AND COALESCE(engine_months_unlocked, 0) < 1;
    END IF;
  END IF;

  UPDATE pending_subscriptions
  SET claimed = true,
      claimed_by = p_user_id,
      claimed_at = now()
  WHERE id = pending.id;

  RETURN 1;
EXCEPTION
  WHEN OTHERS THEN
    INSERT INTO claim_subscription_errors (user_id, email, error_message, sqlstate, context)
    VALUES (p_user_id, p_email, SQLERRM, SQLSTATE, '_do_claim_pending_subscription');
    RETURN 0;
END;
$$;
