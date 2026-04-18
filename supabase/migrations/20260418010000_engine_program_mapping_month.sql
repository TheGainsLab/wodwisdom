-- Phase 1 of the specialty-programs dashboard fix: add a program-specific
-- month column to engine_program_mapping. Previously the dashboard grouped
-- workouts by engine_workouts.month (the catalog's month field), which
-- only makes sense for the Year of the Engine variants that walk the
-- catalog linearly. Specialty programs (Hyrox, VO2 Max) curate a sequence
-- of non-linear catalog days, so the catalog month produced nonsense
-- groupings on the dashboard (e.g., "Month 1: 1 day", "Month 4: 9 days").
--
-- New behavior: each mapping row owns its own month, derived from
-- program_sequence_order under a uniform-months assumption (every
-- program's total_days is a clean multiple of its total_months).

-- Step 1 — give engine_programs a total_months column so uniform-split
-- math has a named source of truth. Hardcode 36 for the Year of the
-- Engine variants and 12 for the specialty programs; these match the
-- product descriptions.
ALTER TABLE engine_programs
  ADD COLUMN IF NOT EXISTS total_months integer;

UPDATE engine_programs
  SET total_months = 36
  WHERE id IN ('main_5day', 'main_3day', 'main_5day_varied', 'main_3day_varied');

UPDATE engine_programs
  SET total_months = 12
  WHERE id IN ('vo2max_3day', 'vo2max_4day', 'hyrox_3day', 'hyrox_5day');

ALTER TABLE engine_programs
  ALTER COLUMN total_months SET NOT NULL;

-- Step 2 — add the month column to engine_program_mapping. Nullable at
-- first so the backfill step below can populate it before we enforce
-- NOT NULL.
ALTER TABLE engine_program_mapping
  ADD COLUMN IF NOT EXISTS month integer;

-- Step 3 — backfill month for every existing mapping row using:
--   month = floor((sequence - 1) / (total_days / total_months)) + 1
-- This is the integer-arithmetic form of ceil(sequence / days_per_month)
-- and assumes total_days is exactly divisible by total_months (verified
-- for every program: 720/36=20, 432/36=12, 144/12=12, 192/12=16,
-- 240/12=20).
UPDATE engine_program_mapping m
  SET month = ((m.program_sequence_order - 1) / (p.total_days / p.total_months)) + 1
  FROM engine_programs p
  WHERE m.engine_program_id = p.id;

-- Step 4 — enforce NOT NULL so future mapping inserts can't skip month.
-- If any row is still null after the backfill, this will raise — which
-- is the desired behavior (it means an engine_program_id exists in the
-- mapping that doesn't exist in engine_programs, and we'd want to know).
ALTER TABLE engine_program_mapping
  ALTER COLUMN month SET NOT NULL;

-- Step 5 — index on (engine_program_id, month) so the dashboard's
-- "group by month" queries are efficient.
CREATE INDEX IF NOT EXISTS idx_engine_program_mapping_program_month
  ON engine_program_mapping(engine_program_id, month);
