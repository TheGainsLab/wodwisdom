#!/usr/bin/env bash
# Retail-invariant integration test for the Wholesale Grants API (F3 requirement).
#
# Proves the hard constraint: granting / revoking a gym (engine_cohort) seat for a
# member who ALSO holds an active RETAIL entitlement leaves the retail row(s)
# BYTE-IDENTICAL. This is the "never disturb an existing retail subscription"
# invariant as an executable test, not a comment.
#
# It runs the EXACT SQL the wholesale-grants edge function issues:
#   - grant  = upsert { source:'gym_'||gym, source_kind:'gym_grant', granted_by:gym }
#              ON CONFLICT (user_id, feature, granted_by)
#   - revoke = delete WHERE source_kind='gym_grant' AND granted_by=gym [AND feature]
# against a throwaway DB with the real migration's entitlements schema applied.
#
# Usage:  bash scripts/test_wholesale_grants_retail_invariant.sh
# Requires: a local Postgres reachable via `psql` (createdb/dropdb perms).
set -euo pipefail

DB="wg_retail_invariant_$$"
MIG="supabase/migrations/20260702120000_wholesale_grants_entitlements.sql"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Extract just the entitlements SCHEMA DDL from the migration (the admin-RPC
# redefinitions reference dozens of app tables and aren't needed for this test).
DDL="$(python3 - "$MIG" <<'PY'
import sys, pathlib
lines = pathlib.Path(sys.argv[1]).read_text().splitlines()
start = next(i for i, l in enumerate(lines) if l.startswith("ALTER TABLE user_entitlements"))
end = next(i for i, l in enumerate(lines) if "idx_entitlements_granted_by" in l)
print("\n".join(lines[start:end + 3]))
PY
)"

createdb "$DB"

psql -v ON_ERROR_STOP=1 -q -d "$DB" <<SQL
-- Minimal real-shaped fixtures: auth.users + user_entitlements (+ the legacy unique).
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

-- Apply the migration's entitlements schema DDL (columns + trigger + indexes).
$DDL

-- Seed: one member with an ACTIVE RETAIL entitlement (the thing we must not disturb).
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO user_entitlements(user_id, feature, source)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'engine', 'sub_RETAIL123');
-- A retail all-access row on the SAME feature a gym might grant, to prove the
-- union case (retail 'engine' + gym 'engine_cohort') never collides.
INSERT INTO user_entitlements(user_id, feature, source)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'engine_cohort', 'sub_RETAIL123');

-- Snapshot every retail row exactly.
CREATE TEMP TABLE retail_before AS
  SELECT to_jsonb(ue.*) AS j FROM user_entitlements ue
  WHERE source_kind = 'retail_stripe' ORDER BY id;

-- ── GRANT (exact wholesale-grants upsert) — gym seat on engine_cohort ──────────
INSERT INTO user_entitlements (user_id, feature, source, source_kind, granted_by)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'engine_cohort',
        'gym_' || 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'gym_grant',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
ON CONFLICT (user_id, feature, granted_by) DO UPDATE SET expires_at = EXCLUDED.expires_at;

-- Assert: retail rows byte-identical, and the gym grant coexists.
DO \$\$
DECLARE diff int; gym_rows int;
BEGIN
  SELECT count(*) INTO diff FROM (
    SELECT j FROM retail_before
    EXCEPT
    SELECT to_jsonb(ue.*) FROM user_entitlements ue WHERE source_kind = 'retail_stripe'
  ) d;
  IF diff <> 0 THEN RAISE EXCEPTION 'RETAIL INVARIANT VIOLATED after grant: % retail row(s) changed', diff; END IF;

  SELECT count(*) INTO gym_rows FROM user_entitlements
   WHERE source_kind = 'gym_grant' AND granted_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  IF gym_rows <> 1 THEN RAISE EXCEPTION 'expected 1 gym grant, found %', gym_rows; END IF;

  -- Both engine_cohort rows (retail + gym) must coexist for the union.
  IF (SELECT count(*) FROM user_entitlements
      WHERE user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND feature='engine_cohort') <> 2 THEN
    RAISE EXCEPTION 'union broken: retail + gym engine_cohort rows did not coexist';
  END IF;
  RAISE NOTICE 'grant: retail byte-identical, gym grant present, union intact';
END \$\$;

-- ── REVOKE (exact wholesale-grants delete) — only gym_grant for this gym ───────
DELETE FROM user_entitlements
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND source_kind = 'gym_grant'
   AND granted_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

DO \$\$
DECLARE diff int;
BEGIN
  SELECT count(*) INTO diff FROM (
    SELECT j FROM retail_before
    EXCEPT
    SELECT to_jsonb(ue.*) FROM user_entitlements ue WHERE source_kind = 'retail_stripe'
  ) d;
  IF diff <> 0 THEN RAISE EXCEPTION 'RETAIL INVARIANT VIOLATED after revoke: % retail row(s) changed', diff; END IF;
  IF (SELECT count(*) FROM user_entitlements WHERE source_kind='gym_grant') <> 0 THEN
    RAISE EXCEPTION 'revoke did not remove the gym grant';
  END IF;
  RAISE NOTICE 'revoke: gym grant gone, retail still byte-identical';
END \$\$;

\echo '✓ RETAIL INVARIANT HELD across grant + revoke'
SQL

echo "PASS: retail-invariant test"
