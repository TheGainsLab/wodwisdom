/**
 * Unit tests for the self-sequencer contract + envelope validator. Run with:
 *   deno test supabase/functions/_shared/engine-sequence_test.ts
 * Pure-function coverage; no I/O.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import type { EngineDayTypeRow } from "./engine-catalogue.ts";
import { parseProposal, validateBlock, validateProposal } from "./engine-sequence.ts";

function row(id: string, phase: number, params: Partial<EngineDayTypeRow>): EngineDayTypeRow {
  return {
    id, name: id, phase_requirement: phase, block_count: 1, set_rest_seconds: null,
    block_1_params: null, block_2_params: null, block_3_params: null, block_4_params: null,
    max_duration_minutes: 60, is_support_day: false, coaching_intent: null, ...params,
  };
}

// Real-shaped envelopes from the seed.
const THRESHOLD = row("threshold", 1, {
  max_duration_minutes: 18,
  block_1_params: { rounds: 1, paceRange: [0.85, 0.95], restDuration: 0, workDuration: [480, 1080], workProgression: "single" },
});
const INTERVAL = row("interval", 1, {
  block_1_params: { rounds: [4, 20], paceRange: [0.80, 1.10], restDuration: "one_third_work", workDuration: [30, 240], workProgression: "consistent" },
});
const HYBRID = row("hybrid_aerobic", 5, {
  block_count: 2,
  max_duration_minutes: 40,
  block_1_params: { rounds: [3, 6], paceRange: [0.90, 1.05], restDuration: "half_to_two_thirds_work", workDuration: [90, 240], workProgression: "consistent" },
  block_2_params: { rounds: [4, 8], paceRange: [0.90, 1.05], restDuration: "half_to_two_thirds_work", workDuration: [60, 180], workProgression: "consistent" },
});
const TOWERS = row("towers", 9, { block_1_params: { rounds: 4, paceRange: [0.75, 0.90], restDuration: 0, workDuration: 120, workProgression: "continuous" } });

const CATALOGUE = [THRESHOLD, INTERVAL, HYBRID, TOWERS];

// ── validateBlock: envelope enforcement ──────────────────────────────────
Deno.test("validateBlock: in-envelope generation passes", () => {
  const errs = validateBlock(
    { rounds: 8, paceRange: [0.85, 1.0], restDuration: "one_third_work", workDuration: 120, workProgression: "consistent" },
    INTERVAL.block_1_params!, "b1",
  );
  assertEquals(errs, []);
});

Deno.test("validateBlock: pace above envelope ceiling fails", () => {
  const errs = validateBlock(
    { rounds: 8, paceRange: [0.85, 1.25], restDuration: "one_third_work", workDuration: 120, workProgression: "consistent" },
    INTERVAL.block_1_params!, "b1",
  );
  assert(errs.some((e) => e.includes("paceRange")));
});

Deno.test("validateBlock: rounds outside range fails", () => {
  const errs = validateBlock(
    { rounds: 25, paceRange: [0.85, 1.0], restDuration: "one_third_work", workDuration: 120, workProgression: "consistent" },
    INTERVAL.block_1_params!, "b1",
  );
  assert(errs.some((e) => e.includes("rounds")));
});

Deno.test("validateBlock: changing the progression mode fails", () => {
  const errs = validateBlock(
    { rounds: 8, paceRange: [0.85, 1.0], restDuration: "one_third_work", workDuration: 120, workProgression: "increasing" },
    INTERVAL.block_1_params!, "b1",
  );
  assert(errs.some((e) => e.includes("workProgression")));
});

Deno.test("validateBlock: wrong rest keyword fails", () => {
  const errs = validateBlock(
    { rounds: 8, paceRange: [0.85, 1.0], restDuration: "equal_to_work", workDuration: 120, workProgression: "consistent" },
    INTERVAL.block_1_params!, "b1",
  );
  assert(errs.some((e) => e.includes("restDuration")));
});

Deno.test("validateBlock: fixed value must be matched", () => {
  const errs = validateBlock(
    { rounds: 2, paceRange: [0.85, 0.95], restDuration: 0, workDuration: 600, workProgression: "single" },
    THRESHOLD.block_1_params!, "b1",
  );
  assert(errs.some((e) => e.includes("rounds"))); // threshold rounds fixed at 1
});

// ── validateProposal ─────────────────────────────────────────────────────
function day(day_type: string, blocks: Record<string, unknown>[], reason = "ok") {
  return { day_type, reason, blocks };
}

Deno.test("validateProposal: valid generated sequence accepted", () => {
  const r = validateProposal(
    { summary: "LT focus", days: [
      day("threshold", [{ rounds: 1, paceRange: [0.85, 0.95], restDuration: 0, workDuration: 900, workProgression: "single" }]),
      day("interval", [{ rounds: 6, paceRange: [0.85, 1.05], restDuration: "one_third_work", workDuration: 120, workProgression: "consistent" }]),
    ] },
    CATALOGUE, { currentPhase: 1 },
  );
  assert(r.ok);
  assertEquals(r.accepted.map((d) => d.day_type), ["threshold", "interval"]);
});

Deno.test("validateProposal: two-block day must supply two blocks", () => {
  const r = validateProposal(
    { summary: "", days: [day("hybrid_aerobic", [{ rounds: 4, paceRange: [0.9, 1.0], restDuration: "half_to_two_thirds_work", workDuration: 120, workProgression: "consistent" }])] },
    CATALOGUE, { currentPhase: 5 },
  );
  assert(!r.ok);
  assert(r.errors.some((e) => e.includes("expected 2")));
});

Deno.test("validateProposal: out-of-envelope block rejects the day", () => {
  const r = validateProposal(
    { summary: "", days: [day("threshold", [{ rounds: 1, paceRange: [0.85, 1.30], restDuration: 0, workDuration: 900, workProgression: "single" }])] },
    CATALOGUE, { currentPhase: 1 },
  );
  assert(!r.ok);
  assert(r.errors.some((e) => e.includes("paceRange")));
});

Deno.test("validateProposal: phase-locked day_type rejected", () => {
  const r = validateProposal(
    { summary: "", days: [day("towers", [{ rounds: 4, paceRange: [0.75, 0.9], restDuration: 0, workDuration: 120, workProgression: "continuous" }])] },
    CATALOGUE, { currentPhase: 4 },
  );
  assert(!r.ok);
  assert(r.errors.some((e) => e.includes("locked")));
});

Deno.test("validateProposal: exceeding max_duration cap rejects", () => {
  // threshold cap 18min; 1 x 1080s work = 18min ok, but 1080+ would exceed. Use rounds within fixed 1, workDuration 1080 is in-range; push over via interval.
  const r = validateProposal(
    { summary: "", days: [day("interval", [{ rounds: 20, paceRange: [0.85, 1.0], restDuration: "one_third_work", workDuration: 240, workProgression: "consistent" }])] },
    CATALOGUE, { currentPhase: 1 }, // 20*240 = 4800s = 80min > interval cap 60min
  );
  assert(!r.ok);
  assert(r.errors.some((e) => e.includes("cap")));
});

// ── parseProposal ────────────────────────────────────────────────────────
Deno.test("parseProposal: extracts day_type + blocks, strips fences", () => {
  const p = parseProposal('```json\n{"summary":"x","days":[{"day_type":"threshold","reason":"LT","blocks":[{"rounds":1}]}]}\n```');
  assertEquals(p?.days[0].day_type, "threshold");
  assertEquals(p?.days[0].blocks.length, 1);
});

Deno.test("parseProposal: garbage → null", () => {
  assertEquals(parseProposal("nope"), null);
});
