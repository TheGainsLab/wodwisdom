-- Continuum Phase 2 (docs/conditioning_continuum_phase2_plan.md): targets from the curve.
--
-- 1. engine_pd_curves.k_effort — the exponent that converts a share of EFFORT to a
--    share of this machine's pace (power ∝ pace^(1/k)): 1 for fan-bike calories,
--    0.30 for Concept2 metres (power ∝ pace³), 0.73 for Concept2 calories, 0.45 for
--    running (the exponent relating the authored running curve to the Echo's).
-- 2. intensityShare on every paced block of engine_day_types: [min,max] share of the
--    balanced max for the bout, derived mechanically from today's Echo pace fraction
--    ÷ the balanced pace for the block's mid work length (23 blocks). Zone 2
--    (endurance, polarized, flux, flux_stages), max efforts, time_trial and
--    rocket_races_b (inherits A) carry none. paceRange stays: the legacy formula,
--    machines without a curve, and the sequencer's envelope still read it.
-- 3. engine_workout_sessions.targets — the per-block target snapshot frozen at Start.
-- 4. athlete_profiles.engine_targets_v2 — the per-athlete rollout switch (default off).

ALTER TABLE engine_pd_curves ADD COLUMN IF NOT EXISTS k_effort numeric NOT NULL DEFAULT 1;
COMMENT ON COLUMN engine_pd_curves.k_effort IS 'exponent converting a share of effort to a share of this machine''s pace: pace_share = effort_share ^ k_effort';
UPDATE engine_pd_curves SET k_effort = 0.30 WHERE units = 'meters' AND modality IN ('c2_row_erg', 'c2_ski_erg', 'c2_bike_erg', 'rogue_row_erg');
UPDATE engine_pd_curves SET k_effort = 0.73 WHERE units = 'cal' AND modality IN ('c2_row_erg', 'c2_ski_erg', 'c2_bike_erg');
UPDATE engine_pd_curves SET k_effort = 0.45 WHERE modality IN ('outdoor_run', 'track_run', 'road_run', 'trail_run', 'assault_runner', 'assault_runner_run', 'motorized_treadmill', 'other_treadmill');
UPDATE engine_pd_curves SET k_effort = 1 WHERE units = 'cal' AND modality IN ('echo_bike', 'assault_bike', 'airdyne_bike', 'other_bike');

-- intensityShare per paced block (idempotent: overwrites the key, touches nothing else in the params)
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.49, 0.7]'::jsonb) WHERE id = 'ascending' AND block_1_params IS NOT NULL;  -- 30–90 s at 0.9–1.3×, R(52 s)=1.85, progression
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.56, 0.66]'::jsonb) WHERE id = 'interval' AND block_1_params IS NOT NULL;  -- 30–240 s at 0.8–1.1×, R(85 s)=1.55
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.72, 0.82]'::jsonb) WHERE id = 'max_aerobic_power' AND block_1_params IS NOT NULL;  -- 90–300 s at 0.85–1.05×, R(164 s)=1.23
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.87, 0.97]'::jsonb) WHERE id = 'threshold' AND block_1_params IS NOT NULL;  -- 480–1080 s at 0.85–0.95×, R(720 s)=0.98
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.78, 0.88]'::jsonb) WHERE id = 'rocket_races_a' AND block_1_params IS NOT NULL;  -- 90–300 s at 0.95–1.1×, R(164 s)=1.23
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.71, 0.81]'::jsonb) WHERE id = 'hybrid_aerobic' AND block_1_params IS NOT NULL;  -- 90–240 s at 0.9–1.05×, R(147 s)=1.27
UPDATE engine_day_types SET block_2_params = jsonb_set(block_2_params, '{intensityShare}', '[0.63, 0.73]'::jsonb) WHERE id = 'hybrid_aerobic' AND block_2_params IS NOT NULL;  -- 60–180 s at 0.9–1.05×, R(104 s)=1.43
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.68, 0.78]'::jsonb) WHERE id = 'hybrid_anaerobic' AND block_1_params IS NOT NULL;  -- 60–120 s at 1.05–1.2×, R(85 s)=1.55
UPDATE engine_day_types SET block_2_params = jsonb_set(block_2_params, '{intensityShare}', '[0.68, 0.78]'::jsonb) WHERE id = 'hybrid_anaerobic' AND block_2_params IS NOT NULL;  -- 60–120 s at 1.05–1.2×, R(85 s)=1.55
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.69, 0.8]'::jsonb) WHERE id = 'ascending_devour' AND block_1_params IS NOT NULL;  -- 60–300 s at 0.9–1.05×, R(134 s)=1.31, progression
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.76, 0.86]'::jsonb) WHERE id = 'descending_devour' AND block_1_params IS NOT NULL;  -- 180–180 s at 0.9–1.05×, R(180 s)=1.20
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.78, 0.88]'::jsonb) WHERE id = 'devour' AND block_1_params IS NOT NULL;  -- 180–360 s at 0.85–1×, R(255 s)=1.11
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.63, 0.74]'::jsonb) WHERE id = 'infinity' AND block_1_params IS NOT NULL;  -- 60–240 s at 0.85–1×, R(120 s)=1.35, progression
UPDATE engine_day_types SET block_2_params = jsonb_set(block_2_params, '{intensityShare}', '[0.95, 1.05]'::jsonb) WHERE id = 'infinity' AND block_2_params IS NOT NULL;  -- 240–240 s at 1.1–1.15×, R(240 s)=1.12
UPDATE engine_day_types SET block_3_params = jsonb_set(block_3_params, '{intensityShare}', '[1.02, 1.12]'::jsonb) WHERE id = 'infinity' AND block_3_params IS NOT NULL;  -- 240–240 s at 1.2–1.2×, R(240 s)=1.12
UPDATE engine_day_types SET block_1_params = jsonb_set(block_1_params, '{intensityShare}', '[0.56, 0.67]'::jsonb) WHERE id = 'towers' AND block_1_params IS NOT NULL;  -- 120–120 s at 0.75–0.9×, R(120 s)=1.35, progression
UPDATE engine_day_types SET block_2_params = jsonb_set(block_2_params, '{intensityShare}', '[0.75, 0.85]'::jsonb) WHERE id = 'towers' AND block_2_params IS NOT NULL;  -- 480–480 s at 0.75–0.9×, R(480 s)=1.03
UPDATE engine_day_types SET block_3_params = jsonb_set(block_3_params, '{intensityShare}', '[0.59, 0.78]'::jsonb) WHERE id = 'towers' AND block_3_params IS NOT NULL;  -- 120–120 s at 0.8–1.05×, R(120 s)=1.35, progression
UPDATE engine_day_types SET block_2_params = jsonb_set(block_2_params, '{intensityShare}', '[0.77, 0.87]'::jsonb) WHERE id = 'afterburner' AND block_2_params IS NOT NULL;  -- 720–720 s at 0.75–0.85×, R(720 s)=0.98
UPDATE engine_day_types SET block_3_params = jsonb_set(block_3_params, '{intensityShare}', '[0.46, 0.54]'::jsonb) WHERE id = 'afterburner' AND block_3_params IS NOT NULL;  -- 60–60 s at 0.8–0.95×, R(60 s)=1.75, progression
UPDATE engine_day_types SET block_2_params = jsonb_set(block_2_params, '{intensityShare}', '[0.63, 0.83]'::jsonb) WHERE id = 'atomic' AND block_2_params IS NOT NULL;  -- 180–180 s at 0.75–1×, R(180 s)=1.20, progression
UPDATE engine_day_types SET block_2_params = jsonb_set(block_2_params, '{intensityShare}', '[0.42, 0.52]'::jsonb) WHERE id = 'synthesis' AND block_2_params IS NOT NULL;  -- 60–60 s at 0.75–0.9×, R(60 s)=1.75
UPDATE engine_day_types SET block_4_params = jsonb_set(block_4_params, '{intensityShare}', '[0.32, 0.42]'::jsonb) WHERE id = 'synthesis' AND block_4_params IS NOT NULL;  -- 30–30 s at 0.75–0.9×, R(30 s)=2.20

ALTER TABLE engine_workout_sessions ADD COLUMN IF NOT EXISTS targets jsonb NULL;
COMMENT ON COLUMN engine_workout_sessions.targets IS 'Phase 2 target snapshot frozen when the session was started: { mode, trial: {id, pace, date}, blocks: [[{ target_pace, basis, fraction, p_balanced, share, p_asked, m, band, effort_seconds, capped }]], version }';

ALTER TABLE athlete_profiles ADD COLUMN IF NOT EXISTS engine_targets_v2 boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN athlete_profiles.engine_targets_v2 IS 'Continuum Phase 2 rollout switch: true = the day page shows and records curve-based targets; false = today''s formula';
