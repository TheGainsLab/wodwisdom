-- Funnel flags on the admin user list, so the dashboard's stat tiles can act
-- as live links into filtered user views ("who are the 67 people with lifts
-- but no evaluation?").
--
-- admin_user_list_v2 is reproduced VERBATIM from its latest form
-- (20260702120000, gym-grant exclusion) with ONLY three columns appended —
-- the same discipline previous revisions used. The three flags mirror the
-- admin_overview_stats funnel definitions exactly (20260717000000), so a
-- tile's count and its user list always agree:
--   has_lifts             = lifts non-empty with at least one value > 0
--   has_evaluation        = any profile_evaluations row
--   has_generated_program = any programs row with source = 'generated'

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
  email_confirmed boolean,
  has_lifts boolean,
  has_evaluation boolean,
  has_generated_program boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
  -- In-function admin gate. SECURITY DEFINER + default EXECUTE grants meant
  -- any authenticated user calling this RPC directly got every user's email
  -- and activity — the role check lived only in the frontend. (The other
  -- admin_* RPCs share this exposure; hardening them is a follow-up sweep.)
  IF NOT EXISTS (
    SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

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
    (au.email_confirmed_at IS NOT NULL) as email_confirmed,
    (
      ap.lifts IS NOT NULL AND ap.lifts != '{}'::jsonb
      AND EXISTS (SELECT 1 FROM jsonb_each_text(ap.lifts) WHERE value::numeric > 0)
    ) as has_lifts,
    EXISTS (
      SELECT 1 FROM profile_evaluations pe WHERE pe.user_id = p.id
    ) as has_evaluation,
    EXISTS (
      SELECT 1 FROM programs pr WHERE pr.user_id = p.id AND pr.source = 'generated'
    ) as has_generated_program
  FROM profiles p
  JOIN auth.users au ON au.id = p.id
  LEFT JOIN athlete_profiles ap ON ap.user_id = p.id
  ORDER BY last_active DESC NULLS LAST;
END;
$func$;

REVOKE ALL ON FUNCTION admin_user_list_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_user_list_v2() TO authenticated;
