-- Lifecycle nudges: schema + candidate RPCs for the daily email sweep
-- (lifecycle-nudges edge function). Reviewed 2026-07-18; this file carries
-- the review fixes: opt-out compliance, the chat_messages index, failed-send
-- retry, ever-paid exclusion, and a global cadence cap.
--
-- Shared safety model (every sweep):
--   - window-bounded: the historical user base is physically invisible
--   - email confirmed / email present / not admin
--   - NOT opted out (profiles.email_opt_out — the unsubscribe link's target)
--   - one-shot per template via email_sends, IGNORING status='failed' rows,
--     so a transient Resend outage retries next run instead of permanently
--     suppressing the user
--   - cadence cap: no successful automated/manual email in the last 5 days
--     (welcome is stricter: none ever), so sweeps never stack

-- Opt-out flag: set by the email-unsubscribe endpoint, honored by every
-- candidate RPC and by the checkout-recovery sender.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_opt_out boolean NOT NULL DEFAULT false;

-- chat_messages had NO user_id index (only context_type/context_id) — every
-- per-user count/max was a full seq scan. This one index serves the
-- free-limit sweep, the digest's quiet-subscriber check, and the chat
-- function's own per-user counting.
CREATE INDEX IF NOT EXISTS idx_chat_messages_user
  ON chat_messages(user_id, created_at DESC);

-- ── Sweep 1: welcome nudge ──────────────────────────────────────────────────
-- Signed up 36h–7d ago, confirmed, did NOTHING, never emailed (any template).

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
    AND NOT p.email_opt_out
    AND COALESCE(p.role, 'user') <> 'admin'
    AND NOT EXISTS (SELECT 1 FROM user_entitlements ue WHERE ue.user_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM checkout_attempts ca WHERE ca.user_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.user_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM athlete_profiles ap WHERE ap.user_id = au.id)
    AND NOT EXISTS (SELECT 1 FROM workout_logs wl WHERE wl.user_id = au.id)
    -- never emailed — but a FAILED send is not a send; retry next run
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = au.id AND es.status <> 'failed'
    )
  ORDER BY au.created_at ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.welcome_nudge_candidates(int) FROM public, anon, authenticated;

-- ── Sweep 2: free-limit nudge ───────────────────────────────────────────────
-- Genuinely-free users who exhausted their 3 questions within the past 7
-- days. Drives FROM an aggregate of chat_messages (index-backed), not from
-- all profiles. Excludes anyone who has EVER paid: active entitlement,
-- stripe_customer_id on the profile (set at purchase, never cleared), or a
-- completed checkout — a churned subscriber with a recent question must NOT
-- be told they "used their three free questions".

CREATE OR REPLACE FUNCTION public.free_limit_candidates(p_limit int DEFAULT 25)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH hitters AS (
    SELECT cm.user_id AS uid, MAX(cm.created_at) AS last_q
    FROM chat_messages cm
    GROUP BY cm.user_id
    HAVING COUNT(*) >= 3
       AND MAX(cm.created_at) >= now() - interval '7 days'
  )
  SELECT p.id, p.email, p.full_name
  FROM hitters h
  JOIN profiles p ON p.id = h.uid
  WHERE p.email IS NOT NULL
    AND NOT p.email_opt_out
    AND COALESCE(p.role, 'user') <> 'admin'
    AND p.stripe_customer_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM user_entitlements ue
      WHERE ue.user_id = p.id
        AND (ue.expires_at IS NULL OR ue.expires_at > now())
    )
    AND NOT EXISTS (
      SELECT 1 FROM checkout_attempts ca
      WHERE ca.user_id = p.id AND ca.status = 'completed'
    )
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = p.id
        AND es.template_key = 'free_limit_nudge'
        AND es.status <> 'failed'
    )
    -- cadence cap: no successful email of any kind in the last 5 days
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = p.id
        AND es.status <> 'failed'
        AND es.sent_at >= now() - interval '5 days'
    )
  ORDER BY h.last_q ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.free_limit_candidates(int) FROM public, anon, authenticated;

-- ── Sweep 3: evaluation follow-up ───────────────────────────────────────────
-- Completed the free profile evaluation 2–7 days ago, then stalled. Drives
-- FROM an aggregate of profile_evaluations (index-backed), not all profiles.

CREATE OR REPLACE FUNCTION public.eval_followup_candidates(p_limit int DEFAULT 25)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH evaluated AS (
    SELECT pe.user_id AS uid, MAX(pe.created_at) AS last_eval
    FROM profile_evaluations pe
    GROUP BY pe.user_id
    HAVING MAX(pe.created_at) BETWEEN now() - interval '7 days' AND now() - interval '2 days'
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
    -- cadence cap: no successful email of any kind in the last 5 days
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

-- ── Opt-out setter for the email-unsubscribe endpoint ───────────────────────
-- Service-role only; the endpoint verifies its HMAC token before calling.

CREATE OR REPLACE FUNCTION public.set_email_opt_out(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles SET email_opt_out = true WHERE id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.set_email_opt_out(uuid) FROM public, anon, authenticated;
