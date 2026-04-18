-- Change the default for engine_months_unlocked from 1 to 0.
-- Payments are the single source of truth for Engine content access. A new
-- athlete_profiles row must start with no months unlocked; the Stripe webhook
-- (invoice.payment_succeeded handler) is responsible for raising the value
-- from 0 on initial payment.
--
-- Existing rows are deliberately not touched by this migration. Users whose
-- engine_months_unlocked is currently 1 from the old default will keep it
-- unless an admin updates them manually via the admin panel.
ALTER TABLE athlete_profiles
  ALTER COLUMN engine_months_unlocked SET DEFAULT 0;
