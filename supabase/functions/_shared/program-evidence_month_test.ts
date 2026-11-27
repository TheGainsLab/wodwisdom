// deno test supabase/functions/_shared/program-evidence_month_test.ts --no-check --allow-env
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildProgramEvidenceContext, loadProgramEvidence } from "./program-evidence.ts";
import { buildComposerUserMessage } from "./metcon-composer.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

/** Records the filters put on the program_workouts lookup; returns no days. */
function recordingSupa() {
  const filters: Record<string, unknown> = {};
  const chain: Any = {
    select() { return chain; },
    eq(c: string, v: unknown) { filters["eq:" + c] = v; return chain; },
    lt(c: string, v: unknown) { filters["lt:" + c] = v; return chain; },
    then(res: Any) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return { filters, supa: { from: (_t: string) => chain } as Any };
}

Deno.test("progress evidence is read from the CURRENT month only", async () => {
  const { filters, supa } = recordingSupa();
  await loadProgramEvidence(supa, "u", "prog", 3, 2);
  assertEquals(filters, { "eq:program_id": "prog", "eq:month_number": 2, "lt:week_num": 3 });
});

Deno.test("the month is passed through from the week being written", async () => {
  const { filters, supa } = recordingSupa();
  assertEquals(await buildProgramEvidenceContext(supa, "u", "prog", 2, 4), "");
  assertEquals(filters["eq:month_number"], 4);
  // Week 1 has nothing before it in its month: no lookup at all.
  const second = recordingSupa();
  await buildProgramEvidenceContext(second.supa, "u", "prog", 1, 4);
  assertEquals(second.filters, {});
});

const COMPOSER_BASE: Any = {
  slots: [], goal_text: null, basics: { age: null, sex: null, bodyweight: 80 }, vocabulary: [], equipment: {},
  injuries_text: null, do_not_program: [], skills: {},
  lifts: { back_squat: 120 }, conditioning_benchmarks: {}, previous_cycle_metcons: [],
  examples: "", articles: "", engine_training: null,
};

Deno.test("conditioning is sized in the athlete's own unit: a kilo athlete's lifts are labelled kg", () => {
  const kg = buildComposerUserMessage({ ...COMPOSER_BASE, units: "kg" });
  assertEquals(kg.includes("1RM LIFTS (kg;"), true);
  assertEquals(kg.includes("Give every weight in kg"), true);
  assertEquals(kg.includes("bodyweight 80 kg"), true);
  const lbs = buildComposerUserMessage({ ...COMPOSER_BASE, units: "lbs" });
  assertEquals(lbs.includes("1RM LIFTS (lbs;"), true);
  assertEquals(buildComposerUserMessage(COMPOSER_BASE).includes("1RM LIFTS (lbs;"), true); // unset stays lbs
});
