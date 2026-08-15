/**
 * Unit tests for the self-sequencer contract + envelope validator. Run with:
 *   deno test supabase/functions/_shared/engine-sequence_test.ts
 * Pure-function coverage; no I/O.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import type { EngineDayTypeRow } from "./engine-catalogue.ts";
import { computeAllowedDayTypes, fillDeterministicParams, parseProposal, validateBlock, validateProposal } from "./engine-sequence.ts";

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

// Real seed envelopes carrying the single-legal-value shapes the fill covers.
const POLARIZED = row("polarized", 2, {
  max_duration_minutes: 60,
  block_1_params: { rounds: 1, basePace: [0.70, 0.70], burstTiming: "every_7_minutes", restDuration: 0, workDuration: [1200, 3600], burstDuration: 7, burstIntensity: "max_effort", workProgression: "continuous_with_bursts" },
});
const ROCKET_B = row("rocket_races_b", 3, {
  max_duration_minutes: 40,
  block_1_params: { rounds: "inherit_from_part_a", paceRange: "inherit_from_part_a", restDuration: "one_to_one_point_five_times_work", workDuration: "inherit_from_part_a", workProgression: "consistent" },
});
const DESCENDING_DEVOUR = row("descending_devour", 7, {
  max_duration_minutes: 36,
  block_1_params: { rounds: [4, 8], paceRange: [0.90, 1.05], restDuration: [75, 15], workDuration: 180, restProgression: "decreasing", workProgression: "consistent" },
});
const FLUX = row("flux", 4, {
  max_duration_minutes: 42,
  block_1_params: { rounds: [4, 8], basePace: [0.70, 0.70], baseDuration: [300, 360], fluxDuration: [30, 120], fluxPaceRange: [0.75, 0.95], workProgression: "alternating_paces", fluxIntensityByDuration: { "30": 0.90, "60": 0.85, "120": 0.80 } },
});

const CATALOGUE = [THRESHOLD, INTERVAL, HYBRID, TOWERS, POLARIZED, ROCKET_B, DESCENDING_DEVOUR, FLUX];

/** Availability pool for tests that aren't about availability. */
const ALLOW_ALL = new Set(CATALOGUE.map((r) => r.id));

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

// ── computeAllowedDayTypes: the program's curation IS the unlock curve ───

Deno.test("pool: specialty month 1 includes its curated deep-arc types (hyrox shape)", () => {
  // Hyrox maps deep catalog days (482, 662, 182…) into month 1 on purpose —
  // its signature types are legal from the first block. This is exactly the
  // case old phase gating got wrong.
  const mapping = [
    { day: 1, month: 1 }, { day: 62, month: 1 }, { day: 482, month: 1 },
    { day: 662, month: 1 }, { day: 182, month: 1 }, { day: 21, month: 2 },
  ];
  const typeByDay = new Map<number, string>([
    [1, "time_trial"], [62, "interval"], [482, "towers"],
    [662, "synthesis"], [182, "flux"], [21, "threshold"],
  ]);
  const m1 = computeAllowedDayTypes(mapping, typeByDay, 1);
  assert(m1.has("towers"));
  assert(m1.has("synthesis"));
  assert(m1.has("flux"));
  assert(!m1.has("threshold")); // month-2 content stays locked
});

Deno.test("pool: cumulative across months; block spanning a boundary widens to the later month", () => {
  const mapping = [
    { day: 1, month: 1 }, { day: 2, month: 1 },
    { day: 30, month: 2 }, { day: 45, month: 3 },
  ];
  const typeByDay = new Map<number, string>([
    [1, "endurance"], [2, "interval"], [30, "devour"], [45, "towers"],
  ]);
  const m2 = computeAllowedDayTypes(mapping, typeByDay, 2);
  assert(m2.has("endurance") && m2.has("interval") && m2.has("devour")); // months <= 2, cumulative
  assert(!m2.has("towers")); // month 3 locked
});

Deno.test("pool: time_trial always available — the AI's recalibration-insert right", () => {
  const pool = computeAllowedDayTypes(
    [{ day: 5, month: 1 }],
    new Map([[5, "endurance"]]),
    1,
  );
  assert(pool.has("time_trial"));
  assertEquals(pool.size, 2); // endurance + time_trial, nothing else
});

// ── fillDeterministicParams: single-legal-value keys are code's job ──────
// Each test pins one of the six shapes to the real day type that carries it.

Deno.test("fill: pinned [x,x] pace range — scalar emission normalized (polarized live failure)", () => {
  // The model emitted basePace 0.7 against the pinned [0.7, 0.7] envelope and
  // lost the day on shape. Fill makes the canonical pair unconditionally.
  const filled = fillDeterministicParams({ workDuration: 1800, basePace: 0.7 }, POLARIZED.block_1_params!);
  assertEquals(filled.basePace, [0.70, 0.70]);
  const r = validateProposal(
    { summary: "", days: [day("polarized", [{ workDuration: 1800, basePace: 0.7 }])] },
    CATALOGUE, { allowedDayTypes: ALLOW_ALL },
  );
  assert(r.ok, r.errors.join("; "));
});

Deno.test("fill: inherit_from_part_a sentinels — rocket_races_b is fully deterministic (live failure)", () => {
  // Every key is a sentinel or fixed: the model has nothing to decide. An
  // empty block must come back complete and valid — even when the model
  // previously computed concrete values here, canonical wins.
  const r = validateProposal(
    { summary: "", days: [day("rocket_races_b", [{}])] },
    CATALOGUE, { allowedDayTypes: ALLOW_ALL },
  );
  assert(r.ok, r.errors.join("; "));
  const b = r.accepted[0].blocks[0];
  assertEquals(b.rounds, "inherit_from_part_a");
  assertEquals(b.paceRange, "inherit_from_part_a");
  assertEquals(b.workDuration, "inherit_from_part_a");
  assertEquals(b.restDuration, "one_to_one_point_five_times_work");
  assertEquals(b.workProgression, "consistent");
});

Deno.test("fill: fixed strings and numbers set unconditionally — wrong emissions can't cost the day", () => {
  const filled = fillDeterministicParams(
    { rounds: 8, paceRange: [0.85, 1.0], workDuration: 120, workProgression: "increasing", restDuration: "equal_to_work" },
    INTERVAL.block_1_params!,
  );
  assertEquals(filled.workProgression, "consistent"); // canonical overwrites the mistake
  assertEquals(filled.restDuration, "one_third_work");
});

Deno.test("fill: reversed [start,end] progression endpoints copied verbatim", () => {
  const filled = fillDeterministicParams({ rounds: 6, paceRange: [0.95, 1.0] }, DESCENDING_DEVOUR.block_1_params!);
  assertEquals(filled.restDuration, [75, 15]);
  assertEquals(filled.workDuration, 180);
  assertEquals(filled.restProgression, "decreasing");
});

Deno.test("fill: lookup objects copied; real choices untouched and still validated", () => {
  const filled = fillDeterministicParams(
    { rounds: 6, baseDuration: 330, fluxDuration: 60, fluxPaceRange: [0.80, 0.90] },
    FLUX.block_1_params!,
  );
  assertEquals(filled.fluxIntensityByDuration, { "30": 0.90, "60": 0.85, "120": 0.80 });
  assertEquals(filled.basePace, [0.70, 0.70]);
  assertEquals(filled.fluxPaceRange, [0.80, 0.90]); // model's real choice stands
  // A genuinely out-of-envelope choice still rejects the day — fill never
  // papers over real errors.
  const r = validateProposal(
    { summary: "", days: [day("flux", [{ rounds: 6, baseDuration: 330, fluxDuration: 60, fluxPaceRange: [0.80, 1.10] }])] },
    CATALOGUE, { allowedDayTypes: ALLOW_ALL },
  );
  assert(!r.ok);
  assert(r.errors.some((e) => e.includes("fluxPaceRange")));
});

Deno.test("fill: accepted days persist the FILLED blocks", () => {
  const r = validateProposal(
    { summary: "", days: [day("interval", [{ rounds: 6, paceRange: [0.85, 1.05], workDuration: 120 }])] },
    CATALOGUE, { allowedDayTypes: ALLOW_ALL },
  );
  assert(r.ok, r.errors.join("; "));
  const b = r.accepted[0].blocks[0];
  assertEquals(b.restDuration, "one_third_work"); // omitted by the model, filled by code
  assertEquals(b.workProgression, "consistent");
  assertEquals(b.rounds, 6); // choices preserved
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
    CATALOGUE, { allowedDayTypes: ALLOW_ALL },
  );
  assert(r.ok);
  assertEquals(r.accepted.map((d) => d.day_type), ["threshold", "interval"]);
});

Deno.test("validateProposal: two-block day must supply two blocks", () => {
  const r = validateProposal(
    { summary: "", days: [day("hybrid_aerobic", [{ rounds: 4, paceRange: [0.9, 1.0], restDuration: "half_to_two_thirds_work", workDuration: 120, workProgression: "consistent" }])] },
    CATALOGUE, { allowedDayTypes: ALLOW_ALL },
  );
  assert(!r.ok);
  assert(r.errors.some((e) => e.includes("expected 2")));
});

Deno.test("validateProposal: out-of-envelope block rejects the day", () => {
  const r = validateProposal(
    { summary: "", days: [day("threshold", [{ rounds: 1, paceRange: [0.85, 1.30], restDuration: 0, workDuration: 900, workProgression: "single" }])] },
    CATALOGUE, { allowedDayTypes: ALLOW_ALL },
  );
  assert(!r.ok);
  assert(r.errors.some((e) => e.includes("paceRange")));
});

Deno.test("validateProposal: day_type outside the availability pool rejected", () => {
  // towers exists in the catalogue but this program hasn't reached a month
  // that maps it — the allowlist is the fence, not phase numbers.
  const r = validateProposal(
    { summary: "", days: [day("towers", [{ rounds: 4, paceRange: [0.75, 0.9], restDuration: 0, workDuration: 120, workProgression: "continuous" }])] },
    CATALOGUE, { allowedDayTypes: new Set(["threshold", "interval", "time_trial"]) },
  );
  assert(!r.ok);
  assert(r.errors.some((e) => e.includes("not available at this point in the program")));
});

Deno.test("validateProposal: exceeding max_duration cap rejects", () => {
  // threshold cap 18min; 1 x 1080s work = 18min ok, but 1080+ would exceed. Use rounds within fixed 1, workDuration 1080 is in-range; push over via interval.
  const r = validateProposal(
    { summary: "", days: [day("interval", [{ rounds: 20, paceRange: [0.85, 1.0], restDuration: "one_third_work", workDuration: 240, workProgression: "consistent" }])] },
    CATALOGUE, { allowedDayTypes: ALLOW_ALL }, // 20*240 = 4800s = 80min > interval cap 60min
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
