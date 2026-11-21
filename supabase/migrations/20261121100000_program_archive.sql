-- Programming archive (founder decisions, 2026-11-21).
--
-- A generated program is ARCHIVED when its owner's Programming access ends
-- (subscription ends, payment never recovers, a plan change that drops
-- `programming`) or by an admin. Never by the athlete; an admin can restore.
-- To the generator, the billing checks and the scheduled jobs an archived
-- program does not exist: a returning subscriber is a brand-new athlete who
-- runs a fresh evaluation and starts a new program at Month 1. The archived
-- program stays readable (view only) and its logged sessions stay in the
-- training log and analytics under their original dates.
--
--   programs.archived_at                  when this program was archived.
--   athlete_profiles.programs_archived_at the person's most recent archive.
--     THE CUT-OFF used everywhere for "since the archive": an evaluation only
--     counts if it is newer, and the generator and the AI Coach do not read
--     evaluations, coach states or program logs from before it.
--
-- This migration archives NOBODY. Catching up athletes who churned before it
-- shipped is a separate, founder-approved step.
--
-- Idempotent + SQL-editor-ready.

BEGIN;

-- ─── 1. Columns + index ──────────────────────────────────────────────

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS programs_archived_at timestamptz;

-- "The user's latest unarchived generated program" — the lookup every
-- scheduler, billing check and generator entry point makes.
CREATE INDEX IF NOT EXISTS idx_programs_user_active_generated
  ON programs (user_id, created_at DESC)
  WHERE archived_at IS NULL AND source = 'generated';

-- ─── 2. Write fence ──────────────────────────────────────────────────
-- Same model and the same reason as 20260714000000_engine_months_write_fence:
-- the owner RLS policies on these tables have no column restriction, so
-- without a trigger an athlete could clear archived_at from the browser
-- console and keep training a program they no longer pay for. Only the
-- end-user roles are fenced; service_role (edge functions), postgres and the
-- owner inside SECURITY DEFINER admin RPCs pass.

-- Reads past RLS so the fence sees the program whoever is asking. Returns
-- false for a program that does not exist (a cascade already removed it).
CREATE OR REPLACE FUNCTION public.program_is_archived(p_program_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM programs WHERE id = p_program_id AND archived_at IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.program_is_archived(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.program_is_archived(uuid) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.protect_program_archive()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'archived_at is managed by the billing system'
          USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
        RAISE EXCEPTION 'archived_at is managed by the billing system'
          USING ERRCODE = '42501';
      END IF;
      IF OLD.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'This program is archived and can no longer be changed'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_program_archive ON programs;
CREATE TRIGGER trg_protect_program_archive
  BEFORE INSERT OR UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION public.protect_program_archive();

CREATE OR REPLACE FUNCTION public.protect_profile_archive_cutoff()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.programs_archived_at IS DISTINCT FROM OLD.programs_archived_at THEN
        RAISE EXCEPTION 'programs_archived_at is managed by the billing system'
          USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      IF NEW.programs_archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'programs_archived_at is managed by the billing system'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_archive_cutoff ON athlete_profiles;
CREATE TRIGGER trg_protect_profile_archive_cutoff
  BEFORE INSERT OR UPDATE ON athlete_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_archive_cutoff();

-- The days, blocks, movements and calendar entries of an archived program:
-- no insert, update or delete by an end user. One function, the parent
-- program resolved per table (TG_ARGV[0]). Both OLD and NEW are checked on an
-- update so a row can be moved neither out of nor into an archived program.
CREATE OR REPLACE FUNCTION public.protect_archived_program_rows()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text := TG_ARGV[0];
  v_program_ids uuid[] := ARRAY[]::uuid[];
  v_pid uuid;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_kind = 'workout' THEN
    IF TG_OP <> 'INSERT' THEN v_program_ids := v_program_ids || OLD.program_id; END IF;
    IF TG_OP <> 'DELETE' THEN v_program_ids := v_program_ids || NEW.program_id; END IF;
  ELSIF v_kind = 'block' THEN
    IF TG_OP <> 'INSERT' THEN
      v_program_ids := v_program_ids || (SELECT pw.program_id FROM program_workouts pw WHERE pw.id = OLD.program_workout_id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_program_ids := v_program_ids || (SELECT pw.program_id FROM program_workouts pw WHERE pw.id = NEW.program_workout_id);
    END IF;
  ELSIF v_kind = 'movement' THEN
    IF TG_OP <> 'INSERT' THEN
      v_program_ids := v_program_ids || (
        SELECT pw.program_id FROM program_blocks_v2 b
        JOIN program_workouts pw ON pw.id = b.program_workout_id
        WHERE b.id = OLD.block_id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_program_ids := v_program_ids || (
        SELECT pw.program_id FROM program_blocks_v2 b
        JOIN program_workouts pw ON pw.id = b.program_workout_id
        WHERE b.id = NEW.block_id);
    END IF;
  ELSIF v_kind = 'schedule' THEN
    -- Engine calendar entries carry no program day and are never fenced.
    IF TG_OP <> 'INSERT' AND OLD.program_workout_id IS NOT NULL THEN
      v_program_ids := v_program_ids || (SELECT pw.program_id FROM program_workouts pw WHERE pw.id = OLD.program_workout_id);
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.program_workout_id IS NOT NULL THEN
      v_program_ids := v_program_ids || (SELECT pw.program_id FROM program_workouts pw WHERE pw.id = NEW.program_workout_id);
    END IF;
  END IF;

  FOREACH v_pid IN ARRAY v_program_ids LOOP
    IF v_pid IS NOT NULL AND public.program_is_archived(v_pid) THEN
      RAISE EXCEPTION 'This program is archived and can no longer be changed'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_archived_program_workouts ON program_workouts;
CREATE TRIGGER trg_protect_archived_program_workouts
  BEFORE INSERT OR UPDATE OR DELETE ON program_workouts
  FOR EACH ROW EXECUTE FUNCTION public.protect_archived_program_rows('workout');

DROP TRIGGER IF EXISTS trg_protect_archived_program_blocks ON program_blocks_v2;
CREATE TRIGGER trg_protect_archived_program_blocks
  BEFORE INSERT OR UPDATE OR DELETE ON program_blocks_v2
  FOR EACH ROW EXECUTE FUNCTION public.protect_archived_program_rows('block');

DROP TRIGGER IF EXISTS trg_protect_archived_program_movements ON program_movements_v2;
CREATE TRIGGER trg_protect_archived_program_movements
  BEFORE INSERT OR UPDATE OR DELETE ON program_movements_v2
  FOR EACH ROW EXECUTE FUNCTION public.protect_archived_program_rows('movement');

DROP TRIGGER IF EXISTS trg_protect_archived_program_schedule ON training_schedule;
CREATE TRIGGER trg_protect_archived_program_schedule
  BEFORE INSERT OR UPDATE OR DELETE ON training_schedule
  FOR EACH ROW EXECUTE FUNCTION public.protect_archived_program_rows('schedule');

-- ─── 3. Archiving ────────────────────────────────────────────────────

-- What archiving does besides stamping the programs (shared by the billing
-- path and the admin button). Internal: no direct callers but the two
-- functions below.
--   * future calendar entries of those programs are removed (decision 10) —
--     "today" is the UTC date; an entry dated today survives only for an
--     athlete whose local date is still yesterday in UTC;
--   * the cut-off moves to now;
--   * the one free evaluation credit is given back (decision 3). GREATEST,
--     not +1: a credit the athlete never spent is not doubled;
--   * the retired resume-pending flag is cleared;
--   * a generation still running for one of those programs is stopped, so it
--     cannot write a new week or month into an archived program. A month
--     append names its program in resume_state, a week fill in program_id.
CREATE OR REPLACE FUNCTION public._apply_program_archive(
  p_user_id uuid,
  p_program_ids uuid[],
  p_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM training_schedule ts
  USING program_workouts pw
  WHERE ts.program_workout_id = pw.id
    AND pw.program_id = ANY (p_program_ids)
    AND ts.scheduled_date >= (p_at AT TIME ZONE 'UTC')::date;

  UPDATE athlete_profiles
  SET programs_archived_at = p_at,
      eval_credits_remaining = GREATEST(COALESCE(eval_credits_remaining, 0), 1),
      programming_resume_pending_at = NULL
  WHERE user_id = p_user_id;

  UPDATE program_jobs
  SET status = 'failed',
      error = 'Stopped: the program was archived (Programming access ended).',
      updated_at = p_at
  WHERE user_id = p_user_id
    AND status IN ('pending', 'processing')
    AND (
      program_id = ANY (p_program_ids)
      OR (resume_state -> 'continuation' ->> 'programId') IN (
        SELECT pid::text FROM unnest(p_program_ids) AS pid
      )
    );
END;
$$;

REVOKE ALL ON FUNCTION public._apply_program_archive(uuid, uuid[], timestamptz) FROM public, anon, authenticated;

-- Archive every unarchived generated program of one user. Called by the
-- billing path (edge functions, service role) once the user holds no
-- Programming access. Idempotent: with nothing left to archive it changes
-- nothing — in particular it does not hand out another evaluation credit.
-- Returns the number of programs archived.
CREATE OR REPLACE FUNCTION public.archive_user_programs(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_ids uuid[];
BEGIN
  WITH upd AS (
    UPDATE programs
    SET archived_at = v_now
    WHERE user_id = p_user_id
      AND source = 'generated'
      AND archived_at IS NULL
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM upd;

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM _apply_program_archive(p_user_id, v_ids, v_now);
  RETURN array_length(v_ids, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_user_programs(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_user_programs(uuid) TO service_role;

-- Admin: archive one program. Same side effects as the billing path, for
-- that one program. Archiving an already archived program is a no-op.
CREATE OR REPLACE FUNCTION public.admin_archive_program(p_program_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid;
  v_source text;
  v_archived_at timestamptz;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, source, archived_at INTO v_user_id, v_source, v_archived_at
  FROM programs WHERE id = p_program_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Program not found';
  END IF;
  IF v_source <> 'generated' THEN
    RAISE EXCEPTION 'Only AI-generated programs can be archived';
  END IF;
  IF v_archived_at IS NOT NULL THEN
    RETURN;
  END IF;

  PERFORM log_admin_access(
    v_user_id,
    'program_archive',
    jsonb_build_object('program_id', p_program_id)
  );

  UPDATE programs SET archived_at = v_now WHERE id = p_program_id;
  PERFORM _apply_program_archive(v_user_id, ARRAY[p_program_id], v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_archive_program(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_archive_program(uuid) TO authenticated;

-- Admin: restore an archived program. Refused while the owner has another
-- unarchived generated program (decision 11) — two live programs would both
-- be filled by the weekly job and "the latest program" would stop meaning
-- one thing. The evaluation credit is left alone, and what was removed at
-- archive time (calendar entries, a stopped generation) is not put back.
-- The CUT-OFF is moved back to the athlete's most recent REMAINING archive
-- (null when none): restore exists for the card that failed and was fixed a
-- week later, and that athlete's evaluation, coach letter and logs from
-- before the archive are theirs again — with the cut-off left in place the
-- restored program's next week would be written without its evaluation.
CREATE OR REPLACE FUNCTION public.admin_restore_program(p_program_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_archived_at timestamptz;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, archived_at INTO v_user_id, v_archived_at
  FROM programs WHERE id = p_program_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Program not found';
  END IF;
  IF v_archived_at IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM programs
    WHERE user_id = v_user_id
      AND source = 'generated'
      AND archived_at IS NULL
      AND id <> p_program_id
  ) THEN
    RAISE EXCEPTION 'This athlete already has an active program. Archive it before restoring this one.';
  END IF;

  PERFORM log_admin_access(
    v_user_id,
    'program_restore',
    jsonb_build_object('program_id', p_program_id)
  );

  UPDATE programs SET archived_at = NULL WHERE id = p_program_id;

  UPDATE athlete_profiles
  SET programs_archived_at = (
    SELECT MAX(archived_at) FROM programs
    WHERE user_id = v_user_id AND source = 'generated' AND archived_at IS NOT NULL
  )
  WHERE user_id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_restore_program(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_restore_program(uuid) TO authenticated;

-- ─── 4. The returner pause flag is retired ───────────────────────────
-- A returner now has no active program, so nothing waits on a "Build my next
-- month" tap. A flag left set would keep the resume emails going for a
-- button that is no longer shown.
UPDATE athlete_profiles
SET programming_resume_pending_at = NULL
WHERE programming_resume_pending_at IS NOT NULL;

-- ─── 5. Admin program list: expose archived_at ───────────────────────
-- Identical to the 20260415070000 definition plus archived_at, so the admin
-- list can label archived programs. (admin_get_program returns
-- to_jsonb(programs row) and so carries the new column without a change.)
CREATE OR REPLACE FUNCTION public.admin_list_programs(
  target_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'source', p.source,
      'gym_name', p.gym_name,
      'is_ongoing', p.is_ongoing,
      'committed', p.committed,
      'generated_months', p.generated_months,
      'subscription_start', p.subscription_start,
      'created_at', p.created_at,
      'archived_at', p.archived_at,
      'workout_count', (SELECT COUNT(*) FROM program_workouts WHERE program_id = p.id)
    ) ORDER BY p.created_at DESC
  ) INTO result
  FROM programs p
  WHERE p.user_id = target_user_id;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_programs(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_programs(uuid) TO authenticated;

-- ─── 6. Previous-cycle summary ignores archived programs ─────────────
-- Identical to the 20260823000000 definition except for the one line that
-- picks the program (AND p.archived_at IS NULL): a returner's new Month 1
-- must not open with a review of, or progress its loads from, a program
-- they left behind.

CREATE OR REPLACE FUNCTION user_previous_cycle_summary(target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  v_skill_keys text[] := ARRAY[
    'muscle_ups','bar_muscle_ups','strict_ring_muscle_ups',
    'toes_to_bar',
    'strict_pull_ups','kipping_pull_ups','butterfly_pull_ups','chest_to_bar_pull_ups',
    'rope_climbs','legless_rope_climbs',
    'wall_facing_hspu','hspu','strict_hspu','deficit_hspu',
    'ring_dips','l_sit','handstand_walk','double_unders','pistols','ghd_sit_ups'
  ];
  v_program_id uuid;
  v_program_name text;
  v_last_completed_date date;
  v_logged boolean;
  v_strength json;
  v_conditioning json;
  v_skill_volume json;
  v_block_notes json;
BEGIN
  -- Most-recently-active completed program (last log date wins).
  SELECT p.id, p.name, MAX(wl.workout_date)
  INTO v_program_id, v_program_name, v_last_completed_date
  FROM programs p
  JOIN program_workouts pw ON pw.program_id = p.id
  JOIN workout_logs wl ON wl.source_id = pw.id AND wl.status = 'completed'
  WHERE p.user_id = target_user_id
    AND p.archived_at IS NULL
  GROUP BY p.id, p.name
  ORDER BY MAX(wl.workout_date) DESC NULLS LAST
  LIMIT 1;

  IF v_program_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM workout_log_entries wle
    JOIN workout_logs wl ON wl.id = wle.log_id
    JOIN program_workouts pw ON pw.id = wl.source_id
    WHERE pw.program_id = v_program_id AND wl.status = 'completed'
  ) INTO v_logged;

  -- STRENGTH: prescription backbone (always present for a v3 prior cycle; empty
  -- for v1) LEFT JOIN logged actuals (additive — null when unlogged).
  WITH presc AS (
    SELECT
      LOWER(REGEXP_REPLACE(TRIM(pm.movement), '[-\s]+', '_', 'g')) AS lift,
      MAX(pm.target_pct_1rm) AS top_pct_1rm,
      MAX(pm.weight) FILTER (WHERE pm.weight_unit = 'lbs') AS top_weight,
      COUNT(*)::int AS sessions
    FROM program_movements_v2 pm
    JOIN program_blocks_v2 pb ON pb.id = pm.block_id
    JOIN program_workouts pw ON pw.id = pb.program_workout_id
    WHERE pw.program_id = v_program_id
      AND pb.block_type IN ('strength', 'accessory')
    GROUP BY 1
  ),
  actuals AS (
    SELECT
      LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g')) AS lift,
      -- Effort lives on the block since the logging-fidelity redesign; per-set
      -- rpe still counts for pre-redesign logs.
      ROUND(AVG(COALESCE(wle.rpe, wlb.rpe))::numeric, 1) AS logged_avg_rpe,
      ROUND(
        100.0 * COUNT(*) FILTER (
          WHERE wle.prescribed_weight IS NOT NULL AND wle.weight IS NOT NULL
            AND wle.weight >= wle.prescribed_weight
        )
        / NULLIF(COUNT(*) FILTER (
          WHERE wle.prescribed_weight IS NOT NULL AND wle.weight IS NOT NULL
        ), 0)
      )::int AS logged_hit_rate
    FROM workout_log_entries wle
    JOIN workout_logs wl ON wl.id = wle.log_id
    JOIN program_workouts pw ON pw.id = wl.source_id
    LEFT JOIN workout_log_blocks wlb ON wlb.id = wle.block_id
    WHERE pw.program_id = v_program_id AND wl.status = 'completed'
    GROUP BY 1
  )
  SELECT json_agg(
    json_build_object(
      'lift', presc.lift,
      'top_pct_1rm', presc.top_pct_1rm,
      'top_weight', presc.top_weight,
      'sessions', presc.sessions,
      'logged_avg_rpe', a.logged_avg_rpe,
      'logged_hit_rate', a.logged_hit_rate
    ) ORDER BY presc.sessions DESC, presc.lift
  )
  INTO v_strength
  FROM presc
  LEFT JOIN actuals a USING (lift);

  -- CONDITIONING: metcon time-domain coverage from prescribed time caps.
  WITH metcons AS (
    SELECT pb.time_cap_seconds AS cap
    FROM program_blocks_v2 pb
    JOIN program_workouts pw ON pw.id = pb.program_workout_id
    WHERE pw.program_id = v_program_id AND pb.block_type = 'metcon'
  )
  SELECT json_build_object(
    'metcons', COUNT(*),
    'time_domains', json_build_object(
      'short',   COUNT(*) FILTER (WHERE cap IS NOT NULL AND cap < 480),
      'medium',  COUNT(*) FILTER (WHERE cap >= 480 AND cap <= 900),
      'long',    COUNT(*) FILTER (WHERE cap > 900),
      'untimed', COUNT(*) FILTER (WHERE cap IS NULL)
    )
  )
  INTO v_conditioning
  FROM metcons;

  -- SKILL VOLUME: reps/holds actually logged (positive signal only).
  WITH matched AS (
    SELECT
      CASE
        WHEN LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g')) = ANY(v_skill_keys)
          THEN LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g'))
        WHEN (LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g')) || 's') = ANY(v_skill_keys)
          THEN LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g')) || 's'
        ELSE NULL
      END AS skill_key,
      wl.workout_date AS day,
      wle.reps_completed,
      wle.reps,
      wle.hold_seconds
    FROM workout_log_entries wle
    JOIN workout_logs wl ON wl.id = wle.log_id
    JOIN program_workouts pw ON pw.id = wl.source_id
    WHERE pw.program_id = v_program_id AND wl.status = 'completed'
  ),
  agg AS (
    SELECT
      skill_key,
      SUM(COALESCE(reps_completed, reps, 0))::int AS total_reps,
      SUM(COALESCE(hold_seconds, 0))::int AS total_hold_seconds,
      COUNT(DISTINCT day)::int AS day_count
    FROM matched
    WHERE skill_key IS NOT NULL
    GROUP BY skill_key
    HAVING SUM(COALESCE(reps_completed, reps, 0)) > 0
        OR SUM(COALESCE(hold_seconds, 0)) > 0
  )
  SELECT json_object_agg(
    skill_key,
    json_build_object('total_reps', total_reps, 'total_hold_seconds', total_hold_seconds, 'days', day_count)
  )
  INTO v_skill_volume
  FROM agg;

  -- BLOCK NOTES: the athlete's own words, newest first, bounded.
  WITH noted AS (
    SELECT
      COALESCE(b.performed_date, wl.workout_date) AS day,
      b.block_type,
      LEFT(TRIM(b.notes), 500) AS note
    FROM workout_log_blocks b
    JOIN workout_logs wl ON wl.id = b.log_id
    JOIN program_workouts pw ON pw.id = wl.source_id
    WHERE pw.program_id = v_program_id
      AND wl.status = 'completed'
      AND b.notes IS NOT NULL AND TRIM(b.notes) <> ''
    ORDER BY COALESCE(b.performed_date, wl.workout_date) DESC, b.sort_order
    LIMIT 30
  )
  SELECT json_agg(
    json_build_object('date', day, 'block_type', block_type, 'note', note)
    ORDER BY day DESC
  )
  INTO v_block_notes
  FROM noted;

  SELECT json_build_object(
    'program_id', v_program_id,
    'program_name', v_program_name,
    'last_completed_date', v_last_completed_date,
    'logged', v_logged,
    'strength', COALESCE(v_strength, '[]'::json),
    'conditioning', v_conditioning,
    'skill_volume', COALESCE(v_skill_volume, '{}'::json),
    'block_notes', COALESCE(v_block_notes, '[]'::json)
  )
  INTO result;

  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
