/**
 * compute-block-benchmark.ts
 *
 * Generation-time benchmark computation for a metcon block. Runs inside
 * generate-program-v3 after the writer emits, computes the cohort-derived
 * expected duration via the shared computeBenchmarks() pipeline, and returns
 * a jsonb-shaped payload that gets stored on
 * program_blocks_v2.expected_benchmark.
 *
 * Why server-side at generation time (vs the previous client-load compute):
 *   - Eliminates per-load recomputation (every Start, every Coach view, every
 *     analytics roll-up was recomputing the same number).
 *   - Single source of truth — every consumer reads the same stored value, no
 *     drift between admin / athlete / Coach.
 *   - Sync audits — the duration audit can read median_seconds from the in-
 *     memory block without an async upstream call inside runAudits().
 *
 * Returns null on:
 *   - Non-metcon blocks
 *   - Movements with no resolvable volume specifier (writer error caught elsewhere)
 *   - Upstream work-calc unavailable / movement unresolved / cohort cell missing
 *
 * Null is a valid stored value — clients fall through to the legacy local-math
 * path (still wired for resilience) when expected_benchmark is null.
 */

import type { BlockPrescription, MovementPrescription } from "./v2-output-schema.ts";
import {
  computeBenchmarks,
  type ComputeBenchmarksInput,
  type ComputeBenchmarksResult,
  type Gender,
  type WorkCalcMovement,
} from "./compute-benchmarks.ts";

/** Code version of the scoring engine (this module + compute-benchmarks
 *  semantics). Composed with the power curve's own calc_version into the
 *  engine_version stamped on every scored evidence row, so a parser or
 *  curve change makes stale rows identifiable and re-scorable (scoring
 *  reliability review 2026-11-03). Bump on any semantic change here. */
export const SCORE_ENGINE_CODE_VERSION = "se2026.11.04-1";

/** The engine_version string for a scored row. */
export function composeEngineVersion(calcVersion: string | null | undefined): string {
  return `${SCORE_ENGINE_CODE_VERSION}+calc:${calcVersion ?? "unknown"}`;
}

export interface ExpectedBenchmark {
  median_score: string;
  median_seconds: number | null;
  excellent_score: string | null;
  excellent_seconds: number | null;
  median_watts: number;
  excellent_watts: number | null;
  joules: number;
  time_domain: "short" | "medium" | "long";
  basis: string;
  cohort_anchors: Array<{ p: number; watts: number; score: string }>;
  compute_status: "computed";
  /** Power-curve generation id, for engine_version composition. */
  calc_version?: string;
}

/**
 * Infer the workout type from block_scheme. AMRAP / EMOM → "amrap" (those
 * blocks have a fixed clock, the score is rounds+reps). Everything else with
 * a scheme → "for_time".
 */
function inferWorkoutType(scheme: string | undefined): "for_time" | "amrap" {
  if (!scheme) return "for_time";
  const s = scheme.toLowerCase();
  if (/\bamrap\b/i.test(s) || /\bemom\b/i.test(s)) return "amrap";
  return "for_time";
}

/**
 * Extract the rounds count from a multi-round For-Time block_scheme.
 * "5 RFT", "5 rounds for time", "3 rounds of:" → 5 / 5 / 3. Returns 1
 * (single-pass chipper / AMRAP / unknown) when no explicit rounds pattern
 * matches. Cap is a sanity ceiling — 50 rounds is far past any real workout.
 */
function extractRounds(scheme: string | undefined): number {
  if (!scheme) return 1;
  const m = scheme.match(
    /(\d+)\s+(?:RFT|rounds?\s+for\s+time|rounds?\s+of\b|rounds?\s*[:\n])/i,
  );
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n < 50) return n;
  }
  return 1;
}

/**
 * Translate one MovementPrescription (writer's emitted shape) into the
 * WorkCalcMovement shape upstream expects. Returns null when no volume
 * specifier resolves — caller drops the whole block's benchmark in that case
 * (mixing partial movements would give upstream incomplete work to model).
 *
 * Priority: calories → distance → reps. Matches client `entryToWorkCalcMovement`
 * but reads typed fields from a writer-emitted MovementPrescription rather
 * than a client `MetconEntry`. Single translation logic, two source shapes.
 */
export function toWorkCalcMovement(
  m: MovementPrescription,
  workoutType: "for_time" | "amrap",
): WorkCalcMovement | null {
  const name = (m.movement ?? "").trim();
  if (!name) return null;

  const out: WorkCalcMovement = { movement_name: name };

  // Pre-save, a varying-scheme movement carries cal_scheme/distance_scheme
  // with the scalar left null (save derives total = sum). Sum here so the
  // benchmark path sees the same totals it would read post-save.
  const sumScheme = (a: number[] | undefined | null) =>
    Array.isArray(a) ? a.filter((n) => typeof n === "number" && n > 0).reduce((x, y) => x + y, 0) : 0;
  const calTotal = typeof m.calories === "number" && m.calories > 0 ? m.calories : sumScheme(m.cal_scheme);
  const distTotal = typeof m.distance === "number" && m.distance > 0 ? m.distance : sumScheme(m.distance_scheme);

  // 2. Distance mapping, resolved up front: an UNMAPPABLE unit no longer
  // kills the movement — inches are a box HEIGHT, not travel volume
  // (audit finding 2026-11-03: 11.2's 24-in box jump nulled the whole
  // block), so an unmapped unit falls through to the rep count below.
  const unit = m.distance_unit?.toLowerCase();
  const mappedUnit: WorkCalcMovement["distance_unit"] | null =
    unit === "m" || unit === "meter" || unit === "meters" ? "meters"
      : unit === "ft" || unit === "foot" || unit === "feet" ? "feet"
      : unit === "mi" || unit === "mile" || unit === "miles" ? "miles"
      : unit === "km" || unit === "kilometer" || unit === "kilometers" ? "kilometers"
      : null;

  // 1. Calorie-counted (Cal Row, Cal Bike, Cal Ski) — typed field wins.
  if (calTotal > 0) {
    out.calories = calTotal;
  } else if (distTotal > 0 && mappedUnit !== null) {
    // 2. Distance-counted (rowing meters, running meters/miles).
    out.distance_value = distTotal;
    out.distance_unit = mappedUnit;
  } else if (typeof m.reps === "number" && m.reps > 0) {
    // 3a. Rep-counted with reps already populated (legacy / programmatic-
    //     fix derived case). Upstream expects different specifier by workout type.
    if (workoutType === "amrap") {
      // For AMRAPs: per-round count. Prefer first rep_scheme entry when
      // available (less ambiguous), else fall back to reps.
      const perRound = Array.isArray(m.rep_scheme) && m.rep_scheme.length > 0
        ? m.rep_scheme[0]
        : m.reps;
      out.reps_per_round = perRound;
    } else {
      out.reps_total = m.reps;
    }
  } else if (Array.isArray(m.rep_scheme) && m.rep_scheme.length > 0) {
    // 3b. Rep-counted with ONLY rep_scheme set — the writer's preferred shape
    //     (per v2-system-prompt: "DO NOT set reps; the save layer computes reps
    //     = sum(rep_scheme)"). At audit-time we're pre-save, so derive here so
    //     upstream gets the right specifier.
    const valid = m.rep_scheme.filter((n) => typeof n === "number" && n > 0);
    if (valid.length === 0) return null;
    if (workoutType === "amrap") {
      out.reps_per_round = valid[0]; // AMRAP repeats one iteration on the clock
    } else {
      out.reps_total = valid.reduce((a, b) => a + b, 0); // For-Time: total work
    }
  } else {
    return null;
  }

  // 4. Load — upstream picks the slot for the athlete's gender. weight is
  // the men's/RX-primary load; weight_women splits the slots when present
  // (audit run 2's women's-ladder family: the women's field was being
  // modeled at men's loads — 11.6 W predicted 28 reps vs observed 73).
  if (typeof m.weight === "number" && m.weight > 0) {
    out.load_lbs_men = m.weight;
    const ww = (m as { weight_women?: number }).weight_women;
    out.load_lbs_women = typeof ww === "number" && ww > 0 ? ww : m.weight;
  }

  return out;
}

/**
 * Parse a formatted "MM:SS" / "H:MM:SS" / "rounds+reps" score into seconds.
 * Returns null for AMRAP-style "11+3" (not a duration). Used by the audit
 * to compare against time-domain bucket ranges.
 */
function parseScoreToSeconds(score: string | null | undefined): number | null {
  if (!score) return null;
  // AMRAP format "rounds+reps" — not a duration.
  if (/^\d+\+\d+$/.test(score)) return null;
  // H:MM:SS
  const hms = score.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hms) {
    return parseInt(hms[1], 10) * 3600 + parseInt(hms[2], 10) * 60 + parseInt(hms[3], 10);
  }
  // MM:SS
  const ms = score.match(/^(\d+):(\d{2})$/);
  if (ms) {
    return parseInt(ms[1], 10) * 60 + parseInt(ms[2], 10);
  }
  return null;
}

/** An ascending/varying ladder prescribed under an "AMRAP" scheme is NOT
 *  rounds of rep_scheme[0] — treating 3-6-9-12... as endless 3-rep rounds
 *  produced the audit's 2,356-reps-in-7-minutes blowup (11.6). Detect: any
 *  movement whose rep_scheme has 2+ entries that are not all equal. */
export function isVaryingLadder(block: BlockPrescription): boolean {
  for (const mv of block.movements ?? []) {
    const rs = (mv as { rep_scheme?: number[] }).rep_scheme;
    if (Array.isArray(rs) && rs.length > 1 && rs.some((n) => n !== rs[0])) {
      return true;
    }
  }
  return false;
}

/** Linear-in-time reps-at-cap conversion: when a capped piece's predicted
 *  median finish exceeds the cap, the median athlete scores REPS, not a
 *  time. Constant-watts approximation: reps completed ≈ total prescribed
 *  reps × cap / predicted_time (calories count as rep-equivalents, the
 *  leaderboard convention). Exported for its own test. */
export function repsAtCap(
  totalReps: number,
  capSeconds: number,
  predictedSeconds: number,
): number | null {
  if (totalReps <= 0 || capSeconds <= 0 || predictedSeconds <= capSeconds) return null;
  return Math.max(1, Math.floor(totalReps * (capSeconds / predictedSeconds)));
}

/** Apply a loads_women map (movement index -> lbs) onto a prescription,
 *  REFUSING any entry whose target doesn't look like what the migration
 *  author saw (review 2026-11-04): the index must name an existing
 *  movement that carries a numeric weight STRICTLY GREATER than the
 *  women's value. A reorder or collapsed-duplicate fails loudly as an
 *  invalid index instead of putting 80 lb on the wrong movement. Valid
 *  entries apply; invalid ones are returned for the caller to surface. */
export function mergeLoadsWomen(
  workout: BlockPrescription,
  loads: Record<string, number> | null | undefined,
): { workout: BlockPrescription; invalid: number[] } {
  if (!loads || Object.keys(loads).length === 0) return { workout, invalid: [] };
  const movements = [...(workout.movements ?? [])];
  const invalid: number[] = [];
  for (const [k, ww] of Object.entries(loads)) {
    const i = Number(k);
    const mv = Number.isInteger(i) ? movements[i] : undefined;
    const ok = mv !== undefined &&
      typeof mv.weight === "number" && mv.weight > 0 &&
      typeof ww === "number" && ww > 0 && ww < mv.weight;
    if (!ok) {
      invalid.push(Number.isFinite(i) ? i : -1);
      continue;
    }
    movements[i] = { ...mv, weight_women: ww };
  }
  return { workout: { ...workout, movements } as BlockPrescription, invalid };
}

/** THE chokepoint for measuring a STORED signature (review 2026-11-04):
 *  every path that measures one — the acceptance audit, the measure/
 *  draft actions, and any future scoring of a hash-joined user log —
 *  goes through here, so the women's-loads merge cannot be forgotten
 *  on one door while the audit certifies another. Takes the row shape
 *  (workout + loads_women) and returns the measurable prescription
 *  plus any refused load indices (surface them; never ship silently). */
export function measurableSignatureWorkout(
  row: { workout: BlockPrescription; loads_women?: Record<string, number> | null },
): { workout: BlockPrescription; invalid: number[] } {
  return mergeLoadsWomen(row.workout, row.loads_women ?? null);
}

export interface BlockBenchmarkExplained {
  bench: ExpectedBenchmark | null;
  /** Named reason when bench is null — the reason codes are product
   *  surface: evidence-row statuses and audit per-workout statuses. */
  reason: string | null;
}

/**
 * Compute the expected benchmark for one metcon block, with the failure
 * reason preserved. Returns { bench: null, reason } on every failure path.
 */
export async function computeBlockBenchmarkExplained(
  block: BlockPrescription,
  gender: Gender | null,
): Promise<BlockBenchmarkExplained> {
  if (block.block_type !== "metcon") return { bench: null, reason: "non_metcon_block" };

  let workoutType = inferWorkoutType(block.block_scheme);
  // Ladder reclassification: a varying-rep ladder under an AMRAP clock is
  // a fixed body of work raced against the cap — model it as capped
  // for-time over the TOTAL prescribed reps, and let the reps-at-cap
  // conversion below express the rep-ranked outcome.
  const ladder = workoutType === "amrap" && isVaryingLadder(block);
  if (ladder) workoutType = "for_time";
  let rounds = workoutType === "for_time" && !ladder ? extractRounds(block.block_scheme) : 1;
  // Expanded-scheme guard: library/signature prescriptions often list the
  // FULL work ("10 rounds" with a 10-entry rep_scheme per movement), where
  // generator output lists one round and relies on the rounds multiplier.
  // When every multi-entry rep_scheme's length equals the extracted round
  // count, the scheme is already expanded — multiplying again would
  // double-count the work (20.1: 80 reps × 10 rounds).
  if (rounds > 1) {
    const multi = (block.movements ?? [])
      .map((mv) => (mv as { rep_scheme?: number[] }).rep_scheme)
      .filter((rs): rs is number[] => Array.isArray(rs) && rs.length > 1);
    if (multi.length > 0 && multi.every((rs) => rs.length === rounds)) rounds = 1;
  }

  const movements: WorkCalcMovement[] = [];
  let totalReps = 0;
  for (const mv of block.movements ?? []) {
    const wcm = toWorkCalcMovement(mv, workoutType);
    if (wcm === null) {
      // Partial-block compute would mislead — bail entirely.
      console.warn(
        `[compute-block-benchmark] dropping block: movement "${mv.movement}" has no resolvable volume specifier`,
      );
      return { bench: null, reason: `movement_no_volume:${(mv.movement ?? "?").slice(0, 40)}` };
    }
    movements.push(wcm);
    totalReps += (wcm.reps_total ?? wcm.reps_per_round ?? 0) + (wcm.calories ?? 0);
  }
  if (movements.length === 0) return { bench: null, reason: "no_movements" };

  const input: ComputeBenchmarksInput = {
    movements,
    gender,
    workout_type: workoutType,
    time_cap_seconds: block.time_cap_seconds,
    block_scheme_hint: block.block_scheme ?? undefined,
    rounds,
  };

  // AMRAP requires a cap; if the writer didn't set one, skip benchmarking
  // (the audit will fire on the AMRAP-missing-cap structural error
  // separately, no need to double-report here).
  if (workoutType === "amrap" && !block.time_cap_seconds) {
    return { bench: null, reason: "amrap_no_cap" };
  }

  const diag: { reason?: string } = {};
  let result: ComputeBenchmarksResult | null;
  try {
    result = await computeBenchmarks(input, diag);
  } catch (e) {
    console.warn(`[compute-block-benchmark] computeBenchmarks threw: ${(e as Error).message}`);
    return { bench: null, reason: `engine_threw:${(e as Error).message.slice(0, 80)}` };
  }
  if (result === null) return { bench: null, reason: diag.reason ?? "engine_null" };

  let medianScore = result.median_score;
  let medianSeconds = parseScoreToSeconds(result.median_score);
  let basis = result.basis;
  // Reps-at-cap: on a capped for-time piece whose predicted median finish
  // exceeds the cap, the median athlete's score is a rep count. This is
  // what makes capped-median workouts (17.1-style) comparable in rep
  // space at all — before it, "predicted 14:50 against a 12:00 cap" was
  // unusable on both channels.
  if (
    workoutType === "for_time" &&
    typeof block.time_cap_seconds === "number" && block.time_cap_seconds > 0 &&
    medianSeconds !== null && medianSeconds > block.time_cap_seconds
  ) {
    const reps = repsAtCap(totalReps * rounds, block.time_cap_seconds, medianSeconds);
    if (reps !== null) {
      medianScore = `${reps} reps`;
      medianSeconds = null;
      // "_linear" is a caveat, not decoration: constant-watts conversion
      // is fair on uniform-load pieces and optimistic on escalating-load
      // ladders (16.2/19.2), where per-rep work climbs — the audit reads
      // the basis string to see which rows used it (review 2026-11-04).
      basis = `${basis}+reps_at_cap_linear`;
    }
  }

  const bench: ExpectedBenchmark = {
    median_score: medianScore,
    median_seconds: medianSeconds,
    excellent_score: result.excellent_score,
    excellent_seconds: parseScoreToSeconds(result.excellent_score),
    median_watts: result.median_watts,
    excellent_watts: result.excellent_watts,
    joules: result.joules,
    time_domain: result.time_domain,
    basis,
    cohort_anchors: result.cohort_anchors,
    compute_status: "computed",
    calc_version: result.calc_version,
  };
  return { bench, reason: null };
}

/** Back-compat wrapper: the original reason-less shape. */
export async function computeBlockBenchmark(
  block: BlockPrescription,
  gender: Gender | null,
): Promise<ExpectedBenchmark | null> {
  return (await computeBlockBenchmarkExplained(block, gender)).bench;
}

/** A specific block's location within a WriterOutput. Used by the targeted
 *  recompute path to refresh only the blocks that surgical rewrote (or that
 *  failed on a prior pass), instead of hammering upstream for all metcons. */
export interface BlockLocation {
  week: number;
  day: number;
  blockIdx: number;
}

/** Max concurrent upstream `/work/calculate` calls. Upstream rate-limits per
 *  trace_id (~5-10 requests per moving window). 3 concurrent keeps us well
 *  under the threshold even during burst-y surgical recompute cycles. Tune
 *  up if upstream lifts the limit; tune down if 429s reappear. */
const WORK_CALC_CONCURRENCY = 3;

interface BenchmarkStats {
  computed: number;
  skipped: number;
  failed: number;
  /** Blocks where computeBlockBenchmark returned null (rate-limited, upstream
   *  unresolvable, etc.). Caller can pass these locations to a follow-up
   *  recompute attempt without re-firing the successful blocks. */
  failedLocations: BlockLocation[];
}

/**
 * Compute expected benchmarks for metcon blocks in a WriterOutput. Mutates
 * each metcon block in place by attaching `expected_benchmark` — downstream
 * save-program-v3 picks it up and persists. Non-metcon blocks are left
 * untouched.
 *
 * Concurrency-capped at WORK_CALC_CONCURRENCY to respect upstream's per-
 * trace rate limit. Earlier Promise.all-on-everything approach tripped 429s
 * during burst-y surgical-recompute cycles.
 *
 * @param onlyLocations  When provided, ONLY recomputes the listed blocks
 *                       (the targeted-recompute path used after surgical
 *                       block rewrites + for retrying first-pass failures).
 *                       When omitted, computes every metcon block in the
 *                       output (the initial post-writer pass).
 */
export async function attachBenchmarksToWriterOutput(
  // deno-lint-ignore no-explicit-any
  weeks: any[],
  gender: Gender | null,
  onlyLocations?: BlockLocation[],
): Promise<BenchmarkStats> {
  // Collect every metcon block + its location so we know what to retry on
  // failure. Skip non-metcon blocks here so they don't enter the worker pool.
  // deno-lint-ignore no-explicit-any
  const queue: Array<{ block: any; loc: BlockLocation }> = [];
  let skipped = 0;

  const onlySet = onlyLocations
    ? new Set(onlyLocations.map((l) => `${l.week}-${l.day}-${l.blockIdx}`))
    : null;

  for (const week of weeks) {
    for (const day of week.days ?? []) {
      const blocks = day.blocks ?? [];
      for (let bi = 0; bi < blocks.length; bi++) {
        const block = blocks[bi];
        if (block.block_type !== "metcon") {
          skipped++;
          continue;
        }
        const loc: BlockLocation = { week: week.week_num, day: day.day_num, blockIdx: bi };
        if (onlySet && !onlySet.has(`${loc.week}-${loc.day}-${loc.blockIdx}`)) {
          // Targeted-recompute mode and this block isn't in the list — leave
          // its existing expected_benchmark untouched (it was either valid
          // from a prior pass or was supposed to stay null).
          continue;
        }
        queue.push({ block, loc });
      }
    }
  }

  let computed = 0;
  let failed = 0;
  const failedLocations: BlockLocation[] = [];

  // Worker-pool: WORK_CALC_CONCURRENCY workers each pull from `queue` until
  // it's empty. Bounded parallelism — upstream sees at most N inflight calls
  // at any moment.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const idx = cursor++;
      const { block, loc } = queue[idx];
      const benchmark = await computeBlockBenchmark(block, gender);
      block.expected_benchmark = benchmark;
      if (benchmark) {
        computed++;
      } else {
        failed++;
        failedLocations.push(loc);
      }
    }
  }
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < Math.min(WORK_CALC_CONCURRENCY, queue.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return { computed, skipped, failed, failedLocations };
}
