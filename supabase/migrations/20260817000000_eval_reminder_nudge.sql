-- Sweep 5: evaluation reminder — accounts that never ran their free eval.
--
-- The gap between the existing sweeps (founder request, 2026-08-17): the
-- welcome nudge catches did-nothings at 36h and caps at 7 days; eval_followup
-- catches people who COMPLETED an eval. Nobody reaches the middle — created
-- an account, maybe started the profile, never ran the evaluation. Once past
-- day 7 they never hear from us again.
--
-- DELIBERATE departure from the window-bounded principle: this sweep has NO
-- upper age bound, because its whole point is reaching the historical backlog
-- of stalled accounts. Safety comes from the other guards instead:
--   - one-shot per user via email_sends (template_key 'eval_reminder',
--     failed rows ignored so transient Resend outages retry)
--   - global 5-day cadence cap, so it never stacks on another sweep
--   - p_limit batches per daily run, so the backlog drains gradually
--     (protects sender reputation) instead of blasting at once
--   - newest accounts first (created_at DESC): warmer leads convert better
--     and older addresses carry higher bounce risk
--
-- Exclusions: opted out, unconfirmed, admins, anyone who ever paid
-- (stripe_customer_id / completed checkout / any entitlement) — a churned
-- subscriber must not get a free-eval prospect pitch.
--
-- The hook is honest product news: the intake was relaxed in Aug '26
-- (2k row + one run instead of all seven conditioning benchmarks), so
-- "finish your evaluation" now asks meaningfully less than when they stalled.

CREATE OR REPLACE FUNCTION public.eval_reminder_candidates(p_limit int DEFAULT 25)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.id, p.email, p.full_name
  FROM auth.users au
  JOIN profiles p ON p.id = au.id
  WHERE au.created_at < now() - interval '7 days'
    AND au.email_confirmed_at IS NOT NULL
    AND p.email IS NOT NULL
    AND NOT p.email_opt_out
    AND COALESCE(p.role, 'user') <> 'admin'
    AND p.stripe_customer_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM profile_evaluations pe WHERE pe.user_id = au.id)
    AND NOT EXISTS (
      SELECT 1 FROM user_entitlements ue WHERE ue.user_id = au.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM checkout_attempts ca
      WHERE ca.user_id = au.id AND ca.status = 'completed'
    )
    -- one-shot: never successfully sent this template
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = au.id
        AND es.template_key = 'eval_reminder'
        AND es.status <> 'failed'
    )
    -- manual outreach counts as this stage's touch: sends from the in-app
    -- composer tagged campaign_key='eval_outreach' permanently satisfy the
    -- sweep (the founder's manual pass IS the eval reminder for that user).
    -- Untagged manual sends deliberately do NOT suppress — a support reply
    -- must never mute the funnel; they only feed the 5-day cadence cap.
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = au.id
        AND es.campaign_key = 'eval_outreach'
        AND es.status <> 'failed'
    )
    -- cadence cap: no successful email of any kind in the last 5 days
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = au.id
        AND es.status <> 'failed'
        AND es.sent_at >= now() - interval '5 days'
    )
  ORDER BY au.created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.eval_reminder_candidates(int) FROM public, anon, authenticated;

-- ── Admin outreach worklist ─────────────────────────────────────────────────
-- "Who needs an email?" — the no-eval cohort as a workable list for the
-- founder's manual outreach pass (/admin/outreach). Broader than the sweep's
-- candidates on purpose: no age bound, and unconfirmed accounts are INCLUDED
-- (badged in the UI) because a human can decide to email them even though
-- automation never will. Hard exclusions only: opted out, admins, ever-paid.
-- handled = a tagged outreach send OR the automated eval_reminder went out,
-- so the list doubles as a coverage view once the sweep is live.
-- Pattern mirrors admin_activity_feed: SECURITY DEFINER + internal admin
-- check + access log, granted to authenticated.

CREATE OR REPLACE FUNCTION public.admin_outreach_list()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  signup_date timestamptz,
  email_confirmed boolean,
  has_profile boolean,
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
    EXISTS (SELECT 1 FROM athlete_profiles ap WHERE ap.user_id = au.id),
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
