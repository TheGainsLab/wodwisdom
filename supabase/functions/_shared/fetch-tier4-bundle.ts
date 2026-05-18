/**
 * fetchTier4Bundle — pulls an athlete's competition-history bundle from the
 * competition-service Supabase project's `programming-profile` edge function.
 *
 * Failure-soft by design: any error path returns null. The diagnostic
 * treats null as "this athlete isn't linked / data unavailable" and flows
 * through unchanged. The eval and program-gen are NEVER blocked by an
 * unhealthy other-project endpoint.
 *
 * Light boundary type check only — confirms top-level shape. Field-level
 * validation lives in the diagnostic consumer where it can decide how to
 * gracefully handle missing or malformed sub-fields.
 */

const TIER4_FETCH_TIMEOUT_MS = 5_000;
// The all_results career array (catalog spec inline, ~50–200 entries) is a
// heavier response and a heavier query on the other side — give it more room.
const TIER4_FETCH_TIMEOUT_MS_HEAVY = 10_000;

export interface Tier4TrendBlock {
  direction: "improving" | "plateau" | "declining" | "new";
  percentile_points_per_year: number | null;
}

export interface Tier4Identity {
  name: string;
  profile_url: string | null;
  competitor_id: string;
}

export interface Tier4MovementAffinityEntry {
  category: string;
  exposures: number;
  avg_percentile: number | null;
  trend: Tier4TrendBlock;
  by_movement: Record<string, { exposures: number; avg_percentile: number }>;
  /**
   * Per-stage breakdown at the category aggregate level (NOT inside
   * by_movement). Stage keys mirror Tier4AllResultsEntry.stage. Empty stages
   * carry exposures=0, avg_percentile=null. Shipped in bundle v1.4/v1.5
   * (verified 2026-05-14).
   */
  by_stage?: Record<string, { exposures: number; avg_percentile: number | null }>;
}

export interface Tier4CharacterAffinityEntry {
  tag: "short_sprint" | "medium_duration" | "long_duration" | "heavy_load";
  exposures: number;
  avg_percentile: number | null;
}

export interface Tier4RecentResult {
  rank: number;
  movements: string[];
  raw_score: number;
  percentile: number;
  time_domain: "short" | "medium" | "long" | null;
  scoring_unit: "time" | "reps" | "load_lbs" | "distance";
  workout_label: string;
  // Added in profile bundle 1.3.0 (additive). Older responses won't have these.
  competition_workout_id?: string;
  worldwide_percentile?: number;
  cohort_n?: number;
  worldwide_n?: number;
}

export interface Tier4CompetitionSummary {
  overall_competitive_tier: "open_only" | "qualifier" | "regionals" | "games_athlete";
  seasons_competed: number;
  latest_percentile: number;
  trend: Tier4TrendBlock;
  consistency: number | null;
}

// ---- all_results (opt-in via ?include=all_results, profile bundle 1.3.0) ----

export interface Tier4WorkoutMovement {
  name: string;
  family: string;
  position: number;
  equipment: string[];
  mgw_category: string | null;       // "M" | "G" | "W" | "O" classification
  rounds: number | null;
  reps_total: number | null;
  reps_per_round: number | null;
  reps_scheme: string | null;
  calories: number | null;
  load_lbs: number | null;
  load_descriptor: string | null;
  load_progression: string | null;
  distance_unit: string | null;
  distance_value: number | null;
  variant_tags: string[] | null;
}

export interface Tier4WorkoutSpec {
  classification: string;            // e.g. "structured"
  description: string;
  scoring_unit: "time" | "reps" | "load_lbs" | "distance";
  scoring_direction: "lower_is_better" | "higher_is_better";
  is_dual_scoring: boolean;          // true => finishers scored by time, capped by reps
  time_cap_seconds: number | null;
  rep_target: number | null;
  time_domain: { bucket: "short" | "mid" | "long" | string; seconds: number | null };
  movements: Tier4WorkoutMovement[];
}

export interface Tier4AllResultsEntry {
  competition_workout_id: string;
  year: number;
  stage: "open" | "quarterfinals" | "semifinals" | "regional" | "games" | string;
  ordinal: number | null;
  workout_name: string;
  division: number;
  scaled_tier: string;               // "rx" | "scaled" | "foundations" | ...
  workout: Tier4WorkoutSpec;
  result: {
    valid: boolean;
    raw_score: number;
    raw_score_text: string | null;
    scoring_unit: "time" | "reps" | "load_lbs" | "distance";
    workout_rank: number;
    cohort_percentile: number;
    worldwide_percentile: number;
    cohort_n: number;
    worldwide_n: number;
    // Added in profile bundle 1.6.0 (additive). Score at p99 of the workout's
    // general cohort + the unit that threshold is in. The unit can differ from
    // scoring_unit on dual-scoring workouts where fewer than 1% of the field
    // finished under the cap — in that case the threshold lives in reps even
    // though a finisher's raw_score is a time. Null when the workout isn't
    // cataloged or the segment is too thin to compute a p99.
    cohort_p99_threshold?: number | null;
    cohort_p99_threshold_unit?: "time" | "reps" | "load_lbs" | "distance" | null;
    // Bundle 1.7.0 (upstream sql/133, deployed 2026-05-18). Work + power are
    // population estimates computed at default body mass (84 kg M / 64 kg W)
    // for scraped competitors — NOT this specific athlete's actual output.
    // `body_mass_basis` disambiguates so consumers don't treat them as
    // personalized; it's unconditional (hardcoded in the SQL function),
    // safe to type as required. joules/watts/w_per_kg are nullable: null
    // when the workout isn't fully_modeled, the result is AMRAP-without-
    // rounds / capped / load / distance, or score_seconds is missing.
    // Per-movement breakdown was deferred from v1 (payload bloat); will
    // land as opt-in ?include=movements_in_results if demand emerges.
    joules: number | null;
    avg_power_watts: number | null;
    avg_w_per_kg: number | null;
    body_mass_basis: "default_84m_64w";
  };
}

// ---- power_profile (opt-in via ?include=power_profile, sql/134) ----

/**
 * Athlete-level work/power aggregations across their result history. Computed
 * server-side from the same per-result work data as all_results[]; rolled up
 * by modality, time domain, and overall so consumers don't recompute with
 * subtly-different weightings.
 *
 * Cohort percentiles in each cell answer "where does this athlete rank within
 * the same gender/division on this slice?" — actionable for programming
 * decisions.
 *
 * by_stage was deliberately omitted from v1 (by_modality + by_time_domain
 * carry the direct programming signal); on roadmap as ?include=power_profile.by_stage.
 */
/**
 * When `n_results: 0` (athlete has no finished results in this slice), the
 * three computed fields are null — same couldn't-compute pattern as
 * per-result joules/avg_power_watts. Cell key is always present.
 */
export interface Tier4PowerProfileCell {
  avg_power_watts: number | null;
  avg_w_per_kg: number | null;
  n_results: number;
  cohort_percentile: number | null;
}

export interface Tier4PowerProfileOverall {
  avg_power_watts: number | null;
  avg_w_per_kg: number | null;
  cohort_percentile: number | null;
  /** Equal-weighted basis for the overall avg; consumers wanting a different
   *  weighting (recent-only, comp-tier-only) roll up by_* cells themselves. */
  n_results: number;
}

export interface Tier4PowerProfilePeak {
  competition_workout_id: string;
  workout_name: string;
  stage: "open" | "quarterfinals" | "semifinals" | "regional" | "games" | string;
  season: number;
  avg_power_watts: number;
  avg_w_per_kg: number;
  cohort_percentile: number;
}

export interface Tier4PowerProfileTrend {
  direction: "improving" | "plateau" | "declining";
  slope_watts_per_year: number;
  from_year: number;
  to_year: number;
  n_results_basis: number;
  /** Categorical (hides regression sketchiness from non-stats consumers).
   *  Derived from n_results_basis + R² of the underlying regression. */
  confidence: "low" | "medium" | "high";
}

export interface Tier4PowerProfile {
  body_mass_basis: "default_84m_64w";
  computed_from_n_results: number;
  computed_from_n_finished: number;
  n_skipped_amrap_no_rounds: number;
  n_skipped_capped_no_finish: number;
  overall: Tier4PowerProfileOverall;
  by_modality: Record<"M" | "G" | "W" | "mixed", Tier4PowerProfileCell>;
  by_time_domain: Record<"short" | "medium" | "long", Tier4PowerProfileCell>;
  peak_power_result: Tier4PowerProfilePeak;
  watts_trend: Tier4PowerProfileTrend;
}

// ---- stage_power_curve (separate endpoint, upstream sql/135) ----

/**
 * Population-level power distribution per (stage, gender, time_domain).
 * Served by GET /v1/reference/stage_power_curve as cacheable reference data,
 * not per-athlete. Refreshes nightly with the upstream materialized view.
 *
 * Used in concert with calc_athlete_work (for AI-generated workouts) to
 * derive data-grounded median/excellent benchmarks — replaces the hardcoded
 * PERFORMANCE_FACTORS multipliers in src/lib/metconScoring.ts.
 *
 * Six percentiles per cell (p10/p25/p50/p75/p90/p99) so consumers can pick
 * the right "excellent" anchor for their user level (e.g. p75 for novice
 * stretch, p90 for advanced).
 *
 * Colocated for now; will likely move to a dedicated reference-data module
 * once additional reference endpoints land.
 */
export interface StagePowerCurveCell {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p99: number;
  n: number;
}

export interface StagePowerCurveStage {
  men: { short: StagePowerCurveCell; medium: StagePowerCurveCell; long: StagePowerCurveCell };
  women: { short: StagePowerCurveCell; medium: StagePowerCurveCell; long: StagePowerCurveCell };
}

export interface StagePowerCurve {
  /** ISO date stamp of the underlying materialized view refresh. */
  version: string;
  body_mass_basis: "default_84m_64w";
  n_underlying_results: number;
  cache_ttl_seconds: number;
  stages: {
    open: StagePowerCurveStage;
    quarterfinals: StagePowerCurveStage;
    regional: StagePowerCurveStage;
    semifinals: StagePowerCurveStage;
    games: StagePowerCurveStage;
  };
}

// ---- catalog (GET /workouts) cohort distributions (bundle 1.7.0) ----

/**
 * Cohort work + power for a single catalog workout. Computed upstream at
 * default body mass (84 kg M / 64 kg W) — same caveat as
 * Tier4AllResultsEntry.result.body_mass_basis. Exposed on /workouts/{id}
 * catalog entries (upstream sql/132 + sql/137 endpoint wiring, shipped
 * 2026-05-19).
 *
 * `joules` is a SCALAR: for a fixed catalog prescription (reps × loads) the
 * total work done is the same for every athlete who completes the workout.
 * The athlete-varying piece is TIME, which is why avg_power_watts and
 * avg_w_per_kg ship as p50/p90/p99 distributions.
 *
 * `n` is the count of athlete results underlying the watts/w_per_kg
 * distributions — surface to users as "based on X athletes" trust signals.
 *
 * Colocated with the bundle types for now; move to a dedicated
 * catalog-types module when benchmark-replacement wires the join.
 */
export interface CatalogCohortWorkPower {
  body_mass_basis: "default_84m_64w";
  n: number;
  joules: number;
  avg_power_watts: { p50: number; p90: number; p99: number };
  avg_w_per_kg: { p50: number; p90: number; p99: number };
}

// ---- movement_competency (opt-in via ?include=competency, bundle 1.4.0) ----

export interface Tier4MovementCompetency {
  movement: string;
  /** Proxy for whether the athlete can do this gate-prone movement. */
  gap_signal: "likely_has" | "likely_lacking" | "inconclusive" | "thin_evidence" | "no_data" | string;
  n_workouts: number;
}

// ---- fitness_signature (opt-in via ?include=signature, bundle 1.5.0) ----

export interface Tier4SignatureBucket {
  n_workouts: number;
  cohort_percentile: number;
  worldwide_percentile: number;
}

export interface Tier4ClosableGap {
  dimension: "load_class" | "modality" | "time_domain" | "skill_gated" | string;
  bucket: string;
  n_workouts: number;
  cohort_percentile: number;
  worldwide_percentile: number;
  /** How far below the athlete's own overall this bucket sits (percentage points). */
  gap_vs_overall_pp: number;
}

export interface Tier4StageProgressionEntry {
  season: number;
  highest_stage_reached: "open" | "quarterfinals" | "semifinals" | "regional" | "games" | string;
  season_cohort_percentile: number;
}

export interface Tier4FitnessSignature {
  closable_gaps: Tier4ClosableGap[];                 // biggest gap first
  stage_progression: Tier4StageProgressionEntry[];
  stimulus_breakdown: {
    overall: { all: Tier4SignatureBucket };
    modality: Record<string, Tier4SignatureBucket>;
    load_class: Record<string, Tier4SignatureBucket>;
    skill_gated: Record<string, Tier4SignatureBucket>;
    time_domain: Record<string, Tier4SignatureBucket>;
  };
}

export interface Tier4Bundle {
  identity: Tier4Identity;
  movement_affinity: Tier4MovementAffinityEntry[];
  character_affinity: Tier4CharacterAffinityEntry[];
  recent_raw_results: Tier4RecentResult[];
  competition_summary: Tier4CompetitionSummary;
  time_domain_modality_breakdown: Record<
    string,
    Record<string, { exposures: number; avg_percentile: number | null }>
  >;
  // Present only when requested via ?include=all_results.
  all_results?: Tier4AllResultsEntry[];
  // Present only when requested via ?include=competency.
  movement_competency?: Tier4MovementCompetency[];
  // Present only when requested via ?include=signature.
  fitness_signature?: Tier4FitnessSignature;
  // Present only when requested via ?include=power_profile (upstream sql/134).
  power_profile?: Tier4PowerProfile;
}

/**
 * Light boundary check — confirms the top-level shape looks like a Tier4Bundle.
 * Doesn't deeply validate every leaf field; that's the consumer's job.
 */
function looksLikeTier4Bundle(x: unknown): x is Tier4Bundle {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    !!o.identity &&
    typeof o.identity === "object" &&
    !!o.competition_summary &&
    typeof o.competition_summary === "object" &&
    Array.isArray(o.movement_affinity) &&
    Array.isArray(o.character_affinity) &&
    Array.isArray(o.recent_raw_results)
  );
}

export interface FetchTier4Options {
  /** ?include= flags, e.g. ["all_results"]. Bundle 1.3.0+. */
  include?: string[];
  /** ?since=<year> — only with include:["all_results"]; windows the career array. */
  since?: number;
}

/**
 * Fetch the Tier 4 bundle for a linked competitor_id.
 * Returns null on any error path (network, auth, 404, malformed body).
 *
 * Caller passes the competitor_id read from athlete_profiles. If the athlete
 * isn't linked, the caller should skip calling this entirely. `opts.include`
 * forwards to the endpoint's ?include= mechanism (e.g. ["all_results"]).
 */
export async function fetchTier4Bundle(
  competitorId: string,
  opts: FetchTier4Options = {},
): Promise<Tier4Bundle | null> {
  if (!competitorId || typeof competitorId !== "string") return null;

  const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
  const serviceKey = Deno.env.get("COMPETITION_SERVICE_KEY");
  if (!baseUrl || !serviceKey) {
    console.warn(
      "[fetchTier4Bundle] missing env (COMPETITION_SERVICE_BASE_URL / COMPETITION_SERVICE_KEY); returning null",
    );
    return null;
  }

  const include = (opts.include ?? []).filter((s) => typeof s === "string" && s.length > 0);
  const params = new URLSearchParams();
  if (include.length > 0) params.set("include", include.join(","));
  if (typeof opts.since === "number" && Number.isFinite(opts.since)) {
    params.set("since", String(Math.trunc(opts.since)));
  }
  const qs = params.toString();
  const url = `${baseUrl.replace(/\/$/, "")}/programming-profile/${encodeURIComponent(competitorId)}${qs ? `?${qs}` : ""}`;

  const heavy = include.includes("all_results");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    heavy ? TIER4_FETCH_TIMEOUT_MS_HEAVY : TIER4_FETCH_TIMEOUT_MS,
  );

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "X-Service-Key": serviceKey },
      signal: controller.signal,
    });

    if (resp.status === 404) {
      console.info(
        `[fetchTier4Bundle] competitor_id ${competitorId} not found (404); returning null`,
      );
      return null;
    }
    if (resp.status === 401) {
      console.error(
        "[fetchTier4Bundle] 401 unauthorized — service key mismatch or rotated; returning null",
      );
      return null;
    }
    if (!resp.ok) {
      console.warn(
        `[fetchTier4Bundle] HTTP ${resp.status} for competitor_id ${competitorId}; returning null`,
      );
      return null;
    }

    let json: unknown;
    try {
      json = await resp.json();
    } catch {
      console.warn(`[fetchTier4Bundle] response not valid JSON for ${competitorId}; returning null`);
      return null;
    }

    if (!looksLikeTier4Bundle(json)) {
      console.warn(
        `[fetchTier4Bundle] response missing expected top-level fields for ${competitorId}; returning null`,
      );
      return null;
    }

    return json;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn(`[fetchTier4Bundle] timeout fetching ${competitorId}; returning null`);
    } else {
      console.warn(`[fetchTier4Bundle] network error fetching ${competitorId}: ${(err as Error).message}; returning null`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
