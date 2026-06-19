/**
 * Unit tests for the self-sequencer contract + validator. Run with:
 *   deno test supabase/functions/_shared/engine-sequence_test.ts
 * Pure-function coverage; no I/O.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import type { EngineDayTypeRow } from "./engine-catalogue.ts";
import { parseProposal, validateProposal } from "./engine-sequence.ts";

function dt(id: string, phase: number): EngineDayTypeRow {
  return {
    id,
    name: id,
    phase_requirement: phase,
    block_count: 1,
    set_rest_seconds: null,
    block_1_params: {},
    block_2_params: null,
    block_3_params: null,
    block_4_params: null,
    max_duration_minutes: 30,
    is_support_day: false,
    coaching_intent: null,
  };
}

const CATALOGUE: EngineDayTypeRow[] = [
  dt("endurance", 1),
  dt("threshold", 1),
  dt("flux", 4),
  dt("towers", 9),
];

// ── parseProposal ────────────────────────────────────────────────────────
Deno.test("parseProposal: plain JSON", () => {
  const p = parseProposal('{"summary":"x","days":[{"day_type":"threshold","reason":"LT lagging"}]}');
  assertEquals(p?.days.length, 1);
  assertEquals(p?.days[0].day_type, "threshold");
});

Deno.test("parseProposal: strips ```json fences", () => {
  const p = parseProposal('```json\n{"summary":"x","days":[{"day_type":"flux","reason":"bridge"}]}\n```');
  assertEquals(p?.days[0].day_type, "flux");
});

Deno.test("parseProposal: garbage → null", () => {
  assertEquals(parseProposal("not json"), null);
  assertEquals(parseProposal('{"no":"days"}'), null);
});

// ── validateProposal ─────────────────────────────────────────────────────
Deno.test("validateProposal: all valid → ok, accepted in order", () => {
  const r = validateProposal(
    { summary: "", days: [
      { day_type: "endurance", reason: "base" },
      { day_type: "threshold", reason: "LT" },
    ] },
    CATALOGUE,
    { currentPhase: 1 },
  );
  assert(r.ok);
  assertEquals(r.accepted.map((d) => d.day_type), ["endurance", "threshold"]);
  assertEquals(r.errors.length, 0);
});

Deno.test("validateProposal: unknown day_type rejected", () => {
  const r = validateProposal(
    { summary: "", days: [{ day_type: "made_up", reason: "x" }] },
    CATALOGUE,
    { currentPhase: 12 },
  );
  assert(!r.ok);
  assertEquals(r.accepted.length, 0);
  assert(r.errors[0].includes("unknown day_type"));
});

Deno.test("validateProposal: locked phase rejected", () => {
  const r = validateProposal(
    { summary: "", days: [{ day_type: "towers", reason: "x" }] }, // phase 9
    CATALOGUE,
    { currentPhase: 4 },
  );
  assert(!r.ok);
  assert(r.errors[0].includes("locked"));
});

Deno.test("validateProposal: missing reason rejected", () => {
  const r = validateProposal(
    { summary: "", days: [{ day_type: "endurance", reason: "" }] },
    CATALOGUE,
    { currentPhase: 1 },
  );
  assert(!r.ok);
  assert(r.errors[0].includes("missing reason"));
});

Deno.test("validateProposal: maxDays caps accepted, flags overflow", () => {
  const r = validateProposal(
    { summary: "", days: [
      { day_type: "endurance", reason: "a" },
      { day_type: "threshold", reason: "b" },
      { day_type: "flux", reason: "c" },
    ] },
    CATALOGUE,
    { currentPhase: 4, maxDays: 2 },
  );
  assertEquals(r.accepted.length, 2);
  assert(r.errors.some((e) => e.includes("maxDays")));
});

Deno.test("validateProposal: partial reject → not ok (mixed valid + invalid)", () => {
  const r = validateProposal(
    { summary: "", days: [
      { day_type: "endurance", reason: "ok" },
      { day_type: "towers", reason: "locked" }, // phase 9 > 1
    ] },
    CATALOGUE,
    { currentPhase: 1 },
  );
  assertEquals(r.accepted.map((d) => d.day_type), ["endurance"]);
  assert(!r.ok); // an error occurred, so caller must review
  assertEquals(r.errors.length, 1);
});
