-- engine_ai_sequencing — per-user opt-in for the AI self-sequencer's LIVE writes.
--
-- The cron reconciler (engine-resequence-cron) only generates real AI days for a
-- user when this flag is true. Default false, so nothing is touched until an admin
-- explicitly switches a user on (test athletes first, then widen). Doubles as a
-- per-user kill-switch. The admin dry-run preview is unaffected — it never writes
-- and works for any user regardless of this flag.

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS engine_ai_sequencing boolean NOT NULL DEFAULT false;
