-- Eval follow-up moves to the 24-hour design (founder ruling, 2026-09-04):
--
--   eval completes -> founder alert (unchanged, instant) -> ONE automated
--   follow-up ~24h later if they haven't purchased -> everything after that
--   is manual outreach.
--
-- Two changes to eval_followup_candidates, both in the WHERE clause:
--
--   1. Window: was 2-21 days, now 24 hours-7 days. The lower bound is the
--      product decision; the 7-day ceiling is a safety valve so a stalled
--      cron can't wake up and email month-old leads. Pair with the pg_cron
--      reschedule to hourly ('0 * * * *') or "24 hours" is really 24-48.
--   2. The 5-day any-email cadence cap is GONE. It implemented the old
--      manual-first design (founder note delays the auto email); the new
--      design sends the auto email first, so nothing may delay it. The
--      one-shot template guard below still caps every lead at exactly one.
--
-- Unchanged guards: user-initiated complete evals only, no active
-- entitlement (the "haven't purchased" rule), no checkout attempt (those
-- leads are in the abandoned-checkout recovery funnel), opt-out, non-admin,
-- one eval_followup ever.
CREATE OR REPLACE FUNCTION public.eval_followup_candidates(p_limit int DEFAULT 25)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH evaluated AS (
    SELECT pe.user_id AS uid, MAX(pe.created_at) AS last_eval
    FROM profile_evaluations pe
    WHERE pe.initiated_by = 'user' AND pe.status = 'complete'
    GROUP BY pe.user_id
    HAVING MAX(pe.created_at) BETWEEN now() - interval '7 days' AND now() - interval '24 hours'
  )
  SELECT p.id, p.email, p.full_name
  FROM evaluated ev
  JOIN profiles p ON p.id = ev.uid
  WHERE p.email IS NOT NULL
    AND NOT p.email_opt_out
    AND COALESCE(p.role, 'user') <> 'admin'
    AND NOT EXISTS (
      SELECT 1 FROM user_entitlements ue
      WHERE ue.user_id = p.id
        AND (ue.expires_at IS NULL OR ue.expires_at > now())
    )
    AND NOT EXISTS (SELECT 1 FROM checkout_attempts ca WHERE ca.user_id = p.id)
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = p.id
        AND es.template_key = 'eval_followup'
        AND es.status <> 'failed'
    )
  ORDER BY ev.last_eval ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.eval_followup_candidates(int) FROM public, anon, authenticated;
