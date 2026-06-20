-- Program-scope the AI self-sequencer's per-user overrides.
--
-- Problem: engine_user_day_overrides was keyed (user_id, sequence_position) only.
-- But sequence_position == the catalog day_number, and EVERY program reuses the
-- same position numbers (a "day 12" exists in main_5day, main_3day, etc.). With no
-- program column, AI days generated for one program would surface inside ANOTHER
-- program at the same position after the athlete switches programs (switchProgram
-- resets engine_current_day to that program's own progress). This adds the program
-- dimension so an override only ever serves the program it was generated for.

ALTER TABLE engine_user_day_overrides
  ADD COLUMN IF NOT EXISTS program_version text NOT NULL DEFAULT 'main_5day';

-- Existing rows were all generated while the sequencer only ran against main_5day,
-- so the DEFAULT backfills them correctly.

-- Replace (user, position) uniqueness with (user, program, position): the same
-- position number must be able to coexist across programs without colliding.
ALTER TABLE engine_user_day_overrides
  DROP CONSTRAINT IF EXISTS engine_user_day_overrides_user_id_sequence_position_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'engine_user_day_overrides_user_program_pos_key'
  ) THEN
    ALTER TABLE engine_user_day_overrides
      ADD CONSTRAINT engine_user_day_overrides_user_program_pos_key
      UNIQUE (user_id, program_version, sequence_position);
  END IF;
END;
$$;

DROP INDEX IF EXISTS idx_engine_overrides_user;
CREATE INDEX IF NOT EXISTS idx_engine_overrides_user
  ON engine_user_day_overrides(user_id, program_version, sequence_position);
