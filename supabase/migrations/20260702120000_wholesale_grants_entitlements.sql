-- Wholesale Grants API — user_entitlements source_kind/granted_by (BILLING_MECHANICS_SPEC §7).
--
-- REALITY DIVERGENCE FROM SPEC §7 (documented, not improvised):
--   Spec §7 assumed `source` was a free column and proposed making it the
--   category enum (retail_stripe | gym_grant | admin). In reality `source`
--   ALREADY EXISTS on user_entitlements and holds a heterogeneous grant-ORIGIN
--   discriminator — Stripe subscription ids ('sub_...'), 'admin', 'generated',
--   'manual', 'backfill', 'beta' — that retail's, admin's, and the v3 migrate
--   path's scoped-revoke queries ('.eq("source", <id>)') and several admin
--   classifiers ('source NOT IN (...)') depend on. Repurposing it would break
--   retail (a hard constraint: grants are strictly additive, retail untouched).
--
--   So this migration is ADDITIVE and honors the spec's INTENT under new names:
--     - `granted_by`  = the tenant/gym id behind a grant (nullable; the spec's
--                       granted_by). NULL for retail/admin/system rows.
--     - `source_kind` = the ORIGIN CATEGORY the spec called `source`
--                       (retail_stripe | gym_grant | admin). `source` keeps its
--                       discriminator role, untouched.
--   Gym grants write `source = 'gym_' || gym_id` (PREFIXED — collision-proof
--   against 'sub_%'/'admin'/'manual'/'backfill'/'beta' so no existing `source`
--   reader misfires) alongside `source_kind='gym_grant'` + `granted_by=gym_id`.
--   Idempotency by (user_id, gym_id, feature) is a FULL unique index on
--   (user_id, feature, granted_by): NULLs are distinct, so every existing
--   retail/admin row (granted_by IS NULL) is unaffected.
--
-- SCHEMA-CACHE + DEPLOY ORDER (IMPORTANT): this migration adds COLUMNS that
-- wholesale-grants AND the already-live admin-data name in their writes.
-- PostgREST's schema cache covers columns, so a write before the cache refreshes
-- fails with PGRST204. Therefore: (1) this migration ends with
-- `NOTIFY pgrst, 'reload schema'`, and (2) DEPLOY ORDER is load-bearing —
-- APPLY THIS MIGRATION FIRST, then deploy admin-data / wholesale-grants /
-- engine-generate. Deploying admin-data before the migration lands breaks live
-- admin grant flows until it does.
--
-- Idempotent + SQL-editor-ready.

BEGIN;

-- 1. New columns (additive; safe to re-run). source_kind starts NULLABLE so the
--    trigger + backfill can classify before we lock it NOT NULL below.
ALTER TABLE user_entitlements
  ADD COLUMN IF NOT EXISTS granted_by text,
  ADD COLUMN IF NOT EXISTS source_kind text;

-- 2. Trigger: derive source_kind from the legacy `source` discriminator whenever
--    a writer doesn't set it explicitly (NULL). Future-proofs every writer that
--    nobody remembers to update (beta grants, manual grants, …) — they classify
--    correctly instead of defaulting to a wrong category. Explicit writers
--    (wholesale-grants -> 'gym_grant', admin-data -> 'admin') set it and the
--    trigger leaves them alone. Stripe subs + the 20260243 'backfill' rows are
--    real retail; everything else internal buckets to 'admin'.
CREATE OR REPLACE FUNCTION public.derive_entitlement_source_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_kind IS NULL THEN
    IF NEW.source LIKE 'sub_%' OR NEW.source = 'backfill' THEN
      NEW.source_kind := 'retail_stripe';
    ELSIF NEW.source LIKE 'gym_%' THEN
      NEW.source_kind := 'gym_grant';
    ELSE
      NEW.source_kind := 'admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entitlement_source_kind ON user_entitlements;
CREATE TRIGGER trg_entitlement_source_kind
  BEFORE INSERT ON user_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.derive_entitlement_source_kind();

-- 3. Backfill existing rows with the same rule (sub_% or 'backfill' -> retail;
--    'gym_%' -> gym_grant (none yet, but correct if any exist); else admin).
UPDATE user_entitlements
SET source_kind = CASE
  WHEN source LIKE 'sub_%' OR source = 'backfill' THEN 'retail_stripe'
  WHEN source LIKE 'gym_%' THEN 'gym_grant'
  ELSE 'admin'
END
WHERE source_kind IS NULL;

-- 4. Lock it down: NOT NULL + category CHECK.
ALTER TABLE user_entitlements ALTER COLUMN source_kind SET NOT NULL;
ALTER TABLE user_entitlements DROP CONSTRAINT IF EXISTS user_entitlements_source_kind_check;
ALTER TABLE user_entitlements
  ADD CONSTRAINT user_entitlements_source_kind_check
  CHECK (source_kind IN ('retail_stripe', 'gym_grant', 'admin'));

-- 5. Idempotency index for gym grants: one active grant per (user, feature, gym).
--    Full (not partial) unique index — NULL granted_by (retail/admin) rows stay
--    distinct, so this constrains gym grants only without touching the existing
--    UNIQUE(user_id, feature, source) that retail relies on.
CREATE UNIQUE INDEX IF NOT EXISTS ux_entitlements_user_feature_grantedby
  ON user_entitlements (user_id, feature, granted_by);

-- 6. Query index for "all gym grants for gym X" (revoke-on-leave, §11 audit).
--    Single-column partial — granted_by non-null already implies a gym grant,
--    so a second column adds no selectivity.
CREATE INDEX IF NOT EXISTS idx_entitlements_granted_by
  ON user_entitlements (granted_by)
  WHERE granted_by IS NOT NULL;

-- 7. Admin classifiers: exclude gym grants. The `is_paid_subscriber` /
--    subscriber-count predicates are `source NOT IN ('manual','admin')`; a
--    prefixed gym source ('gym_<uuid>') is not in that set, so without this a
--    wholesale member reads as a paying retail subscriber (inflated counts,
--    wrong churn, delete-protection). The two live RPCs are reproduced VERBATIM
--    from their source migrations (20260602000000 / 20260506300000) with the
--    single predicate `AND source_kind <> 'gym_grant'` added — see the appended
--    blocks below. (admin-delete-users' JS classifier is fixed in that function.)

-- ── admin_user_list_v2 (from 20260602000000) + gym-grant exclusion ──────────
CREATE OR REPLACE FUNCTION admin_user_list_v2()
RETURNS TABLE(
  id uuid,
  email text,
  full_name text,
  role text,
  signup_date timestamptz,
  last_active timestamptz,
  entitlements text[],
  question_count bigint,
  total_tokens bigint,
  engine_day integer,
  engine_sessions_count bigint,
  nutrition_days_logged bigint,
  workouts_logged bigint,
  programs_count bigint,
  has_profile boolean,
  email_count bigint,
  last_email_at timestamptz,
  is_paid_subscriber boolean,
  competition_linked boolean,
  competition_athlete_label text,
  email_confirmed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.role,
    au.created_at as signup_date,
    GREATEST(
      (SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.user_id = p.id),
      (SELECT MAX(fe.created_at) FROM food_entries fe WHERE fe.user_id = p.id),
      (SELECT MAX(es.created_at) FROM engine_workout_sessions es WHERE es.user_id = p.id),
      (SELECT MAX(wl.created_at) FROM workout_logs wl WHERE wl.user_id = p.id)
    ) as last_active,
    (
      SELECT ARRAY_AGG(DISTINCT ue.feature)
      FROM user_entitlements ue
      WHERE ue.user_id = p.id
        AND (ue.expires_at IS NULL OR ue.expires_at > NOW())
    ) as entitlements,
    (SELECT COUNT(*) FROM chat_messages cm WHERE cm.user_id = p.id) as question_count,
    (SELECT COALESCE(SUM(cm.input_tokens + cm.output_tokens), 0) FROM chat_messages cm WHERE cm.user_id = p.id) as total_tokens,
    ap.engine_current_day as engine_day,
    (SELECT COUNT(*) FROM engine_workout_sessions es WHERE es.user_id = p.id) as engine_sessions_count,
    (SELECT COUNT(DISTINCT dn.date) FROM daily_nutrition dn WHERE dn.user_id = p.id) as nutrition_days_logged,
    (SELECT COUNT(*) FROM workout_logs wl WHERE wl.user_id = p.id) as workouts_logged,
    (SELECT COUNT(*) FROM programs pr WHERE pr.user_id = p.id) as programs_count,
    (ap.user_id IS NOT NULL) as has_profile,
    (SELECT COUNT(*) FROM email_sends es WHERE es.user_id = p.id) as email_count,
    (SELECT MAX(es.sent_at) FROM email_sends es WHERE es.user_id = p.id) as last_email_at,
    EXISTS (
      SELECT 1
      FROM user_entitlements ue
      WHERE ue.user_id = p.id
        AND (ue.expires_at IS NULL OR ue.expires_at > NOW())
        AND ue.source NOT IN ('manual', 'admin')
        AND ue.source_kind <> 'gym_grant'
    ) as is_paid_subscriber,
    (ap.competition_athlete_id IS NOT NULL) as competition_linked,
    ap.competition_athlete_label as competition_athlete_label,
    (au.email_confirmed_at IS NOT NULL) as email_confirmed
  FROM profiles p
  JOIN auth.users au ON au.id = p.id
  LEFT JOIN athlete_profiles ap ON ap.user_id = p.id
  ORDER BY last_active DESC NULLS LAST;
END;
$func$;

-- ── admin_overview_stats (from 20260506300000) + gym-grant exclusion ───────
CREATE OR REPLACE FUNCTION admin_overview_stats(tz text DEFAULT 'UTC')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  today date := (NOW() AT TIME ZONE tz)::date;
BEGIN
  SELECT json_build_object(
    'active_today', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages
      WHERE created_at >= today
    ),
    'active_7d', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages
      WHERE created_at >= today - INTERVAL '7 days'
    ),
    'active_30d', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages
      WHERE created_at >= today - INTERVAL '30 days'
    ),
    'total_users', (
      SELECT COUNT(*) FROM profiles
    ),
    'new_signups_7d', (
      SELECT COUNT(*) FROM auth.users
      WHERE created_at >= today - INTERVAL '7 days'
    ),
    'new_signups_30d', (
      SELECT COUNT(*) FROM auth.users
      WHERE created_at >= today - INTERVAL '30 days'
    ),

    'subscribers', (
      SELECT json_agg(row_to_json(s)) FROM (
        SELECT feature, COUNT(DISTINCT user_id) as count
        FROM user_entitlements
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND source NOT IN ('manual', 'admin')
          AND source_kind <> 'gym_grant'
        GROUP BY feature
        ORDER BY count DESC
      ) s
    ),

    'entitled_users', (
      SELECT json_agg(row_to_json(s)) FROM (
        SELECT feature, COUNT(DISTINCT user_id) as count
        FROM user_entitlements
        WHERE (expires_at IS NULL OR expires_at > NOW())
        GROUP BY feature
        ORDER BY count DESC
      ) s
    ),

    'users_with_entitlements', (
      SELECT COUNT(DISTINCT user_id) FROM user_entitlements
      WHERE (expires_at IS NULL OR expires_at > NOW())
    ),

    'profiles_with_lifts', (
      SELECT COUNT(*) FROM athlete_profiles
      WHERE lifts IS NOT NULL AND lifts != '{}'::jsonb
        AND EXISTS (SELECT 1 FROM jsonb_each_text(lifts) WHERE value::numeric > 0)
    ),
    'profiles_with_evaluation', (
      SELECT COUNT(DISTINCT user_id) FROM profile_evaluations
    ),
    'profiles_with_program', (
      SELECT COUNT(DISTINCT user_id) FROM programs WHERE source = 'generated'
    )
  ) INTO result;
  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
