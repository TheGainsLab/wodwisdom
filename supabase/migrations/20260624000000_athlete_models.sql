-- athlete_models — Step 1 of the coaching-state architecture.
--
-- The DETERMINISTIC truth layer (Athlete Model), persisted as IMMUTABLE,
-- versioned SNAPSHOTS (explicitly NOT event sourcing). Each row is a
-- complete, self-contained "what the coach currently believes" computed by
-- buildAthleteModel() from the athlete's static profile (+ competition).
--
-- IMMUTABILITY: nothing edits a row in place. A changed input (profile/1RM
-- edit, fresh competition data, or a thresholds/builder version bump) →
-- a NEW version row; prior versions are never mutated. The persistence
-- layer (persist-athlete-model.ts) appends a new version ONLY when the
-- computed model content actually changes (model_hash differs from the
-- latest row) — a re-run with identical inputs is a no-op.
--
-- VERSIONS:
--   version          — model version, increments when model content changes.
--   profile_version  — increments only when the static profile inputs change
--                      (profile_hash differs). Lets future artifacts pin the
--                      exact profile they were built on ("versioned on edit").
--
-- PROVENANCE PINS (version the transforms, not just the data):
--   thresholds_version + model_builder_version stamp the curated config and
--   the builder logic, so two snapshots can be explained by inputs-vs-logic.

CREATE TABLE athlete_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  version integer NOT NULL,
  profile_version integer NOT NULL,

  -- Content-addressing for append-only-on-change dedup + version stepping.
  model_hash text NOT NULL,
  profile_hash text NOT NULL,

  -- The full AthleteModel snapshot (AthleteModelContent + version fields).
  model jsonb NOT NULL DEFAULT '{}',
  -- The static profile inputs the model was computed from (AthleteProfileStatic).
  profile_snapshot jsonb NOT NULL DEFAULT '{}',

  -- Provenance pins (the transform versions).
  thresholds_version text NOT NULL,
  model_builder_version text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- One row per (athlete, version); guards against a double-append race.
  UNIQUE (user_id, version)
);

-- Latest-snapshot read: "what does the coach currently believe?"
CREATE INDEX idx_athlete_models_user_version ON athlete_models(user_id, version DESC);

ALTER TABLE athlete_models ENABLE ROW LEVEL SECURITY;

-- Read-only to the owner; rows are written exclusively by edge functions via
-- the service-role key (which bypasses RLS). Immutable → no update/delete policy.
CREATE POLICY "select own" ON athlete_models
  FOR SELECT USING (auth.uid() = user_id);

COMMENT ON TABLE athlete_models IS
  'Immutable versioned snapshots of the deterministic Athlete Model (coaching-state Step 1). Append-only; a new version is created only when the computed model content changes. Written by edge functions (service role); the Model affects FUTURE generations only — delivered/in-flight programs keep the version they pinned.';
