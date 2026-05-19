/**
 * compute-benchmarks.ts
 *
 * Pure-function core for data-grounded median/excellent benchmarks.
 * Orchestrates:
 *   1. POST /v1/work/calculate (upstream) → total joules for the prescription
 *   2. getStagePowerCurve() → cohort watts at p50/p90 etc.
 *   3. Time-domain derivation cascade (time_cap → block_scheme regex → self-consistent → default)
 *   4. Anchor selection with fallback cascade (QF p50 → Open p90 → Open p75 → null)
 *   5. Score formatting (For-Time as MM:SS, AMRAP as "rounds+reps")
 *
 * Anchors locked 2026-05-19:
 *   median   = stage_power_curve.open.{gender}.{time_domain}.p50
 *   excellent = stage_power_curve.quarterfinals.{gender}.{time_domain}.p50
 *
 * Returns null on any failure path; callers (the metconScoring refactor)
 * fall back to existing PERFORMANCE_FACTORS-based client math.
 *
 * Pre-expansion is the caller's responsibility: for "21-15-9 thrusters",
 * pass `reps_total: 45`, not 21. compute-benchmarks doesn't parse block
 * schemes — it does the cohort/benchmark math against pre-flattened reps.
 *
 * AMRAP partial-reps approximation: uses uniform-pacing assumption
 * (remaining_work / joules_per_round × total_per_round_reps). Slightly
 * off for chippers within a round; close enough for the user-facing
 * "X+Y" format which sums across movements anyway.
 */

import type { StagePowerCurve, StagePowerCurveCell } from "./fetch-tier4-bundle.ts";
import { getStagePowerCurve } from "./stage-power-curve-cache.ts";

const WORK_CALC_TIMEOUT_MS = 8_000;

export type TimeDomain = "short" | "medium" | "long";
export type Gender = "men" | "women";

/** A movement in the format upstream POST /v1/work/calculate expects.
 *
 *  Volume specifiers are mutually exclusive per movement — caller sets
 *  exactly ONE of these to declare how to count work:
 *    - reps_total       For-Time / chippers (total reps across workout)
 *    - reps_per_round   AMRAPs / EMOMs (per-round count)
 *    - distance_value + distance_unit   row / run / ski
 *    - calories         bike / cal-row
 *    - rounds           round-counting movements (rare)
 *
 *  Caller pre-expands ladders (21-15-9 → reps_total: 45 etc.); we don't
 *  parse schemes here. Sending the wrong specifier for a workout type
 *  yields an invalid_request from upstream (sql/139 hardening, deployed
 *  2026-05-19). */
export interface WorkCalcMovement {
  movement_name: string;
  reps_total?: number;
  reps_per_round?: number;
  distance_value?: number;
  distance_unit?: "meters" | "feet" | "miles" | "kilometers";
  calories?: number;
  rounds?: number;
  load_lbs_men?: number;
  load_lbs_women?: number;
}

export interface ComputeBenchmarksInput {
  /** Pre-expanded movements (For-Time: full reps; AMRAP: per-round reps). */
  movements: WorkCalcMovement[];
  /** "men" / "women" — null defaults to "men" with a logged warning. */
  gender: Gender | null;
  /** "for_time" or "amrap" — drives output format. */
  workout_type: "for_time" | "amrap";
  /** For AMRAPs: the AMRAP duration. For capped For-Time: the cap.
   *  For uncapped For-Time: omit. */
  time_cap_seconds?: number;
  /** Free-text block scheme — used only for regex-based time-domain
   *  fallback when time_cap_seconds is absent. */
  block_scheme_hint?: string;
  /** Multi-round For-Time multiplier (e.g., 5 RFT → rounds: 5).
   *  Default 1. Ignored for AMRAPs (use time_cap_seconds instead). */
  rounds?: number;
  /** For warning logs when gender defaults. */
  user_id?: string;
}

export interface ComputeBenchmarksResult {
  /** "7:38" for For-Time, "11+3" for AMRAP. */
  median_score: string;
  /** "5:53" for For-Time, "13+7" for AMRAP. null when fallback cascade
   *  exhausts (rare — Open p50 always exists, but QF cells may be missing
   *  and we cascaded all the way through Open p90 / Open p75 to null). */
  excellent_score: string | null;
  median_watts: number;
  excellent_watts: number | null;
  joules: number;
  /** Describes which anchors were used so debugging is tractable.
   *  E.g., "open_p50_vs_qf_p50" (normal),
   *        "open_p50_vs_open_p90_qf_missing" (excellent cascaded),
   *        "open_p50_vs_null_all_excellent_missing" (no excellent). */
  basis: string;
  /** Derived (or defaulted) time domain used for the curve lookup. */
  time_domain: TimeDomain;
}

// ============================================================
// Public entry point
// ============================================================

export async function computeBenchmarks(
  input: ComputeBenchmarksInput,
): Promise<ComputeBenchmarksResult | null> {
  // 1. Gender default + warning.
  const gender: Gender = input.gender ?? "men";
  if (input.gender === null) {
    console.warn(
      `[compute-benchmarks] gender missing for user_id=${input.user_id ?? "unknown"}; defaulting to "men". Audit and chase down the missing-gender data.`,
    );
  }

  // 2. Fetch joules from upstream work-calc.
  const joules = await fetchWorkCalcJoules(input.movements, gender);
  if (joules === null || joules <= 0) {
    return null; // caller falls back to PERFORMANCE_FACTORS
  }

  // 3. Fetch the stage power curve (cached).
  const curve = await getStagePowerCurve();
  if (curve === null) {
    return null;
  }

  // 4. Derive time domain via the locked cascade.
  const timeDomain = deriveTimeDomain(
    input.time_cap_seconds ?? null,
    input.block_scheme_hint ?? null,
    joules,
    curve,
    gender,
  );

  // 5. Anchor selection.
  const median = pickMedianWatts(curve, gender, timeDomain);
  if (median === null) {
    // Open p50 missing — extremely unlikely. Fall back to caller.
    return null;
  }
  const excellent = pickExcellentWatts(curve, gender, timeDomain, median.watts);

  // 6. Score formatting.
  const rounds = input.rounds ?? 1;
  let medianScore: string;
  let excellentScore: string | null;
  if (input.workout_type === "amrap") {
    if (!input.time_cap_seconds || input.time_cap_seconds <= 0) {
      // AMRAP with no time cap is malformed.
      return null;
    }
    medianScore = formatAMRAP(joules, median.watts, input.time_cap_seconds, input.movements);
    excellentScore = excellent
      ? formatAMRAP(joules, excellent.watts, input.time_cap_seconds, input.movements)
      : null;
  } else {
    const totalJoules = joules * rounds;
    medianScore = formatTimeSeconds(totalJoules / median.watts);
    excellentScore = excellent ? formatTimeSeconds(totalJoules / excellent.watts) : null;
  }

  return {
    median_score: medianScore,
    excellent_score: excellentScore,
    median_watts: median.watts,
    excellent_watts: excellent?.watts ?? null,
    joules,
    basis: `open_p50_vs_${excellent?.label ?? "null_all_excellent_missing"}`,
    time_domain: timeDomain,
  };
}

// ============================================================
// Upstream work-calc wrapper
// ============================================================

/** Calls POST /v1/work/calculate, returns total_joules. null on any failure. */
async function fetchWorkCalcJoules(
  movements: WorkCalcMovement[],
  gender: Gender,
): Promise<number | null> {
  const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
  // work-calc function uses a SEPARATE per-consumer key, not the shared
  // COMPETITION_SERVICE_KEY used for programming-profile / catalog endpoints.
  const serviceKey = Deno.env.get("WORK_CALC_SERVICE_KEY");
  if (!baseUrl || !serviceKey) {
    console.warn(
      "[compute-benchmarks] missing COMPETITION_SERVICE_BASE_URL or WORK_CALC_SERVICE_KEY env; returning null",
    );
    return null;
  }

  const url = `${baseUrl.replace(/\/$/, "")}/work-calc/v1/work/calculate`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORK_CALC_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "X-Service-Key": serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        gender,
        workout: { movements },
      }),
      signal: controller.signal,
    });

    let bodyText: string;
    try {
      bodyText = await resp.text();
    } catch {
      console.warn(`[compute-benchmarks] work-calc body read failed (status=${resp.status}); returning null`);
      return null;
    }

    if (!resp.ok) {
      console.warn(
        `[compute-benchmarks] work-calc HTTP ${resp.status}; body=${bodyText.slice(0, 400)}; returning null`,
      );
      return null;
    }

    let json: unknown;
    try {
      json = JSON.parse(bodyText);
    } catch {
      console.warn(
        `[compute-benchmarks] work-calc response not JSON; body=${bodyText.slice(0, 200)}; returning null`,
      );
      return null;
    }

    const obj = json as Record<string, unknown>;
    if (typeof obj.total_joules !== "number" || obj.total_joules <= 0) {
      console.warn(
        `[compute-benchmarks] work-calc returned no usable total_joules; full_response=${bodyText.slice(0, 400)}; returning null`,
      );
      return null;
    }
    return obj.total_joules;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[compute-benchmarks] work-calc timeout; returning null");
    } else {
      console.warn(`[compute-benchmarks] work-calc error: ${(err as Error).message}; returning null`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Time-domain derivation cascade (decision 2, locked 2026-05-19)
// ============================================================

export function _deriveTimeDomain( // exported for tests
  timeCapSeconds: number | null,
  blockScheme: string | null,
  joules: number,
  curve: StagePowerCurve,
  gender: Gender,
): TimeDomain {
  return deriveTimeDomain(timeCapSeconds, blockScheme, joules, curve, gender);
}

function deriveTimeDomain(
  timeCapSeconds: number | null,
  blockScheme: string | null,
  joules: number,
  curve: StagePowerCurve,
  gender: Gender,
): TimeDomain {
  // 1. time_cap_seconds present (AMRAP / EMOM / capped For-Time).
  if (timeCapSeconds && timeCapSeconds > 0) {
    return bucketSeconds(timeCapSeconds);
  }
  // 2. block_scheme regex.
  const minutesFromScheme = extractMinutesFromScheme(blockScheme);
  if (minutesFromScheme !== null) {
    return bucketSeconds(minutesFromScheme * 60);
  }
  // 3. Self-consistent iteration via joules / p50_watts.
  const selfConsistent = findSelfConsistentBucket(joules, curve, gender);
  if (selfConsistent !== null) {
    return selfConsistent;
  }
  // 4. Default fallback.
  return "medium";
}

function bucketSeconds(seconds: number): TimeDomain {
  if (seconds <= 480) return "short"; // ≤ 8 min
  if (seconds <= 900) return "medium"; // 8–15 min
  return "long";
}

function extractMinutesFromScheme(scheme: string | null): number | null {
  if (!scheme) return null;
  // AMRAP 12, AMRAP12, AMRAP-12, etc.
  const amrap = scheme.match(/AMRAP\s*-?\s*(\d+)/i);
  if (amrap) return parseInt(amrap[1], 10);
  // EMOM 10
  const emom = scheme.match(/EMOM\s*-?\s*(\d+)/i);
  if (emom) return parseInt(emom[1], 10);
  // Generic "N min"
  const min = scheme.match(/(\d+)\s*min\b/i);
  if (min) return parseInt(min[1], 10);
  return null;
}

function findSelfConsistentBucket(
  joules: number,
  curve: StagePowerCurve,
  gender: Gender,
): TimeDomain | null {
  const open = curve.stages.open[gender];
  for (const bucket of ["short", "medium", "long"] as const) {
    const cell = open[bucket];
    if (!cell) continue;
    const time = joules / cell.p50;
    if (bucket === "short" && time <= 480) return "short";
    if (bucket === "medium" && time > 480 && time <= 900) return "medium";
    if (bucket === "long" && time > 900) return "long";
  }
  return null;
}

// ============================================================
// Anchor selection with fallback cascade
// ============================================================

interface PickedWatts {
  watts: number;
  label: string; // e.g., "qf_p50", "open_p90", "open_p75"
}

function pickMedianWatts(
  curve: StagePowerCurve,
  gender: Gender,
  timeDomain: TimeDomain,
): PickedWatts | null {
  const open = curve.stages.open[gender];
  const cell = open[timeDomain];
  if (cell) return { watts: cell.p50, label: "open_p50" };
  return null;
}

function pickExcellentWatts(
  curve: StagePowerCurve,
  gender: Gender,
  timeDomain: TimeDomain,
  medianWatts: number,
): PickedWatts | null {
  // Primary: QF p50. Guard against the (rare) case where a thin-sample QF
  // p50 lands below median — would produce nonsensical "excellent worse
  // than median" output. Fall through to the Open p90 fallback.
  const qfCell: StagePowerCurveCell | undefined = curve.stages.quarterfinals[gender][timeDomain];
  if (qfCell && qfCell.p50 > medianWatts) {
    return { watts: qfCell.p50, label: "qf_p50" };
  }
  // Fallback: Open p90 from the same cell (always > Open p50 by definition).
  const openCell: StagePowerCurveCell | undefined = curve.stages.open[gender][timeDomain];
  if (openCell) {
    return { watts: openCell.p90, label: "open_p90_qf_missing_or_too_low" };
  }
  return null;
}

// ============================================================
// Score formatting
// ============================================================

/** Formats seconds as MM:SS (or H:MM:SS if ≥ 1 hour). */
export function _formatTimeSeconds(seconds: number): string { // exported for tests
  return formatTimeSeconds(seconds);
}

function formatTimeSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const totalSec = Math.round(seconds);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Formats an AMRAP score as "rounds+partial_reps".
 *  joulesPerRound = work-calc joules for one round of the AMRAP structure.
 *  Partial reps use uniform-pacing approximation across the unfinished round. */
export function _formatAMRAP( // exported for tests
  joulesPerRound: number,
  watts: number,
  timeCapSeconds: number,
  movements: WorkCalcMovement[],
): string {
  return formatAMRAP(joulesPerRound, watts, timeCapSeconds, movements);
}

function formatAMRAP(
  joulesPerRound: number,
  watts: number,
  timeCapSeconds: number,
  movements: WorkCalcMovement[],
): string {
  if (joulesPerRound <= 0 || watts <= 0) return "0+0";
  const totalWorkCapacity = watts * timeCapSeconds; // joules attainable in time cap
  const fullRounds = Math.floor(totalWorkCapacity / joulesPerRound);
  const remainingWork = totalWorkCapacity - fullRounds * joulesPerRound;
  // AMRAPs use reps_per_round, not reps_total. Sum across movements gives
  // the reps-per-AMRAP-round basis for the uniform-pacing approximation.
  const repsPerRound = movements.reduce((sum, m) => sum + (m.reps_per_round ?? 0), 0);
  const partialReps = repsPerRound > 0
    ? Math.floor((remainingWork / joulesPerRound) * repsPerRound)
    : 0;
  return `${fullRounds}+${partialReps}`;
}
