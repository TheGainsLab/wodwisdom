-- Make _do_claim_pending_subscription race-proof at the database, independent
-- of how many times a caller invokes it.
--
-- Context: the frontend fired claim_my_pending_subscription() twice per load,
-- concurrently (getSession and onAuthStateChange('SIGNED_IN') both resolve on a
-- normal load). That client bug is fixed separately, but the concurrent path was
-- only ever benign by invariant, not by construction: the entitlement inserts are
-- ON CONFLICT DO NOTHING, the stripe_customer_id update is self-guarded, and
-- re-marking claimed with the same claimed_by is idempotent. Nothing enforces
-- that those three properties survive future edits to this function, and the
-- unclaimed-row SELECT has always been a read-then-write with no lock.
--
-- Fix: take a row lock on the pending subscription being claimed.
--
-- Why plain FOR UPDATE and not FOR UPDATE SKIP LOCKED: under READ COMMITTED the
-- blocked loser re-evaluates the row predicate after the winner commits, so the
-- `AND NOT claimed` clause makes it observe the completed claim and return 0 --
-- a true "already claimed". SKIP LOCKED would instead skip the row and return 0
-- as a guess, indistinguishable from "no pending subscription exists". There is
-- no contention argument for SKIP LOCKED here: the realistic worst case is two
-- calls milliseconds apart from a single user.
--
-- Observable change: in a genuine race the losing call now returns 0 where it
-- previously returned 1. Both callers in the tree ignore the return value (the
-- trigger PERFORMs it; the frontend discards it), and 0 is the more honest
-- answer -- that call did not claim anything.
--
-- Idempotent and backward-compatible: CREATE OR REPLACE of one function body,
-- no schema, data, or signature changes. Safe to re-run.

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

  -- FOR UPDATE: serialize concurrent claims of the same pending row. A second
  -- caller blocks here, then re-checks `NOT claimed` against the committed row
  -- and falls through to RETURN 0 below.
  SELECT * INTO pending
  FROM pending_subscriptions
  WHERE lower(email) = lower(p_email)
    AND NOT claimed
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

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
