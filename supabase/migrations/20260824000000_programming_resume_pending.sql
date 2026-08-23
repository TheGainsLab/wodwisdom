-- Returner pause: re-subscribing programming users review their numbers
-- before month N+1 builds.
--
-- The stripe webhook detects a re-subscriber (billing_reason=subscription_create
-- + an existing generated program) and, instead of generating immediately from
-- a profile they haven't looked at since they left, sets
-- programming_resume_pending_at. The Athlete page shows the welcome-back
-- banner + "Build my next month"; generate-next-month clears the flag when a
-- generation kicks off (athlete tap, admin, or the reconciler's 7-day
-- fallback). The drip cron and reconciler both defer to the flag.
--
-- resume_nudge_candidates feeds the lifecycle sweep: one row per pending
-- returner past p_min_days, standard safety model (opt-out, one-shot per
-- template via email_sends ignoring failed, 5-day cadence cap). Two templates
-- share it: resume_nudge_1 (day 2) and resume_nudge_2 (day 5).

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS programming_resume_pending_at timestamptz;

CREATE OR REPLACE FUNCTION public.resume_nudge_candidates(
  p_template_key text,
  p_min_days int,
  p_limit int DEFAULT 25
)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ap.user_id, p.email, p.full_name
  FROM athlete_profiles ap
  JOIN profiles p ON p.id = ap.user_id
  WHERE ap.programming_resume_pending_at IS NOT NULL
    AND ap.programming_resume_pending_at < now() - make_interval(days => p_min_days)
    -- the 7-day reconciler fallback owns anyone older than a week
    AND ap.programming_resume_pending_at > now() - interval '7 days'
    AND p.email IS NOT NULL
    AND NOT p.email_opt_out
    AND COALESCE(p.role, 'user') <> 'admin'
    -- one-shot: never successfully sent this template for THIS pending spell
    -- (sent_at after the flag was set, so a returner who lapses and returns
    -- again years later can be nudged again)
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = ap.user_id
        AND es.template_key = p_template_key
        AND es.status <> 'failed'
        AND es.sent_at >= ap.programming_resume_pending_at
    )
    -- cadence cap: no successful email of any kind in the last 2 days (tighter
    -- than the usual 5 so nudge 1 at day 2 doesn't mute nudge 2 at day 5)
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = ap.user_id
        AND es.status <> 'failed'
        AND es.sent_at >= now() - interval '2 days'
    )
  ORDER BY ap.programming_resume_pending_at ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.resume_nudge_candidates(text, int, int) FROM public, anon, authenticated;
