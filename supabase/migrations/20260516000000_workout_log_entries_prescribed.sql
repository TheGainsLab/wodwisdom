-- Step 18 of the v3 UX roadmap: prescribed_* snapshot on workout_log_entries.
--
-- Today every column on workout_log_entries holds what the athlete saved.
-- Because Start prefills the form from program_movements_v2, "the saved
-- value matches the prescription" is indistinguishable from "the athlete
-- never touched the field." That ambiguity blocks adherence math + the
-- per-lift / skill / cohort dashboards downstream (roadmap steps 21–25).
--
-- We snapshot the prescription into the log entry at save time so each row
-- carries both what was asked and what was done. The existing columns
-- (weight, reps, hold_seconds, rpe) keep their current semantics — what
-- the athlete logged. The new prescribed_* columns are read-only after
-- write; analytics computes `actual - prescribed` deltas off them.
--
-- v1 logs may end up with NULL prescribed_* (parsed_tasks not always
-- populated for v1 strength); analytics treat NULL as "unknown prescription"
-- and skip those rows.
--
-- prescribed_hold_seconds — chose `hold_seconds` over `time_seconds` to
-- match the existing column name on this table. (program_movements_v2 uses
-- `time_seconds` for the source data; the StartWorkoutPage prefill remaps.)

ALTER TABLE workout_log_entries
  ADD COLUMN prescribed_weight numeric,
  ADD COLUMN prescribed_reps integer,
  ADD COLUMN prescribed_hold_seconds integer,
  ADD COLUMN prescribed_rpe numeric;

COMMENT ON COLUMN workout_log_entries.prescribed_weight IS
  'Prescription snapshot from program_movements_v2.weight (v3) or '
  'parsed_tasks (v1) at the moment the entry was saved. NULL when no '
  'prescription was available.';
COMMENT ON COLUMN workout_log_entries.prescribed_reps IS
  'Prescription snapshot from program_movements_v2.reps (v3) or parsed_tasks '
  '(v1). For metcons with duplicate movements (e.g., 21-15-9), this is the '
  'sum across rounds.';
COMMENT ON COLUMN workout_log_entries.prescribed_hold_seconds IS
  'Prescription snapshot from program_movements_v2.time_seconds (v3) or '
  'parsed_tasks.hold_seconds (v1).';
COMMENT ON COLUMN workout_log_entries.prescribed_rpe IS
  'Prescription snapshot from program_movements_v2.rpe (v3) or parsed_tasks '
  '(v1). Often NULL — RPE is rarely prescribed.';
