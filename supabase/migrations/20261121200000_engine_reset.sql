-- Engine reset (founder decisions, 2026-11-21).
--
-- When a person's Engine access ends (subscription ends, payment never
-- recovers, a plan change or new purchase that drops `engine`, an admin
-- revoke) the Engine is RESET for them, at that moment, server side. On
-- return they see the two-question setup and start at Day 1 with the
-- sequencer on, as a new athlete would. What the reset does:
--
--   * every track is stamped as restarted (athlete_profiles.engine_restarts,
--     the mechanism restartProgram() already uses), so no track remembers a
--     position;
--   * the program choice is cleared (engine_program_version = NULL),
--     engine_current_day = 1, engine_ai_sequencing = false (setup turns it
--     back on);
--   * pacing calibration is cleared as restartProgram() clears it (rolling
--     performance metrics deleted, every time trial's is_current = false) and
--     the Continuum curve (engine_curve) is cleared too;
--   * future Engine calendar entries are removed;
--   * sequencer-written days (engine_user_day_overrides): a day the athlete
--     COMPLETED is kept as history and ARCHIVED (archived_at) so it is never
--     served again at that position; a day they never completed is deleted.
--
-- What it never touches: engine_workout_sessions and engine_time_trials rows
-- (the training log, analytics, records and leaderboard keep everything) and
-- engine_months_unlocked (paid access is not a progress concept).
--
--   engine_user_day_overrides.archived_at   when this sequenced day was
--     retired by a reset. NULL = live. Every reader that serves or lists days
--     by position reads live rows only; the one reader that looks at archived
--     rows is the Continuum, to recover what a PAST session prescribed.
--   athlete_profiles.engine_reset_at        the person's most recent reset.
--     THE CUT-OFF for pacing: the Continuum curve is rebuilt only from
--     sessions and time trials logged after it. Without it the daily curve
--     refresh would rebuild the cleared curve from the old sessions overnight.
--
-- This migration resets NOBODY. Catching up people who left before it shipped
-- is a separate, founder-approved step (reset_engine_for_user per person).
--
-- Idempotent + SQL-editor-ready.

BEGIN;

-- ─── 1. Columns ──────────────────────────────────────────────────────

ALTER TABLE engine_user_day_overrides
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS engine_reset_at timestamptz;

COMMENT ON COLUMN engine_user_day_overrides.archived_at IS
  'Set by reset_engine_for_user: this sequenced day was completed before an Engine reset. Kept as the record of what that session prescribed; never served again. NULL = live.';
COMMENT ON COLUMN athlete_profiles.engine_reset_at IS
  'Most recent Engine reset (access ended). The Continuum curve is built only from sessions and time trials after it. Written by reset_engine_for_user.';

-- ─── 2. One LIVE override per position ───────────────────────────────
-- The (user, program, position) uniqueness now applies to live rows only, so
-- the sequencer can write a new day at a position that holds an archived one.
-- A partial index cannot be the target of a plain ON CONFLICT (cols), so the
-- sequencer no longer upserts: it replaces the live row (run-resequence.ts).
-- That was the only writer with an onConflict target on this table.

ALTER TABLE engine_user_day_overrides
  DROP CONSTRAINT IF EXISTS engine_user_day_overrides_user_program_pos_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_engine_overrides_live_position
  ON engine_user_day_overrides (user_id, program_version, sequence_position)
  WHERE archived_at IS NULL;

-- ─── 3. An athlete never sees or changes an archived override ────────
-- The owner policies had no archive condition. Narrowing them (rather than a
-- trigger) does two jobs at once: an app bundle that predates this migration
-- cannot be served an archived day, and nobody can clear archived_at from the
-- browser console to get an old day served again. service_role (the
-- sequencer, the Continuum, the reset) bypasses RLS and sees everything.

DROP POLICY IF EXISTS "Users select own engine overrides" ON engine_user_day_overrides;
CREATE POLICY "Users select own engine overrides" ON engine_user_day_overrides
  FOR SELECT USING (user_id = auth.uid() AND archived_at IS NULL);

DROP POLICY IF EXISTS "Users insert own engine overrides" ON engine_user_day_overrides;
CREATE POLICY "Users insert own engine overrides" ON engine_user_day_overrides
  FOR INSERT WITH CHECK (user_id = auth.uid() AND archived_at IS NULL);

DROP POLICY IF EXISTS "Users update own engine overrides" ON engine_user_day_overrides;
CREATE POLICY "Users update own engine overrides" ON engine_user_day_overrides
  FOR UPDATE USING (user_id = auth.uid() AND archived_at IS NULL)
  WITH CHECK (user_id = auth.uid() AND archived_at IS NULL);

DROP POLICY IF EXISTS "Users delete own engine overrides" ON engine_user_day_overrides;
CREATE POLICY "Users delete own engine overrides" ON engine_user_day_overrides
  FOR DELETE USING (user_id = auth.uid() AND archived_at IS NULL);

-- ─── 4. The reset ────────────────────────────────────────────────────
-- One transaction (a function body is one). Called by the billing path and
-- the admin revoke (edge functions, service role) once the person holds no
-- Engine access — _shared/engine-reset.ts makes that check; this function
-- does not, so it can also be run per person for a vetted catch-up list.
--
-- IDEMPOTENT. "Already reset" = nothing is left for a reset to change: no
-- program chosen, pointer at 1, sequencer off, no curve, and no live
-- override, performance metric, current time trial or future Engine calendar
-- entry. In that state it returns acted=false and writes nothing — in
-- particular it does not move the restart stamps or engine_reset_at, so a
-- re-emitted billing event cannot disturb anything. (A person who never used
-- the Engine is in that state from the start.)
--
-- "Completed" for a sequenced day = a completed session exists for the same
-- user, program and position, logged at or after the day was written. That is
-- the sequencer's own block-consumed notion (a session at that position since
-- the athlete's last restart — a restart deletes that program's days, so any
-- day still present was written after it), stated without parsing the
-- client-writable restart stamps.
CREATE OR REPLACE FUNCTION public.reset_engine_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'UTC')::date;
  v_has_profile boolean;
  v_program text;
  v_day integer;
  v_sequencing boolean;
  v_has_curve boolean;
  v_restarts jsonb;
  v_tracks integer := 0;
  v_deleted integer := 0;
  v_archived integer := 0;
  v_schedule integer := 0;
  -- Same shape restartProgram() writes (JS toISOString), so every reader of
  -- engine_restarts parses one format.
  v_stamp text := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  SELECT engine_program_version, engine_current_day, engine_ai_sequencing,
         engine_curve IS NOT NULL, COALESCE(engine_restarts, '{}'::jsonb)
  INTO v_program, v_day, v_sequencing, v_has_curve, v_restarts
  FROM athlete_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;
  v_has_profile := FOUND;
  -- engine_restarts is client-writable: anything but an object is treated as empty.
  IF v_restarts IS NULL OR jsonb_typeof(v_restarts) <> 'object' THEN
    v_restarts := '{}'::jsonb;
  END IF;

  IF NOT (
    (v_has_profile AND (
      v_program IS NOT NULL
      OR COALESCE(v_day, 1) <> 1
      OR COALESCE(v_sequencing, false)
      OR COALESCE(v_has_curve, false)
    ))
    OR EXISTS (SELECT 1 FROM engine_user_day_overrides WHERE user_id = p_user_id AND archived_at IS NULL)
    OR EXISTS (SELECT 1 FROM engine_user_performance_metrics WHERE user_id = p_user_id)
    OR EXISTS (SELECT 1 FROM engine_time_trials WHERE user_id = p_user_id AND is_current)
    OR EXISTS (
      SELECT 1 FROM training_schedule
      WHERE user_id = p_user_id AND engine_workout_id IS NOT NULL AND scheduled_date >= v_today
    )
  ) THEN
    RETURN jsonb_build_object('acted', false);
  END IF;

  -- Sequenced days: never completed -> deleted; completed -> archived.
  WITH del AS (
    DELETE FROM engine_user_day_overrides o
    WHERE o.user_id = p_user_id
      AND o.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM engine_workout_sessions s
        WHERE s.user_id = o.user_id
          AND s.completed
          AND s.program_version = o.program_version
          AND s.sequence_position = o.sequence_position
          AND s.created_at >= o.created_at
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  WITH upd AS (
    UPDATE engine_user_day_overrides
    SET archived_at = v_now
    WHERE user_id = p_user_id AND archived_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_archived FROM upd;

  -- Pacing calibration, as restartProgram() clears it. Rows of
  -- engine_time_trials stay (analytics, history); only "current" goes.
  DELETE FROM engine_user_performance_metrics WHERE user_id = p_user_id;
  UPDATE engine_time_trials SET is_current = false WHERE user_id = p_user_id AND is_current;

  -- Future Engine calendar entries. "Today" is the UTC date, as in the
  -- Programming archive.
  WITH del AS (
    DELETE FROM training_schedule
    WHERE user_id = p_user_id AND engine_workout_id IS NOT NULL AND scheduled_date >= v_today
    RETURNING 1
  )
  SELECT count(*) INTO v_schedule FROM del;

  IF v_has_profile THEN
    -- Every track: the catalogue's programs, every program the person has a
    -- session under (legacy ids included), the current one, and any key
    -- already stamped. A stamp on a track never trained is harmless.
    SELECT v_restarts || COALESCE(jsonb_object_agg(k, to_jsonb(v_stamp)), '{}'::jsonb), count(*)
    INTO v_restarts, v_tracks
    FROM (
      SELECT id AS k FROM engine_programs
      UNION
      SELECT DISTINCT program_version FROM engine_workout_sessions
        WHERE user_id = p_user_id AND program_version IS NOT NULL
      UNION
      SELECT v_program WHERE v_program IS NOT NULL
      UNION
      SELECT jsonb_object_keys(v_restarts)
    ) t;

    UPDATE athlete_profiles
    SET engine_restarts = v_restarts,
        engine_program_version = NULL,
        engine_current_day = 1,
        engine_ai_sequencing = false,
        engine_curve = NULL,
        engine_reset_at = v_now
    WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'acted', true,
    'reset_at', v_now,
    'previous_program', v_program,
    'tracks_stamped', v_tracks,
    'days_archived', v_archived,
    'days_deleted', v_deleted,
    'calendar_entries_removed', v_schedule
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_engine_for_user(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_engine_for_user(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
