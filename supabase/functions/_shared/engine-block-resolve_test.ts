// deno test supabase/functions/_shared/engine-block-resolve_test.ts --no-check
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveEngineDay, resolveSegments, type CatalogEngineDay } from "./engine-block-resolve.ts";

function day(over: Partial<CatalogEngineDay>): CatalogEngineDay {
  return {
    day_number: 1, day_type: "interval", phase: 1, month: 1,
    block_count: 1, set_rest_seconds: null,
    block_1_params: null, block_2_params: null, block_3_params: null, block_4_params: null,
    total_duration_minutes: 30, ...over,
  };
}

Deno.test("standard intervals: rounds expand with rest between (not after last)", () => {
  const segs = resolveSegments(day({
    block_1_params: { rounds: 3, workDuration: 300, restDuration: 120, paceRange: [0.7, 0.8] },
  }));
  assertEquals(segs.map((s) => s.type), ["work", "rest", "work", "rest", "work"]);
  assertEquals(segs[0].duration_seconds, 300);
  assertEquals(segs[1].duration_seconds, 120);
  assertEquals(segs[0].pace_frac, 0.75);
  assertEquals(segs[0].intensity, "70–80%");
  assertEquals(segs[1].pace_frac, null);
});

Deno.test("rest ratio keywords resolve against work duration", () => {
  const segs = resolveSegments(day({
    block_1_params: { rounds: 2, workDuration: 240, restDuration: "equal_to_work", paceRange: [0.8, 0.9] },
  }));
  assertEquals(segs[1].duration_seconds, 240);
});

Deno.test("continuous: one unbroken work segment of workDuration × rounds", () => {
  const segs = resolveSegments(day({
    block_1_params: { rounds: 2, workDuration: 600, workProgression: "continuous", paceRange: [0.65, 0.75] },
  }));
  assertEquals(segs.length, 1);
  assertEquals(segs[0].duration_seconds, 1200);
});

Deno.test("max_effort pace has null frac and MAX label", () => {
  const segs = resolveSegments(day({
    block_1_params: { rounds: 1, workDuration: 60, paceRange: "max_effort" },
  }));
  assertEquals(segs[0].pace_frac, null);
  assertEquals(segs[0].label, "Max Effort");
  assertEquals(segs[0].intensity, "MAX");
});

Deno.test("flux alternates base and flux segments across workDuration", () => {
  const segs = resolveSegments(day({
    block_1_params: {
      rounds: 1, workDuration: 720, workProgression: "alternating_paces",
      baseDuration: 300, fluxDuration: 60, basePace: [0.6, 0.7], fluxPaceRange: [0.9, 1.0],
    },
  }));
  assertEquals(segs.map((s) => s.label), ["Base", "Flux", "Base", "Flux"]);
  assertEquals(segs.reduce((sum, s) => sum + s.duration_seconds, 0), 720);
  assertEquals(segs[1].pace_frac, 0.95);
});

Deno.test("block rest inserted between blocks only", () => {
  const segs = resolveSegments(day({
    block_count: 2, set_rest_seconds: 180,
    block_1_params: { rounds: 1, workDuration: 300, paceRange: [0.7, 0.8] },
    block_2_params: { rounds: 1, workDuration: 300, paceRange: [0.8, 0.9] },
  }));
  assertEquals(segs.map((s) => s.type), ["work", "block-rest", "work"]);
  assertEquals(segs[1].duration_seconds, 180);
});

Deno.test("resolved day: scoring params cover work segments only; time trial flagged", () => {
  const d = resolveEngineDay(
    day({
      day_type: "time_trial", day_number: 3,
      block_1_params: { rounds: 2, workDuration: 600, restDuration: 60, paceRange: "max_effort" },
    }),
    { title: "Time Trial", coaching_intent: "Establish the baseline." },
  );
  assert(d.is_time_trial);
  assertEquals(d.ref, "d3");
  assertEquals(d.scoring_params.formula, "engine_ratio_v1");
  assertEquals(d.scoring_params.work_segments.length, 2);
  assertEquals(d.scoring_params.total_work_seconds, 1200);
  assertEquals(d.scoring_params.rate_units, ["watts"]);
});
