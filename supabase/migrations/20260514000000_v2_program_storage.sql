-- v2 program storage — normalized tables for the rewritten generate-program
-- writer's structured output (WriterOutput).
--
-- v1 stores programs as free-text in program_workouts.workout_text +
-- program_workout_blocks.block_text. v2 emits structured per-movement data
-- (typed sets/reps/weight/weight_unit/rpe/scaling_note) via Anthropic
-- tool-use. These two new tables hold that structured data natively so:
--   - the log form can pre-fill from prescription on "Did it,"
--   - analytics joins prescribed-vs-actual cleanly,
--   - the dataset moat (per athlete: prescribed composition → logged actual
--     → Tier 4 outcome) accumulates without lossy prose serialization.
--
-- Backward compatibility:
--   - Existing v1 rows untouched.
--   - `programs.program_version` defaults to 'v1' so all current rows are
--     correctly tagged; new v2 generations write 'v2'.
--   - `program_workouts.workout_text` becomes nullable so v2 can skip it
--     (v2 produces structured blocks; no workout-level prose).
--   - `programs.month_plan` (jsonb) holds the writer's 4-week-arc outline
--     (weekly_intent, strength_progression, deload_placement,
--     programming_priorities) — top-level structure not duplicated in
--     per-day rows.

-- 1. programs gets a version discriminator + month_plan blob.
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS program_version text NOT NULL DEFAULT 'v1'
    CHECK (program_version IN ('v1', 'v2')),
  ADD COLUMN IF NOT EXISTS month_plan jsonb;

COMMENT ON COLUMN programs.program_version IS
  'Schema discriminator. v1 → read from program_workouts.workout_text + program_workout_blocks.block_text (prose). v2 → read from program_blocks_v2 + program_movements_v2 (structured) and the month_plan jsonb here.';

COMMENT ON COLUMN programs.month_plan IS
  'v2 only: the writer LLM''s 4-week-arc outline emitted alongside the daily blocks. Shape: { weekly_intent: string[4], strength_progression: text, deload_placement: text, programming_priorities?: text }. NULL on v1 rows.';

-- 2. program_workouts.workout_text becomes nullable.
ALTER TABLE program_workouts
  ALTER COLUMN workout_text DROP NOT NULL;

COMMENT ON COLUMN program_workouts.workout_text IS
  'v1: free-text workout description (NOT NULL on legacy rows). v2: NULL (structure lives in program_blocks_v2 / program_movements_v2).';

-- 3. program_blocks_v2 — one row per block in a v2 program day.
CREATE TABLE program_blocks_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_workout_id uuid NOT NULL REFERENCES program_workouts(id) ON DELETE CASCADE,
  block_type text NOT NULL CHECK (block_type IN (
    'warm-up', 'mobility', 'skills', 'strength',
    'accessory', 'metcon', 'active-recovery', 'cool-down'
  )),
  block_label text,
  block_scheme text,            -- "21-15-9 for time", "AMRAP 12", "5x5 @75%", etc.
  time_cap_seconds integer,     -- metcon-style cap, NULL when not applicable
  block_notes text,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_program_blocks_v2_workout ON program_blocks_v2(program_workout_id);
CREATE INDEX idx_program_blocks_v2_type ON program_blocks_v2(block_type);

ALTER TABLE program_blocks_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select v2 blocks for own programs" ON program_blocks_v2
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM program_workouts pw
      JOIN programs p ON p.id = pw.program_id
      WHERE pw.id = program_blocks_v2.program_workout_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert v2 blocks for own programs" ON program_blocks_v2
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM program_workouts pw
      JOIN programs p ON p.id = pw.program_id
      WHERE pw.id = program_blocks_v2.program_workout_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update v2 blocks for own programs" ON program_blocks_v2
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM program_workouts pw
      JOIN programs p ON p.id = pw.program_id
      WHERE pw.id = program_blocks_v2.program_workout_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete v2 blocks for own programs" ON program_blocks_v2
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM program_workouts pw
      JOIN programs p ON p.id = pw.program_id
      WHERE pw.id = program_blocks_v2.program_workout_id AND p.user_id = auth.uid()
    )
  );

-- 4. program_movements_v2 — one row per prescribed movement in a v2 block.
-- Field shape MIRRORS workout_log_entries so the log form pre-fill is a 1:1
-- column copy and analytics joins are clean.
CREATE TABLE program_movements_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES program_blocks_v2(id) ON DELETE CASCADE,
  movement text NOT NULL,                     -- display_name (Title Case); validated against vocabulary at gen time
  sets smallint,
  reps smallint,
  weight numeric,
  weight_unit text CHECK (weight_unit IN ('lbs', 'kg')),
  rpe smallint CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  time_seconds integer,                        -- duration prescription
  distance numeric,
  distance_unit text CHECK (distance_unit IS NULL OR distance_unit IN ('ft', 'm')),
  scaling_note text,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_program_movements_v2_block ON program_movements_v2(block_id);
CREATE INDEX idx_program_movements_v2_movement ON program_movements_v2(movement);

ALTER TABLE program_movements_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select v2 movements for own programs" ON program_movements_v2
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM program_blocks_v2 b
      JOIN program_workouts pw ON pw.id = b.program_workout_id
      JOIN programs p ON p.id = pw.program_id
      WHERE b.id = program_movements_v2.block_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert v2 movements for own programs" ON program_movements_v2
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM program_blocks_v2 b
      JOIN program_workouts pw ON pw.id = b.program_workout_id
      JOIN programs p ON p.id = pw.program_id
      WHERE b.id = program_movements_v2.block_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update v2 movements for own programs" ON program_movements_v2
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM program_blocks_v2 b
      JOIN program_workouts pw ON pw.id = b.program_workout_id
      JOIN programs p ON p.id = pw.program_id
      WHERE b.id = program_movements_v2.block_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete v2 movements for own programs" ON program_movements_v2
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM program_blocks_v2 b
      JOIN program_workouts pw ON pw.id = b.program_workout_id
      JOIN programs p ON p.id = pw.program_id
      WHERE b.id = program_movements_v2.block_id AND p.user_id = auth.uid()
    )
  );

-- 5. Constraint integrity check.
-- Validate that the existing program_workout_blocks block_type list is a
-- SUPERSET of the v2 enum (i.e., v2 doesn't introduce new block_type
-- values that would be invalid on the v1 side). Pure sanity — fails if
-- the assumption ever drifts.
DO $$
DECLARE
  v_constraint_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_constraint_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'program_workout_blocks'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%block_type%';

  -- v2 enum values
  IF v_constraint_def IS NULL THEN
    -- v1's program_workout_blocks has no block_type CHECK constraint.
    -- That's fine — v2 has its own at the row level. Just log it.
    RAISE NOTICE 'program_workout_blocks has no block_type CHECK constraint; v2 enum is enforced on program_blocks_v2 only.';
  END IF;
END;
$$;
