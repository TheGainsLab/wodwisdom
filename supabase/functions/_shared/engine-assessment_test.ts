// The Engine assessment: the shape of the read, and that phase 1 stores nothing.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ASSESSMENT_FOCUSES, ENGINE_ASSESSMENT_SYSTEM, ENGINE_ASSESSMENT_TOOL, parseEngineAssessment, renderEngineAssessment, STRENGTH_FOCUSES,
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
  // A strength is a band or consistency; "calibration" is a priority only.
  assertEquals(STRENGTH_FOCUSES, [...REGIONS.map((r) => r[2]), "consistency"]);
  assertEquals(props.strengths.items.properties.focus.enum, [...STRENGTH_FOCUSES]);
  const a = parseEngineAssessment({ ...GOOD, strengths: [{ focus: "calibration", note: "Fresh trial." }, GOOD.strengths[0]] })!;
  assertEquals(a.strengths.map((s) => s.focus), ["30–60 s"]);
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
  // Where a measured band stands is given by the app; the AI does not re-judge the number.
  assert(ENGINE_ASSESSMENT_SYSTEM.includes("POSITIONS ARE GIVEN, NOT YOURS TO DECIDE"));
  assert(ENGINE_ASSESSMENT_SYSTEM.includes('"slightly behind": a mild gap. It may be a priority, usually a lower one. NEVER a strength.'));
  assert(ENGINE_ASSESSMENT_SYSTEM.includes("the same number must always read the same way"));
  // Written to the athlete, as their coach.
  assert(ENGINE_ASSESSMENT_SYSTEM.includes('write every field TO THE ATHLETE, in the second person'));
  assert(ENGINE_ASSESSMENT_SYSTEM.includes('Never "the athlete" or "this athlete"'));
  assert(ENGINE_ASSESSMENT_SYSTEM.includes("Do not compare a pace on one machine, or in one unit, with a pace on another"));
});

Deno.test("phase 1 is a dry run: nothing is stored and no coach or sequencer reads it yet", async () => {
  const fn = await Deno.readTextFile(new URL("../engine-assessment/index.ts", import.meta.url));
  const shared = await Deno.readTextFile(new URL("./engine-assessment.ts", import.meta.url));
  for (const src of [fn, shared]) for (const write of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) assert(!src.includes(write), `phase 1 must not write: found ${write}`);
  assert(fn.includes("dry_run: true, stored: false"));
  // The curve is computed fresh for the read and not stored by a dry run.
  assert(fn.includes('buildEngineAssessmentInputs(supa, userId, { curve: "fresh_unsaved" })'));
  const cs = await Deno.readTextFile(new URL("./conditioning-state.ts", import.meta.url));
  assert(cs.includes('write: curveMode === "fresh"'));
  assert(cs.includes("{ write: opts.write !== false }"));
  for (const reader of ["../chat/index.ts", "./run-resequence.ts"]) {
    const src = await Deno.readTextFile(new URL(reader, import.meta.url));
    assert(!src.includes("engine-assessment"), `${reader} already reads the assessment`);
  }
});

import { currentUncalibratedOnly } from "./conditioning-state.ts";

Deno.test("a stored 'uncalibrated' flag is never passed to the coach when the athlete's trials contradict it", async () => {
  const trials = [{ modality: "c2_row_erg", units: "cal" }, { modality: "echo_bike", units: "cal" }];
  const stored = ["UNCALIBRATED:c2_row_erg|cal", "UNCALIBRATED:c2_row_erg|meters", "UNCALIBRATED:track_run|meters", "AWAITING_RIGHT_ANCHOR", "TRIAL_STALE:echo_bike|cal"];
  assertEquals(currentUncalibratedOnly(stored, trials), [
    "UNCALIBRATED:c2_row_erg|meters", // same machine, a unit with no trial: still true
    "UNCALIBRATED:track_run|meters",  // no trial at all: still true
    "AWAITING_RIGHT_ANCHOR", "TRIAL_STALE:echo_bike|cal", // every other flag untouched
  ]);
  assertEquals(currentUncalibratedOnly([], trials), []);
  // The stored-curve path (what chat reads) applies it before the text is built.
  const cs = await Deno.readTextFile(new URL("./conditioning-state.ts", import.meta.url));
  assert(cs.includes("const storedFlags = currentUncalibratedOnly(stored.flags ?? [], trials);"));
  assert(cs.includes("flags: storedFlags,"));
});
