-- Engine days become once-and-done on the calendar, like program days.
--
-- Previously the only engine constraint was one session per DATE
-- (uniq_schedule_engine_per_day), which let the same engine day be scheduled to
-- many dates. Product rule change: a given engine_workout_id may appear at most
-- ONCE in training_schedule per user. Users can still DO/repeat an engine day
-- (engine_workout_sessions is unaffected); they just can't schedule a repeat.

-- 1) Collapse any existing duplicate engine schedule rows, keeping the earliest.
DELETE FROM training_schedule t
USING training_schedule d
WHERE t.engine_workout_id IS NOT NULL
  AND t.user_id = d.user_id
  AND t.engine_workout_id = d.engine_workout_id
  AND (t.created_at, t.id) > (d.created_at, d.id);

-- 2) Enforce one schedule row per (user, engine day).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_schedule_engine_once
  ON training_schedule(user_id, engine_workout_id)
  WHERE engine_workout_id IS NOT NULL;
