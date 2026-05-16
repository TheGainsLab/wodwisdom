-- Step 16 of the v3 UX roadmap: target_pct_1rm on program_movements_v2.
--
-- The v3 writer reasons about strength-block intensity in % of 1RM terms
-- ("snatch 5x1 @70-75%") and only emits the final pound number. The %
-- gets lost. Storing it as a stored column unlocks:
--   - Per-lift progress charts (Step 22) — % is the comparable axis across
--     athletes with different 1RMs.
--   - Coach (Step 9) reads the % directly rather than dividing live.
--   - Carry-forward continuity (Step 27) — next cycle's writer ingests
--     "last cycle: trained snatch at 70-72% across 12 sessions, no misses"
--     to push intensity forward.
--   - Adherence by intensity zone (Step 21) — flag whether skip rate
--     correlates with prescribed intensity.
--
-- numeric(5,2) covers 0.00–999.99 — well past the practical 0–110%
-- range. Nullable because non-strength prescriptions (skills,
-- bodyweight accessory, metcon) don't carry a % anchor.

ALTER TABLE program_movements_v2
  ADD COLUMN target_pct_1rm numeric(5, 2);

COMMENT ON COLUMN program_movements_v2.target_pct_1rm IS
  'Writer-emitted % of 1RM for strength/accessory prescriptions reasoned in % terms (e.g. 72.5 for "@70-75%"). Null for non-%-anchored movements (skills, bodyweight, metcon).';
