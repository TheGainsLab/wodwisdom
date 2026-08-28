-- Warm-lead flow for completed evaluations (founder design, 2026-08-28):
--
--   1. A USER-initiated evaluation completing fires an inbox alert to the
--      founder (profile-analysis sends it — no schema needed).
--   2. The founder sends a personal note from the admin composer (logged in
--      email_sends like every send).
--   3. ONE automated, eval-aware follow-up per lead: day 2-3 when no manual
--      note was sent; otherwise 5 days after the founder's note (the
--      existing any-email cadence cap implements the wait — a manual send
--      inside the window pushes the auto email out past it).
--
-- Two schema pieces:
--
-- initiated_by distinguishes evals a person ran from evals the machinery ran
-- (admin regenerations via service curl, monthly continuations). Only 'user'
-- evals alert the founder or enter the follow-up window — so backfills and
-- prompt-version regenerations never trigger the funnel. Existing rows
-- default to 'user': anything older than the window is inert anyway.
--
-- eval_followup_candidates changes: user-initiated evals only, and the upper
-- window widens 7d -> 21d so a founder note on day 5 doesn't push the lead
-- out of eligibility before the 5-day quiet period ends. The once-ever
-- eval_followup guard still caps every lead at exactly one automated email.

ALTER TABLE profile_evaluations
  ADD COLUMN IF NOT EXISTS initiated_by text NOT NULL DEFAULT 'user'
  CHECK (initiated_by IN ('user', 'service'));

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
    HAVING MAX(pe.created_at) BETWEEN now() - interval '21 days' AND now() - interval '2 days'
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
    -- cadence cap: no successful email of any kind in the last 5 days.
    -- This is also the "wait 5 days after the founder's manual note" rule.
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = p.id
        AND es.status <> 'failed'
        AND es.sent_at >= now() - interval '5 days'
    )
  ORDER BY ev.last_eval ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.eval_followup_candidates(int) FROM public, anon, authenticated;
