// signature-cohort-select — the two-pass cohort handoff as a pure function,
// extracted from the refit handler so the one piece of new control flow in
// the z-space upgrade is pinned by tests (review 2026-11-03: the fit math
// has golden parity and the panel has the copy checker; this decision —
// thresholds read from params, elite row absent, explicit params_key
// bypassing selection, hysteresis — had nothing).
//
// The rule: selection runs only for the DEFAULT params request (an explicit
// params_key is an operator asking for exactly that row) and only when
// there is evidence. Entry at elite_level_min_pct; an athlete already in
// the elite cohort stays until the general fit drops below
// elite_level_exit_pct (default: entry − 5) — which side they were on
// comes from the persisted header cohort, never recomputed from the noisy
// fitted level.

import type { SignatureModelParams } from "./signature-profile-fit.ts";

export const ELITE_COHORT = "open_rx_elite";

export function selectEliteCohort(args: {
  /** the params_key the request asked for */
  requestedKey: string;
  /** the service's default key — selection only runs when these match */
  defaultKey: string;
  nEvidence: number;
  /** the elite params row, or null when it does not exist */
  eliteParams: SignatureModelParams | null;
  /** cohort column of the persisted profile header, if any */
  previousCohort: string | null | undefined;
  /** the GENERAL fit's level mean (percentile) */
  generalLevelMean: number;
}): boolean {
  const { requestedKey, defaultKey, nEvidence, eliteParams, previousCohort, generalLevelMean } =
    args;
  if (requestedKey !== defaultKey) return false; // explicit key bypasses selection
  if (nEvidence <= 0) return false;
  if (!eliteParams || eliteParams.space !== "z") return false;
  const enterAt = eliteParams.elite_level_min_pct ?? 85;
  const exitAt = eliteParams.elite_level_exit_pct ?? enterAt - 5;
  return previousCohort === ELITE_COHORT
    ? generalLevelMean >= exitAt
    : generalLevelMean >= enterAt;
}
