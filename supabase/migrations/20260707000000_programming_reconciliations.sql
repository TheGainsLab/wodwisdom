-- programming_reconciliations — audit trail for the daily paid-vs-delivered sweep.
--
-- The belt (stripe-webhook firing generate-next-month on invoice.payment_succeeded)
-- fails silently: one attempt, 30s timeout, swallowed exception — a paid renewal
-- whose generation dies is invisible until the customer emails. The suspenders
-- (reconcile-programming-months, daily) compare ground truth (paid Stripe invoices)
-- against delivered truth (programs.generated_months) for every active programming
-- subscriber and auto-heal unambiguous gaps. Each run inserts ONE row here, so the
-- sweep itself can never fail silently either: no row today = the cron didn't run.
--
-- healed/flagged/errors are jsonb arrays of per-user entries; `flagged` carries the
-- ambiguous cases the sweep refused to auto-fire (incomplete profile, no active
-- subscription, generation already in flight, unsupported billing interval).

CREATE TABLE programming_reconciliations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  dry_run boolean NOT NULL DEFAULT false,
  checked integer NOT NULL,
  healthy integer NOT NULL,
  healed jsonb NOT NULL DEFAULT '[]',
  flagged jsonb NOT NULL DEFAULT '[]',
  errors jsonb NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_programming_reconciliations_ran_at
  ON programming_reconciliations(ran_at DESC);

-- Service-role/operator surface only: RLS on with no policies, so clients see
-- nothing; the SQL editor and edge functions (service role) read/write freely.
ALTER TABLE programming_reconciliations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE programming_reconciliations IS
  'One row per run of reconcile-programming-months: the daily sweep that compares paid Stripe invoices against delivered program months for active programming subscribers, auto-heals unambiguous gaps via generate-next-month, and flags ambiguous ones for the operator.';
