-- Weekly digest (founder-facing): one RPC returning the week's numbers as
-- jsonb. Reviewed 2026-07-18; fixes carried here:
--   - purchases counted by COMPLETION date (completed_at), not session-open
--     date, so a checkout opened last week that closes this week counts
--   - abandoners/quiet lists ship a true total alongside the capped list
--   - email stats exclude status='failed' rows (a failed send is not a send)

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
        -- by COMPLETION date: cross-week purchases count in the week they close
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
    'quiet', (
      WITH quiet_users AS (
        SELECT p.email
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
        GROUP BY p.email
      )
      SELECT jsonb_build_object(
        'total', (SELECT COUNT(*) FROM quiet_users),
        'sample', (SELECT COALESCE(jsonb_agg(q.email), '[]'::jsonb) FROM (SELECT email FROM quiet_users LIMIT 10) q)
      )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.weekly_digest_stats() FROM public, anon, authenticated;
