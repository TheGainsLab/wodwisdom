-- Phase 2: archetype generation columns.
--
-- program_workouts.day_type — the archetype label for this workout
--   ('strength' | 'metcon' | 'fitness' | 'skill' | 'recovery'). Drives
--   per-day rule scoping during generation, UI rendering of "Day N:
--   Strength Day" headers, and post-gen audit comparisons.
--
-- programs.weekly_pattern — jsonb array of archetypes per day for the
--   first 3 weeks (week 4 is the deload override and lives separately
--   in code). Stored for audit visibility — we can see what shape the
--   generator was asked to build.
--
-- programs.experience_tier_at_gen — text snapshot of the tier used
--   when the program was generated. Lets the next month's reconciler
--   apply the upward-only ratchet (never demote).

ALTER TABLE program_workouts
  ADD COLUMN IF NOT EXISTS day_type text;

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS weekly_pattern jsonb,
  ADD COLUMN IF NOT EXISTS experience_tier_at_gen text;

CREATE INDEX IF NOT EXISTS idx_program_workouts_day_type
  ON program_workouts(day_type);
