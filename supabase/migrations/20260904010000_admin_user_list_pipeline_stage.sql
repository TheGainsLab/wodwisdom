-- Pipeline stage on the admin user list (founder design, 2026-09-04): every
-- user gets exactly ONE stage, computed LIVE at query time — no cron, no
-- materialized status column, nothing that can go stale (the database is the
-- source of truth; this just reads it). Precedence, first match wins:
--
--   subscriber       active paid entitlements, no cancellation scheduled
--   leaving          active paid entitlements, latest cancel-intent event is
--                    'cancel_scheduled' (access continues — the save window)
--   churned          no active entitlements, but a 'canceled'/'payment_churn'
--                    billing event exists (entitlement rows are DELETED at
--                    churn, so the billing ledger is the only durable signal)
--   checkout_started checkout_attempts row, never purchased (the
--                    abandoned-checkout recovery funnel)
--   emailed          the one automated eval follow-up went out; everything
--                    from here on is MANUAL outreach — this is the worklist
--   evaluated        completed a user-initiated eval; follow-up not yet sent
--                    (inside the 24-hour window — the personal-touch moment)
--   profile_started  athlete profile exists, no completed eval
--   signed_up        account only
--
-- admin_user_list_v2 is reproduced VERBATIM from its latest form
-- (20260827000000, funnel flags) with ONLY the pipeline_stage column
-- appended — the same discipline every previous revision used. Product
-- chips need no new column: the entitlements array is already returned.

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
  has_generated_program boolean,
  pipeline_stage text
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
    ) as has_generated_program,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM user_entitlements ue
        WHERE ue.user_id = p.id
          AND (ue.expires_at IS NULL OR ue.expires_at > NOW())
          AND ue.source NOT IN ('manual', 'admin')
          AND ue.source_kind <> 'gym_grant'
      ) THEN
        CASE WHEN (
          SELECT be.event_type FROM billing_events be
          WHERE be.user_id = p.id
            AND be.event_type IN ('cancel_scheduled', 'cancel_unscheduled')
          ORDER BY be.created_at DESC LIMIT 1
        ) = 'cancel_scheduled' THEN 'leaving' ELSE 'subscriber' END
      WHEN EXISTS (
        SELECT 1 FROM billing_events be
        WHERE be.user_id = p.id AND be.event_type IN ('canceled', 'payment_churn')
      ) THEN 'churned'
      WHEN EXISTS (
        SELECT 1 FROM checkout_attempts ca WHERE ca.user_id = p.id
      ) THEN 'checkout_started'
      WHEN EXISTS (
        SELECT 1 FROM email_sends es2
        WHERE es2.user_id = p.id
          AND es2.template_key = 'eval_followup'
          AND es2.status <> 'failed'
      ) THEN 'emailed'
      WHEN EXISTS (
        SELECT 1 FROM profile_evaluations pe2
        WHERE pe2.user_id = p.id
          AND pe2.status = 'complete'
          AND pe2.initiated_by = 'user'
      ) THEN 'evaluated'
      WHEN ap.user_id IS NOT NULL THEN 'profile_started'
      ELSE 'signed_up'
    END as pipeline_stage
  FROM profiles p
  JOIN auth.users au ON au.id = p.id
  LEFT JOIN athlete_profiles ap ON ap.user_id = p.id
  ORDER BY last_active DESC NULLS LAST;
END;
$func$;

REVOKE ALL ON FUNCTION admin_user_list_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_user_list_v2() TO authenticated;
