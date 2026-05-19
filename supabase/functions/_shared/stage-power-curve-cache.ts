/**
 * stage-power-curve-cache.ts
 *
 * Cached fetcher for the upstream competition-service's reference endpoint:
 *   GET /v1/reference/stage_power_curve
 *
 * Reference data — not per-athlete, same payload for every consumer fetch.
 * Cache lives per edge-function cold start, TTL driven by the response's
 * own `cache_ttl_seconds` field. Inflight-fetch deduplication so concurrent
 * cache misses share a single network call.
 *
 * Failure-soft by design: any error path returns null. Consumers (the
 * benchmark-replacement compute) treat null as "reference data unavailable"
 * and fall back to the existing PERFORMANCE_FACTORS-based math.
 */

import type { StagePowerCurve } from "./fetch-tier4-bundle.ts";

const FETCH_TIMEOUT_MS = 5_000;
/** Used only if the response somehow lacks cache_ttl_seconds. The endpoint
 *  always sets this field, but be defensive. */
const FALLBACK_TTL_SECONDS = 3600;

interface CacheEntry {
  data: StagePowerCurve;
  expiresAt: number; // epoch milliseconds
}

let cache: CacheEntry | null = null;
let inflightFetch: Promise<StagePowerCurve | null> | null = null;

/**
 * Returns the stage power curve from cache or a fresh fetch.
 * null on any failure (missing env, network error, malformed response).
 *
 * Concurrent callers during a cache miss share the same inflight fetch.
 */
export async function getStagePowerCurve(): Promise<StagePowerCurve | null> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }
  if (inflightFetch) {
    return inflightFetch;
  }
  inflightFetch = doFetch();
  try {
    return await inflightFetch;
  } finally {
    inflightFetch = null;
  }
}

async function doFetch(): Promise<StagePowerCurve | null> {
  const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
  // work-calc function uses a SEPARATE per-consumer key, not the shared
  // COMPETITION_SERVICE_KEY used for programming-profile / catalog endpoints.
  const serviceKey = Deno.env.get("WORK_CALC_SERVICE_KEY");
  if (!baseUrl || !serviceKey) {
    console.warn(
      "[stage-power-curve-cache] missing env (COMPETITION_SERVICE_BASE_URL / WORK_CALC_SERVICE_KEY); returning null",
    );
    return null;
  }

  const url = `${baseUrl.replace(/\/$/, "")}/work-calc/v1/reference/stage_power_curve`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "X-Service-Key": serviceKey },
      signal: controller.signal,
    });

    if (!resp.ok) {
      console.warn(
        `[stage-power-curve-cache] HTTP ${resp.status}; returning null`,
      );
      return null;
    }

    let json: unknown;
    try {
      json = await resp.json();
    } catch {
      console.warn("[stage-power-curve-cache] response not valid JSON; returning null");
      return null;
    }

    if (!looksLikeStagePowerCurve(json)) {
      console.warn(
        "[stage-power-curve-cache] response missing expected top-level fields; returning null",
      );
      return null;
    }

    const curve = json as StagePowerCurve;
    const ttlSeconds = typeof curve.cache_ttl_seconds === "number" && curve.cache_ttl_seconds > 0
      ? curve.cache_ttl_seconds
      : FALLBACK_TTL_SECONDS;

    cache = {
      data: curve,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    return curve;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[stage-power-curve-cache] timeout fetching stage_power_curve; returning null");
    } else {
      console.warn(
        `[stage-power-curve-cache] network error: ${(err as Error).message}; returning null`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Light boundary check — confirms the response has the expected top-level shape.
 * Doesn't deeply validate every stage/gender/time-domain cell; consumers must
 * already handle missing cells (n<30 omission) via fallback cascade.
 */
function looksLikeStagePowerCurve(x: unknown): x is StagePowerCurve {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.version === "string" &&
    typeof o.body_mass_basis === "string" &&
    typeof o.cache_ttl_seconds === "number" &&
    !!o.stages &&
    typeof o.stages === "object"
  );
}

/** Test-only: reset cache + inflight state between test cases. */
export function _resetCacheForTests(): void {
  cache = null;
  inflightFetch = null;
}
