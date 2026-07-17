-- Weekly digest (founder-facing): one RPC returning the week's numbers as
-- jsonb. The weekly-digest edge function (pg_cron, Monday) formats and
-- emails it to the founder. Everything derives from the platform's own
-- tables — no Stripe API calls; MRR/churn enrichment is a later rev.
--
-- Sections:
--   funnel      — signups, confirmations implied, evals, checkout opens /
--                 completions / conversion, this week vs the numbers' own
--                 denominators
--   abandoners  — identities that opened checkout this week, never completed
--                 anything, hold no entitlement (the personal-outreach list)
--   emails      — per-template sent / opened for the week (Resend webhook
--                 writes opened/clicked back onto email_sends)
--   ratings     — thumbs-down count this week
--   quiet       — entitled users with no activity in 14 days (churn watch)

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
        'opened', COUNT(*),
        'people', COUNT(DISTINCT COALESCE(ca.user_id::text, ca.email)),
        'completed', COUNT(*) FILTER (WHERE ca.status = 'completed'),
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
      FROM checkout_attempts ca
      WHERE ca.created_at >= now() - interval '7 days'
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
        'template', t.template_key, 'sent', t.sent, 'opened', t.opened)), '[]'::jsonb)
      FROM (
        SELECT
          es.template_key,
          COUNT(*) AS sent,
          COUNT(*) FILTER (WHERE es.status IN ('opened', 'clicked')) AS opened
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
    'quiet_subscribers', (
      SELECT COALESCE(jsonb_agg(t.email), '[]'::jsonb)
      FROM (
        SELECT DISTINCT p.email
        FROM profiles p
        JOIN user_entitlements ue ON ue.user_id = p.id
          AND (ue.expires_at IS NULL OR ue.expires_at > now())
        WHERE COALESCE(p.role, 'user') <> 'admin'
          AND GREATEST(
            COALESCE((SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.user_id = p.id), 'epoch'::timestamptz),
            COALESCE((SELECT MAX(fe.created_at) FROM food_entries fe WHERE fe.user_id = p.id), 'epoch'::timestamptz),
            COALESCE((SELECT MAX(es2.created_at) FROM engine_workout_sessions es2 WHERE es2.user_id = p.id), 'epoch'::timestamptz),
            COALESCE((SELECT MAX(wl.created_at) FROM workout_logs wl WHERE wl.user_id = p.id), 'epoch'::timestamptz)
          ) < now() - interval '14 days'
        LIMIT 10
      ) t
    )
  );
$$;

REVOKE ALL ON FUNCTION public.weekly_digest_stats() FROM public;
REVOKE ALL ON FUNCTION public.weekly_digest_stats() FROM anon;
REVOKE ALL ON FUNCTION public.weekly_digest_stats() FROM authenticated;
