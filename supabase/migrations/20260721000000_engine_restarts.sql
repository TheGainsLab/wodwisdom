-- Engine program restarts: per-program "start over from Day 1" timestamps.
--
-- July '26 field report: a new subscriber spent four AI Coach questions in
-- ten minutes trying to restart the program ("Can I clear my history and
-- start over?" / "I want to start from day 1, how do I do so?") because no
-- restart affordance exists — switchProgram deliberately resumes at the
-- furthest completed day.
--
-- Semantics: ARCHIVE, not delete. engine_restarts maps program_id -> the
-- ISO timestamp of the most recent restart. Sessions completed BEFORE that
-- moment stop counting toward program progress (dashboard completed-days,
-- prior-session checks, Rocket Races pairing, switchProgram's resume point)
-- but remain in engine_workout_sessions for PRs, analytics, and the
-- leaderboard — beating your old numbers is the point of coming back.
-- restartProgram() (client) also clears pacing calibration (performance
-- metrics + current time-trial flags) so Day 1's time trial sets a genuinely
-- fresh baseline: "starting over" feels like starting over.
--
-- Client-writable by design (a preference, not an entitlement — the
-- 20260714000000 fence trigger guards only the engine_months columns).

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS engine_restarts jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN athlete_profiles.engine_restarts IS
  'Per-program restart timestamps: {program_id: ISO timestamp}. Sessions before the timestamp are archived out of program progress but kept for PRs/analytics. Written by restartProgram() client-side.';
