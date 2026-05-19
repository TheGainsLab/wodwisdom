/**
 * Tests for compute-benchmarks.ts.
 *
 * Run with:
 *   deno test supabase/functions/_shared/compute-benchmarks_test.ts --allow-env --no-check
 *
 * Stubs globalThis.fetch with URL-matching: work-calc URL → joules response,
 * stage_power_curve URL → curve response. Resets the curve cache between
 * tests via stage-power-curve-cache._resetCacheForTests.
 */

import { assert, assertEquals, assertAlmostEquals } from "jsr:@std/assert";
import { _resetCacheForTests } from "./stage-power-curve-cache.ts";
import type { StagePowerCurve } from "./fetch-tier4-bundle.ts";
import {
  _deriveTimeDomain,
  _formatAMRAP,
  _formatTimeSeconds,
  computeBenchmarks,
  type WorkCalcMovement,
} from "./compute-benchmarks.ts";

// ============================================================
// Fixtures
// ============================================================

function makeFullCurve(): StagePowerCurve {
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
          // long: intentionally omitted (n<30 contract).
        },
      },
      regional: { men: {}, women: {} },
      semifinals: { men: {}, women: {} },
      games: { men: {}, women: {} },
    },
  };
}

const FRAN_MOVEMENTS: WorkCalcMovement[] = [
  { movement_name: "Thruster", reps_total: 45, load_lbs_men: 95, load_lbs_women: 65 },
  { movement_name: "Pull-up", reps_total: 45 },
];

const CINDY_PER_ROUND_MOVEMENTS: WorkCalcMovement[] = [
  // AMRAP movements use reps_per_round, not reps_total (upstream contract).
  { movement_name: "Pull-up", reps_per_round: 5 },
  { movement_name: "Push-up", reps_per_round: 10 },
  { movement_name: "Air Squat", reps_per_round: 15 },
];

// ============================================================
// fetch stub: route by URL substring
// ============================================================

const ORIGINAL_FETCH = globalThis.fetch;

interface StubOpts {
  /** Joules to return from work-calc (or null to fail with 500). */
  workCalcJoules: number | null;
  /** Curve to return (or null to fail with 500). */
  curve: StagePowerCurve | null;
  workCalcStatus?: number;
  curveStatus?: number;
}

function installFetchStub(opts: StubOpts) {
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = typeof url === "string" ? url : (url as URL).toString();
    if (u.includes("/reference/stage_power_curve")) {
      if (opts.curve === null) {
        return Promise.resolve(new Response("err", { status: opts.curveStatus ?? 500 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(opts.curve), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.includes("/work/calculate")) {
      if (opts.workCalcJoules === null) {
        return Promise.resolve(new Response("err", { status: opts.workCalcStatus ?? 500 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ total_joules: opts.workCalcJoules }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.reject(new Error(`fetch stub: unrecognized URL ${u}`));
    // deno-lint-ignore no-explicit-any
  }) as any;
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}

function setEnv() {
  Deno.env.set("COMPETITION_SERVICE_BASE_URL", "http://stub.local");
  Deno.env.set("WORK_CALC_SERVICE_KEY", "stub-work-calc-key");
}

async function withClean<T>(fn: () => Promise<T>): Promise<T> {
  _resetCacheForTests();
  setEnv();
  try {
    return await fn();
  } finally {
    restoreFetch();
    _resetCacheForTests();
  }
}

// ============================================================
// Time-domain derivation cascade
// ============================================================

Deno.test("_deriveTimeDomain: time_cap_seconds present buckets directly (short)", () => {
  assertEquals(
    _deriveTimeDomain(420, null, 0, makeFullCurve(), "men"),
    "short",
  );
});

Deno.test("_deriveTimeDomain: time_cap_seconds present buckets directly (medium)", () => {
  assertEquals(
    _deriveTimeDomain(720, null, 0, makeFullCurve(), "men"),
    "medium",
  );
});

Deno.test("_deriveTimeDomain: time_cap_seconds present buckets directly (long)", () => {
  assertEquals(
    _deriveTimeDomain(1500, null, 0, makeFullCurve(), "men"),
    "long",
  );
});

Deno.test("_deriveTimeDomain: cap = 480s exactly → short (boundary)", () => {
  assertEquals(_deriveTimeDomain(480, null, 0, makeFullCurve(), "men"), "short");
});

Deno.test("_deriveTimeDomain: cap = 900s exactly → medium (boundary)", () => {
  assertEquals(_deriveTimeDomain(900, null, 0, makeFullCurve(), "men"), "medium");
});

Deno.test("_deriveTimeDomain: AMRAP block_scheme regex (12 → medium)", () => {
  assertEquals(
    _deriveTimeDomain(null, "AMRAP 12", 0, makeFullCurve(), "men"),
    "medium",
  );
});

Deno.test("_deriveTimeDomain: EMOM block_scheme regex (5 → short)", () => {
  assertEquals(
    _deriveTimeDomain(null, "EMOM 5", 0, makeFullCurve(), "men"),
    "short",
  );
});

Deno.test("_deriveTimeDomain: generic 'N min' scheme (20 → long)", () => {
  assertEquals(
    _deriveTimeDomain(null, "For time, 20 min cap", 0, makeFullCurve(), "men"),
    "long",
  );
});

Deno.test("_deriveTimeDomain: self-consistent iteration when no cap or scheme", () => {
  // Fran-ish joules (~74k) ÷ men's short p50 (250 W) ≈ 296s → "short".
  assertEquals(
    _deriveTimeDomain(null, null, 74000, makeFullCurve(), "men"),
    "short",
  );
  // Bigger workout → ~200k joules ÷ medium p50 (205W) ≈ 976s → "long".
  assertEquals(
    _deriveTimeDomain(null, null, 200000, makeFullCurve(), "men"),
    "long",
  );
});

Deno.test("_deriveTimeDomain: defaults to 'medium' when all fail", () => {
  // Force a malformed curve: no cells at all.
  const emptyCurve: StagePowerCurve = {
    ...makeFullCurve(),
    stages: {
      open: { men: {}, women: {} },
      quarterfinals: { men: {}, women: {} },
      regional: { men: {}, women: {} },
      semifinals: { men: {}, women: {} },
      games: { men: {}, women: {} },
    },
  };
  assertEquals(_deriveTimeDomain(null, null, 50000, emptyCurve, "men"), "medium");
});

// ============================================================
// Score formatting helpers
// ============================================================

Deno.test("_formatTimeSeconds: rounds + pads correctly", () => {
  assertEquals(_formatTimeSeconds(0), "0:00");
  assertEquals(_formatTimeSeconds(7), "0:07");
  assertEquals(_formatTimeSeconds(60), "1:00");
  assertEquals(_formatTimeSeconds(458), "7:38");
  assertEquals(_formatTimeSeconds(3600), "1:00:00");
  // Rounds (273.5 → 274 = 4:34)
  assertEquals(_formatTimeSeconds(273.5), "4:34");
});

Deno.test("_formatTimeSeconds: invalid/negative → '0:00'", () => {
  assertEquals(_formatTimeSeconds(-5), "0:00");
  assertEquals(_formatTimeSeconds(NaN), "0:00");
  assertEquals(_formatTimeSeconds(Infinity), "0:00");
});

Deno.test("_formatAMRAP: classic Cindy example (men, 20 min)", () => {
  // Cindy per round: 5 pull-up + 10 push-up + 15 air squat = 30 reps.
  // Suppose joulesPerRound = 18000, p50 watts = 200, 20 min cap.
  // Total capacity = 200 × 1200 = 240,000 J → 13 full rounds (234,000 J)
  // remaining = 6,000 J → 6000/18000 × 30 = 10 partial reps.
  const result = _formatAMRAP(18000, 200, 1200, CINDY_PER_ROUND_MOVEMENTS);
  assertEquals(result, "13+10");
});

Deno.test("_formatAMRAP: zero watts → '0+0'", () => {
  assertEquals(_formatAMRAP(10000, 0, 600, CINDY_PER_ROUND_MOVEMENTS), "0+0");
});

// ============================================================
// computeBenchmarks: happy paths + fallbacks
// ============================================================

Deno.test("computeBenchmarks: For-Time happy path (Fran men)", async () => {
  await withClean(async () => {
    installFetchStub({ workCalcJoules: 74000, curve: makeFullCurve() });
    const result = await computeBenchmarks({
      movements: FRAN_MOVEMENTS,
      gender: "men",
      workout_type: "for_time",
      block_scheme_hint: "21-15-9 for time",
    });
    assert(result !== null);
    // time_domain derived via self-consistent (no cap, no AMRAP regex):
    // 74000 / 250 (open.men.short.p50) ≈ 296s → short.
    assertEquals(result.time_domain, "short");
    assertEquals(result.median_watts, 250);
    assertEquals(result.excellent_watts, 330); // QF men short p50
    assertEquals(result.basis, "open_p50_vs_qf_p50");
    // Median time = 74000 / 250 = 296s → "4:56"
    assertEquals(result.median_score, "4:56");
    // Excellent time = 74000 / 330 ≈ 224s → "3:44"
    assertEquals(result.excellent_score, "3:44");
    assertEquals(result.joules, 74000);
  });
});

Deno.test("computeBenchmarks: AMRAP happy path (Cindy men 20 min)", async () => {
  await withClean(async () => {
    installFetchStub({ workCalcJoules: 18000, curve: makeFullCurve() });
    const result = await computeBenchmarks({
      movements: CINDY_PER_ROUND_MOVEMENTS,
      gender: "men",
      workout_type: "amrap",
      time_cap_seconds: 1200, // 20 min
    });
    assert(result !== null);
    assertEquals(result.time_domain, "long"); // 1200s > 900
    // open.men.long.p50 = 175, qf.men.long.p50 = 230.
    assertEquals(result.median_watts, 175);
    assertEquals(result.excellent_watts, 230);
    // Median: capacity 175*1200 = 210000 → 11 rounds (198000 J) + 12000 remaining
    //   12000/18000 × 30 = 20 reps → "11+20"
    assertEquals(result.median_score, "11+20");
    // Excellent: 230*1200 = 276000 → 15 rounds (270000 J) + 6000 remaining → 10 partial → "15+10"
    assertEquals(result.excellent_score, "15+10");
  });
});

Deno.test("computeBenchmarks: AMRAP requires time_cap_seconds (returns null without)", async () => {
  await withClean(async () => {
    installFetchStub({ workCalcJoules: 18000, curve: makeFullCurve() });
    const result = await computeBenchmarks({
      movements: CINDY_PER_ROUND_MOVEMENTS,
      gender: "men",
      workout_type: "amrap",
    });
    assertEquals(result, null);
  });
});

Deno.test("computeBenchmarks: For-Time with multi-rounds (5 RFT)", async () => {
  await withClean(async () => {
    installFetchStub({ workCalcJoules: 14000, curve: makeFullCurve() });
    const result = await computeBenchmarks({
      movements: [{ movement_name: "Burpee", reps_total: 10 }],
      gender: "men",
      workout_type: "for_time",
      rounds: 5,
    });
    assert(result !== null);
    // Total joules = 14000 * 5 = 70000
    // Self-consistent: 70000 / 250 = 280s → short
    assertEquals(result.time_domain, "short");
    // Median time = 70000 / 250 = 280s → "4:40"
    assertEquals(result.median_score, "4:40");
  });
});

// ============================================================
// Fallback cascades
// ============================================================

Deno.test("computeBenchmarks: QF cell missing → falls back to Open p90 for excellent", async () => {
  await withClean(async () => {
    // QF women long is omitted in our fixture.
    installFetchStub({ workCalcJoules: 90000, curve: makeFullCurve() });
    const result = await computeBenchmarks({
      movements: [
        { movement_name: "Row", distance_value: 2000, distance_unit: "meters" },
      ],
      gender: "women",
      workout_type: "for_time",
      time_cap_seconds: 1200, // forces long
    });
    assert(result !== null);
    assertEquals(result.time_domain, "long");
    assertEquals(result.median_watts, 140); // open.women.long.p50
    // QF missing → fall back to Open women's long p90 = 195
    assertEquals(result.excellent_watts, 195);
    assertEquals(result.basis, "open_p50_vs_open_p90_qf_missing_or_too_low");
    assert(result.excellent_score !== null);
  });
});

Deno.test("computeBenchmarks: thin-sample QF p50 below median → falls back to Open p90", async () => {
  await withClean(async () => {
    const curve = makeFullCurve();
    // Force QF men short p50 below Open men short p50 (250). Real-world this would
    // be an extreme small-sample fluke, but the guard should kick in.
    curve.stages.quarterfinals.men.short = {
      p10: 100, p25: 130, p50: 220, p75: 280, p90: 360, p99: 480, n: 31,
    };
    installFetchStub({ workCalcJoules: 60000, curve });
    const result = await computeBenchmarks({
      movements: FRAN_MOVEMENTS,
      gender: "men",
      workout_type: "for_time",
      time_cap_seconds: 360, // forces short
    });
    assert(result !== null);
    assertEquals(result.time_domain, "short");
    assertEquals(result.median_watts, 250);
    // QF p50 (220) < median (250) → guard kicks in, falls back to Open p90 (340).
    assertEquals(result.excellent_watts, 340);
    assertEquals(result.basis, "open_p50_vs_open_p90_qf_missing_or_too_low");
  });
});

Deno.test("computeBenchmarks: Open p50 missing → returns null (caller falls back)", async () => {
  await withClean(async () => {
    const curve = makeFullCurve();
    // Remove the Open men short cell — extremely unlikely but defensive.
    delete curve.stages.open.men.short;
    installFetchStub({ workCalcJoules: 60000, curve });
    const result = await computeBenchmarks({
      movements: FRAN_MOVEMENTS,
      gender: "men",
      workout_type: "for_time",
      time_cap_seconds: 360,
    });
    assertEquals(result, null);
  });
});

// ============================================================
// Failure paths → returns null (caller falls back to PERFORMANCE_FACTORS)
// ============================================================

Deno.test("computeBenchmarks: work-calc 500 → null", async () => {
  await withClean(async () => {
    installFetchStub({ workCalcJoules: null, curve: makeFullCurve() });
    const result = await computeBenchmarks({
      movements: FRAN_MOVEMENTS,
      gender: "men",
      workout_type: "for_time",
    });
    assertEquals(result, null);
  });
});

Deno.test("computeBenchmarks: stage curve 500 → null", async () => {
  await withClean(async () => {
    installFetchStub({ workCalcJoules: 74000, curve: null });
    const result = await computeBenchmarks({
      movements: FRAN_MOVEMENTS,
      gender: "men",
      workout_type: "for_time",
    });
    assertEquals(result, null);
  });
});

Deno.test("computeBenchmarks: gender null defaults to men (no crash)", async () => {
  await withClean(async () => {
    installFetchStub({ workCalcJoules: 74000, curve: makeFullCurve() });
    const result = await computeBenchmarks({
      movements: FRAN_MOVEMENTS,
      gender: null,
      workout_type: "for_time",
      time_cap_seconds: 360,
      user_id: "test-user-id",
    });
    assert(result !== null);
    assertEquals(result.median_watts, 250); // men's short p50
  });
});

Deno.test("computeBenchmarks: arithmetic sanity check (joules / watts → time)", async () => {
  await withClean(async () => {
    // Make joules + watts produce a clean number: 50000 J / 250 W = 200s = 3:20.
    installFetchStub({ workCalcJoules: 50000, curve: makeFullCurve() });
    const result = await computeBenchmarks({
      movements: FRAN_MOVEMENTS,
      gender: "men",
      workout_type: "for_time",
      time_cap_seconds: 360,
    });
    assert(result !== null);
    assertEquals(result.median_score, "3:20");
    // Excellent: 50000 / 330 ≈ 151.5s → "2:32"
    assertEquals(result.excellent_score, "2:32");
    assertAlmostEquals(result.median_watts, 250);
    assertAlmostEquals(result.excellent_watts ?? 0, 330);
  });
});
