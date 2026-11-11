-- =============================================================================
-- Engine test athlete — a synthetic 3-day subscriber who has just finished the
-- assessment month (positions 1–12 of main_3day complete, pointer at 13 = the
-- month-two time trial). Lets the sequencer be exercised end to end before any
-- real subscriber reaches month two:
--
--   * Admin → Users → this athlete → "Engine AI Preview" runs the gate, the
--     diagnosis (with the ENGINE ANALYTICS block) and the Sonnet 5.5 call as a
--     dry run — writes nothing.
--   * engine_ai_sequencing is ON and no overrides exist, so the resequence
--     cron (every 15 min) generates the real month-two block. Logged in as the
--     athlete you can see it, log the time trial, and watch the next block.
--
-- HOW TO RUN: create the auth user first (Supabase → Authentication → Users →
-- Add user, auto-confirm). Set the email below. Paste the whole file into the
-- SQL editor and run it ONCE as a single statement (no begin/commit).
-- IDEMPOTENT: re-running wipes this athlete's Engine rows and rebuilds them;
-- the entitlement rows are kept. Only this one user is ever touched.
--
-- Modality: echo bike, calories. Baseline 120 cal in 10:00 → 12.0 cal/min.
-- Anaerobic ≈ 1.4× baseline and rising, max aerobic a little over target,
-- endurance on target — a healthy, consistent month, nothing pathological.
-- =============================================================================

DO $$
DECLARE
  v_email text := 'tfish1492+test@gmail.com';   -- <<< the test account
  v_uid   uuid;
  v_today date := current_date;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No auth user with email %. Create it in Authentication → Users first.', v_email;
  END IF;

  -- ---- reset this athlete's Engine rows (never anyone else's) --------------
  DELETE FROM engine_user_day_overrides        WHERE user_id = v_uid;
  DELETE FROM engine_user_performance_metrics  WHERE user_id = v_uid;
  DELETE FROM engine_workout_sessions          WHERE user_id = v_uid;
  DELETE FROM engine_time_trials               WHERE user_id = v_uid;

  -- ---- entitlements: what a real Engine purchase grants (stripe-webhook
  -- PLAN_FEATURES.engine = engine + ai_chat + nutrition); source → 'admin' kind
  INSERT INTO user_entitlements (user_id, feature, source)
  VALUES (v_uid, 'engine',    'seed:engine_test_athlete'),
         (v_uid, 'ai_chat',   'seed:engine_test_athlete'),
         (v_uid, 'nutrition', 'seed:engine_test_athlete')
  ON CONFLICT DO NOTHING;

  -- ---- profile: 3-day program, assessment month done, sequencer on ----------
  INSERT INTO athlete_profiles (user_id, engine_program_version, engine_current_day,
                                engine_months_unlocked, engine_ai_sequencing, engine_goal, goal)
  VALUES (v_uid, 'main_3day', 13, 2, true,
          'Build a bigger aerobic base for CrossFit metcons without losing top-end power.',
          'Build a bigger aerobic base for CrossFit metcons without losing top-end power.')
  ON CONFLICT (user_id) DO UPDATE SET
    engine_program_version = EXCLUDED.engine_program_version,
    engine_current_day     = EXCLUDED.engine_current_day,
    engine_months_unlocked = GREATEST(COALESCE(athlete_profiles.engine_months_unlocked, 0), EXCLUDED.engine_months_unlocked),
    engine_ai_sequencing   = EXCLUDED.engine_ai_sequencing,
    engine_goal            = EXCLUDED.engine_goal,
    goal                   = EXCLUDED.goal,
    updated_at             = now();

  -- ---- time trial: day 1 of month one, four weeks ago -----------------------
  INSERT INTO engine_time_trials (user_id, modality, date, total_output, calculated_rpm, units, is_current)
  VALUES (v_uid, 'echo_bike', v_today - 27, 120, 12.0, 'cal', true);

  -- ---- the twelve month-one sessions (positions 1–12, 3/week, 4 weeks) ------
  -- catalog days for main_3day month 1: 1,2,4,6,7,8,11,12,15,16,19,20
  INSERT INTO engine_workout_sessions
    (user_id, date, program_day, program_day_number, sequence_position, day_type, modality, units,
     target_pace, actual_pace, total_output, performance_ratio, calculated_rpm,
     average_heart_rate, peak_heart_rate, perceived_exertion, completed, program_version, workout_data, created_at)
  VALUES
  -- week 1
  (v_uid, v_today - 27, 1, 1, 1, 'time_trial', 'echo_bike', 'cal',
     NULL, 12.0, 120, NULL, 12.0, 170, 185, 10, true, 'main_3day',
     '{"total_intervals":1,"total_rest_time":0,"total_work_time":600,"avg_work_rest_ratio":null,"intervals_completed":1}',
     (v_today - 27) + time '07:10'),
  (v_uid, v_today - 25, 2, 2, 2, 'anaerobic', 'echo_bike', 'cal',
     NULL, 16.667, 50, NULL, 16.667, 165, 182, 9, true, 'main_3day',
     '{"interval_scores":[9,8,8,8,8,9],"total_intervals":6,"total_rest_time":900,"total_work_time":180,"avg_work_rest_ratio":0.2,"intervals_completed":6}',
     (v_today - 25) + time '07:05'),
  (v_uid, v_today - 23, 4, 4, 3, 'max_aerobic_power', 'echo_bike', 'cal',
     11.4, 11.625, 186, 1.0197, 11.625, 158, 172, 7, true, 'main_3day',
     '{"interval_scores":[47,47,46,46],"total_intervals":4,"total_rest_time":960,"total_work_time":960,"avg_work_rest_ratio":1.0,"intervals_completed":4}',
     (v_today - 23) + time '07:12'),
  -- week 2
  (v_uid, v_today - 20, 6, 6, 4, 'anaerobic', 'echo_bike', 'cal',
     NULL, 16.875, 45, NULL, 16.875, 166, 183, 9, true, 'main_3day',
     '{"interval_scores":[6,6,6,5,6,5,6,5],"total_intervals":8,"total_rest_time":800,"total_work_time":160,"avg_work_rest_ratio":0.2,"intervals_completed":8}',
     (v_today - 20) + time '07:08'),
  (v_uid, v_today - 18, 7, 7, 5, 'endurance', 'echo_bike', 'cal',
     8.4, 8.5, 204, 1.0119, 8.5, 142, 150, 5, true, 'main_3day',
     '{"total_intervals":1,"total_rest_time":0,"total_work_time":1440,"avg_work_rest_ratio":null,"intervals_completed":1}',
     (v_today - 18) + time '07:00'),
  (v_uid, v_today - 16, 8, 8, 6, 'max_aerobic_power', 'echo_bike', 'cal',
     11.5, 12.0, 144, 1.0435, 12.0, 159, 173, 7, true, 'main_3day',
     '{"interval_scores":[18,18,18,18,18,18,18,18],"total_intervals":8,"total_rest_time":720,"total_work_time":720,"avg_work_rest_ratio":1.0,"intervals_completed":8}',
     (v_today - 16) + time '07:15'),
  -- week 3
  (v_uid, v_today - 13, 11, 11, 7, 'endurance', 'echo_bike', 'cal',
     8.45, 8.593, 232, 1.0169, 8.593, 143, 151, 5, true, 'main_3day',
     '{"total_intervals":1,"total_rest_time":0,"total_work_time":1620,"avg_work_rest_ratio":null,"intervals_completed":1}',
     (v_today - 13) + time '07:02'),
  (v_uid, v_today - 11, 12, 12, 8, 'max_aerobic_power', 'echo_bike', 'cal',
     11.7, 12.067, 181, 1.0314, 12.067, 160, 174, 7, true, 'main_3day',
     '{"interval_scores":[37,36,36,36,36],"total_intervals":5,"total_rest_time":900,"total_work_time":900,"avg_work_rest_ratio":1.0,"intervals_completed":5}',
     (v_today - 11) + time '07:11'),
  (v_uid, v_today - 9, 15, 15, 9, 'anaerobic', 'echo_bike', 'cal',
     NULL, 17.333, 52, NULL, 17.333, 167, 184, 9, true, 'main_3day',
     '{"interval_scores":[9,9,9,8,9,8],"total_intervals":6,"total_rest_time":900,"total_work_time":180,"avg_work_rest_ratio":0.2,"intervals_completed":6}',
     (v_today - 9) + time '07:06'),
  -- week 4
  (v_uid, v_today - 6, 16, 16, 10, 'max_aerobic_power', 'echo_bike', 'cal',
     11.9, 12.444, 112, 1.0457, 12.444, 161, 175, 8, true, 'main_3day',
     '{"interval_scores":[7,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7],"total_intervals":18,"total_rest_time":540,"total_work_time":540,"avg_work_rest_ratio":1.0,"intervals_completed":18}',
     (v_today - 6) + time '07:09'),
  (v_uid, v_today - 4, 19, 19, 11, 'anaerobic', 'echo_bike', 'cal',
     NULL, 17.0, 51, NULL, 17.0, 168, 185, 9, true, 'main_3day',
     '{"interval_scores":[13,13,13,12],"total_intervals":4,"total_rest_time":900,"total_work_time":180,"avg_work_rest_ratio":0.2,"intervals_completed":4}',
     (v_today - 4) + time '07:04'),
  (v_uid, v_today - 2, 20, 20, 12, 'endurance', 'echo_bike', 'cal',
     8.5, 8.8, 264, 1.0353, 8.8, 144, 152, 5, true, 'main_3day',
     '{"total_intervals":1,"total_rest_time":0,"total_work_time":1800,"avg_work_rest_ratio":null,"intervals_completed":1}',
     (v_today - 2) + time '07:01');

  -- ---- rolling metrics, consistent with the sessions above ------------------
  -- anaerobic ratios are actual ÷ time-trial baseline (max-effort, no target).
  INSERT INTO engine_user_performance_metrics
    (user_id, day_type, modality, learned_max_pace, rolling_avg_ratio, rolling_count, last_5_ratios)
  VALUES
  (v_uid, 'anaerobic',         'echo_bike', 17.333, 1.4141, 4, '[1.3889,1.4063,1.4444,1.4167]'),
  (v_uid, 'max_aerobic_power', 'echo_bike', 12.444, 1.0351, 4, '[1.0197,1.0435,1.0314,1.0457]'),
  (v_uid, 'endurance',         'echo_bike',  8.8,   1.0214, 3, '[1.0119,1.0169,1.0353]');

  RAISE NOTICE 'Engine test athlete seeded for % (%): main_3day, positions 1-12 complete, pointer 13, sequencer on.', v_email, v_uid;
END $$;

-- Verify (optional):
-- SELECT engine_program_version, engine_current_day, engine_months_unlocked, engine_ai_sequencing
--   FROM athlete_profiles WHERE user_id = (SELECT id FROM auth.users WHERE email = 'tfish1492+test@gmail.com');
-- SELECT sequence_position, date, day_type, actual_pace, performance_ratio
--   FROM engine_workout_sessions WHERE user_id = (SELECT id FROM auth.users WHERE email = 'tfish1492+test@gmail.com')
--   ORDER BY sequence_position;
