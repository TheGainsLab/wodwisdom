-- Welcome nudge (lifecycle automation #1): users who create an account,
-- confirm their email, and then do NOTHING get one automated email (~36h in)
-- describing the free features — the founder was sending this by hand.
--
-- This RPC returns the day's candidates; the welcome-nudge edge function
-- (pg_cron, daily) sends and logs. Safety is in the WHERE clause:
--   - only accounts 36h–7d old: the query physically cannot see the
--     historical user base (same principle as checkout recovery)
--   - email confirmed only (unconfirmed = probably spam, never proven inbox)
--   - zero activity: no entitlement, no checkout, no chat question, no
--     athlete profile, no logged workout — any of those puts the user in a
--     different funnel (or none)
--   - zero prior emails of ANY kind (email_sends), so nobody the founder
--     already wrote to by hand gets a robot echo, and the send itself
--     (logged as template welcome_nudge) makes the RPC one-shot per user

CREATE OR REPLACE FUNCTION public.welcome_nudge_candidates(p_limit int DEFAULT 25)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.id, p.email, p.full_name
  FROM auth.users au
  JOIN profiles p ON p.id = au.id
  WHERE au.created_at BETWEEN now() - interval '7 days' AND now() - interval '36 hours'
    AND au.email_confirmed_at IS NOT NULL
    AND p.email IS NOT NULL
    AND COALESCE(p.role, 'user') <> 'admin'
    AND NOT EXISTS (SELECT 1 FROM user_entitlements ue WHERE ue.user_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM checkout_attempts ca WHERE ca.user_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.user_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM athlete_profiles ap WHERE ap.user_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM workout_logs wl WHERE wl.user_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM email_sends es WHERE es.user_id = au.id)
  ORDER BY au.created_at ASC
  LIMIT p_limit;
$$;

-- Service-role only (the edge function); never client-callable.
REVOKE ALL ON FUNCTION public.welcome_nudge_candidates(int) FROM public;
REVOKE ALL ON FUNCTION public.welcome_nudge_candidates(int) FROM anon;
REVOKE ALL ON FUNCTION public.welcome_nudge_candidates(int) FROM authenticated;

-- Sweep #2: free-limit nudge. Users who asked their 3rd (final) free AI
-- Coach question RECENTLY and hold no entitlement — the highest-intent
-- moment in the funnel (actively using the product when it said no).
--   - >= 3 chat messages AND the latest within the past 7 days: a user
--     blocked at the limit can't create new rows, so old limit-hitters from
--     the historical base have stale MAX(created_at) and never match
--   - no ACTIVE entitlement (subscribed-since-limit users are skipped)
--   - one-shot via email_sends template_key = 'free_limit_nudge' (other
--     templates — e.g. the welcome nudge — don't block this one)

CREATE OR REPLACE FUNCTION public.free_limit_candidates(p_limit int DEFAULT 25)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.email, p.full_name
  FROM profiles p
  WHERE p.email IS NOT NULL
    AND COALESCE(p.role, 'user') <> 'admin'
    AND (
      SELECT COUNT(*) FROM chat_messages cm WHERE cm.user_id = p.id
    ) >= 3
    AND (
      SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.user_id = p.id
    ) >= now() - interval '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM user_entitlements ue
      WHERE ue.user_id = p.id
        AND (ue.expires_at IS NULL OR ue.expires_at > now())
    )
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = p.id AND es.template_key = 'free_limit_nudge'
    )
  ORDER BY (SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.user_id = p.id) ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.free_limit_candidates(int) FROM public;
REVOKE ALL ON FUNCTION public.free_limit_candidates(int) FROM anon;
REVOKE ALL ON FUNCTION public.free_limit_candidates(int) FROM authenticated;
