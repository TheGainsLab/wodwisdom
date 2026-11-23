-- coach_states.inputs_hash (2026-11-23).
--
-- A stored coach state (the coach's judgment of an athlete: priorities,
-- metcon guidance, the letter) is reused for the next build whenever the
-- athlete model version and the builder version are unchanged. The athlete
-- model does not contain the athlete's goal, days per week, session length,
-- injury text or their notes, so a judgment could be reused after any of
-- those changed: a program could be built from priorities that predate the
-- goal.
--
--   inputs_hash   SHA-256 (hex) of exactly those five inputs — goal text,
--     days per week, session length, injuries text, active coach notes — as
--     they were when the row was written (coachStateInputsHash in
--     supabase/functions/_shared/generate-coach-state.ts). A stored state is
--     reused only when this also matches the athlete's current inputs.
--
-- NULL means "written before this column existed" and is treated as DOES NOT
-- MATCH: no existing row is rewritten or back-filled, and every athlete gets
-- one fresh coach state at their next build, after which reuse resumes.
--
-- Nullable, no default, no data rewrite, no index (the reuse read is already
-- served by idx_coach_states_user_version). Safe to run twice.

ALTER TABLE coach_states
  ADD COLUMN IF NOT EXISTS inputs_hash text;

COMMENT ON COLUMN coach_states.inputs_hash IS
  'SHA-256 of the profile inputs this judgment was made from (goal text, days per week, session length, injuries text, active coach notes). A stored state is reused only when it matches the current inputs. NULL = written before 2026-11-23: never matches, so the next build writes a fresh state.';
