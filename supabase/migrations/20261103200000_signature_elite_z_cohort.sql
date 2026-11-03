-- open_rx_elite_v2_z — the z-space (probit) model for the elite cohort,
-- plus the columns the two-pass fit persists into.
--
-- WHY (model upgrade, 2026-11-03): percentiles compress at the top of the
-- scale, so an elite athlete's event scores all land in the mid-90s and the
-- dials lose resolution exactly where the athlete is most interesting. The
-- probit transform (percentile -> standard-normal z) stretches the tail
-- back out; the fit runs in z and the display converts back.
--
-- EVIDENCE (same 30k-athlete study data as v1, all constants re-measured
-- in z with the v1 methods):
--   * noise_var 0.0750 z^2 (verbatim-repeat test-retest, sd ~0.27 z)
--   * level prior var 0.8241 z^2 (population level spread)
--   * prior_cov: PD-clipped split-half signal covariance in z + 0.005
--     slack (deconvolved, exactly the v1 recipe)
--   * calibration_sd_inflation 1.478, measured ON THE ELITE BAND the
--     cohort serves (53,924 holdouts; after rescale, nominal 95% intervals
--     cover 95.5%)
--   * validation: Bayesian LOO on 2,397 elite athletes (>= p85, hist >= 6):
--     z beats the year-baseline +5.2% in z units, and beats the v1 pct
--     model +8.0% in display units on the same holdouts. On the mid-field
--     each space wins only its own metric, so v1 STAYS the general model
--     and v2_z serves the elite band only (two-pass selection in the refit).
--   * elite-refit discrimination vectors were fitted and REJECTED: under
--     the production predictor they score -0.57% +/- 0.13% WORSE than the
--     editorial vectors on the elite band (loose-ridge ALS gains did not
--     survive the production regime; Bayesian-ALS was worse still). The
--     editorial per-workout vectors remain the instrument. Machine-fitted
--     vectors stay exhibits (founder law) — this row ships none.
--
-- HYSTERESIS (review 2026-11-03): enter the elite cohort at p85, leave it
-- below p80. Both thresholds live on this row because they are properties
-- of the cohort model; the refit reads the athlete's PREVIOUS cohort from
-- the profile header, so an athlete near the line does not flip rulers on
-- every refit as their fitted level wobbles.
--
-- NAMING DEBT, acknowledged: the *_pct param fields and column names are
-- historical; for a space='z' row they carry z units. The fit module is
-- unit-agnostic and reads 'space' to know which ruler it is holding.

insert into public.signature_model_params (key, params, notes) values (
  'open_rx_elite_v2_z',
  '{"space":"z","axes":["aerobic_capacity","anaerobic_capacity","gymnastics_pressing","gymnastics_pulling","midline","mixed_modal_conditioning","olympic_lifting","posterior_chain","powerlifting_strength","skill_coordination","squat_cycling","upper_body_pressing"],"prior_cov_pct":[[0.3852,0.0022,-0.1037,-0.3325,0.0142,0.0203,0.0363,0.0201,-0.0064,-0.0605,0.0465,0.0382],[0.0022,0.1586,0.0404,0.0195,0.0445,0.0533,-0.1125,-0.0123,-0.0547,-0.0476,-0.0521,-0.0347],[-0.1037,0.0404,0.3474,0.1208,0.0036,0.0197,-0.1641,-0.024,-0.1015,0.0478,-0.0521,-0.0767],[-0.3325,0.0195,0.1208,0.6233,0.0098,0.0474,-0.1629,-0.0331,-0.2229,0.0133,-0.141,-0.141],[0.0142,0.0445,0.0036,0.0098,0.0444,0.0119,-0.0448,-0.0438,-0.0215,0.0103,0.0074,-0.0065],[0.0203,0.0533,0.0197,0.0474,0.0119,0.0426,-0.0511,-0.0008,-0.0739,-0.0091,-0.0494,-0.0341],[0.0363,-0.1125,-0.1641,-0.1629,-0.0448,-0.0511,0.2127,0.0432,0.1394,0.0051,0.0384,0.0677],[0.0201,-0.0123,-0.024,-0.0331,-0.0438,-0.0008,0.0432,0.0912,0.0191,-0.0724,-0.0388,0.0019],[-0.0064,-0.0547,-0.1015,-0.2229,-0.0215,-0.0739,0.1394,0.0191,0.2407,-0.056,0.1178,0.0907],[-0.0605,-0.0476,0.0478,0.0133,0.0103,-0.0091,0.0051,-0.0724,-0.056,0.251,0.01,0.0271],[0.0465,-0.0521,-0.0521,-0.141,0.0074,-0.0494,0.0384,-0.0388,0.1178,0.01,0.1349,0.0655],[0.0382,-0.0347,-0.0767,-0.141,-0.0065,-0.0341,0.0677,0.0019,0.0907,0.0271,0.0655,0.0676]],"noise_var_pct":0.075,"calibration_sd_inflation":1.478,"evidence_age_weight":{"0":1.0,"1":1.0,"2":0.98,"3":0.82,"4":0.73},"fitted_on":"open_rx_general_30k_2026-11-03_probit","cohort":"open_rx_elite","level_prior_mean":0.0,"level_prior_var":0.8241,"elite_level_min_pct":85.0,"elite_level_exit_pct":80.0,"prior_note":"z-space (probit) refit of the same 30k study: prior = PD-clipped split-half signal covariance in z + 0.005 slack (deconvolved, same method as v1). Elite holdout (2,397 athletes >= p85, 53,924 scores): editorial-W Bayesian LOO beats year-baseline +5.2% in z; vs the v1 pct model on the same holdouts, z predictions win +8.0% in display units on the elite band. Elite-refit discrimination vectors tested and REJECTED (-0.57% vs editorial under the production predictor); editorial vectors stay."}'::jsonb,
  'z-space (probit) elite-cohort model, fitted 2026-11-03 on the same 30k Open RX study as v1. Serves athletes at level >= p85 via two-pass selection in signature-profile-refit; the general field stays on open_rx_general_v1. All constants re-measured in z with the v1 methods (noise from verbatim repeats, deconvolved split-half prior, elite-band calibration x1.478). Editorial discrimination vectors retained: elite-refit W rejected on evidence (-0.57% vs editorial under the production predictor).'
)
on conflict (key) do nothing;

-- z-native posterior beside the display (pct) conversion. mean_z/sd_z
-- already exist on athlete_capability_vectors (reserved in the athlete-
-- layer migration); the prior width and the header's level need their
-- z columns for the sigma display and for refit idempotency checks.
alter table public.athlete_capability_vectors
  add column if not exists prior_sd_z numeric;

alter table public.athlete_signature_profiles
  add column if not exists level_mean_z numeric,
  add column if not exists level_sd_z numeric;
