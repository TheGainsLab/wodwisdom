-- Injury intake safety (handoff 1.1/1.3): the athlete-confirmed avoidance gate.
--
-- injuries_structured stays the LATEST PARSE OUTPUT = a pending proposal.
-- injuries_avoidance_confirmed is the ACTIVE safety filter the athlete signed off on.
--
-- A confirmation is VALID only for the exact text it was confirmed against:
--   injuries_avoidance_confirmed.confirmed_against_hash === injuries_constraints_hash.
-- Editing the injuries text changes the hash → the confirmation goes stale → downstream
-- must re-confirm (this is what makes re-parse-must-re-confirm (handoff 1.6) automatic).
--
-- Shape:
--   {
--     "do_not_program": ["Snatch", ...],   -- the athlete's final list (incl. manual add/remove)
--     "confirmed_at": "2026-07-11T...Z",
--     "confirmed_against_hash": "<sha256 of injuries_constraints at confirm time>"
--   }
-- NULL = never confirmed. NOT backfilled: auto-confirming existing injury text would
-- fabricate a signature. Existing users hit a one-time show-back (handoff 1.5 / ticket T6);
-- until then build-writer-payload falls back to the raw parsed list, so protection is
-- never dropped during rollout.
--
-- Idempotent — safe to paste into the Supabase SQL editor and re-run.

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS injuries_avoidance_confirmed jsonb;

COMMENT ON COLUMN athlete_profiles.injuries_avoidance_confirmed IS
  'Athlete-confirmed injury avoidance list (the ACTIVE safety filter). Valid only when '
  'confirmed_against_hash = injuries_constraints_hash; a text edit invalidates it. NULL = '
  'never confirmed. See docs/injury_intake_safety_handoff.md.';

-- Per-generation avoidance record (handoff 1.5 / ticket T6): the avoidance list that
-- actually gated each generated program cycle, WITH provenance tags (T5 blocked_by).
-- This is the defensible artifact — "the program generated on date X avoided movement
-- M because: injury" — distinct from the athlete's confirmation event. One row per
-- (program, month); the unique constraint mirrors program_months idempotency so a
-- retry/re-save doesn't duplicate. ON DELETE CASCADE from programs propagates deletion
-- (handoff 3.1): deleting a program (or an account, which deletes its programs) removes
-- these too.
CREATE TABLE IF NOT EXISTS program_generation_avoidances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  month_number int NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  -- { do_not_program: text[], blocked_by: { "<movement>": "injury"|"equipment"|"both" } }
  avoidances jsonb NOT NULL,
  UNIQUE (program_id, month_number)
);

CREATE INDEX IF NOT EXISTS program_generation_avoidances_user_idx
  ON program_generation_avoidances (user_id);

COMMENT ON TABLE program_generation_avoidances IS
  'Immutable record of the effective avoidance list (injury-confirmed union equipment, '
  'with blocked_by provenance) that gated each generated program cycle. See '
  'docs/injury_intake_safety_handoff.md (1.5).';
