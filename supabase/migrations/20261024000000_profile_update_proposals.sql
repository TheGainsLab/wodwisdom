-- Chat → profile Apply (founder decision, 2026-10-23, the Mackenzie case):
-- when an athlete tells the coach a DURABLE change (schedule structure,
-- outside training load, goals, injuries), the coach proposes a profile
-- diff as a card; the athlete taps Apply and the change lands in
-- athlete_profiles — no homework, no re-typing into the profile form.
-- The conversation's context must never again die in the chat log.
--
-- Each proposal is logged here BEFORE the card is shown (mirrors
-- ai_edit_log for block edits): the apply-profile-update fn resolves the
-- row, so what gets applied is exactly what was proposed and approved,
-- once. `current` snapshots the fields at proposal time for the card's
-- diff and the audit trail.

CREATE TABLE profile_update_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request text,                -- the athlete's message that prompted it
  rationale text,              -- the coach's one-line reason on the card
  current jsonb NOT NULL,      -- {days_per_week, goal, injuries_constraints} at proposal time
  proposal jsonb NOT NULL,     -- {days_per_week?, goal_append?, injuries_replace?}
  outcome text,                -- null = pending, 'applied' | 'declined'
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_profile_update_proposals_user
  ON profile_update_proposals (user_id, created_at DESC);

-- Service-role writes only (chat fn inserts, apply fn resolves); athletes
-- may read their own rows (the card rehydration path, if ever needed).
ALTER TABLE profile_update_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY pup_select_own ON profile_update_proposals
  FOR SELECT USING (user_id = auth.uid());
