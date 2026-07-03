-- Wholesale Grants API — user_entitlements source/granted_by (BILLING_MECHANICS_SPEC §7).
--
-- REALITY DIVERGENCE FROM SPEC §7 (documented, not improvised):
--   Spec §7 assumed `source` was a free column and proposed making it the
--   category enum (retail_stripe | gym_grant | admin). In reality `source`
--   ALREADY EXISTS on user_entitlements and holds a heterogeneous grant-ORIGIN
--   discriminator — Stripe subscription ids ('sub_...'), 'admin', 'generated',
--   'manual' — that retail's, admin's, and the v3 migrate path's scoped-revoke
--   queries ('.eq("source", <id>)') depend on. Repurposing it would break retail
--   (a hard constraint: grants are strictly additive, retail untouched).
--
--   So this migration is ADDITIVE and honors the spec's INTENT under new names:
--     - `granted_by`  = the tenant/gym id behind a grant (nullable; the spec's
--                       granted_by). NULL for retail/admin/system rows.
--     - `source_kind` = the ORIGIN CATEGORY the spec called `source`
--                       (retail_stripe | gym_grant | admin). `source` keeps its
--                       existing discriminator role, untouched.
--   Idempotency by (user_id, gym_id, feature) is a new FULL unique index on
--   (user_id, feature, granted_by): NULLs are distinct, so every existing
--   retail/admin row (granted_by IS NULL) is unaffected, while gym grants collide
--   per (user, feature, gym) exactly as the spec requires.
--
-- Idempotent + SQL-editor-ready. PostgREST schema reload NOT required to read the
-- new columns (they are plain columns), but the affiliate consumer needs the
-- WHOLESALE_SERVICE_KEY / WHOLESALE_CONSUMER_KEYS env vars set on the
-- wholesale-grants function before it can grant (see PR notes).

BEGIN;

-- 1. New columns (additive; safe to re-run).
ALTER TABLE user_entitlements
  ADD COLUMN IF NOT EXISTS granted_by text,
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'retail_stripe';

-- 2. Category CHECK (drop-then-add so re-runs don't error on an existing constraint).
ALTER TABLE user_entitlements DROP CONSTRAINT IF EXISTS user_entitlements_source_kind_check;
ALTER TABLE user_entitlements
  ADD CONSTRAINT user_entitlements_source_kind_check
  CHECK (source_kind IN ('retail_stripe', 'gym_grant', 'admin'));

-- 3. Backfill existing rows' category from the legacy `source` discriminator.
--    Stripe subscriptions ('sub_...') are retail; everything else internal
--    ('admin' / 'generated' / 'manual' / …) buckets to 'admin'. Runs only on
--    rows still at the default so a re-run after real gym_grant rows exist is a
--    no-op for them.
UPDATE user_entitlements
SET source_kind = CASE
  WHEN source LIKE 'sub_%' THEN 'retail_stripe'
  ELSE 'admin'
END
WHERE source_kind = 'retail_stripe'
  AND source NOT LIKE 'sub_%';

-- 4. Idempotency index for gym grants: one active grant per (user, feature, gym).
--    Full (not partial) unique index — NULL granted_by (retail/admin) rows stay
--    distinct, so this constrains gym grants only without touching the existing
--    UNIQUE(user_id, feature, source) that retail relies on.
CREATE UNIQUE INDEX IF NOT EXISTS ux_entitlements_user_feature_grantedby
  ON user_entitlements (user_id, feature, granted_by);

-- 5. Query index for "all gym_grant rows for gym X" (revoke-on-leave, audit §11).
CREATE INDEX IF NOT EXISTS idx_entitlements_grantedby_kind
  ON user_entitlements (granted_by, source_kind)
  WHERE granted_by IS NOT NULL;

COMMIT;
