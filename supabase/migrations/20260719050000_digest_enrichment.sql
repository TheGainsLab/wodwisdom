-- Digest enrichment (capture item C, 2026-07-18): make the captured data
-- readable. Adds to weekly_digest_stats:
--   acquisition   — the week's signups by first-touch source (item B's
--                   labels, read from auth.users.raw_user_meta_data)
--   recovery_wins — purchases this week that followed a checkout_recovery
--                   email to the same user (the automation's revenue)
--   chat_insights — the nightly classifier's output, finally read: topic
--                   mix, feature requests, complaints, buying-intent count
--   opt_outs_total, pwa (installs total/this week),
--   active_users (this week vs prior week — the one-number health trend)
-- Everything else unchanged from 20260719020000.

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
    'acquisition', (
      SELECT COALESCE(jsonb_object_agg(t.src, t.cnt), '{}'::jsonb)
      FROM (
        SELECT
          COALESCE(
            au.raw_user_meta_data->'acquisition'->>'source',
            au.raw_user_meta_data->'acquisition'->>'referrer',
            'direct/untagged'
          ) AS src,
          COUNT(*) AS cnt
        FROM auth.users au
        WHERE au.created_at >= now() - interval '7 days'
        GROUP BY 1
      ) t
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
    'recovery_wins', (
      SELECT COUNT(*)
      FROM checkout_attempts done
      WHERE done.status = 'completed'
        AND done.completed_at >= now() - interval '7 days'
        AND done.user_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM email_sends es
          WHERE es.user_id = done.user_id
            AND es.template_key = 'checkout_recovery'
            AND es.status <> 'failed'
            AND es.sent_at < done.completed_at
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
    'chat_insights', (
      SELECT jsonb_build_object(
        'topics', COALESCE((
          SELECT jsonb_object_agg(t.topic, t.cnt)
          FROM (
            SELECT cqi.topic, COUNT(*) AS cnt
            FROM chat_question_insights cqi
            JOIN chat_messages cm ON cm.id = cqi.message_id
            WHERE cm.created_at >= now() - interval '7 days'
            GROUP BY cqi.topic
          ) t
        ), '{}'::jsonb),
        'feature_requests', (
          SELECT COUNT(*) FROM chat_question_insights cqi
          JOIN chat_messages cm ON cm.id = cqi.message_id
          WHERE cm.created_at >= now() - interval '7 days' AND cqi.intent = 'feature_request'
        ),
        'complaints', (
          SELECT COUNT(*) FROM chat_question_insights cqi
          JOIN chat_messages cm ON cm.id = cqi.message_id
          WHERE cm.created_at >= now() - interval '7 days' AND cqi.intent = 'complaint'
        ),
        'buying_intent', (
          SELECT COUNT(*) FROM chat_question_insights cqi
          JOIN chat_messages cm ON cm.id = cqi.message_id
          WHERE cm.created_at >= now() - interval '7 days' AND cqi.buying_intent
        )
      )
    ),
    'thumbs_down_7d', (
      SELECT COUNT(*) FROM chat_message_ratings r
      WHERE r.rating = -1 AND r.created_at >= now() - interval '7 days'
    ),
    'opt_outs_total', (
      SELECT COUNT(*) FROM profiles p WHERE p.email_opt_out
    ),
    'pwa', (
      SELECT jsonb_build_object(
        'installed_total', COUNT(*) FILTER (WHERE p.pwa_installed_at IS NOT NULL),
        'installed_7d', COUNT(*) FILTER (WHERE p.pwa_installed_at >= now() - interval '7 days')
      ) FROM profiles p
    ),
    'active_users', (
      WITH activity AS (
        SELECT user_id, created_at FROM chat_messages
        UNION ALL SELECT user_id, created_at FROM food_entries
        UNION ALL SELECT user_id, created_at FROM engine_workout_sessions
        UNION ALL SELECT user_id, created_at FROM workout_logs
      )
      SELECT jsonb_build_object(
        'this_week', (SELECT COUNT(DISTINCT user_id) FROM activity WHERE created_at >= now() - interval '7 days'),
        'prior_week', (SELECT COUNT(DISTINCT user_id) FROM activity
                       WHERE created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days')
      )
    ),
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
