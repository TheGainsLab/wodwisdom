-- Movement-level cardio_modality.
--
-- saveProgramV3's program_movements_v2 insert writes cardio_modality (the
-- machine for a monostructural movement — e.g. an erg inside a metcon).
-- Phase 2 (20260521010000) added cardio_modality only at the BLOCK level
-- (program_blocks_v2); the movement tables need it too, or the insert
-- references a non-existent column and saveProgramV3 throws.
--
-- workout_log_entries gets it as well — it is the log-side mirror of
-- program_movements_v2, and power-at-log-time (P5) will read it there.
--
-- Free text, nullable — matches the block-level cardio_modality. NULL on
-- every non-cardio movement (and on all generated-program movements).

ALTER TABLE program_movements_v2 ADD COLUMN IF NOT EXISTS cardio_modality text;
ALTER TABLE workout_log_entries  ADD COLUMN IF NOT EXISTS cardio_modality text;
