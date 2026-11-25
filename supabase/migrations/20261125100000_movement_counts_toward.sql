-- What a movement counts toward (2026-11-25).
--
-- Each written movement, and each logged entry, records which of the athlete's
-- PROFILE lifts or skills it counts toward. The AI that writes the movement
-- decides; code reads the answer and never the name.
--
-- Why: the profile stores a skill as `chest_to_bar_pull_ups`, the movement
-- catalogue calls the same thing "Chest To Bar", and the carry-over into the
-- next month compared the two by spelling. 236 written "Chest To Bar", 192
-- "Pull Up", 69 "Handstand Push Up", 62 "Ring Muscle Up" and 62 "Strict Ring
-- Dip" were never counted.
--
-- Values: a profile lift key, a profile skill key, 'none' (the AI says
-- neither), or NULL (not labelled yet). Nullable, no default, no rewrite of
-- existing rows: every reader treats NULL exactly as it treated the row
-- before this migration. Existing rows are labelled afterwards by the
-- label-movements function, one distinct name at a time.

ALTER TABLE public.program_movements_v2 ADD COLUMN IF NOT EXISTS counts_toward text;
ALTER TABLE public.workout_log_entries  ADD COLUMN IF NOT EXISTS counts_toward text;

COMMENT ON COLUMN public.program_movements_v2.counts_toward IS
  'Profile lift or skill key this movement counts toward, ''none'', or NULL when not yet labelled. Written by the AI; see supabase/functions/_shared/counts-toward.ts.';
COMMENT ON COLUMN public.workout_log_entries.counts_toward IS
  'Copied from the prescribed movement when the entry is logged; same values as program_movements_v2.counts_toward.';

-- ─── Labelling the rows that already exist ───────────────────────────
-- The distinct movement names nobody has labelled yet, most used first.
-- Service role only (the label-movements function).
CREATE OR REPLACE FUNCTION public.unlabelled_movement_names(p_limit int DEFAULT 200)
RETURNS TABLE (movement text, uses bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT name, SUM(n)::bigint AS uses
  FROM (
    SELECT TRIM(pm.movement) AS name, COUNT(*) AS n
    FROM program_movements_v2 pm
    WHERE pm.counts_toward IS NULL AND pm.movement IS NOT NULL AND TRIM(pm.movement) <> ''
    GROUP BY TRIM(pm.movement)
    UNION ALL
    SELECT TRIM(wle.movement) AS name, COUNT(*) AS n
    FROM workout_log_entries wle
    WHERE wle.counts_toward IS NULL AND wle.movement IS NOT NULL AND TRIM(wle.movement) <> ''
    GROUP BY TRIM(wle.movement)
  ) u
  GROUP BY name
  ORDER BY SUM(n) DESC, name
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000));
$$;
REVOKE ALL ON FUNCTION public.unlabelled_movement_names(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlabelled_movement_names(int) TO service_role;

-- Store one name's answer on every row that carries exactly that name and has
-- no answer yet. Never overwrites an answer already there.
CREATE OR REPLACE FUNCTION public.apply_movement_label(p_movement text, p_counts_toward text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a int; b int;
BEGIN
  IF p_movement IS NULL OR TRIM(p_movement) = '' OR p_counts_toward IS NULL THEN RETURN 0; END IF;
  UPDATE program_movements_v2 SET counts_toward = p_counts_toward
    WHERE counts_toward IS NULL AND TRIM(movement) = TRIM(p_movement);
  GET DIAGNOSTICS a = ROW_COUNT;
  UPDATE workout_log_entries SET counts_toward = p_counts_toward
    WHERE counts_toward IS NULL AND TRIM(movement) = TRIM(p_movement);
  GET DIAGNOSTICS b = ROW_COUNT;
  RETURN a + b;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_movement_label(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_movement_label(text, text) TO service_role;

-- ─── The carry-over reads the answer ─────────────────────────────────
-- Identical to the 20261121100000 definition except for the skill_key CASE:
-- a labelled entry follows its label; an unlabelled one is compared by
-- spelling exactly as before.

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
        -- The AI's answer for this entry (2026-11-25). A key from the profile's
        -- skill list counts; "none" or a lift key does not.
        WHEN wle.counts_toward IS NOT NULL
          THEN CASE WHEN wle.counts_toward = ANY(v_skill_keys) THEN wle.counts_toward ELSE NULL END
        -- Not labelled yet: the earlier spelling comparison, unchanged, so an
        -- unlabelled entry is counted exactly as it was before.
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
