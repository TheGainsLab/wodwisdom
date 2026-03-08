-- Add parsed_skills column to cache LLM-parsed skill movements per block.
-- null = not yet parsed; non-null = cached structured result.
ALTER TABLE program_workout_blocks
  ADD COLUMN parsed_skills jsonb;
