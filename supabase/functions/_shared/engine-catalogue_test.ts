/**
 * Unit tests for the engine day-type catalogue formatter. Run with:
 *   deno test supabase/functions/_shared/engine-catalogue_test.ts
 * Pure-function coverage; no I/O.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import { type EngineDayTypeRow, formatDayTypeCatalogue, PARAM_LEGEND } from "./engine-catalogue.ts";

const THRESHOLD: EngineDayTypeRow = {
  id: "threshold",
  name: "Threshold",
  phase_requirement: 1,
  block_count: 1,
  set_rest_seconds: null,
  block_1_params: { rounds: 1, paceRange: [0.85, 0.95], restDuration: 0, workDuration: [480, 1080], workProgression: "single" },
  block_2_params: null,
  block_3_params: null,
  block_4_params: null,
  max_duration_minutes: 18,
  is_support_day: false,
  coaching_intent: "Structure: Sustained efforts at lactate threshold intensity",
};

const HYBRID: EngineDayTypeRow = {
  id: "hybrid_aerobic",
  name: "Hybrid Aerobic",
  phase_requirement: 5,
  block_count: 2,
  set_rest_seconds: null,
  block_1_params: { rounds: [3, 6], workDuration: [90, 240], restDuration: "half_to_two_thirds_work" },
  block_2_params: { rounds: [4, 8], workDuration: [60, 180], restDuration: "half_to_two_thirds_work" },
  block_3_params: null,
  block_4_params: null,
  max_duration_minutes: 40,
  is_support_day: false,
  coaching_intent: "Structure: Paired aerobic-power intervals",
};

Deno.test("formatDayTypeCatalogue: empty → ''", () => {
  assertEquals(formatDayTypeCatalogue([]), "");
});

Deno.test("formatDayTypeCatalogue: includes legend, gating, intent, and raw envelopes", () => {
  const out = formatDayTypeCatalogue([THRESHOLD, HYBRID]);
  // legend present
  assert(out.includes(PARAM_LEGEND));
  assert(out.includes("DAY TYPES (2):"));
  // gating line
  assert(out.includes("### threshold (Threshold) — phase>=1, 1 block, cap 18min"));
  assert(out.includes("### hybrid_aerobic (Hybrid Aerobic) — phase>=5, 2 blocks, cap 40min"));
  // intent
  assert(out.includes("lactate threshold"));
  // raw envelopes (authoritative params), both blocks for the 2-block type
  assert(out.includes('block_1_params: {"rounds":1'));
  assert(out.includes("block_2_params:"));
});

Deno.test("formatDayTypeCatalogue: only emits up to block_count blocks", () => {
  const out = formatDayTypeCatalogue([THRESHOLD]);
  assert(out.includes("block_1_params:"));
  assert(!out.includes("block_2_params:")); // threshold is 1 block
});
