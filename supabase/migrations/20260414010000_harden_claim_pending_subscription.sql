-- Harden the pay-first subscription claim flow.
--
-- Context: users may pay via Stripe checkout before creating an account.
-- The stripe-webhook writes to pending_subscriptions, and when the user
-- later signs up a trigger should grant entitlements. One user (Slade)
-- was observed where this trigger did not fire, with no diagnosable cause.
--
-- This migration adds defense in depth:
--   1. Error log table so silent failures are recorded.
--   2. Shared helper that both the trigger and an on-login RPC call.
--   3. Trigger expanded to fire on INSERT OR UPDATE OF email (covers the
--      ON CONFLICT DO UPDATE path in handle_new_user).
--   4. RPC claim_my_pending_subscription() the frontend calls on every
--      login as a safety net.
-- All changes are idempotent and backward-compatible. Existing users
-- with entitlements are unaffected.

-- ─── 1. Error log table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.claim_subscription_errors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  email text,
  error_message text,
  sqlstate text,
  context text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_errors_created_at
  ON public.claim_subscription_errors (created_at DESC);

-- ─── 2. Shared claim helper ──────────────────────────────────────────
-- Called by both the trigger and the RPC. Looks up an unclaimed pending
-- subscription by email, grants entitlements, marks claimed.
-- Returns number of rows claimed (0 or 1).

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

-- ─── 3. Trigger function (wraps helper; never blocks signup) ─────────

CREATE OR REPLACE FUNCTION public.claim_pending_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM _do_claim_pending_subscription(NEW.id, NEW.email);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    INSERT INTO claim_subscription_errors (user_id, email, error_message, sqlstate, context)
    VALUES (NEW.id, NEW.email, SQLERRM, SQLSTATE, 'claim_pending_subscription trigger');
    RETURN NEW;
END;
$$;

-- ─── 4. Trigger: fire on INSERT OR UPDATE OF email ───────────────────
-- Replaces the previous INSERT-only trigger. Firing on UPDATE OF email
-- covers the case where handle_new_user goes through ON CONFLICT DO UPDATE
-- (which does not fire AFTER INSERT triggers).

DROP TRIGGER IF EXISTS on_profile_created_claim_subscription ON public.profiles;
DROP TRIGGER IF EXISTS on_profile_claim_subscription ON public.profiles;

CREATE TRIGGER on_profile_claim_subscription
  AFTER INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW
  WHEN (NEW.email IS NOT NULL)
  EXECUTE FUNCTION public.claim_pending_subscription();

-- ─── 5. Client-callable RPC (safety net on login) ────────────────────
-- The frontend calls this after every sign-in as a backup to the trigger.
-- Runs with the caller's auth context; only claims subscriptions matching
-- the caller's own email.

CREATE OR REPLACE FUNCTION public.claim_my_pending_subscription()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid;
  email_val text;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT email INTO email_val FROM auth.users WHERE id = uid;
  RETURN _do_claim_pending_subscription(uid, email_val);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_my_pending_subscription() FROM public;
GRANT EXECUTE ON FUNCTION public.claim_my_pending_subscription() TO authenticated;
