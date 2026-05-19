/**
 * Tests for stage-power-curve-cache.ts.
 *
 * Run with:
 *   deno test supabase/functions/_shared/stage-power-curve-cache_test.ts --allow-env --no-check
 *
 * Stubs globalThis.fetch and manipulates env vars. Each test resets the
 * module-level cache via _resetCacheForTests so cases don't leak state.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { _resetCacheForTests, getStagePowerCurve } from "./stage-power-curve-cache.ts";
import type { StagePowerCurve } from "./fetch-tier4-bundle.ts";

// ============================================================
// Test fixtures
// ============================================================

/** A minimal valid response covering all stages + some omitted cells
 *  to exercise the n<30 cell-omission contract. */
function makeCurve(): StagePowerCurve {
  return {
    version: "2026-05-19",
    body_mass_basis: "default_84m_64w",
    n_underlying_results: 2_837_412,
    cache_ttl_seconds: 86400,
    stages: {
      open: {
        men: {
          short: { p10: 180, p25: 215, p50: 250, p75: 290, p90: 340, p99: 420, n: 87412 },
          medium: { p10: 145, p25: 175, p50: 205, p75: 240, p90: 285, p99: 360, n: 124859 },
          long: { p10: 125, p25: 150, p50: 175, p75: 205, p90: 245, p99: 310, n: 91237 },
        },
        women: {
          short: { p10: 145, p25: 175, p50: 200, p75: 235, p90: 275, p99: 340, n: 64321 },
          medium: { p10: 120, p25: 145, p50: 165, p75: 195, p90: 230, p99: 290, n: 93215 },
          long: { p10: 100, p25: 120, p50: 140, p75: 165, p90: 195, p99: 250, n: 68134 },
        },
      },
      quarterfinals: {
        men: {
          short: { p10: 260, p25: 295, p50: 330, p75: 370, p90: 420, p99: 500, n: 1842 },
          medium: { p10: 210, p25: 240, p50: 270, p75: 310, p90: 355, p99: 430, n: 2154 },
          long: { p10: 175, p25: 200, p50: 230, p75: 265, p90: 305, p99: 380, n: 1623 },
        },
        women: {
          short: { p10: 215, p25: 245, p50: 275, p75: 310, p90: 350, p99: 420, n: 1421 },
          medium: { p10: 175, p25: 200, p50: 225, p75: 260, p90: 300, p99: 365, n: 1685 },
          // long: omitted to exercise n<30 contract
        },
      },
      regional: {
        men: { short: { p10: 280, p25: 310, p50: 345, p75: 385, p90: 435, p99: 510, n: 142 } },
        women: { short: { p10: 230, p25: 260, p50: 290, p75: 325, p90: 370, p99: 440, n: 98 } },
      },
      semifinals: {
        men: {},
        women: {},
      },
      games: {
        men: {},
        women: {},
      },
    },
  };
}

// ============================================================
// fetch stub helpers
// ============================================================

const ORIGINAL_FETCH = globalThis.fetch;

interface StubOpts {
  status?: number;
  body?: unknown;
  bodyText?: string; // if set, used instead of body — for malformed-JSON case
  throwError?: Error;
}

let fetchCallCount = 0;

function installFetchStub(opts: StubOpts) {
  fetchCallCount = 0;
  globalThis.fetch = ((_url: string | URL | Request) => {
    fetchCallCount++;
    if (opts.throwError) return Promise.reject(opts.throwError);
    const status = opts.status ?? 200;
    if (opts.bodyText !== undefined) {
      return Promise.resolve(new Response(opts.bodyText, { status }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(opts.body ?? null), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
    // deno-lint-ignore no-explicit-any
  }) as any;
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
  fetchCallCount = 0;
}

function setEnv() {
  Deno.env.set("COMPETITION_SERVICE_BASE_URL", "http://stub.local");
  Deno.env.set("WORK_CALC_SERVICE_KEY", "stub-work-calc-key");
}

function unsetEnv() {
  Deno.env.delete("COMPETITION_SERVICE_BASE_URL");
  Deno.env.delete("WORK_CALC_SERVICE_KEY");
}

function withClean<T>(fn: () => Promise<T> | T): Promise<T> {
  _resetCacheForTests();
  setEnv();
  return Promise.resolve(fn()).finally(() => {
    restoreFetch();
    unsetEnv();
    _resetCacheForTests();
  });
}

// ============================================================
// Tests
// ============================================================

Deno.test("getStagePowerCurve: returns null when env vars missing", async () => {
  await withClean(async () => {
    unsetEnv(); // override the setEnv() from withClean
    installFetchStub({ body: makeCurve() });
    const result = await getStagePowerCurve();
    assertEquals(result, null);
    assertEquals(fetchCallCount, 0, "should not attempt fetch when env missing");
  });
});

Deno.test("getStagePowerCurve: returns null on 4xx", async () => {
  await withClean(async () => {
    installFetchStub({ status: 401 });
    const result = await getStagePowerCurve();
    assertEquals(result, null);
  });
});

Deno.test("getStagePowerCurve: returns null on 5xx", async () => {
  await withClean(async () => {
    installFetchStub({ status: 503 });
    const result = await getStagePowerCurve();
    assertEquals(result, null);
  });
});

Deno.test("getStagePowerCurve: returns null on malformed JSON", async () => {
  await withClean(async () => {
    installFetchStub({ bodyText: "not valid json {" });
    const result = await getStagePowerCurve();
    assertEquals(result, null);
  });
});

Deno.test("getStagePowerCurve: returns null when top-level fields missing", async () => {
  await withClean(async () => {
    installFetchStub({ body: { version: "x" } }); // missing stages, body_mass_basis, etc.
    const result = await getStagePowerCurve();
    assertEquals(result, null);
  });
});

Deno.test("getStagePowerCurve: returns null on network error", async () => {
  await withClean(async () => {
    installFetchStub({ throwError: new Error("ECONNRESET") });
    const result = await getStagePowerCurve();
    assertEquals(result, null);
  });
});

Deno.test("getStagePowerCurve: success path returns parsed curve", async () => {
  await withClean(async () => {
    const curve = makeCurve();
    installFetchStub({ body: curve });
    const result = await getStagePowerCurve();
    assert(result !== null);
    assertEquals(result.version, "2026-05-19");
    assertEquals(result.body_mass_basis, "default_84m_64w");
    assertEquals(result.stages.open.men.short?.p50, 250);
  });
});

Deno.test("getStagePowerCurve: handles missing cells (n<30 contract)", async () => {
  await withClean(async () => {
    installFetchStub({ body: makeCurve() });
    const result = await getStagePowerCurve();
    assert(result !== null);
    // QF women's long is intentionally omitted in the fixture.
    assertEquals(result.stages.quarterfinals.women.long, undefined);
    // QF women's medium IS present — proves we're not blanket-rejecting.
    assertEquals(result.stages.quarterfinals.women.medium?.p50, 225);
    // Games cells are entire-gender empty objects — consumers see undefined.
    assertEquals(result.stages.games.men.short, undefined);
    assertEquals(result.stages.games.women.long, undefined);
  });
});

Deno.test("getStagePowerCurve: caches across calls (second call no fetch)", async () => {
  await withClean(async () => {
    installFetchStub({ body: makeCurve() });
    const first = await getStagePowerCurve();
    assert(first !== null);
    assertEquals(fetchCallCount, 1);
    const second = await getStagePowerCurve();
    assert(second !== null);
    assertEquals(fetchCallCount, 1, "second call should hit cache, not refetch");
    // Same reference identity — proves it's the cached object.
    assertEquals(first, second);
  });
});

Deno.test("getStagePowerCurve: refetches after TTL expires", async () => {
  await withClean(async () => {
    // cache_ttl_seconds of 0 forces immediate expiry path — but the code
    // requires > 0 (falls back to FALLBACK_TTL_SECONDS). Use a tiny TTL
    // via a custom curve so we can wait it out without sleeping forever.
    const curve = makeCurve();
    curve.cache_ttl_seconds = 1; // 1 second TTL
    installFetchStub({ body: curve });
    await getStagePowerCurve();
    assertEquals(fetchCallCount, 1);

    // Wait > 1s for TTL to expire.
    await new Promise((r) => setTimeout(r, 1100));

    await getStagePowerCurve();
    assertEquals(fetchCallCount, 2, "should refetch after TTL");
  });
});

Deno.test("getStagePowerCurve: concurrent calls during cache miss share inflight fetch", async () => {
  await withClean(async () => {
    let resolveFetch: (resp: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((r) => (resolveFetch = r));
    fetchCallCount = 0;
    globalThis.fetch = ((_url: string | URL | Request) => {
      fetchCallCount++;
      return fetchPromise;
      // deno-lint-ignore no-explicit-any
    }) as any;

    // Fire three concurrent calls.
    const p1 = getStagePowerCurve();
    const p2 = getStagePowerCurve();
    const p3 = getStagePowerCurve();

    // Only one fetch should be in flight even though three callers are waiting.
    assertEquals(fetchCallCount, 1);

    // Resolve the fetch; all three callers get the same result.
    resolveFetch(
      new Response(JSON.stringify(makeCurve()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    assert(r1 !== null && r2 !== null && r3 !== null);
    assertEquals(r1, r2);
    assertEquals(r2, r3);
    assertEquals(fetchCallCount, 1, "inflight dedup should prevent extra fetches");
  });
});
