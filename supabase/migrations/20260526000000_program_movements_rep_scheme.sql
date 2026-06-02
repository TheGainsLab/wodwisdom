-- rep_scheme: per-iteration reps breakdown for v3 metcon/strength movements.
--
-- Lets the writer emit the structural rep pattern as a typed array instead
-- of conflating it with the scalar `reps` field:
--   - Chipper "21-15-9": rep_scheme = [21, 15, 9], reps = 45 (sum)
--   - 3 RFT 15 reps/round: rep_scheme = [15, 15, 15], reps = 45
--   - Single-pass "100 burpees": rep_scheme = [100], reps = 100
--   - AMRAP 10/round: rep_scheme = [10] (one iteration), reps = 10
--
-- save-program-v3 computes reps = sum(rep_scheme) in code (deterministic,
-- no LLM arithmetic). The UI uses rep_scheme to render "21-15-9" structure
-- when length > 1. compute-benchmarks consumes the (now-accurate) reps for
-- For-Time and reps_per_round for AMRAP, with `rounds` extracted from the
-- block_scheme as before.

ALTER TABLE program_movements_v2
  ADD COLUMN IF NOT EXISTS rep_scheme smallint[];

COMMENT ON COLUMN program_movements_v2.rep_scheme IS
  'Per-iteration reps breakdown: chipper [21,15,9], 3 RFT [15,15,15], single-pass [100]. sum(rep_scheme) = reps. Null for non-rep movements (distance/time/calorie-counted).';
