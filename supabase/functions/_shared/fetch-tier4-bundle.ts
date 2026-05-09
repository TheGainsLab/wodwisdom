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
}

export interface Tier4CompetitionSummary {
  overall_competitive_tier: "open_only" | "qualifier" | "regionals" | "games_athlete";
  seasons_competed: number;
  latest_percentile: number;
  trend: Tier4TrendBlock;
  consistency: number | null;
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

/**
 * Fetch the Tier 4 bundle for a linked competitor_id.
 * Returns null on any error path (network, auth, 404, malformed body).
 *
 * Caller passes the competitor_id read from athlete_profiles. If the athlete
 * isn't linked, the caller should skip calling this entirely.
 */
export async function fetchTier4Bundle(
  competitorId: string,
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

  const url = `${baseUrl.replace(/\/$/, "")}/programming-profile/${encodeURIComponent(competitorId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIER4_FETCH_TIMEOUT_MS);

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
