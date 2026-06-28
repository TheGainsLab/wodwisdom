-- coach_states — Step 2 of the coaching-state architecture.
--
-- The JUDGMENT layer (CoachState): the coach's current beliefs about an
-- athlete — typed decisions (develop / maintain / deprioritize, recovery
-- posture, strength emphasis) made ONCE from the deterministic Athlete Model
-- (Step 1). Persisted as IMMUTABLE, versioned SNAPSHOTS (same pattern as
-- athlete_models), with the provenance lineage made explicit:
--
--   CoachState v5  →  athlete_model_version 17  →  Athlete Profile vN
--
-- IMMUTABILITY: nothing edits a row in place. A new belief set (because the
-- model changed, or the builder/prompt version bumped) → a NEW version row.
-- The persistence layer (persist-coach-state.ts) appends a new version ONLY
-- when the decision content actually changes (content_hash differs from the
-- athlete's latest row).
--
-- PRINCIPLE enforced upstream (coach-state.ts): a CoachState carries NO
-- numeric fact fields — it references the Athlete Model by key. This table
-- just stores the resulting decision snapshot.

CREATE TABLE coach_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  version integer NOT NULL,

  -- Provenance pins: the exact facts (input) + the logic (transform) this
  -- belief set was produced from.
  athlete_model_version integer NOT NULL,
  coach_state_builder_version text NOT NULL,

  -- Content-addressing for append-only-on-change dedup + version stepping.
  content_hash text NOT NULL,

  -- The full CoachState snapshot (CoachStateContent + version fields).
  coach_state jsonb NOT NULL DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, version)
);

-- Latest-snapshot read: "what does the coach currently believe?"
CREATE INDEX idx_coach_states_user_version ON coach_states(user_id, version DESC);

ALTER TABLE coach_states ENABLE ROW LEVEL SECURITY;

-- Read-only to the owner; rows are written exclusively by edge functions via
-- the service-role key (which bypasses RLS). Immutable → no update/delete policy.
CREATE POLICY "select own" ON coach_states
  FOR SELECT USING (auth.uid() = user_id);

COMMENT ON TABLE coach_states IS
  'Immutable versioned snapshots of the typed CoachState (coaching-state Step 2 — the judgment layer). Append-only; a new version only when decision content changes. References the athlete_model_version it was built on. Written by edge functions (service role).';
