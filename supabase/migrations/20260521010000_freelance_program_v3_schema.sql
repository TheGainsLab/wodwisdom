-- Freelance ingestion — v3 program-side schema (Phase 2).
--
-- Phase 1 (20260521000000) taught the LOG tables (workout_log_blocks /
-- workout_log_entries) about cardio. This does the same for the v3 PROGRAM
-- tables, so an ingested freelance program with cardio blocks can be stored
-- in program_blocks_v2 / program_movements_v2 as a peer of AI-Programming
-- output.
--
-- AI Programming is unaffected: a CHECK is permissive, not generative —
-- generate-program-v3's prompts are untouched and still emit only the
-- original 8 block types.

-- 1. program_blocks_v2.block_type — add 'cardio' and 'other'.
--    'cardio'  = ingested cardio blocks.
--    'other'   = escape hatch the freelance parser needs for rest days /
--                unclassifiable blocks. v1's program_workout_blocks had no
--                CHECK and tolerated 'other'; v3's strict CHECK must allow it.
ALTER TABLE program_blocks_v2 DROP CONSTRAINT IF EXISTS program_blocks_v2_block_type_check;
ALTER TABLE program_blocks_v2 ADD CONSTRAINT program_blocks_v2_block_type_check
  CHECK (block_type IN (
    'warm-up', 'mobility', 'skills', 'strength', 'accessory',
    'metcon', 'cardio', 'active-recovery', 'cool-down', 'other'
  ));

-- 2. program_blocks_v2.cardio_modality — the prescribed cardio machine.
--    Free text (no CHECK), matching how the Year of the Engine tables store
--    modality. Null on non-cardio blocks.
ALTER TABLE program_blocks_v2
  ADD COLUMN IF NOT EXISTS cardio_modality text;

COMMENT ON COLUMN program_blocks_v2.cardio_modality IS
  'Cardio machine for a cardio block (free text, YOTE-aligned vocabulary). Null on non-cardio blocks.';

-- 3. program_movements_v2.calories — calorie-based cardio movements.
--    program_movements_v2 mirrors workout_log_entries; this matches the
--    `calories` column Phase 1 added there. distance/distance_unit already
--    exist for metre/foot work; calorie work had nowhere to land.
ALTER TABLE program_movements_v2
  ADD COLUMN IF NOT EXISTS calories numeric;

COMMENT ON COLUMN program_movements_v2.calories IS
  'Calorie count for calorie-based cardio movements (e.g. "30 cal row").';

-- 4. Consistency rename: workout_log_blocks.modality -> cardio_modality.
--    Phase 1 added the column as `modality`; the settled field name is
--    `cardio_modality` (avoids collision with the movement W/G/M modality,
--    and matches program_blocks_v2 above). The column is empty and has no
--    consumers yet — safe rename.
ALTER TABLE workout_log_blocks RENAME COLUMN modality TO cardio_modality;
