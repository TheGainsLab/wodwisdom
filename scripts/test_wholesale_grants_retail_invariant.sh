#!/usr/bin/env bash
# Retail-invariant integration test for the Wholesale Grants API.
#
# Proves the hard constraint: granting / revoking a gym (engine_cohort) seat for a
# member who ALSO holds an active RETAIL entitlement leaves the retail row(s)
# BYTE-IDENTICAL. This is "never disturb an existing retail subscription" as an
# executable test, not a comment.
#
# It runs the EXACT upsert/delete SHAPE the wholesale-grants edge function issues,
# including the retry-safe expires_at behavior (ABSENT = omit from the SET so a
# re-grant never clobbers a stored expiry; a timestamp = set it) — and it asserts
# that behavior directly, so the test can't silently codify the bug the function
# fixed. The entitlements schema is inlined below (mirrors migration
# 20260702120000_wholesale_grants_entitlements.sql) so there is no fragile
# migration line-scrape to drift.
#
# Run:   bash scripts/test_wholesale_grants_retail_invariant.sh   (see scripts/README.md)
# Requires: a local Postgres reachable via psql (createdb/dropdb perms).
set -euo pipefail

DB="wg_retail_invariant_$$"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
-- ── Fixtures: auth.users + user_entitlements (real shape + legacy unique) ──────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE user_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (user_id, feature, source)
);

-- ── Entitlements schema DDL (mirror of migration 20260702120000) ──────────────
ALTER TABLE user_entitlements ADD COLUMN granted_by text;
ALTER TABLE user_entitlements ADD COLUMN source_kind text;
CREATE OR REPLACE FUNCTION public.derive_entitlement_source_kind()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.source_kind IS NULL THEN
    IF NEW.source LIKE 'sub_%' OR NEW.source = 'backfill' THEN NEW.source_kind := 'retail_stripe';
    ELSIF NEW.source LIKE 'gym_%' THEN NEW.source_kind := 'gym_grant';
    ELSE NEW.source_kind := 'admin';
    END IF;
  END IF;
  RETURN NEW;
END; $fn$;
CREATE TRIGGER trg_entitlement_source_kind BEFORE INSERT ON user_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.derive_entitlement_source_kind();
ALTER TABLE user_entitlements ALTER COLUMN source_kind SET NOT NULL;
CREATE UNIQUE INDEX ux_entitlements_user_feature_grantedby
  ON user_entitlements (user_id, feature, granted_by);

-- ── Seed: a member with ACTIVE RETAIL entitlements (what we must not disturb) ──
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO user_entitlements(user_id, feature, source)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'engine', 'sub_RETAIL123');
-- Retail all-access row on the SAME feature a gym grants, to prove the union case.
INSERT INTO user_entitlements(user_id, feature, source, expires_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'engine_cohort', 'sub_RETAIL123', now() + interval '400 days');

-- Precondition: the snapshot is NON-empty (else the EXCEPT checks pass vacuously).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM user_entitlements WHERE source_kind = 'retail_stripe';
  IF n < 2 THEN RAISE EXCEPTION 'precondition: expected >=2 retail rows, got %', n; END IF;
END $$;

CREATE TEMP TABLE retail_before AS
  SELECT to_jsonb(ue.*) AS j FROM user_entitlements ue WHERE source_kind = 'retail_stripe';

-- Symmetric byte-identical assertion (catches mutations, deletes AND additions).
CREATE OR REPLACE FUNCTION assert_retail_unchanged(ctx text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE diff int;
BEGIN
  SELECT count(*) INTO diff FROM (
    (SELECT j FROM retail_before
       EXCEPT SELECT to_jsonb(ue.*) FROM user_entitlements ue WHERE source_kind='retail_stripe')
    UNION ALL
    (SELECT to_jsonb(ue.*) FROM user_entitlements ue WHERE source_kind='retail_stripe'
       EXCEPT SELECT j FROM retail_before)
  ) d;
  IF diff <> 0 THEN RAISE EXCEPTION 'RETAIL INVARIANT VIOLATED (%): % retail row(s) differ', ctx, diff; END IF;
END $$;

-- ── GRANT (mirror: no expires_at in payload -> omit from the DO UPDATE SET) ────
INSERT INTO user_entitlements (user_id, feature, source, source_kind, granted_by)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'engine_cohort',
        'gym_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'gym_grant', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
ON CONFLICT (user_id, feature, granted_by)
  DO UPDATE SET source = EXCLUDED.source, source_kind = EXCLUDED.source_kind; -- NOTE: no expires_at

DO $$
BEGIN
  PERFORM assert_retail_unchanged('after grant');
  IF (SELECT count(*) FROM user_entitlements WHERE source_kind='gym_grant'
        AND granted_by='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') <> 1 THEN
    RAISE EXCEPTION 'expected 1 gym grant'; END IF;
  IF (SELECT count(*) FROM user_entitlements
        WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND feature='engine_cohort') <> 2 THEN
    RAISE EXCEPTION 'union broken: retail + gym engine_cohort did not coexist'; END IF;
  RAISE NOTICE 'grant: retail byte-identical, gym grant present, union intact';
END $$;

-- ── expires_at retry-safety (the behavior the function was redesigned for) ─────
-- Set an expiry, then re-grant WITHOUT expires_at (omit from SET) -> must persist.
INSERT INTO user_entitlements (user_id, feature, source, source_kind, granted_by, expires_at)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'engine_cohort',
        'gym_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'gym_grant',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now() + interval '30 days')
ON CONFLICT (user_id, feature, granted_by)
  DO UPDATE SET expires_at = EXCLUDED.expires_at;
INSERT INTO user_entitlements (user_id, feature, source, source_kind, granted_by)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'engine_cohort',
        'gym_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'gym_grant', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
ON CONFLICT (user_id, feature, granted_by)
  DO UPDATE SET source = EXCLUDED.source; -- omit expires_at
DO $$
BEGIN
  IF (SELECT expires_at FROM user_entitlements WHERE source_kind='gym_grant'
        AND granted_by='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') IS NULL THEN
    RAISE EXCEPTION 'retry clobbered a stored expiry (the fixed bug regressed)';
  END IF;
  PERFORM assert_retail_unchanged('after expiry retry');
  RAISE NOTICE 'expires_at: re-grant without the field preserved the stored expiry';
END $$;

-- ── REVOKE (mirror: delete only gym_grant rows for this gym) ───────────────────
DELETE FROM user_entitlements
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND source_kind = 'gym_grant'
   AND granted_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$
BEGIN
  PERFORM assert_retail_unchanged('after revoke');
  IF (SELECT count(*) FROM user_entitlements WHERE source_kind='gym_grant') <> 0 THEN
    RAISE EXCEPTION 'revoke did not remove the gym grant'; END IF;
  RAISE NOTICE 'revoke: gym grant gone, retail still byte-identical';
END $$;

\echo '✓ RETAIL INVARIANT HELD across grant + expiry-retry + revoke'
SQL

echo "PASS: retail-invariant test"
