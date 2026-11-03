/**
 * The REAL open_rx_elite_v2_z parameters, verbatim from the migration seed
 * (20261103200000_signature_elite_z_cohort.sql) — z-space (probit) model
 * for the elite cohort. Frozen here for the golden parity tests; if the
 * seeded row and this fixture drift apart, the golden test is testing the
 * wrong model and must be re-frozen alongside the migration.
 */

import type { SignatureModelParams } from "../signature-profile-fit.ts";

export const OPEN_RX_ELITE_V2_Z: SignatureModelParams = {
  "space": "z",
  "axes": [
    "aerobic_capacity",
    "anaerobic_capacity",
    "gymnastics_pressing",
    "gymnastics_pulling",
    "midline",
    "mixed_modal_conditioning",
    "olympic_lifting",
    "posterior_chain",
    "powerlifting_strength",
    "skill_coordination",
    "squat_cycling",
    "upper_body_pressing"
  ],
  "prior_cov_pct": [
    [
      0.3852,
      0.0022,
      -0.1037,
      -0.3325,
      0.0142,
      0.0203,
      0.0363,
      0.0201,
      -0.0064,
      -0.0605,
      0.0465,
      0.0382
    ],
    [
      0.0022,
      0.1586,
      0.0404,
      0.0195,
      0.0445,
      0.0533,
      -0.1125,
      -0.0123,
      -0.0547,
      -0.0476,
      -0.0521,
      -0.0347
    ],
    [
      -0.1037,
      0.0404,
      0.3474,
      0.1208,
      0.0036,
      0.0197,
      -0.1641,
      -0.024,
      -0.1015,
      0.0478,
      -0.0521,
      -0.0767
    ],
    [
      -0.3325,
      0.0195,
      0.1208,
      0.6233,
      0.0098,
      0.0474,
      -0.1629,
      -0.0331,
      -0.2229,
      0.0133,
      -0.141,
      -0.141
    ],
    [
      0.0142,
      0.0445,
      0.0036,
      0.0098,
      0.0444,
      0.0119,
      -0.0448,
      -0.0438,
      -0.0215,
      0.0103,
      0.0074,
      -0.0065
    ],
    [
      0.0203,
      0.0533,
      0.0197,
      0.0474,
      0.0119,
      0.0426,
      -0.0511,
      -0.0008,
      -0.0739,
      -0.0091,
      -0.0494,
      -0.0341
    ],
    [
      0.0363,
      -0.1125,
      -0.1641,
      -0.1629,
      -0.0448,
      -0.0511,
      0.2127,
      0.0432,
      0.1394,
      0.0051,
      0.0384,
      0.0677
    ],
    [
      0.0201,
      -0.0123,
      -0.024,
      -0.0331,
      -0.0438,
      -0.0008,
      0.0432,
      0.0912,
      0.0191,
      -0.0724,
      -0.0388,
      0.0019
    ],
    [
      -0.0064,
      -0.0547,
      -0.1015,
      -0.2229,
      -0.0215,
      -0.0739,
      0.1394,
      0.0191,
      0.2407,
      -0.056,
      0.1178,
      0.0907
    ],
    [
      -0.0605,
      -0.0476,
      0.0478,
      0.0133,
      0.0103,
      -0.0091,
      0.0051,
      -0.0724,
      -0.056,
      0.251,
      0.01,
      0.0271
    ],
    [
      0.0465,
      -0.0521,
      -0.0521,
      -0.141,
      0.0074,
      -0.0494,
      0.0384,
      -0.0388,
      0.1178,
      0.01,
      0.1349,
      0.0655
    ],
    [
      0.0382,
      -0.0347,
      -0.0767,
      -0.141,
      -0.0065,
      -0.0341,
      0.0677,
      0.0019,
      0.0907,
      0.0271,
      0.0655,
      0.0676
    ]
  ],
  "noise_var_pct": 0.075,
  "calibration_sd_inflation": 1.478,
  "evidence_age_weight": {
    "0": 1.0,
    "1": 1.0,
    "2": 0.98,
    "3": 0.82,
    "4": 0.73
  },
  "fitted_on": "open_rx_general_30k_2026-11-03_probit",
  "cohort": "open_rx_elite",
  "level_prior_mean": 0.0,
  "level_prior_var": 0.8241,
  "elite_level_min_pct": 85.0,
  "prior_note": "z-space (probit) refit of the same 30k study: prior = PD-clipped split-half signal covariance in z + 0.005 slack (deconvolved, same method as v1). Elite holdout (2,397 athletes >= p85, 53,924 scores): editorial-W Bayesian LOO beats year-baseline +5.2% in z; vs the v1 pct model on the same holdouts, z predictions win +8.0% in display units on the elite band. Elite-refit discrimination vectors tested and REJECTED (-0.57% vs editorial under the production predictor); editorial vectors stay."
} as SignatureModelParams;
