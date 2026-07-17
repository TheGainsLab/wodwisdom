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
