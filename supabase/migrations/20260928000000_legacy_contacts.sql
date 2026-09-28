-- Past-user detection (founder request, 2026-09-28): customers from the
-- previous platforms live in Resend Audiences. The sync-resend-audiences
-- edge function snapshots every audience's contacts into legacy_contacts
-- (service role only), and app accounts are matched by normalized email —
-- so the admin panel can mark a signup as a returning past customer.
--
-- Emails are stored lowercased/trimmed at write time; every match here
-- compares against lower(profiles.email).

CREATE TABLE IF NOT EXISTS public.legacy_contacts (
  email text NOT NULL,
  audience_id text NOT NULL,
  audience_name text,
  first_name text,
  last_name text,
  unsubscribed boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, audience_id)
);

COMMENT ON TABLE public.legacy_contacts IS
  'Snapshot of Resend Audience contacts (past-platform customers). Written only by the sync-resend-audiences edge function with the service role; read through admin RPCs.';

-- Service-role only: RLS on, no policies.
ALTER TABLE public.legacy_contacts ENABLE ROW LEVEL SECURITY;

-- ── Per-user lookup for the admin user detail page ──────────────────
CREATE OR REPLACE FUNCTION public.admin_past_user_audiences(target_user_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result text[];
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT COALESCE(lc.audience_name, lc.audience_id) ORDER BY COALESCE(lc.audience_name, lc.audience_id))
  INTO result
  FROM legacy_contacts lc
  JOIN profiles p ON lower(p.email) = lc.email
  WHERE p.id = target_user_id;

  RETURN COALESCE(result, '{}');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_past_user_audiences(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_past_user_audiences(uuid) TO authenticated;

-- ── Sync stats for the Ops page card ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_legacy_contacts_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'contacts', (SELECT count(DISTINCT email) FROM legacy_contacts),
    'audiences', (SELECT count(DISTINCT audience_id) FROM legacy_contacts),
    'matched_users', (
      SELECT count(DISTINCT p.id)
      FROM profiles p
      JOIN legacy_contacts lc ON lc.email = lower(p.email)
    ),
    'last_synced', (SELECT max(synced_at) FROM legacy_contacts)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_legacy_contacts_stats() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_legacy_contacts_stats() TO authenticated;

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
  past_user boolean
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
