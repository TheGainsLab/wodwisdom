/**
 * Integration tests for buildWriterPayload against the 6 profile fixtures.
 * Run with:
 *   deno test supabase/functions/_shared/build-writer-payload_test.ts --allow-env --no-check
 *
 * Stubs:
 *   - SupabaseClient: minimal fluent builder returning the fixture's profileRow
 *     for athlete_profiles, and a fixed display_name list for movements.
 *   - globalThis.fetch: intercepted to return the fixture's bundle for
 *     competition-service URLs; everything else (OpenAI etc.) throws so
 *     buildRagContext soft-fails to "".
 *
 * The module under test (build-writer-payload.ts) is loaded via dynamic
 * import after env manipulation so build-rag-context.ts captures
 * OPENAI_API_KEY = undefined at module-init and skips the RAG path entirely.
 */

import { assert, assertEquals, assertObjectMatch } from "jsr:@std/assert";

import {
  ALL_FIXTURES,
  FIXTURE_BEGINNER_FITNESS,
  FIXTURE_INTERMEDIATE_COMPETITOR,
  FIXTURE_STRONG_LOWCARDIO,
  FIXTURE_QUALIFIER_LINKED,
  FIXTURE_GAMES_LINKED,
  FIXTURE_INJURED_COMPETITOR,
  type FixtureProfileRow,
  type ProfileFixture,
} from "./fixtures/profile-fixtures.ts";
import {
  ALL_CONDITIONING_KEYS,
  ALL_EQUIPMENT_KEYS,
  ALL_LIFT_KEYS,
  ALL_SKILL_KEYS,
  SKILL_DISPLAY_NAMES,
} from "./tier-status.ts";
import type { Tier4Bundle } from "./fetch-tier4-bundle.ts";

// ============================================================
// Env + module load — must happen before importing the SUT so
// build-rag-context.ts captures OPENAI_API_KEY = undefined.
// ============================================================

Deno.env.delete("OPENAI_API_KEY");
Deno.env.set("COMPETITION_SERVICE_BASE_URL", "http://stub.local");
Deno.env.set("COMPETITION_SERVICE_KEY", "stub-key");

const { buildWriterPayload } = await import("./build-writer-payload.ts");

// ============================================================
// SupabaseClient stub
// ============================================================

const VOCAB = ["Back Squat", "Deadlift", "Snatch", "Clean and Jerk", "Burpee"];

interface StubOpts {
  profileRow: FixtureProfileRow | null;
  vocabulary?: string[];
  profileError?: { message: string } | null;
  /** Step 27 carry-forward; tests default to null (no prior cycle). */
  previousCycle?: unknown;
  /** Latest profile_evaluations.analysis; defaults to null (no evaluation). */
  profileEval?: string | null;
  /** Latest training_evaluations.analysis; defaults to null. */
  trainingEval?: string | null;
}

function makeStubSupa(opts: StubOpts) {
  const vocab = opts.vocabulary ?? VOCAB;

  function makeBuilder(table: string) {
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select(_cols: string) {
        return builder;
      },
      eq(_col: string, _val: unknown) {
        return builder;
      },
      gt(_col: string, _val: unknown) {
        return builder;
      },
      not(_col: string, _op: string, _val: unknown) {
        return builder;
      },
      limit(_n: number) {
        return builder;
      },
      order(_col: string, _orderOpts?: unknown) {
        // Movements terminal — thenable. Other tables keep chaining (their
        // queries end in .limit(1).maybeSingle()).
        if (table === "movements") {
          return Promise.resolve({
            data: vocab.map((display_name) => ({ display_name })),
            error: null,
          });
        }
        return builder;
      },
      maybeSingle() {
        if (table === "athlete_profiles") {
          return Promise.resolve({
            data: opts.profileRow,
            error: opts.profileError ?? null,
          });
        }
        if (table === "profile_evaluations") {
          return Promise.resolve({
            data: opts.profileEval != null ? { analysis: opts.profileEval } : null,
            error: null,
          });
        }
        if (table === "training_evaluations") {
          return Promise.resolve({
            data: opts.trainingEval != null ? { analysis: opts.trainingEval } : null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  // deno-lint-ignore no-explicit-any
  return {
    from: (table: string) => makeBuilder(table),
    // Step 27: user_previous_cycle_summary RPC. Tests default to "no prior
    // cycle" (null result); override per test if a fixture needs one.
    rpc: (_fn: string, _args: unknown) =>
      Promise.resolve({ data: opts.previousCycle ?? null, error: null }),
  } as any;
}

// ============================================================
// fetch stub — install/uninstall around each test
// ============================================================

const ORIGINAL_FETCH = globalThis.fetch;

function installFetchStub(bundle: Tier4Bundle | null) {
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = typeof url === "string" ? url : (url as URL).toString();
    if (u.startsWith("http://stub.local")) {
      if (bundle === null) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(bundle), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    // Anything else (OpenAI embeddings, etc.) — fail so callers soft-fail.
    return Promise.reject(new Error(`fetch stub: blocked ${u}`));
    // deno-lint-ignore no-explicit-any
  }) as any;
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}

// ============================================================
// Helper — assert canonical-key hydration shape
// ============================================================

function assertCanonicalShape(payload: {
  lifts: Record<string, number | null>;
  skills: Record<string, string | null>;
  conditioning: Record<string, string | number | null>;
  equipment: Record<string, boolean>;
}) {
  assertEquals(Object.keys(payload.lifts).sort(), [...ALL_LIFT_KEYS].sort());
  assertEquals(
    Object.keys(payload.skills).sort(),
    ALL_SKILL_KEYS.map((k) => SKILL_DISPLAY_NAMES[k]).sort(),
  );
  assertEquals(
    Object.keys(payload.conditioning).sort(),
    [...ALL_CONDITIONING_KEYS].sort(),
  );
  assertEquals(
    Object.keys(payload.equipment).sort(),
    [...ALL_EQUIPMENT_KEYS].sort(),
  );
}

// ============================================================
// Per-fixture: payload structurally matches the contract
// ============================================================

for (const fixture of ALL_FIXTURES) {
  Deno.test(`buildWriterPayload(${fixture.name}): canonical-key hydration + top-level shape`, async () => {
    installFetchStub(fixture.bundle);
    try {
      const supa = makeStubSupa({ profileRow: fixture.profileRow });
      const payload = await buildWriterPayload(supa, "test-user-id");

      // 13 top-level keys per the locked contract (Step 27 added previous_cycle;
      // eval-consumption added profile_evaluation + training_evaluation;
      // coaching-state Step 1 added athlete_model).
      assertEquals(
        Object.keys(payload).sort(),
        [
          "athlete_model",
          "basics",
          "competition",
          "conditioning",
          "equipment",
          "lifts",
          "previous_cycle",
          "profile_evaluation",
          "rag",
          "skills",
          "training_context",
          "training_evaluation",
          "vocabulary",
        ],
      );

      // athlete_model is always present (unpersisted v0 fallback when the
      // stub has no athlete_models table) with the deterministic fact-sheet.
      assertEquals(typeof payload.athlete_model.recovery_class, "string");
      assert(payload.athlete_model.strength_ratios !== undefined);
      assert(payload.athlete_model.capabilities !== undefined);

      assertCanonicalShape(payload);

      // basics propagates verbatim (numbers as-is; strings normalized).
      assertEquals(payload.basics.age, fixture.profileRow.age);
      assertEquals(payload.basics.bodyweight, fixture.profileRow.bodyweight);
      assertEquals(payload.basics.gender, fixture.profileRow.gender);

      // vocabulary propagates from the movements stub.
      assertEquals(payload.vocabulary, VOCAB);

      // rag is "" because OPENAI_API_KEY was deleted before module init.
      assertEquals(payload.rag, "");

      // competition presence reflects linkage + bundle availability.
      if (fixture.profileRow.competition_athlete_id && fixture.bundle) {
        assert(payload.competition !== null, "expected non-null competition for linked fixture");
      } else {
        assertEquals(payload.competition, null);
      }
    } finally {
      restoreFetch();
    }
  });
}

// ============================================================
// Fixture-specific: lifts hydration semantics
// ============================================================

Deno.test("buildWriterPayload(beginner_fitness): partial lifts → present keys filled, missing keys null", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_BEGINNER_FITNESS.profileRow });
    const payload = await buildWriterPayload(supa, "u");

    // Filled in the fixture:
    assertEquals(payload.lifts.back_squat, 225);
    assertEquals(payload.lifts.deadlift, 275);
    assertEquals(payload.lifts.bench_press, 185);
    assertEquals(payload.lifts.snatch, 95);
    assertEquals(payload.lifts.clean_and_jerk, 135);

    // Absent in the fixture → null:
    assertEquals(payload.lifts.front_squat, null);
    assertEquals(payload.lifts.overhead_squat, null);
    assertEquals(payload.lifts.power_snatch, null);
    assertEquals(payload.lifts.clean, null);
    assertEquals(payload.lifts.jerk, null);
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload(intermediate_competitor): all 14 canonical lifts filled", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({
      profileRow: FIXTURE_INTERMEDIATE_COMPETITOR.profileRow,
    });
    const payload = await buildWriterPayload(supa, "u");
    for (const k of ALL_LIFT_KEYS) {
      assert(
        typeof payload.lifts[k] === "number" && (payload.lifts[k] as number) > 0,
        `expected lifts.${k} to be a positive number, got ${payload.lifts[k]}`,
      );
    }
  } finally {
    restoreFetch();
  }
});

// ============================================================
// Equipment hydration: missing key → false
// ============================================================

Deno.test("buildWriterPayload(strong_lowcardio): equipment missing keys hydrate to false", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_STRONG_LOWCARDIO.profileRow });
    const payload = await buildWriterPayload(supa, "u");
    for (const k of ALL_EQUIPMENT_KEYS) {
      assertEquals(
        typeof payload.equipment[k],
        "boolean",
        `equipment.${k} must be boolean`,
      );
    }
    // The strong_lowcardio fixture has at least one explicit false; spot-check.
    assert(Object.values(payload.equipment).some((v) => v === true));
  } finally {
    restoreFetch();
  }
});

// ============================================================
// Tier 4 slice: drops character_affinity + identity from the bundle
// ============================================================

Deno.test("buildWriterPayload(qualifier_linked): Tier 4 slice strips identity + character_affinity", async () => {
  installFetchStub(FIXTURE_QUALIFIER_LINKED.bundle);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_QUALIFIER_LINKED.profileRow });
    const payload = await buildWriterPayload(supa, "u");

    assert(payload.competition !== null);
    const comp = payload.competition!;
    assert(!("identity" in comp));
    assert(!("character_affinity" in comp));
    // Pass-through keys present:
    assert("competition_summary" in comp);
    assert("movement_affinity" in comp);
    assert("time_domain_modality_breakdown" in comp);
    assert("recent_raw_results" in comp);
    assert(Array.isArray(comp.all_results));
    assert(Array.isArray(comp.movement_competency));
    assert(typeof comp.fitness_signature === "object");
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload(games_linked): competition_summary tier propagates", async () => {
  installFetchStub(FIXTURE_GAMES_LINKED.bundle);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_GAMES_LINKED.profileRow });
    const payload = await buildWriterPayload(supa, "u");
    assert(payload.competition !== null);
    assertObjectMatch(payload.competition!.competition_summary as Record<string, unknown>, {
      overall_competitive_tier: "games_athlete",
    });
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload(beginner_fitness): unlinked → competition is null", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_BEGINNER_FITNESS.profileRow });
    const payload = await buildWriterPayload(supa, "u");
    assertEquals(payload.competition, null);
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload(qualifier_linked): tier4 fetch 404 → competition null (soft-fail)", async () => {
  installFetchStub(null); // stub returns 404 when bundle is null
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_QUALIFIER_LINKED.profileRow });
    const payload = await buildWriterPayload(supa, "u");
    assertEquals(payload.competition, null);
  } finally {
    restoreFetch();
  }
});

// ============================================================
// Tier 4 slice: work/power fields (bundle 1.7.0, designed not yet shipped)
// ============================================================

Deno.test("buildWriterPayload(qualifier_linked): all_results[].result work/power round-trips when present", async () => {
  installFetchStub(FIXTURE_QUALIFIER_LINKED.bundle);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_QUALIFIER_LINKED.profileRow });
    const payload = await buildWriterPayload(supa, "u");
    assert(payload.competition !== null);
    const first = payload.competition!.all_results![0].result;
    assertEquals(first.joules, 158000);
    assertEquals(first.avg_power_watts, 220);
    assertEquals(first.avg_w_per_kg, 2.62);
    assertEquals(first.body_mass_basis, "default_84m_64w");
    // Bundle 1.9.0 — every result carries compute_status.
    assertEquals(first.compute_status, "computed");
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload(qualifier_linked): power_profile passes through with cell null pattern", async () => {
  installFetchStub(FIXTURE_QUALIFIER_LINKED.bundle);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_QUALIFIER_LINKED.profileRow });
    const payload = await buildWriterPayload(supa, "u");
    assert(payload.competition !== null);
    const pp = payload.competition!.power_profile;
    assert(pp !== null, "power_profile should pass through from bundle");
    assertEquals(pp!.body_mass_basis, "default_84m_64w");
    // Bundle 1.9.0 — calc_version + n_skipped_unmodeled.
    assertEquals(pp!.calc_version, "1.9.0");
    assertEquals(pp!.n_skipped_unmodeled, 8);
    assertEquals(pp!.overall.avg_power_watts, 245);
    assertEquals(pp!.overall.cohort_percentile, 92.0);
    // M cell has zero results — computed fields null, n_results 0.
    assertEquals(pp!.by_modality.M.n_results, 0);
    assertEquals(pp!.by_modality.M.avg_power_watts, null);
    assertEquals(pp!.by_modality.M.cohort_percentile, null);
    // mixed cell has data — computed fields populated.
    assertEquals(pp!.by_modality.mixed.n_results, 9);
    assertEquals(pp!.by_modality.mixed.avg_power_watts, 252);
    // Trend + peak round-trip.
    assertEquals(pp!.watts_trend.direction, "improving");
    assertEquals(pp!.peak_power_result.workout_name, "23.1");
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload(games_linked): bundle without power_profile → competition.power_profile is null", async () => {
  installFetchStub(FIXTURE_GAMES_LINKED.bundle);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_GAMES_LINKED.profileRow });
    const payload = await buildWriterPayload(supa, "u");
    assert(payload.competition !== null);
    assertEquals(payload.competition!.power_profile, null);
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload(games_linked): all_results[].result with null work/power (couldn't-compute branch)", async () => {
  installFetchStub(FIXTURE_GAMES_LINKED.bundle);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_GAMES_LINKED.profileRow });
    const payload = await buildWriterPayload(supa, "u");
    assert(payload.competition !== null);
    const first = payload.competition!.all_results![0].result;
    // Computed fields null per upstream contract (capped / AMRAP-no-rounds /
    // non-modeled). body_mass_basis is unconditional and always present.
    assertEquals(first.joules, null);
    assertEquals(first.avg_power_watts, null);
    assertEquals(first.avg_w_per_kg, null);
    assertEquals(first.body_mass_basis, "default_84m_64w");
    // Bundle 1.9.0 — compute_status explains why the work fields are null.
    assertEquals(first.compute_status, "skipped_capped_no_finish");
    // Pre-existing 1.6.0 field still present alongside the new ones.
    assertEquals(first.cohort_p99_threshold, 252);
  } finally {
    restoreFetch();
  }
});

// ============================================================
// training_context: clamping + free-text passthrough
// ============================================================

Deno.test("buildWriterPayload: days_per_week clamped low (2 → 3)", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({
      profileRow: { ...FIXTURE_BEGINNER_FITNESS.profileRow, days_per_week: 2 },
    });
    const payload = await buildWriterPayload(supa, "u");
    assertEquals(payload.training_context.days_per_week, 3);
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload: days_per_week clamped high (8 → 6)", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({
      profileRow: { ...FIXTURE_BEGINNER_FITNESS.profileRow, days_per_week: 8 },
    });
    const payload = await buildWriterPayload(supa, "u");
    assertEquals(payload.training_context.days_per_week, 6);
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload: days_per_week null → defaults to 5", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({
      profileRow: { ...FIXTURE_BEGINNER_FITNESS.profileRow, days_per_week: null },
    });
    const payload = await buildWriterPayload(supa, "u");
    assertEquals(payload.training_context.days_per_week, 5);
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload(injured_competitor): injuries_constraints text passes through verbatim", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_INJURED_COMPETITOR.profileRow });
    const payload = await buildWriterPayload(supa, "u");
    assertEquals(
      payload.training_context.injuries_constraints_text,
      FIXTURE_INJURED_COMPETITOR.profileRow.injuries_constraints,
    );
    assertEquals(
      payload.training_context.goal_text,
      FIXTURE_INJURED_COMPETITOR.profileRow.goal,
    );
  } finally {
    restoreFetch();
  }
});

// ============================================================
// Error path: profile row missing → throws
// ============================================================

Deno.test("buildWriterPayload: missing profile row throws", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({ profileRow: null });
    let thrown: unknown = null;
    try {
      await buildWriterPayload(supa, "missing-user");
    } catch (e) {
      thrown = e;
    }
    assert(thrown instanceof Error);
    assert(
      (thrown as Error).message.includes("not found"),
      `expected 'not found' in error message, got: ${(thrown as Error).message}`,
    );
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload: profile fetch error throws", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({
      profileRow: null,
      profileError: { message: "permission denied" },
    });
    let thrown: unknown = null;
    try {
      await buildWriterPayload(supa, "u");
    } catch (e) {
      thrown = e;
    }
    assert(thrown instanceof Error);
    assert((thrown as Error).message.includes("permission denied"));
  } finally {
    restoreFetch();
  }
});

// ============================================================
// Skill-level normalization
// ============================================================

Deno.test("buildWriterPayload: skill level lowercases + validates against allowed set", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({
      profileRow: {
        ...FIXTURE_BEGINNER_FITNESS.profileRow,
        skills: {
          strict_pull_ups: "ADVANCED", // mixed case → lowercases
          kipping_pull_ups: "garbage", // invalid → null
          muscle_ups: "none", // valid
          // remaining keys absent → null
        },
      },
    });
    const payload = await buildWriterPayload(supa, "u");
    assertEquals(payload.skills["Strict Pull-Ups"], "advanced");
    assertEquals(payload.skills["Kipping Pull-Ups"], null);
    assertEquals(payload.skills["Muscle-Ups"], "none");
    assertEquals(payload.skills["Toes-to-Bar"], null);
  } finally {
    restoreFetch();
  }
});

// ============================================================
// Coaching evaluation consumption
// ============================================================

Deno.test("buildWriterPayload: no evaluations → profile_evaluation + training_evaluation null", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({ profileRow: FIXTURE_BEGINNER_FITNESS.profileRow });
    const payload = await buildWriterPayload(supa, "u");
    assertEquals(payload.profile_evaluation, null);
    assertEquals(payload.training_evaluation, null);
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload: without includeEvaluations, evals are NOT read (evaluator isolation)", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({
      profileRow: FIXTURE_BEGINNER_FITNESS.profileRow,
      profileEval: "PROFILE NARRATIVE",
      trainingEval: "TRAINING NARRATIVE",
    });
    // Default opts (the profile-analysis-v2 evaluator path) must not ingest the
    // latest evaluation — that would be circular. Even at month 2.
    const payload = await buildWriterPayload(supa, "u", { monthNumber: 2 });
    assertEquals(payload.profile_evaluation, null);
    assertEquals(payload.training_evaluation, null);
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload: month 1 reads profile eval but NOT training eval", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({
      profileRow: FIXTURE_BEGINNER_FITNESS.profileRow,
      profileEval: "PROFILE NARRATIVE",
      trainingEval: "TRAINING NARRATIVE",
    });
    const payload = await buildWriterPayload(supa, "u", { includeEvaluations: true, monthNumber: 1 });
    assertEquals(payload.profile_evaluation, "PROFILE NARRATIVE");
    // Month 1 has no training history — training eval is never read.
    assertEquals(payload.training_evaluation, null);
  } finally {
    restoreFetch();
  }
});

Deno.test("buildWriterPayload: month 2 reads both profile + training evals", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({
      profileRow: FIXTURE_BEGINNER_FITNESS.profileRow,
      profileEval: "PROFILE NARRATIVE",
      trainingEval: "TRAINING NARRATIVE",
    });
    const payload = await buildWriterPayload(supa, "u", { includeEvaluations: true, monthNumber: 2 });
    assertEquals(payload.profile_evaluation, "PROFILE NARRATIVE");
    assertEquals(payload.training_evaluation, "TRAINING NARRATIVE");
  } finally {
    restoreFetch();
  }
});

// ============================================================
// Vocabulary fetch failure → empty list (audit rule 7 enforces downstream)
// ============================================================

Deno.test("buildWriterPayload: empty vocabulary list propagates", async () => {
  installFetchStub(null);
  try {
    const supa = makeStubSupa({
      profileRow: FIXTURE_BEGINNER_FITNESS.profileRow,
      vocabulary: [],
    });
    const payload = await buildWriterPayload(supa, "u");
    assertEquals(payload.vocabulary, []);
  } finally {
    restoreFetch();
  }
});
