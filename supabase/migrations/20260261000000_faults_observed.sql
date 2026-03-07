-- Add faults_observed column to workout_log_entries.
-- Stores common faults the athlete checked during logging (sourced from coach review).
ALTER TABLE workout_log_entries
  ADD COLUMN faults_observed text[] DEFAULT NULL;
