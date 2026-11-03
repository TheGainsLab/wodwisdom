-- intake_standards_v1 — editorial anchors converting declared intake
-- numbers (1RMs as bodyweight ratios, conditioning times) into percentile
-- evidence on the open_rx_general scale (benchmark ingestion, build item 2,
-- 2026-11-03).
--
-- PROVENANCE: editorial throughout, deliberately wide-noised, and designed
-- to be REPLACED per-metric as the platform's own regressions gain power
-- (lift transfer audit; the transference curve for conditioning — design
-- doc 2026-11-02). The p95 lift anchors are the athlete model's advanced
-- benchmarks (back_squat 1.90 BW men / 1.50 women, deadlift 2.50/2.00,
-- bench 1.46/1.00) and the normative oly ratios on top of them
-- (snatch = 0.60 x BS, C&J = 0.80 x BS); p50 anchors are judgment.
-- Percentile = 50 + 45 * (value - p50) / (p95 - p50), clamped [3, 97]
-- (times inverted: faster = higher).
--
-- noise_var: lifts 150 (sd ~12 - same construct in gym and workout, but
-- self-reported and fresh-vs-fatigued); conditioning 300 (sd ~17 - the
-- TRANSFERENCE discount: a monostructural score overstates mixed-modal
-- delivery, physiologically and mechanically; the curve will replace this
-- blanket widening with a fitted slope + residual).

insert into public.signature_model_params (key, params, notes) values (
  'intake_standards_v1',
  '{
    "lifts": {
      "back_squat":     {"axes": {"powerlifting_strength": 100},                       "noise_var": 150,
                         "men": {"p50": 1.20, "p95": 1.90}, "women": {"p50": 0.95, "p95": 1.50}},
      "deadlift":       {"axes": {"powerlifting_strength": 70, "posterior_chain": 30}, "noise_var": 150,
                         "men": {"p50": 1.60, "p95": 2.50}, "women": {"p50": 1.25, "p95": 2.00}},
      "bench_press":    {"axes": {"powerlifting_strength": 70, "upper_body_pressing": 30}, "noise_var": 150,
                         "men": {"p50": 0.90, "p95": 1.46}, "women": {"p50": 0.55, "p95": 1.00}},
      "snatch":         {"axes": {"olympic_lifting": 100},                             "noise_var": 150,
                         "men": {"p50": 0.75, "p95": 1.14}, "women": {"p50": 0.55, "p95": 0.90}},
      "clean_and_jerk": {"axes": {"olympic_lifting": 100},                             "noise_var": 150,
                         "men": {"p50": 1.00, "p95": 1.52}, "women": {"p50": 0.75, "p95": 1.20}}
    },
    "conditioning": {
      "2k_row":     {"axes": {"aerobic_capacity": 80, "anaerobic_capacity": 20}, "noise_var": 300, "lower_is_better": true,
                     "men": {"p50": 465,  "p95": 390},  "women": {"p50": 525,  "p95": 440}},
      "1_mile_run": {"axes": {"aerobic_capacity": 80, "anaerobic_capacity": 20}, "noise_var": 250, "lower_is_better": true,
                     "men": {"p50": 465,  "p95": 330},  "women": {"p50": 540,  "p95": 390}},
      "5k_run":     {"axes": {"aerobic_capacity": 100},                          "noise_var": 250, "lower_is_better": true,
                     "men": {"p50": 1620, "p95": 1140}, "women": {"p50": 1860, "p95": 1320}}
    },
    "skill_gates": {
      "muscle_ups": "ring_muscle_up",
      "bar_muscle_ups": "bar_muscle_up",
      "chest_to_bar_pull_ups": "chest_to_bar",
      "pull_ups_any": "pull_up",
      "hspu": "kipping_hspu",
      "strict_hspu": "strict_hspu",
      "handstand_walk": "handstand_walk",
      "double_unders": "double_unders",
      "pistols": "single_leg_squat",
      "toes_to_bar": "toes_to_bar"
    },
    "pct_clamp": [3, 97]
  }'::jsonb,
  'Editorial intake-to-percentile anchors, 2026-11-03. Lift p95 anchors = the athlete model advanced benchmarks + normative oly ratios; p50 = judgment. Conditioning carries the transference discount as widened noise until the transference curve fits a slope. Run benchmarks noise < row (running already charges the bodyweight tax the erg waives - the run-transfers-best hypothesis). Replace per-metric with fitted values as platform regressions gain power; provenance then moves editorial -> empirical.'
)
on conflict (key) do nothing;

-- Intake evidence carries its own discrimination vector (there is no
-- workout signature to join — the standards config IS the vector). The
-- fit's loader prefers a row-level vector when present; signature-joined
-- rows leave it null and resolve through the join as before.
alter table public.signature_evidence
  add column if not exists discrimination jsonb;
