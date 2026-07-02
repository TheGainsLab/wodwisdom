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
 * Resilience (the catalog is near-static, so a slightly stale copy beats an
 * outage):
 *   - SERVE-STALE-ON-ERROR: if a refresh fails but we hold any prior payload,
 *     return it rather than failing the user.
 *   - NEGATIVE CACHE: after a failure, don't re-fire the upstream fetch for a
 *     short window — otherwise every click stampedes the shared key on the exact
 *     failure this cache exists to prevent (H1).
 *   - STATUS PASSTHROUGH: on a hard miss (failure with no stale copy) the
 *     upstream HTTP status is surfaced so the caller can distinguish a 429
 *     (rate-limited — back off, and the signal the flip-the-gate audit says to
 *     measure) from a generic outage.
 *   - Inflight dedup: concurrent misses share one network call.
 */

const FETCH_TIMEOUT_MS = 8_000;
// Catalog changes ~yearly; a long TTL is safe. Cold starts reset it anyway.
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
// After a failed refresh, wait this long before hitting upstream again.
const NEGATIVE_TTL_MS = 45 * 1000; // 45 seconds

interface CacheEntry {
  payload: unknown;
  expiresAt: number; // epoch milliseconds
}

/** Success (fresh or stale) OR a hard miss carrying the upstream status. */
export type CatalogResult =
  | { payload: unknown; stale: boolean }
  | { payload: null; status: number | null }; // status: upstream HTTP status, or null on network/timeout

type FetchOutcome =
  | { ok: true; payload: unknown }
  | { ok: false; status: number | null };

let cache: CacheEntry | null = null;
let inflightFetch: Promise<FetchOutcome> | null = null;
// After a failure: don't refetch until this time; remember the status seen.
let failUntil = 0;
let lastFailStatus: number | null = null;

export async function getCompetitionCatalog(): Promise<CatalogResult> {
  const now = Date.now();

  // Fresh hit.
  if (cache && now < cache.expiresAt) {
    return { payload: cache.payload, stale: false };
  }

  // Inside the negative-cache window: don't hit upstream. Serve stale if we
  // have it, otherwise report the last failure status.
  if (now < failUntil) {
    return cache
      ? { payload: cache.payload, stale: true }
      : { payload: null, status: lastFailStatus };
  }

  // Refresh (expired or cold). Share one inflight fetch across callers.
  if (!inflightFetch) inflightFetch = doFetch();
  let outcome: FetchOutcome;
  try {
    outcome = await inflightFetch;
  } finally {
    inflightFetch = null;
  }

  if (outcome.ok) return { payload: outcome.payload, stale: false };

  // Failure: open the negative-cache window, then serve stale or report status.
  failUntil = Date.now() + NEGATIVE_TTL_MS;
  lastFailStatus = outcome.status;
  return cache
    ? { payload: cache.payload, stale: true }
    : { payload: null, status: outcome.status };
}

async function doFetch(): Promise<FetchOutcome> {
  const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
  const serviceKey = Deno.env.get("COMPETITION_SERVICE_KEY");
  if (!baseUrl || !serviceKey) {
    console.warn(
      "[competition-catalog-cache] missing env (COMPETITION_SERVICE_BASE_URL / COMPETITION_SERVICE_KEY)",
    );
    return { ok: false, status: null };
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
      console.warn(`[competition-catalog-cache] HTTP ${resp.status}`);
      return { ok: false, status: resp.status };
    }

    let payload: unknown;
    try {
      payload = await resp.json();
    } catch {
      console.warn("[competition-catalog-cache] response not valid JSON");
      return { ok: false, status: resp.status };
    }

    cache = { payload, expiresAt: Date.now() + CATALOG_TTL_MS };
    failUntil = 0;
    lastFailStatus = null;
    return { ok: true, payload };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[competition-catalog-cache] timeout fetching /workouts");
    } else {
      console.warn(`[competition-catalog-cache] network error: ${(err as Error).message}`);
    }
    return { ok: false, status: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Test-only: reset cache + inflight + negative-cache state between cases. */
export function _resetCacheForTests(): void {
  cache = null;
  inflightFetch = null;
  failUntil = 0;
  lastFailStatus = null;
}
