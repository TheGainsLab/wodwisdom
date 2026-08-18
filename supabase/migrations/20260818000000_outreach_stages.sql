-- Outreach worklist: replace the binary has_profile flag with the athlete's
-- actual stopping point, so the founder's manual emails can speak to where
-- each person actually stalled (founder request, 2026-08-18).
--
-- stage ∈
--   no_activity        — no athlete_profiles row at all
--   started_basics     — profile row exists, T1 basics incomplete
--   needs_lifts        — basics done, one or more of the 5 required lifts missing
--   needs_conditioning — lifts done, missing the 2k row and/or a run time
--                        (the relaxed Aug '26 gate: 2k + mile-or-5k)
--   eval_ready         — everything's in; they just never ran the evaluation
--
-- The stage CASE mirrors getTierStatus (tier-status.ts) for the fields that
-- gate the eval: basics + required lifts + required conditioning. Skills are
-- ignored — the app auto-defaults unrated skills to 'none' at tier-check
-- time, so they never block. Lift values are checked type-safely
-- (jsonb_typeof = 'number') so a malformed value degrades to "missing"
-- instead of failing the cast; required conditioning keys are times stored
-- as strings — non-empty, non-zero text counts as set.
--
-- The function's return signature changes, so DROP + CREATE (CREATE OR
-- REPLACE cannot change OUT parameters).

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
  handled_at timestamptz
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
        AND (es.campaign_key = 'eval_outreach' OR es.template_key = 'eval_reminder'))
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
