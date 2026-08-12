-- Generation audit log — the memory half of the warnings doctrine.
--
-- Audits enforce contracts; warning-tier findings are data with an obligation:
-- a recurring warning class earns the next ruling by observed collision. That
-- obligation needs memory, and edge-function console logs expire on a retention
-- window. This table persists per-generation audit outcomes (accepted
-- violations, warnings, retry events) so "how often did X fire, and for whom"
-- is one SQL query instead of log archaeology.

CREATE TABLE IF NOT EXISTS generation_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  program_id uuid,
  month_number int,
  stage text NOT NULL,
  violations text[] NOT NULL DEFAULT '{}',
  warnings text[] NOT NULL DEFAULT '{}',
  retried boolean NOT NULL DEFAULT false,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS gal_stage_created_idx ON generation_audit_log (stage, created_at DESC);
CREATE INDEX IF NOT EXISTS gal_user_created_idx ON generation_audit_log (user_id, created_at DESC);

-- Operator-only: RLS enabled with NO policies. The service role (edge
-- functions, admin tooling) bypasses RLS; athletes never read audit internals.
ALTER TABLE generation_audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE generation_audit_log IS
  'Per-generation audit outcomes (accepted violations, warning-tier findings, retries). Written best-effort by generate-program-v3; rows are analysis data, not athlete-facing state.';
COMMENT ON COLUMN generation_audit_log.stage IS
  'Pipeline stage that produced the finding: metcons | fill_residual | soft_audit.';
COMMENT ON COLUMN generation_audit_log.retried IS
  'True when the stage''s one-retry fired (even if the retry then passed clean — retry frequency is itself a signal).';
