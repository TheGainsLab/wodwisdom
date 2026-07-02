/**
 * competition-catalog-cache.ts
 *
 * Cached fetcher for the upstream competition-service's catalog list:
 *   GET /workouts   (every competition workout, ~340 rows, near-static —
 *                    changes ~yearly when CrossFit adds new workouts)
 *
 * Reference data — identical payload for every user. Competition History is
 * free for all authenticated users (STRATEGY.md D5), so without a cache every
 * click of every user hits the shared COMPETITION_SERVICE_KEY bucket. This
 * collapses those into ~1 upstream fetch per TTL window per cold start.
 *
 * Mirrors stage-power-curve-cache.ts: per-cold-start in-memory cache, inflight
 * dedup so concurrent misses share one network call, failure-soft (null on any
 * error; the caller decides the HTTP status).
 */

const FETCH_TIMEOUT_MS = 8_000;
// Catalog changes ~yearly; a long TTL is safe. Cold starts reset it anyway,
// so this bounds staleness within a warm instance, not across deploys.
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry {
  payload: unknown;
  expiresAt: number; // epoch milliseconds
}

let cache: CacheEntry | null = null;
let inflightFetch: Promise<unknown | null> | null = null;

/**
 * Returns the catalog payload from cache or a fresh fetch.
 * null on any failure (missing env, non-200, timeout, malformed JSON) — the
 * caller maps null to an appropriate HTTP error.
 *
 * Concurrent callers during a cache miss share the same inflight fetch.
 */
export async function getCompetitionCatalog(): Promise<unknown | null> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.payload;
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

async function doFetch(): Promise<unknown | null> {
  const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
  const serviceKey = Deno.env.get("COMPETITION_SERVICE_KEY");
  if (!baseUrl || !serviceKey) {
    console.warn(
      "[competition-catalog-cache] missing env (COMPETITION_SERVICE_BASE_URL / COMPETITION_SERVICE_KEY); returning null",
    );
    return null;
  }

  const url = `${baseUrl.replace(/\/$/, "")}/workouts`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "X-Service-Key": serviceKey },
      signal: controller.signal,
    });

    if (!resp.ok) {
      console.warn(`[competition-catalog-cache] HTTP ${resp.status}; returning null`);
      return null;
    }

    let payload: unknown;
    try {
      payload = await resp.json();
    } catch {
      console.warn("[competition-catalog-cache] response not valid JSON; returning null");
      return null;
    }

    cache = { payload, expiresAt: Date.now() + CATALOG_TTL_MS };
    return payload;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[competition-catalog-cache] timeout fetching /workouts; returning null");
    } else {
      console.warn(
        `[competition-catalog-cache] network error: ${(err as Error).message}; returning null`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Test-only: reset cache + inflight state between test cases. */
export function _resetCacheForTests(): void {
  cache = null;
  inflightFetch = null;
}
