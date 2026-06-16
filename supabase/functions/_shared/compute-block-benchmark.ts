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
function toWorkCalcMovement(
  m: MovementPrescription,
  workoutType: "for_time" | "amrap",
): WorkCalcMovement | null {
  const name = (m.movement ?? "").trim();
  if (!name) return null;

  const out: WorkCalcMovement = { movement_name: name };

  // 1. Calorie-counted (Cal Row, Cal Bike, Cal Ski) — typed field wins.
  if (typeof m.calories === "number" && m.calories > 0) {
    out.calories = m.calories;
  } else if (typeof m.distance === "number" && m.distance > 0 && m.distance_unit) {
    // 2. Distance-counted (rowing meters, running meters/miles).
    const unit = m.distance_unit.toLowerCase();
    const mapped: WorkCalcMovement["distance_unit"] | null =
      unit === "m" || unit === "meter" || unit === "meters" ? "meters"
        : unit === "ft" || unit === "foot" || unit === "feet" ? "feet"
        : unit === "mi" || unit === "mile" || unit === "miles" ? "miles"
        : unit === "km" || unit === "kilometer" || unit === "kilometers" ? "kilometers"
        : null;
    if (mapped === null) return null;
    out.distance_value = m.distance;
    out.distance_unit = mapped;
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

  // 4. Load — pass on both gender slots; upstream picks per athlete gender.
  if (typeof m.weight === "number" && m.weight > 0) {
    out.load_lbs_men = m.weight;
    out.load_lbs_women = m.weight;
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

/**
 * Compute the expected benchmark for one metcon block. Skips non-metcon
 * blocks. Returns null on any failure path so callers can store null and
 * the client falls through to legacy local math.
 */
export async function computeBlockBenchmark(
  block: BlockPrescription,
  gender: Gender | null,
): Promise<ExpectedBenchmark | null> {
  if (block.block_type !== "metcon") return null;

  const workoutType = inferWorkoutType(block.block_scheme);
  const rounds = workoutType === "for_time" ? extractRounds(block.block_scheme) : 1;

  const movements: WorkCalcMovement[] = [];
  for (const mv of block.movements ?? []) {
    const wcm = toWorkCalcMovement(mv, workoutType);
    if (wcm === null) {
      // Partial-block compute would mislead — bail entirely.
      console.warn(
        `[compute-block-benchmark] dropping block: movement "${mv.movement}" has no resolvable volume specifier`,
      );
      return null;
    }
    movements.push(wcm);
  }
  if (movements.length === 0) return null;

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
  if (workoutType === "amrap" && !block.time_cap_seconds) return null;

  let result: ComputeBenchmarksResult | null;
  try {
    result = await computeBenchmarks(input);
  } catch (e) {
    console.warn(`[compute-block-benchmark] computeBenchmarks threw: ${(e as Error).message}`);
    return null;
  }
  if (result === null) return null;

  return {
    median_score: result.median_score,
    median_seconds: parseScoreToSeconds(result.median_score),
    excellent_score: result.excellent_score,
    excellent_seconds: parseScoreToSeconds(result.excellent_score),
    median_watts: result.median_watts,
    excellent_watts: result.excellent_watts,
    joules: result.joules,
    time_domain: result.time_domain,
    basis: result.basis,
    cohort_anchors: result.cohort_anchors,
    compute_status: "computed",
  };
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
