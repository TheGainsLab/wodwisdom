// Tests for the two-pass cohort handoff (review 2026-11-03). Four cases
// named in review, plus the threshold-from-params check:
//   1. thresholds are read from the params row, not code constants
//   2. elite row absent (or not a z row) -> general, whatever the level
//   3. explicit params_key bypasses selection entirely
//   4. hysteresis: enter at min, stay down to exit, leave below exit —
//      decided by the PERSISTED cohort, not the level alone
//
// Run with:
//   deno test supabase/functions/_shared/signature-cohort-select_test.ts --no-check

import { selectEliteCohort } from "./signature-cohort-select.ts";
import type { SignatureModelParams } from "./signature-profile-fit.ts";

const DEFAULT_KEY = "open_rx_general_v1";

const eliteParams = (over: Partial<SignatureModelParams> = {}): SignatureModelParams => ({
  space: "z",
  axes: [],
  prior_cov_pct: [],
  noise_var_pct: 0.075,
  calibration_sd_inflation: 1.478,
  evidence_age_weight: { "0": 1 },
  elite_level_min_pct: 85,
  elite_level_exit_pct: 80,
  ...over,
});

const base = {
  requestedKey: DEFAULT_KEY,
  defaultKey: DEFAULT_KEY,
  nEvidence: 12,
  eliteParams: eliteParams(),
  previousCohort: "open_rx_general" as string | null,
  generalLevelMean: 90,
};

function expect(actual: boolean, expected: boolean, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: got ${actual}, wanted ${expected}`);
}

Deno.test("thresholds come from the params row", () => {
  const p = eliteParams({ elite_level_min_pct: 92, elite_level_exit_pct: 88 });
  expect(selectEliteCohort({ ...base, eliteParams: p, generalLevelMean: 90 }), false, "90 < custom entry 92");
  expect(selectEliteCohort({ ...base, eliteParams: p, generalLevelMean: 92 }), true, "92 >= custom entry");
  expect(
    selectEliteCohort({ ...base, eliteParams: p, previousCohort: "open_rx_elite", generalLevelMean: 89 }),
    true, "89 >= custom exit 88 while elite",
  );
  // exit defaults to entry - 5 when the row predates the field
  const noExit = eliteParams({ elite_level_exit_pct: undefined });
  expect(
    selectEliteCohort({ ...base, eliteParams: noExit, previousCohort: "open_rx_elite", generalLevelMean: 81 }),
    true, "default exit = 80 keeps an 81 elite",
  );
});

Deno.test("elite row absent or not z-space -> general at any level", () => {
  expect(selectEliteCohort({ ...base, eliteParams: null, generalLevelMean: 99 }), false, "row absent");
  expect(
    selectEliteCohort({ ...base, eliteParams: eliteParams({ space: "pct" }), generalLevelMean: 99 }),
    false, "pct row never selects",
  );
  expect(
    selectEliteCohort({ ...base, eliteParams: eliteParams({ space: undefined }), generalLevelMean: 99 }),
    false, "space missing never selects",
  );
});

Deno.test("explicit params_key bypasses selection", () => {
  expect(
    selectEliteCohort({ ...base, requestedKey: "open_rx_elite_v2_z", generalLevelMean: 99 }),
    false, "operator asked for a specific row — no handoff",
  );
  expect(selectEliteCohort({ ...base, nEvidence: 0, generalLevelMean: 99 }), false, "no evidence, no handoff");
});

Deno.test("hysteresis: enter at 85, hold to 80, decided by persisted cohort", () => {
  // previously general: entry threshold governs
  expect(selectEliteCohort({ ...base, generalLevelMean: 84.9 }), false, "84.9 general stays general");
  expect(selectEliteCohort({ ...base, generalLevelMean: 85 }), true, "85 general enters");
  // previously elite: exit threshold governs — the 80-85 band is sticky
  const elite = { ...base, previousCohort: "open_rx_elite" };
  expect(selectEliteCohort({ ...elite, generalLevelMean: 82 }), true, "82 elite stays elite");
  expect(selectEliteCohort({ ...elite, generalLevelMean: 80 }), true, "80 elite stays elite");
  expect(selectEliteCohort({ ...elite, generalLevelMean: 79.9 }), false, "79.9 elite drops out");
  // no persisted header (first ever fit) behaves as general
  expect(
    selectEliteCohort({ ...base, previousCohort: null, generalLevelMean: 83 }),
    false, "no header + 83 does not enter",
  );
});
