-- Remove the source_type column from workout_logs.
-- Every workout comes from a program; the source_id FK is sufficient.

ALTER TABLE workout_logs DROP COLUMN source_type;
