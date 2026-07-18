-- Capture stage D (2026-07-18): the in-app event log — what happens between
-- sign-in and logging. NOT full analytics: a fixed vocabulary of ~12 moments,
-- each chosen to answer a standing question (see app-events client helper
-- for the census). Signed-in users only; route patterns not URLs; no free
-- text; first-party only.
--
-- Volume is modest at current scale; prune policy is a later decision.

CREATE TABLE app_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_events_user ON app_events(user_id, created_at DESC);
CREATE INDEX idx_app_events_event ON app_events(event, created_at DESC);

ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;

-- Clients may INSERT their own events only; reads are admin/reporting-side.
CREATE POLICY "insert own events" ON app_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE app_events IS
  'Stage-D in-app event log: fixed vocabulary (page_view, workout_viewed, timer_started, log_started, nutrition_method, eval_viewed, paywall_hit, install_prompt, billing_portal_opened, client_error, profile_started, share_used). Insert-own from clients; reporting reads via SECURITY DEFINER.';
