-- Generalize the reconciliation audit trail to cover both delivery sweeps.
--
-- programming_reconciliations was built for reconcile-programming-months; the
-- engine counterpart (reconcile-engine-months, now scheduled daily instead of
-- one-shot) gets the same never-silent treatment. Both sweeps write here,
-- discriminated by `kind`, so the operator's morning check stays one query:
--   SELECT ran_at, kind, healthy, healed, flagged
--   FROM programming_reconciliations ORDER BY ran_at DESC;
-- Two rows per day (one per kind) = both sweeps ran.

ALTER TABLE programming_reconciliations
  ADD COLUMN kind text NOT NULL DEFAULT 'programming'
    CHECK (kind IN ('programming', 'engine'));

COMMENT ON COLUMN programming_reconciliations.kind IS
  'Which paid-vs-delivered sweep wrote this row: programming (generate-next-month heals) or engine (engine_months_unlocked raises).';
