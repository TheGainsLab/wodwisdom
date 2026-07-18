-- Reporting foundation (2026-07-18): "build all the reporting first."
--
-- 1. digest_runs — every weekly-digest run stores its full stats jsonb.
--    Week-over-week trends become computable from OUR OWN history instead of
--    restarting from zero, and the run record doubles as the digest's
--    missing idempotency/history trail (review finding, now closed).
--
-- 2. subscriber_health() — the ghost audit made repeatable: one row per
--    active entitled user with plan(s), entitlement source kind, tenure,
--    last sign-in, last training log, PWA install, and lifetime activity
--    counts. Powers the digest summary line, ad-hoc digs, and the coming
--    /admin/reports page.

CREATE TABLE digest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  stats jsonb NOT NULL
);

CREATE INDEX idx_digest_runs_run_at ON digest_runs(run_at DESC);

ALTER TABLE digest_runs ENABLE ROW LEVEL SECURITY;
-- Service-role writes (weekly-digest fn); admin reads via RPC later.

COMMENT ON TABLE digest_runs IS
  'One row per weekly-digest run: the full stats snapshot. The reporting layer''s trend history.';

-- ── Subscriber health ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.subscriber_health()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  features text[],
  source_kinds text[],
  signup_at timestamptz,
  last_sign_in_at timestamptz,
  last_training_at timestamptz,
  last_any_activity_at timestamptz,
  pwa_installed boolean,
  engine_sessions bigint,
  workouts bigint,
  nutrition_entries bigint,
  chat_questions bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.email,
    p.full_name,
    (SELECT array_agg(DISTINCT ue.feature) FROM user_entitlements ue
      WHERE ue.user_id = p.id AND (ue.expires_at IS NULL OR ue.expires_at > now())),
    -- 'sub_...' = live Stripe subscription; anything else = grant/legacy.
    (SELECT array_agg(DISTINCT CASE WHEN ue.source LIKE 'sub_%' THEN 'stripe' ELSE COALESCE(ue.source, 'unknown') END)
      FROM user_entitlements ue
      WHERE ue.user_id = p.id AND (ue.expires_at IS NULL OR ue.expires_at > now())),
    au.created_at,
    au.last_sign_in_at,
    GREATEST(
      COALESCE((SELECT MAX(es.created_at) FROM engine_workout_sessions es WHERE es.user_id = p.id), 'epoch'::timestamptz),
      COALESCE((SELECT MAX(wl.created_at) FROM workout_logs wl WHERE wl.user_id = p.id), 'epoch'::timestamptz)
    ) AS last_training_at,
    GREATEST(
      COALESCE((SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.user_id = p.id), 'epoch'::timestamptz),
      COALESCE((SELECT MAX(fe.created_at) FROM food_entries fe WHERE fe.user_id = p.id), 'epoch'::timestamptz),
      COALESCE((SELECT MAX(es.created_at) FROM engine_workout_sessions es WHERE es.user_id = p.id), 'epoch'::timestamptz),
      COALESCE((SELECT MAX(wl.created_at) FROM workout_logs wl WHERE wl.user_id = p.id), 'epoch'::timestamptz)
    ) AS last_any_activity_at,
    (p.pwa_installed_at IS NOT NULL),
    (SELECT COUNT(*) FROM engine_workout_sessions es WHERE es.user_id = p.id),
    (SELECT COUNT(*) FROM workout_logs wl WHERE wl.user_id = p.id),
    (SELECT COUNT(*) FROM food_entries fe WHERE fe.user_id = p.id),
    (SELECT COUNT(*) FROM chat_messages cm WHERE cm.user_id = p.id)
  FROM profiles p
  JOIN auth.users au ON au.id = p.id
  WHERE COALESCE(p.role, 'user') <> 'admin'
    AND EXISTS (
      SELECT 1 FROM user_entitlements ue
      WHERE ue.user_id = p.id AND (ue.expires_at IS NULL OR ue.expires_at > now())
    )
  ORDER BY last_any_activity_at DESC;
$$;

REVOKE ALL ON FUNCTION public.subscriber_health() FROM public, anon, authenticated;
