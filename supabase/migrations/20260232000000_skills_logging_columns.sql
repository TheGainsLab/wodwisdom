-- Add structured skills logging columns to workout_log_entries.
-- These complement existing sets/reps/weight/rpe for gymnastics & skill work.

ALTER TABLE workout_log_entries
  ADD COLUMN reps_completed smallint,
  ADD COLUMN hold_seconds   smallint,
  ADD COLUMN distance        numeric,
  ADD COLUMN distance_unit   text CHECK (distance_unit IN ('ft', 'm')),
  ADD COLUMN quality         text CHECK (quality IN ('A', 'B', 'C', 'D')),
  ADD COLUMN variation       text;
