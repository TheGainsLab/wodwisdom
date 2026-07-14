-- One-off goodwill grant: grandfather a specific subscriber at month 4.
--
-- This user paid for 3 months (engine_months_unlocked = 3) but had walked the
-- current-day pointer into month 4 before the entitlement fence
-- (20260714000000) existed. Rather than yanking them back mid-month, comp the
-- month they are already in: raise to 4. The fence walls month 5 onward, and
-- each future paid invoice raises the value by 1 (stripe-webhook), so all
-- remaining months are paid months.
--
-- Stability: every automated writer (stripe-webhook, reconcile-engine-months,
-- monthly-generation-cron, gym drip) is only-raise, so none of them will ever
-- lower this back to the Stripe-computed 3. The daily reconciler will list
-- this user in its "flagged" audit bucket as over_entitled — that is expected
-- and correct: they hold one comped month.
--
-- Guarded with < 4 so re-running (or a payment landing first) never lowers.
-- No-op in environments where the row doesn't exist.
UPDATE athlete_profiles
SET engine_months_unlocked = 4,
    engine_months_unlocked_last_at = now()
WHERE user_id = 'f6c37b9c-e6eb-4352-b690-7fa3c2a5abdf'
  AND engine_months_unlocked < 4;
