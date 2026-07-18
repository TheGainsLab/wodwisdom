-- Engagement split + logging nudge (founder, 2026-07-18): "users who do the
-- training and never log it are everywhere in every system I ever had."
--
-- Two pieces:
--   1. The weekly digest's quiet-subscriber list splits on last_sign_in_at:
--      "not logging" (signed in within 14d, nothing logged — training or at
--      least engaging without recording) vs "ghosting" (no sign-ins either —
--      actually gone). Different diseases, different responses.
--   2. Sweep #4 (logging_nudge): entitled Engine/Programming users who
--      signed in this week but haven't logged a session in 14+ days get the
--      coaching argument — targets only adapt to what they see. Recurs at
--      most every 45 days while the condition persists (a retention nudge is
--      allowed to repeat, gently), plus the global 5-day cadence cap.

-- ── Sweep 4: logging nudge ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.logging_nudge_candidates(p_limit int DEFAULT 25)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.email, p.full_name
  FROM profiles p
  JOIN auth.users au ON au.id = p.id
  WHERE p.email IS NOT NULL
    AND NOT p.email_opt_out
    AND COALESCE(p.role, 'user') <> 'admin'
    -- training products only: a nutrition-only subscriber has no "sessions" to log
    AND EXISTS (
      SELECT 1 FROM user_entitlements ue
      WHERE ue.user_id = p.id
        AND ue.feature IN ('engine', 'programming')
        AND (ue.expires_at IS NULL OR ue.expires_at > now())
    )
    -- engaged: signed in within the past 7 days
    AND au.last_sign_in_at >= now() - interval '7 days'
    -- ...but no TRAINING logged in 14+ days (never counts too)
    AND GREATEST(
      COALESCE((SELECT MAX(es2.created_at) FROM engine_workout_sessions es2 WHERE es2.user_id = p.id), 'epoch'::timestamptz),
      COALESCE((SELECT MAX(wl.created_at) FROM workout_logs wl WHERE wl.user_id = p.id), 'epoch'::timestamptz)
    ) < now() - interval '14 days'
    -- gentle recurrence: at most one logging nudge per 45 days
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = p.id
        AND es.template_key = 'logging_nudge'
        AND es.status <> 'failed'
        AND es.sent_at >= now() - interval '45 days'
    )
    -- global cadence cap: no successful email of any kind in the last 5 days
    AND NOT EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.user_id = p.id
        AND es.status <> 'failed'
        AND es.sent_at >= now() - interval '5 days'
    )
  ORDER BY au.last_sign_in_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.logging_nudge_candidates(int) FROM public, anon, authenticated;

-- ── Digest: split quiet subscribers by sign-in recency ──────────────────────

CREATE OR REPLACE FUNCTION public.weekly_digest_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'signups_7d', (
      SELECT COUNT(*) FROM auth.users au WHERE au.created_at >= now() - interval '7 days'
    ),
    'evals_7d', (
      SELECT COUNT(*) FROM profile_evaluations pe WHERE pe.created_at >= now() - interval '7 days'
    ),
    'checkouts', (
      SELECT jsonb_build_object(
        'opened', (
          SELECT COUNT(*) FROM checkout_attempts ca
          WHERE ca.created_at >= now() - interval '7 days'
        ),
        'people', (
          SELECT COUNT(DISTINCT COALESCE(ca.user_id::text, ca.email)) FROM checkout_attempts ca
          WHERE ca.created_at >= now() - interval '7 days'
        ),
        'completed', (
          SELECT COUNT(*) FROM checkout_attempts ca
          WHERE ca.status = 'completed'
            AND ca.completed_at >= now() - interval '7 days'
        ),
        'by_plan', (
          SELECT COALESCE(jsonb_object_agg(plan, cnt), '{}'::jsonb)
          FROM (
            SELECT ca2.plan, COUNT(*) AS cnt
            FROM checkout_attempts ca2
            WHERE ca2.created_at >= now() - interval '7 days'
            GROUP BY ca2.plan
          ) t
        )
      )
    ),
    'abandoners_total', (
      SELECT COUNT(DISTINCT COALESCE(ca.email, ca.user_id::text))
      FROM checkout_attempts ca
      WHERE ca.created_at >= now() - interval '7 days'
        AND ca.status <> 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM checkout_attempts done
          WHERE done.status = 'completed'
            AND (
              (ca.user_id IS NOT NULL AND done.user_id = ca.user_id)
              OR (ca.user_id IS NULL AND ca.email IS NOT NULL AND done.email = ca.email)
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_entitlements ue
          WHERE ue.user_id = ca.user_id
            AND (ue.expires_at IS NULL OR ue.expires_at > now())
        )
    ),
    'abandoners', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('email', t.email, 'plans', t.plans)), '[]'::jsonb)
      FROM (
        SELECT
          COALESCE(ca.email, '(no email)') AS email,
          array_agg(DISTINCT ca.plan) AS plans
        FROM checkout_attempts ca
        WHERE ca.created_at >= now() - interval '7 days'
          AND ca.status <> 'completed'
          AND NOT EXISTS (
            SELECT 1 FROM checkout_attempts done
            WHERE done.status = 'completed'
              AND (
                (ca.user_id IS NOT NULL AND done.user_id = ca.user_id)
                OR (ca.user_id IS NULL AND ca.email IS NOT NULL AND done.email = ca.email)
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM user_entitlements ue
            WHERE ue.user_id = ca.user_id
              AND (ue.expires_at IS NULL OR ue.expires_at > now())
          )
        GROUP BY COALESCE(ca.email, '(no email)')
        LIMIT 15
      ) t
    ),
    'emails', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'template', t.template_key, 'sent', t.sent, 'opened', t.opened, 'failed', t.failed)), '[]'::jsonb)
      FROM (
        SELECT
          es.template_key,
          COUNT(*) FILTER (WHERE es.status <> 'failed') AS sent,
          COUNT(*) FILTER (WHERE es.status IN ('opened', 'clicked')) AS opened,
          COUNT(*) FILTER (WHERE es.status = 'failed') AS failed
        FROM email_sends es
        WHERE es.sent_at >= now() - interval '7 days'
        GROUP BY es.template_key
        ORDER BY COUNT(*) DESC
      ) t
    ),
    'thumbs_down_7d', (
      SELECT COUNT(*) FROM chat_message_ratings r
      WHERE r.rating = -1 AND r.created_at >= now() - interval '7 days'
    ),
    -- Quiet subscribers, split by the sign-in discriminator:
    --   not_logging — signed in within 14d but nothing logged (training
    --                 without recording, or browsing without training)
    --   ghosting    — no sign-ins either; actually gone
    'engagement', (
      WITH quiet_users AS (
        SELECT p.email, (au.last_sign_in_at >= now() - interval '14 days') AS signed_in_recently
        FROM profiles p
        JOIN auth.users au ON au.id = p.id
        JOIN user_entitlements ue ON ue.user_id = p.id
          AND (ue.expires_at IS NULL OR ue.expires_at > now())
        WHERE COALESCE(p.role, 'user') <> 'admin'
          AND GREATEST(
            COALESCE((SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.user_id = p.id), 'epoch'::timestamptz),
            COALESCE((SELECT MAX(fe.created_at) FROM food_entries fe WHERE fe.user_id = p.id), 'epoch'::timestamptz),
            COALESCE((SELECT MAX(es2.created_at) FROM engine_workout_sessions es2 WHERE es2.user_id = p.id), 'epoch'::timestamptz),
            COALESCE((SELECT MAX(wl.created_at) FROM workout_logs wl WHERE wl.user_id = p.id), 'epoch'::timestamptz)
          ) < now() - interval '14 days'
        GROUP BY p.email, au.last_sign_in_at
      )
      SELECT jsonb_build_object(
        'not_logging_total', (SELECT COUNT(*) FROM quiet_users WHERE signed_in_recently),
        'not_logging', (
          SELECT COALESCE(jsonb_agg(q.email), '[]'::jsonb)
          FROM (SELECT email FROM quiet_users WHERE signed_in_recently LIMIT 10) q
        ),
        'ghosting_total', (SELECT COUNT(*) FROM quiet_users WHERE NOT signed_in_recently),
        'ghosting', (
          SELECT COALESCE(jsonb_agg(q.email), '[]'::jsonb)
          FROM (SELECT email FROM quiet_users WHERE NOT signed_in_recently LIMIT 10) q
        )
      )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.weekly_digest_stats() FROM public, anon, authenticated;
