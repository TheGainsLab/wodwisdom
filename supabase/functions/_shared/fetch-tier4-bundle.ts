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
  };
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
