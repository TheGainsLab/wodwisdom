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

// 15s (was 8s): burst diagnosis 2026-11-05 — tail-of-queue work-calc
// calls die under instance churn + connection pressure built by the
// first ~25 burst calls (the same workouts score instantly when run
// first; positional, not payload). Longer timeout + one fewer slot
// lets the tail survive the pressure the head creates.
const WORK_CALC_TIMEOUT_MS = 15_000;

export type TimeDomain = "short" | "medium" | "long";
export type Gender = "men" | "women";

/** Score-scale calibration constant κ (acceptance run 6, 2026-11-05).
 *  After the service-side movement cost corrections (service sql/165/166)
 *  the engine still predicted exp(+0.187) ≈ 1.21× more output than the
 *  field produced — uniformly, across 77 scored workout-gender pairs
 *  (mean of ln(predicted/observed), time rows inverted). Cause: a
 *  pooled cell p50 overstates what the median athlete sustains on a
 *  single NEW workout (selection toward favorable workouts in the
 *  pool). Every watts value drawn from the curve for prediction or
 *  percentile anchoring is divided by κ. Re-measure after any curve
 *  rebuild or cost-table refit; bump SCORE_ENGINE_CODE_VERSION when
 *  this changes. */
export const SCORESCALE_KAPPA = 1.206;
let kappa = SCORESCALE_KAPPA;
const sustainableWatts = (cellWatts: number): number => cellWatts / kappa;

/** Test-only: run the arithmetic suite at κ=1 (pass nothing to restore
 *  the production constant). Production code never calls this. */
export function __setKappaForTests(value?: number): void {
  kappa = value ?? SCORESCALE_KAPPA;
}

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
  distance_unit?: "m" | "ft" | "meters" | "feet" | "miles" | "kilometers";
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

/** One anchor in the cohort distribution: percentile + the watts that
 *  percentile of the Open field sustained, plus the workout score that
 *  wattage produces (formatted MM:SS or "rounds+reps"). Used by the
 *  client-side percentile interpolation. */
export interface CohortAnchor {
  p: number;    // 10, 25, 50, 75, 90, 99
  watts: number;
  score: string;
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
  /** stage_power_curve generation id (StagePowerCurve.calc_version) —
   *  part of the scored row's engine_version. */
  calc_version?: string;
  /** Full Open-stage cohort distribution for this workout: six anchors
   *  (p10/p25/p50/p75/p90/p99) of sustained watts converted to workout
   *  scores. Empty array when the Open cell is missing for the gender ×
   *  time-domain combo. Consumed by the client's piecewise-linear
   *  percentile interpolation — the real-data replacement for the
   *  earlier 2-anchor normalCDF estimate. */
  cohort_anchors: CohortAnchor[];
}

// ============================================================
// Public entry point
// ============================================================

export async function computeBenchmarks(
  input: ComputeBenchmarksInput,
  /** Optional diagnostic sink: on a null return, `reason` names why —
   *  the reason codes flow to evidence rows and audit statuses. */
  diag?: { reason?: string },
): Promise<ComputeBenchmarksResult | null> {
  console.log(
    `[compute-benchmarks] called: workout_type=${input.workout_type} n_movements=${input.movements.length} time_cap=${input.time_cap_seconds ?? "none"} user_id=${input.user_id ?? "unknown"}`,
  );

  // 1. Gender default + warning.
  const gender: Gender = input.gender ?? "men";
  if (input.gender === null) {
    console.warn(
      `[compute-benchmarks] gender missing for user_id=${input.user_id ?? "unknown"}; defaulting to "men". Audit and chase down the missing-gender data.`,
    );
  }

  // 2. Fetch joules from upstream work-calc. Upstream's AI resolver (2026-05-19)
  // handles free-text → canonical name mapping server-side, so we pass the
  // writer's movement names through unchanged. If a movement can't be resolved
  // upstream, work-calc returns 404 with suggested_matches and our fetch
  // helper logs the failure + we fall back to PERFORMANCE_FACTORS.
  const wc = await fetchWorkCalcJoulesEx(input.movements, gender);
  if (wc.joules === null || wc.joules <= 0) {
    console.warn(`[compute-benchmarks] returning null: fetchWorkCalcJoules failed (specific reason logged above by that fn)`);
    if (diag) diag.reason = wc.reason ?? "work_calc_failed";
    return null;
  }
  const joules = wc.joules;
  console.log(`[compute-benchmarks] joules=${joules}`);

  // 3. Fetch the stage power curve (cached).
  const curve = await getStagePowerCurve();
  if (curve === null) {
    console.warn(`[compute-benchmarks] returning null: getStagePowerCurve unavailable`);
    if (diag) diag.reason = "power_curve_unavailable";
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
  console.log(`[compute-benchmarks] gender=${gender} time_domain=${timeDomain}`);

  // 5. Anchor selection.
  const median = pickMedianWatts(curve, gender, timeDomain);
  if (median === null) {
    const openGender = curve.stages.open[gender];
    console.warn(
      `[compute-benchmarks] returning null: Open ${gender} ${timeDomain} cell missing in stage_power_curve. ` +
        `available_open_${gender}_keys=${JSON.stringify(Object.keys(openGender))}`,
    );
    if (diag) diag.reason = `curve_cell_missing:${gender}/${timeDomain}`;
    return null;
  }
  const excellent = pickExcellentWatts(curve, gender, timeDomain, median.watts);

  // 6. Score formatting.
  const rounds = input.rounds ?? 1;
  let medianScore: string;
  let excellentScore: string | null;
  if (input.workout_type === "amrap") {
    if (!input.time_cap_seconds || input.time_cap_seconds <= 0) {
      console.warn(
        `[compute-benchmarks] returning null: AMRAP requires time_cap_seconds but got ${input.time_cap_seconds}`,
      );
      if (diag) diag.reason = "amrap_no_cap";
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

  // 7. Build the full cohort distribution anchors for percentile interpolation.
  // All six come from the Open cell so the percentile is interpretable as
  // "your rank within the Open population." (median_/excellent_score above
  // still use the cross-stage Open-p50 / QF-p50 anchoring for UI labels.)
  const cohortAnchors = buildCohortAnchors(
    curve,
    gender,
    timeDomain,
    joules,
    input.workout_type,
    input.time_cap_seconds,
    input.movements,
    rounds,
  );

  return {
    median_score: medianScore,
    excellent_score: excellentScore,
    median_watts: median.watts,
    excellent_watts: excellent?.watts ?? null,
    joules,
    basis: `open_p50_vs_${excellent?.label ?? "null_all_excellent_missing"}`,
    time_domain: timeDomain,
    cohort_anchors: cohortAnchors,
    // The curve's own generation id: a curve refresh is a silent model
    // change, so it rides in engine_version on every scored row (scoring
    // reliability review 2026-11-03) and the stale-rescore job sees it.
    calc_version: curve.calc_version,
  };
}

/** Compute (p, watts, score) for each Open percentile in the cell — same
 *  joules ÷ watts math used for median/excellent, run six times. Returns
 *  [] when the Open cell is absent (n<30 was dropped by upstream). */
function buildCohortAnchors(
  curve: StagePowerCurve,
  gender: Gender,
  timeDomain: TimeDomain,
  joules: number,
  workoutType: "for_time" | "amrap",
  timeCapSeconds: number | undefined,
  movements: WorkCalcMovement[],
  rounds: number,
): CohortAnchor[] {
  const cell = curve.stages.open[gender][timeDomain];
  if (!cell) return [];
  const wattsByP: Array<{ p: number; watts: number }> = [
    { p: 10, watts: sustainableWatts(cell.p10) },
    { p: 25, watts: sustainableWatts(cell.p25) },
    { p: 50, watts: sustainableWatts(cell.p50) },
    { p: 75, watts: sustainableWatts(cell.p75) },
    { p: 90, watts: sustainableWatts(cell.p90) },
    { p: 99, watts: sustainableWatts(cell.p99) },
  ];
  return wattsByP.flatMap(({ p, watts }) => {
    if (!Number.isFinite(watts) || watts <= 0) return [];
    let score: string;
    if (workoutType === "amrap") {
      if (!timeCapSeconds || timeCapSeconds <= 0) return [];
      score = formatAMRAP(joules, watts, timeCapSeconds, movements);
    } else {
      score = formatTimeSeconds((joules * rounds) / watts);
    }
    return [{ p, watts, score }];
  });
}

// ============================================================
// Upstream work-calc wrapper
// ============================================================

/** Work-calc outcome with the failure reason preserved — the reason codes
 *  are product surface (scoring reliability review 2026-11-03): they land
 *  on evidence rows and in the acceptance audit's per-workout statuses,
 *  never only in logs. */
interface WorkCalcOutcome {
  joules: number | null;
  reason: string | null;
}

// In-instance memo: identical movement sets ask identical questions — the
// 6 p.m. class logging one whiteboard, or the audit's twin workouts
// (12.4/13.3). One network call per distinct (gender, movements) per
// cold start; the memo also caches DETERMINISTIC failures (a 404
// resolver miss stays a miss), while transient failures are retried
// before being memoized.
interface WorkCalcMemoEntry {
  promise: Promise<WorkCalcOutcome>;
  /** null = cached forever (success, deterministic failure). A transient
   *  failure gets a short negative TTL instead — review 2026-11-04: a
   *  whiteboard that hit rate limiting at 6:01 p.m. must not stay
   *  "failed" for the instance's lifetime, but a struggling service
   *  needs the burst to back off, not retry in lockstep. */
  expiresAt: number | null;
}

const workCalcMemo = new Map<string, WorkCalcMemoEntry>();
const TRANSIENT_NEG_CACHE_MS = 45_000;

/** Determinism-check support ONLY: the acceptance audit's repeat runs
 *  must hit the service fresh, or the memo makes the check a tautology. */
export function __clearWorkCalcMemo(): void {
  workCalcMemo.clear();
}

const TRANSIENT_WORK_CALC = /^work_calc_(http_429|http_5\d\d|timeout|network)/;

// Per-instance semaphore: a burst of DIFFERENT structures (the 6 p.m.
// class, the audit) must not reproduce the run-1 pile-up. Slot-transfer
// semantics: a release hands its slot to the next waiter directly.
// Per-instance only — cross-instance single-flight is the hash-keyed
// queue worker's job (planned; see PR/doc).
const MAX_CONCURRENT_WORK_CALC = 3; // 4→3: see WORK_CALC_TIMEOUT_MS note
let workCalcInFlight = 0;
const workCalcWaiters: Array<() => void> = [];

function acquireWorkCalcSlot(): Promise<void> {
  if (workCalcInFlight < MAX_CONCURRENT_WORK_CALC) {
    workCalcInFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => workCalcWaiters.push(resolve));
}

function releaseWorkCalcSlot(): void {
  const next = workCalcWaiters.shift();
  if (next) next(); // slot transfers; inFlight unchanged
  else workCalcInFlight--;
}

/** Calls POST /v1/work/calculate with retry + backoff on transient
 *  failures (429/5xx/timeout/network — never on a 404 resolver miss,
 *  which is deterministic), throttled and memoized per instance. The
 *  memo stores the IN-FLIGHT promise, so twenty concurrent logs of one
 *  whiteboard share a single call (same pattern as the stage-curve
 *  cache's inflightFetch). The burst case is the NORMAL case, so
 *  politeness lives here in the shared engine, not in callers. */
function fetchWorkCalcJoulesEx(
  movements: WorkCalcMovement[],
  gender: Gender,
): Promise<WorkCalcOutcome> {
  const key = `${gender}|${JSON.stringify(movements)}`;
  const hit = workCalcMemo.get(key);
  if (hit && (hit.expiresAt === null || Date.now() < hit.expiresAt)) {
    return hit.promise;
  }
  const entry: WorkCalcMemoEntry = { promise: undefined as unknown as Promise<WorkCalcOutcome>, expiresAt: null };
  entry.promise = (async (): Promise<WorkCalcOutcome> => {
    await acquireWorkCalcSlot();
    try {
      let out: WorkCalcOutcome = { joules: null, reason: "work_calc_unknown" };
      for (let attempt = 0; attempt < 3; attempt++) {
        out = await workCalcOnce(movements, gender);
        if (out.joules !== null || out.reason === null || !TRANSIENT_WORK_CALC.test(out.reason)) {
          break;
        }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1) * (attempt + 1)));
      }
      // success + deterministic failure cache forever (per instance);
      // transient exhaustion gets the short negative TTL
      if (out.joules === null && out.reason !== null && TRANSIENT_WORK_CALC.test(out.reason)) {
        entry.expiresAt = Date.now() + TRANSIENT_NEG_CACHE_MS;
      }
      return out;
    } finally {
      releaseWorkCalcSlot();
    }
  })();
  workCalcMemo.set(key, entry);
  return entry.promise;
}

async function workCalcOnce(
  movements: WorkCalcMovement[],
  gender: Gender,
): Promise<WorkCalcOutcome> {
  const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
  // work-calc function uses a SEPARATE per-consumer key, not the shared
  // COMPETITION_SERVICE_KEY used for programming-profile / catalog endpoints.
  const serviceKey = Deno.env.get("WORK_CALC_SERVICE_KEY");
  if (!baseUrl || !serviceKey) {
    console.warn(
      "[compute-benchmarks] missing COMPETITION_SERVICE_BASE_URL or WORK_CALC_SERVICE_KEY env; returning null",
    );
    return { joules: null, reason: "work_calc_env_missing" };
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
      return { joules: null, reason: "work_calc_network" };
    }

    if (!resp.ok) {
      console.warn(
        `[compute-benchmarks] work-calc HTTP ${resp.status}; body=${bodyText.slice(0, 400)}; returning null`,
      );
      // 404 is the server-side AI resolver failing a movement name —
      // deterministic, carries suggested_matches worth surfacing.
      if (resp.status === 404) {
        let hint = "";
        try {
          const j = JSON.parse(bodyText) as { suggested_matches?: unknown; movement?: unknown };
          if (j.movement) hint = `:${String(j.movement).slice(0, 40)}`;
        } catch { /* body shape is upstream's business */ }
        return { joules: null, reason: `work_calc_movement_unresolved${hint}` };
      }
      return { joules: null, reason: `work_calc_http_${resp.status}` };
    }

    let json: unknown;
    try {
      json = JSON.parse(bodyText);
    } catch {
      console.warn(
        `[compute-benchmarks] work-calc response not JSON; body=${bodyText.slice(0, 200)}; returning null`,
      );
      return { joules: null, reason: "work_calc_bad_json" };
    }

    const obj = json as Record<string, unknown>;
    if (typeof obj.total_joules !== "number" || obj.total_joules <= 0) {
      console.warn(
        `[compute-benchmarks] work-calc returned no usable total_joules; full_response=${bodyText.slice(0, 400)}; returning null`,
      );
      return { joules: null, reason: "work_calc_no_joules" };
    }
    // Gate on fully_computed. The stage_power_curve is built ONLY from
    // fully-computed workouts, and work-calc returns a PARTIAL total_joules when
    // a movement can't be computed — dividing partial joules by the full-workout
    // curve under-estimates the time. Per upstream, only divide when
    // fully_computed === true (a partial_work entry in warnings[] signals the
    // incomplete total). Mirrors the realization-path gate in metcon-workcalc.ts.
    if (obj.fully_computed !== true) {
      const warnings = Array.isArray(obj.warnings) ? obj.warnings : [];
      console.warn(
        `[compute-benchmarks] work-calc not fully_computed (fully_computed=${String(obj.fully_computed)}, ` +
          `warnings=${JSON.stringify(warnings).slice(0, 200)}); skipping benchmark (returning null)`,
      );
      return { joules: null, reason: "work_calc_partial" };
    }
    return { joules: obj.total_joules, reason: null };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[compute-benchmarks] work-calc timeout; returning null");
      return { joules: null, reason: "work_calc_timeout" };
    }
    const msg = (err as Error).message ?? "";
    // Supabase platform rate limiter on outbound calls per invocation
    // ("Rate limit exceeded for trace ... Retry after Nms"): a fixed
    // ~1-minute window that, once tripped, rejects every further call
    // from this invocation. Deterministic for the rest of the window —
    // retrying burns attempts against a closed door, so it is NOT
    // classified transient. Callers that need many calc calls must
    // stay under the per-invocation budget (audit: small slices).
    if (/rate limit exceeded/i.test(msg)) {
      console.warn(`[compute-benchmarks] work-calc platform rate limit: ${msg.slice(0, 120)}; returning null`);
      return { joules: null, reason: "work_calc_platform_rate_limited" };
    }
    console.warn(`[compute-benchmarks] work-calc error: ${msg}; returning null`);
    return { joules: null, reason: "work_calc_network" };
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
    const time = joules / sustainableWatts(cell.p50);
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
  if (cell) return { watts: sustainableWatts(cell.p50), label: "open_p50" };
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
  if (qfCell && sustainableWatts(qfCell.p50) > medianWatts) {
    return { watts: sustainableWatts(qfCell.p50), label: "qf_p50" };
  }
  // Fallback: Open p90 from the same cell (always > Open p50 by definition).
  const openCell: StagePowerCurveCell | undefined = curve.stages.open[gender][timeDomain];
  if (openCell) {
    return { watts: sustainableWatts(openCell.p90), label: "open_p90_qf_missing_or_too_low" };
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
