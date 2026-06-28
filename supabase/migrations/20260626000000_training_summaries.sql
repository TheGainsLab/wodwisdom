-- training_summaries — Step 4, the observed-evidence layer persisted + versioned.
--
-- Deterministic distillation of raw logged training (Evidence) into typed facts
-- ("what did the athlete actually do?"). Persisted as IMMUTABLE versioned
-- snapshots (same pattern as athlete_models / coach_states) so we can DIFF
-- consecutive versions — the "what changed in your training" half of the
-- three-diffs story (training / belief / decisions).
--
-- Append-only-on-change: a new version only when the meaningful evidence changes
-- (persist-training-summary.ts hashes the evidence, excluding volatile dates so a
-- rolling window alone doesn't churn versions). Written by edge functions
-- (service role); read-only to the owner.

CREATE TABLE training_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  version integer NOT NULL,
  content_hash text NOT NULL,

  -- The full TrainingSummary snapshot (training-summary.ts).
  summary jsonb NOT NULL DEFAULT '{}',
  -- The builder/transform version that produced it.
  training_summary_version text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, version)
);

CREATE INDEX idx_training_summaries_user_version ON training_summaries(user_id, version DESC);

ALTER TABLE training_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own" ON training_summaries
  FOR SELECT USING (auth.uid() = user_id);

COMMENT ON TABLE training_summaries IS
  'Immutable versioned snapshots of the deterministic Training Summary (Step 4 observed-evidence layer). Append-only on evidence change; powers the "what changed in your training" diff. Written by edge functions (service role).';
