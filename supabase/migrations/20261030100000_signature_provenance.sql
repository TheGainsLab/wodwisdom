-- Provenance + workout identity for workout_signatures (review decisions 2026-10-30).
--
-- provenance: per-vector origin, so an auditor can tell a 50 that is an
-- opinion from a 50 that is a regression on 400 scores:
--   { demand:        {kind: 'editorial'},
--     discrimination:{kind: 'derived_from_demand'}
--                  | {kind: 'empirical', cohort, n, fitted_at, fit_quality}
--                  | {kind: 'stale_empirical', invalidated_at, invalidated_by},
--     stimulus:      {kind: 'editorial'} }
-- Server-managed by signature-workout; v1 rows are all editorial/derived.
--
-- workout_hash: SHA-256 of the canonical workout structure — the workout's
-- IDENTITY, distinct from the signature's version. An empirical column is
-- tied to this structure: editing the workout changes the hash and the
-- function stale-marks any empirical provenance rather than letting a
-- regression fitted on one workout silently describe another.

alter table public.workout_signatures
  add column if not exists provenance jsonb not null default '{}'::jsonb,
  add column if not exists workout_hash text;
