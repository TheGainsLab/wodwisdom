-- Extend the admin Users list with two abuse/adoption signals:
--   1. Competition-athlete linkage — see at a glance which users found and
--      linked their athlete data.
--        linked = athlete_profiles.competition_athlete_id IS NOT NULL
--        competition_athlete_label = the name captured at link time.
--   2. Email confirmation — surfaces ghost/spam signups (e.g. one display name
--      across many emails). Most spam signups are never confirmed.
--        email_confirmed = auth.users.email_confirmed_at IS NOT NULL
--
-- admin_user_list_v2 already JOINs auth.users + LEFT JOINs athlete_profiles;
-- this just adds return columns. Signature changes, so DROP + recreate.

DROP FUNCTION IF EXISTS admin_user_list_v2();

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
