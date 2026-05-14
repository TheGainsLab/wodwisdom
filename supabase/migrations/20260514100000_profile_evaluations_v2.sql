-- profile_evaluations v2 storage — additive columns on the existing table.
--
-- v1 writes prose into three text columns: lifting_analysis, skills_analysis,
-- engine_analysis. v2 emits a structured 5-section evaluation
-- (EvaluationOutput) via Anthropic tool-use. Rather than spread that across
-- another set of columns (the eval data isn't load-bearing for cross-athlete
-- analytics like the programs side is — it's mostly for display), we store
-- the full structured output as a single jsonb blob plus a version
-- discriminator.
--
-- Existing v1 rows untouched: evaluation_version defaults to 'v1' so all
-- legacy rows are correctly tagged.

ALTER TABLE profile_evaluations
  ADD COLUMN IF NOT EXISTS evaluation_version text NOT NULL DEFAULT 'v1'
    CHECK (evaluation_version IN ('v1', 'v2')),
  ADD COLUMN IF NOT EXISTS structured_evaluation jsonb;

COMMENT ON COLUMN profile_evaluations.evaluation_version IS
  'Schema discriminator. v1 → read prose from lifting_analysis / skills_analysis / engine_analysis text columns. v2 → read from the structured_evaluation jsonb (EvaluationOutput shape).';

COMMENT ON COLUMN profile_evaluations.structured_evaluation IS
  'v2 only: { headline_takeaway: text, strengths: text[], weaknesses_and_priorities: text[], detailed_analysis: text, recommendations: text[] }. NULL on v1 rows.';
