// The Engine assessment: the shape of the read, and that phase 1 stores nothing.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ASSESSMENT_FOCUSES, ENGINE_ASSESSMENT_SYSTEM, ENGINE_ASSESSMENT_TOOL, parseEngineAssessment, renderEngineAssessment,
} from "./engine-assessment.ts";
import { REGIONS } from "./engine-continuum.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

const GOOD = {
  headline: "Strong short efforts; the gap is holding pace from four to twenty minutes.",
  strengths: [{ focus: "30–60 s", note: "Short hard efforts are well ahead of the time trial." }],
  priorities: [
    { rank: 2, focus: "calibration", evidence: "echo bike (cal): 52d old", why: "Targets come from a stale test.", action: "Retest the bike early." },
    { rank: 1, focus: "4–10 min", evidence: "M 0.91 measured, n 3.2", why: "This is where your metcons live.", action: "More sustained efforts of four to ten minutes." },
  ],
  retest: { machine: "echo bike", reason: "The trial is 52 days old." },
  confidence: "medium",
  unknowns: "Nothing has landed in the 1–2 minute range yet.",
};

Deno.test("a priority's focus is one of the curve's seven bands, calibration or consistency", () => {
  assertEquals(ASSESSMENT_FOCUSES, [...REGIONS.map((r) => r[2]), "calibration", "consistency"]);
  assertEquals(ASSESSMENT_FOCUSES.length, 9);
  const props = (ENGINE_ASSESSMENT_TOOL.input_schema as Any).properties;
  assertEquals(props.priorities.items.properties.focus.enum, [...ASSESSMENT_FOCUSES]);
  assertEquals(props.priorities.maxItems, 3);
});

Deno.test("a usable answer is kept, ranked 1..n in order", () => {
  const a = parseEngineAssessment(GOOD)!;
  assertEquals(a.priorities.map((p) => [p.rank, p.focus]), [[1, "4–10 min"], [2, "calibration"]]);
  assertEquals(a.confidence, "medium");
  assertEquals(a.retest?.machine, "echo bike");
});

Deno.test("an answer that cannot be used is refused, not patched into something that looks like a read", () => {
  assertEquals(parseEngineAssessment(null), null);
  assertEquals(parseEngineAssessment({ ...GOOD, priorities: [] }), null);
  assertEquals(parseEngineAssessment({ ...GOOD, headline: 7 }), null);
  // A focus outside the fixed set is dropped; with none left the answer is refused.
  assertEquals(parseEngineAssessment({ ...GOOD, priorities: [{ rank: 1, focus: "sprint power", evidence: "x", why: "long enough", action: "long enough" }] }), null);
  // Missing confidence is the careful end, never "high".
  assertEquals(parseEngineAssessment({ ...GOOD, confidence: "certain" })!.confidence, "low");
  assertEquals(parseEngineAssessment({ ...GOOD, retest: null })!.retest, null);
});

Deno.test("what a coach is given: the read, and the instruction to work from it", () => {
  const text = renderEngineAssessment(parseEngineAssessment(GOOD)!);
  assert(text.startsWith("ENGINE ASSESSMENT"));
  assert(text.includes("do not re-derive a different read from the raw numbers"));
  assert(text.includes("1. 4–10 min — This is where your metcons live. Action: More sustained efforts of four to ten minutes."));
  assert(text.includes("Retest: echo bike"));
  assert(text.includes("Confidence: medium. Not yet known: Nothing has landed in the 1–2 minute range yet."));
});

Deno.test("the instructions: unmeasured is unknown, not weak; no targets or session prescriptions", () => {
  assert(ENGINE_ASSESSMENT_SYSTEM.includes(`"floor" and "blank" are things you do not know yet`));
  assert(ENGINE_ASSESSMENT_SYSTEM.includes("no session prescriptions, no paces, no targets"));
  assert(ENGINE_ASSESSMENT_SYSTEM.includes("never scold"));
  assert(ENGINE_ASSESSMENT_SYSTEM.includes("Do not compare a pace on one machine, or in one unit, with a pace on another"));
});

Deno.test("phase 1 is a dry run: nothing is stored and no coach or sequencer reads it yet", async () => {
  const fn = await Deno.readTextFile(new URL("../engine-assessment/index.ts", import.meta.url));
  const shared = await Deno.readTextFile(new URL("./engine-assessment.ts", import.meta.url));
  for (const src of [fn, shared]) for (const write of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) assert(!src.includes(write), `phase 1 must not write: found ${write}`);
  assert(fn.includes("dry_run: true, stored: false"));
  for (const reader of ["../chat/index.ts", "./run-resequence.ts", "./conditioning-state.ts"]) {
    const src = await Deno.readTextFile(new URL(reader, import.meta.url));
    assert(!src.includes("engine-assessment"), `${reader} already reads the assessment`);
  }
});
