-- Rename parsed_skills → parsed_tasks to support any block type (skills, metcon, etc.)
ALTER TABLE program_workout_blocks
  RENAME COLUMN parsed_skills TO parsed_tasks;

COMMENT ON COLUMN program_workout_blocks.parsed_tasks IS
  'Cached LLM-parsed structured movements. null = not yet parsed; non-null = cached result.';
