/**
 * compute-statuses-cache.ts
 *
 * Cached fetcher for GET /work-calc/v1/reference/compute_statuses — the
 * upstream's enum dictionary explaining each `compute_status` value on
 * Tier4AllResultsEntry.result. Cacheable 24h (per their cache_ttl_seconds);
 * mirrors stage-power-curve-cache.ts (failure-soft, inflight dedup).
 *
 * Useful for keying UI strings against the enum without hardcoding
 * descriptions on our side — each row carries description / severity /
 * actionable_by hints we can display directly.
 */

import type { ComputeStatusesResponse } from "./fetch-tier4-bundle.ts";

const FETCH_TIMEOUT_MS = 5_000;
const FALLBACK_TTL_SECONDS = 86400; // 24h, matches upstream default

interface CacheEntry {
  data: ComputeStatusesResponse;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
let inflightFetch: Promise<ComputeStatusesResponse | null> | null = null;

/**
 * Returns the compute-statuses dictionary from cache or a fresh fetch.
 * null on any failure path; consumers fall back to inline UI strings.
 */
export async function getComputeStatuses(): Promise<ComputeStatusesResponse | null> {
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

async function doFetch(): Promise<ComputeStatusesResponse | null> {
  const baseUrl = Deno.env.get("COMPETITION_SERVICE_BASE_URL");
  const serviceKey = Deno.env.get("WORK_CALC_SERVICE_KEY");
  if (!baseUrl || !serviceKey) {
    console.warn(
      "[compute-statuses-cache] missing env (COMPETITION_SERVICE_BASE_URL / WORK_CALC_SERVICE_KEY); returning null",
    );
    return null;
  }

  const url = `${baseUrl.replace(/\/$/, "")}/work-calc/v1/reference/compute_statuses`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "X-Service-Key": serviceKey },
      signal: controller.signal,
    });

    if (!resp.ok) {
      console.warn(`[compute-statuses-cache] HTTP ${resp.status}; returning null`);
      return null;
    }

    let json: unknown;
    try {
      json = await resp.json();
    } catch {
      console.warn("[compute-statuses-cache] response not valid JSON; returning null");
      return null;
    }

    if (!looksLikeComputeStatuses(json)) {
      console.warn(
        "[compute-statuses-cache] response missing expected fields; returning null",
      );
      return null;
    }

    const data = json as ComputeStatusesResponse;
    const ttlSeconds = typeof data.cache_ttl_seconds === "number" && data.cache_ttl_seconds > 0
      ? data.cache_ttl_seconds
      : FALLBACK_TTL_SECONDS;
    cache = { data, expiresAt: Date.now() + ttlSeconds * 1000 };
    return data;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[compute-statuses-cache] timeout; returning null");
    } else {
      console.warn(`[compute-statuses-cache] error: ${(err as Error).message}; returning null`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeComputeStatuses(x: unknown): x is ComputeStatusesResponse {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return Array.isArray(o.statuses) && typeof o.calc_version === "string";
}

/** Test-only: reset cache + inflight state between test cases. */
export function _resetCacheForTests(): void {
  cache = null;
  inflightFetch = null;
}
