-- Surface the past-platform unsubscribe on the outreach worklist
-- (founder request, 2026-09-28): someone who unsubscribed on the old
-- platform said something the app's own email_opt_out can't see — show
-- it before a manual email goes out. Same body as
-- 20260928000000_legacy_contacts.sql's version plus one column;
-- signature changes, so DROP + CREATE.

-- ── Outreach worklist: surface the past-user flag per row ───────────
-- Same body as 20260818000000_outreach_stages.sql plus one column
-- (past_user). Return signature changes, so DROP + CREATE.

DROP FUNCTION IF EXISTS public.admin_outreach_list();

CREATE FUNCTION public.admin_outreach_list()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  signup_date timestamptz,
  email_confirmed boolean,
  stage text,
  last_email_at timestamptz,
  handled boolean,
  handled_at timestamptz,
  past_user boolean,
  past_user_unsubscribed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM log_admin_access(
    '00000000-0000-0000-0000-000000000000'::uuid,
    'outreach_list',
    '{}'::jsonb
  );

  RETURN QUERY
  SELECT
    au.id,
    p.email,
    p.full_name,
    au.created_at,
    (au.email_confirmed_at IS NOT NULL),
    CASE
      WHEN ap.user_id IS NULL THEN 'no_activity'
      WHEN NOT (
        COALESCE(ap.age, 0) > 0
        AND COALESCE(ap.height, 0) > 0
        AND COALESCE(ap.bodyweight, 0) > 0
        AND btrim(COALESCE(ap.gender, '')) <> ''
        AND btrim(COALESCE(ap.units, '')) <> ''
      ) THEN 'started_basics'
      WHEN NOT (
        (jsonb_typeof(ap.lifts -> 'back_squat') = 'number' AND (ap.lifts ->> 'back_squat')::numeric > 0)
        AND (jsonb_typeof(ap.lifts -> 'deadlift') = 'number' AND (ap.lifts ->> 'deadlift')::numeric > 0)
        AND (jsonb_typeof(ap.lifts -> 'bench_press') = 'number' AND (ap.lifts ->> 'bench_press')::numeric > 0)
        AND (jsonb_typeof(ap.lifts -> 'snatch') = 'number' AND (ap.lifts ->> 'snatch')::numeric > 0)
        AND (jsonb_typeof(ap.lifts -> 'clean_and_jerk') = 'number' AND (ap.lifts ->> 'clean_and_jerk')::numeric > 0)
      ) THEN 'needs_lifts'
      WHEN NOT (
        btrim(COALESCE(ap.conditioning ->> '2k_row', '')) NOT IN ('', '0')
        AND (
          btrim(COALESCE(ap.conditioning ->> '1_mile_run', '')) NOT IN ('', '0')
          OR btrim(COALESCE(ap.conditioning ->> '5k_run', '')) NOT IN ('', '0')
        )
      ) THEN 'needs_conditioning'
      ELSE 'eval_ready'
    END,
    (SELECT MAX(es.sent_at) FROM email_sends es
      WHERE es.user_id = au.id AND es.status <> 'failed'),
    EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = au.id
        AND es.status <> 'failed'
        AND (es.campaign_key = 'eval_outreach' OR es.template_key = 'eval_reminder')
    ),
    (SELECT MAX(es.sent_at) FROM email_sends es
      WHERE es.user_id = au.id
        AND es.status <> 'failed'
        AND (es.campaign_key = 'eval_outreach' OR es.template_key = 'eval_reminder')),
    EXISTS (
      SELECT 1 FROM legacy_contacts lc WHERE lc.email = lower(p.email)
    ),
    EXISTS (
      SELECT 1 FROM legacy_contacts lc
      WHERE lc.email = lower(p.email) AND lc.unsubscribed
    )
  FROM auth.users au
  JOIN profiles p ON p.id = au.id
  LEFT JOIN athlete_profiles ap ON ap.user_id = au.id
  WHERE p.email IS NOT NULL
    AND NOT p.email_opt_out
    AND COALESCE(p.role, 'user') <> 'admin'
    AND p.stripe_customer_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM profile_evaluations pe WHERE pe.user_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM user_entitlements ue WHERE ue.user_id = au.id)
    AND NOT EXISTS (
      SELECT 1 FROM checkout_attempts ca
      WHERE ca.user_id = au.id AND ca.status = 'completed'
    )
  -- unhandled first; within each group, newest signups first (warmer leads)
  ORDER BY 8 ASC, 4 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_outreach_list() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_outreach_list() TO authenticated;
