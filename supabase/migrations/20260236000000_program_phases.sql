-- Add phase-based gating to programs.
-- Generated programs produce 60 days (12 weeks) but display 20 at a time.
-- phase: which 20-day block is currently visible (1, 2, or 3).
-- total_phases: how many phases the program has (default 1 for legacy programs).

ALTER TABLE programs
  ADD COLUMN phase integer NOT NULL DEFAULT 1,
  ADD COLUMN total_phases integer NOT NULL DEFAULT 1;
