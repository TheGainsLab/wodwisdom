/**
 * work-calc-movements-cache.ts
 *
 * Cached fetcher for GET /work-calc/v1/movements — upstream's canonical
 * vocabulary of ~114 movements with display_name, canonical_name, family,
 * formula_type, and a `modeled: boolean` flag indicating whether work-calc
 * can compute joules for this movement.
 *
 * 24h cacheable per upstream guidance; mirrors stage-power-curve-cache.ts
 * (failure-soft, inflight dedup, TTL driven by response cache_ttl_seconds).
 *
 * Consumed by movement-resolver.ts to map free-text writer output to
 * upstream canonical names before sending to work-calc.
 */

const FETCH_TIMEOUT_MS = 5_000;
const FALLBACK_TTL_SECONDS = 86400;

export interface MovementInfo {
  display_name: string;
  canonical_name: string;
  family?: string;
  mgw_category?: string;
  formula_type?: string;
  modeled: boolean;
  required_inputs?: string[];
}

export interface MovementsResponse {
  movements: MovementInfo[];
  total: number;
  modeled_count: number;
  version: string;
  cache_ttl_seconds?: number;
}

interface CacheEntry {
  data: MovementsResponse;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
let inflightFetch: Promise<MovementsResponse | null> | null = null;

export async function getWorkCalcMovements(): Promise<MovementsResponse | null> {
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

async function doFetch(): Promise<MovementsResponse | null> {
  const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
  const serviceKey = Deno.env.get("WORK_CALC_SERVICE_KEY");
  if (!baseUrl || !serviceKey) {
    console.warn(
      "[work-calc-movements-cache] missing env (COMPETITION_SERVICE_BASE_URL / WORK_CALC_SERVICE_KEY); returning null",
    );
    return null;
  }

  const url = `${baseUrl.replace(/\/$/, "")}/work-calc/v1/movements`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "X-Service-Key": serviceKey },
      signal: controller.signal,
    });

    if (!resp.ok) {
      console.warn(`[work-calc-movements-cache] HTTP ${resp.status}; returning null`);
      return null;
    }

    let json: unknown;
    try {
      json = await resp.json();
    } catch {
      console.warn("[work-calc-movements-cache] response not valid JSON; returning null");
      return null;
    }

    if (!looksLikeMovementsResponse(json)) {
      console.warn(
        "[work-calc-movements-cache] response missing expected fields; returning null",
      );
      return null;
    }

    const data = json as MovementsResponse;
    const ttlSeconds = typeof data.cache_ttl_seconds === "number" && data.cache_ttl_seconds > 0
      ? data.cache_ttl_seconds
      : FALLBACK_TTL_SECONDS;
    cache = { data, expiresAt: Date.now() + ttlSeconds * 1000 };
    return data;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[work-calc-movements-cache] timeout; returning null");
    } else {
      console.warn(`[work-calc-movements-cache] error: ${(err as Error).message}; returning null`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeMovementsResponse(x: unknown): x is MovementsResponse {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return Array.isArray(o.movements) && typeof o.version === "string";
}

/** Test-only: reset cache + inflight state between test cases. */
export function _resetCacheForTests(): void {
  cache = null;
  inflightFetch = null;
}
