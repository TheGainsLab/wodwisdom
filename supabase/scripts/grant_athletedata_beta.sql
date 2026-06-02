-- Athlete Data — beta cohort entitlement grant
-- ============================================================================
-- Grants the `athletedata` feature to the beta test cohort. This is a one-off
-- ops action, NOT a migration — run it in the Supabase SQL editor.
--
-- `source = 'beta'` marks these as hand-granted test rows. At GA a separate
-- default-grant path will issue `source = 'default'` rows; the unique
-- constraint (user_id, feature, source) lets a beta user pick up the default
-- row later without conflict. To wind the beta down, delete only the
-- source='beta' rows (see the revoke block at the bottom) — GA grants survive.
--
-- The page gate is `isAdmin || hasFeature('athletedata')`, so admins already
-- have access via role; the admin grant below is belt-and-suspenders so the
-- entitlement table reflects reality and `source` cohort queries are complete.
-- ============================================================================

-- 1. Admins — every profile with role = 'admin'.
INSERT INTO user_entitlements (user_id, feature, source)
SELECT id, 'athletedata', 'beta'
FROM profiles
WHERE role = 'admin'
ON CONFLICT (user_id, feature, source) DO NOTHING;

-- 2. Beta athletes — by email. Replace the list with the real cohort.
--    Pick ~15-20 spanning competitive tiers (Open-only -> Games) and include
--    at least one thin-data athlete, so the charts get tested across sparse
--    and rich histories.
INSERT INTO user_entitlements (user_id, feature, source)
SELECT id, 'athletedata', 'beta'
FROM auth.users
WHERE email IN (
  'athlete1@example.com',
  'athlete2@example.com'
  -- ... add the rest of the beta cohort here
)
ON CONFLICT (user_id, feature, source) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Verify the grants landed.
SELECT u.email, ue.feature, ue.source, ue.granted_at
FROM user_entitlements ue
JOIN auth.users u ON u.id = ue.user_id
WHERE ue.feature = 'athletedata' AND ue.source = 'beta'
ORDER BY ue.granted_at;

-- ----------------------------------------------------------------------------
-- Revoke (wind down the beta) — removes ONLY the hand-granted rows, leaving any
-- GA default-grant rows intact. Uncomment to run.
-- DELETE FROM user_entitlements WHERE feature = 'athletedata' AND source = 'beta';
