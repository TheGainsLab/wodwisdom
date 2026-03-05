-- Replace phase-based gating with month-based generation tracking.
-- Old columns (phase, total_phases) controlled which 20-day slice was visible.
-- New columns support generating one month at a time and appending more later.

ALTER TABLE programs
  DROP COLUMN IF EXISTS phase,
  DROP COLUMN IF EXISTS total_phases;

ALTER TABLE programs
  ADD COLUMN generated_months integer NOT NULL DEFAULT 1,
  ADD COLUMN subscription_start timestamptz;
