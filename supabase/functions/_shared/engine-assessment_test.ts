// The Engine assessment: the shape of the read, when a stored one is reused,
// and that every reader is given the stored one.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ASSESSMENT_FOCUSES, type AssessmentBasis, assessmentIsCurrent, ENGINE_ASSESSMENT_BUILDER_VERSION, ENGINE_ASSESSMENT_SYSTEM, ENGINE_ASSESSMENT_TOOL,
  ensureEngineAssessment, parseEngineAssessment, previousReadBlock, renderEngineAssessment, REWRITE_AFTER_SESSIONS, storedAssessmentForCoach, STRENGTH_FOCUSES,
} from "./engine-assessment.ts";
import { formatConditioningState, SIGNALS_HEADER_RAW, SIGNALS_HEADER_UNDER_ASSESSMENT } from "./conditioning-state.ts";
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

Deno.test("the dry run still stores nothing; storing happens in one place", async () => {
  const fn = await Deno.readTextFile(new URL("../engine-assessment/index.ts", import.meta.url));
  for (const write of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) assert(!fn.includes(write), `the function must not write directly: found ${write}`);
  assert(fn.includes("dry_run: true, stored: false"));
  assert(fn.includes('buildEngineAssessmentInputs(supa, userId, { curve: "fresh_unsaved" })'));
  assert(fn.includes('params.get("mode") ?? "dry_run"'));
  const shared = await Deno.readTextFile(new URL("./engine-assessment.ts", import.meta.url));
  // Append-only: one insert, never an update or delete of a stored read.
  assertEquals(shared.split(".insert(").length - 1, 1);
  for (const write of [".update(", ".upsert(", ".delete("]) assert(!shared.includes(write), `a stored read is never changed: found ${write}`);
  const cs = await Deno.readTextFile(new URL("./conditioning-state.ts", import.meta.url));
  assert(cs.includes('write: curveMode === "fresh"'));
  assert(cs.includes("{ write: opts.write !== false }"));
});

const BASIS: AssessmentBasis = { sessions: 20, latest_trial_at: "2026-11-01T10:00:00Z", goal: "row faster", program: "p1", reset_at: "", builder_version: ENGINE_ASSESSMENT_BUILDER_VERSION };

Deno.test("a stored read is reused until its basis moves on", () => {
  assertEquals(REWRITE_AFTER_SESSIONS, 5);
  assert(assessmentIsCurrent(BASIS, BASIS));
  assert(assessmentIsCurrent(BASIS, { ...BASIS, sessions: 24 }), "four more sessions: still current");
  assert(!assessmentIsCurrent(BASIS, { ...BASIS, sessions: 25 }), "five more sessions: rewrite");
  assert(!assessmentIsCurrent(BASIS, { ...BASIS, latest_trial_at: "2026-11-20T10:00:00Z" }), "new time trial");
  assert(!assessmentIsCurrent({ ...BASIS, latest_trial_at: null }, BASIS), "first time trial");
  assert(!assessmentIsCurrent(BASIS, { ...BASIS, goal: "bike faster" }), "goal changed");
  assert(!assessmentIsCurrent(BASIS, { ...BASIS, program: "p2" }), "program changed");
  assert(!assessmentIsCurrent(BASIS, { ...BASIS, reset_at: "2026-11-25" }), "Engine reset");
  assert(!assessmentIsCurrent({ ...BASIS, builder_version: "v0" }, BASIS), "new instructions");
  assert(!assessmentIsCurrent(BASIS, { ...BASIS, sessions: 19 }), "sessions removed");
  assert(!assessmentIsCurrent(null, BASIS));
});

Deno.test("a rewrite is shown the previous read and told to keep it unless the facts changed", () => {
  const prev = { assessment: parseEngineAssessment(GOOD)!, basis: BASIS, created_at: "2026-11-10T09:00:00Z" };
  const block = previousReadBlock(prev, { ...BASIS, sessions: 25, latest_trial_at: "2026-11-20T10:00:00Z" });
  assert(block.startsWith("YOUR PREVIOUS READ (written 2026-11-10; 5 sessions logged since. A new time trial has been logged since.)"));
  assert(block.includes("keep it unless the facts above have changed enough to change it"));
  assert(block.includes(prev.assessment.headline));
  assert(ENGINE_ASSESSMENT_SYSTEM.includes("WHEN YOU ARE SHOWN YOUR PREVIOUS READ"));
  assert(ENGINE_ASSESSMENT_SYSTEM.includes("Do not reword for its own sake and do not reorder priorities that are still equally supported"));
});

Deno.test("the coach, the workout review, the sequencer and session completion all use the stored read", async () => {
  const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));
  const chat = await read("../chat/index.ts");
  assertEquals(chat.split("await conditioningForCoach(supa, userId)").length - 1, 2);
  assert(!chat.includes("buildConditioningState("), "the chat must not read the numbers without the assessment");
  const review = await read("../workout-review/index.ts");
  assert(review.includes("conditioningForCoach(supa, user.id)"));
  assert(!review.includes("buildConditioningState("));
  const seq = await read("./run-resequence.ts");
  assert(seq.includes("await ensureEngineAssessment(supa, userId)"));
  assert(seq.includes("assessmentText +\n    `${diagnosis}"));
  assert(seq.includes("Never write a \"reason\" that contradicts"));
  const done = await read("../engine-continuum-backfill/index.ts");
  assert(done.includes("if (body.dry_run !== true) refreshAssessmentInBackground(supa, userId);"));
});

Deno.test("with a stored read the numbers are presented as its detail, not as something to re-read", () => {
  const inputs = { metrics: [{ day_type: "endurance", modality: "row", rolling_avg_ratio: 1, rolling_count: 3, last_5_ratios: [1, 1, 1], learned_max_pace: null }], timeTrials: [], sessions: [], daysPerWeek: null };
  // deno-lint-ignore no-explicit-any
  const raw = formatConditioningState(inputs as any);
  // deno-lint-ignore no-explicit-any
  const under = formatConditioningState(inputs as any, { underAssessment: true });
  assert(raw.startsWith(SIGNALS_HEADER_RAW) && raw.includes("judge each system's state"));
  assert(under.startsWith(SIGNALS_HEADER_UNDER_ASSESSMENT));
  assert(!under.includes("interpret yourself") && !under.includes("judge each system's state"));
  assert(under.includes("The overall read of these numbers is the ENGINE ASSESSMENT above."));
});

// A fake database: enough of the query builder for the reads and the one insert.
function fakeSupa(tables: Record<string, unknown[]>, opts: { count?: number } = {}) {
  const inserted: Array<{ table: string; row: unknown }> = [];
  const from = (table: string) => {
    const result = () => ({ data: (tables[table] ?? [])[0] ?? null, error: null, count: opts.count ?? 0 });
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      maybeSingle: () => Promise.resolve(result()),
      insert: (row: unknown) => { inserted.push({ table, row }); return Promise.resolve({ error: null }); },
      then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok),
    };
    return q;
  };
  return { supa: { from } as unknown as Parameters<typeof storedAssessmentForCoach>[0], inserted };
}

Deno.test("the coach is given the stored read without waiting, and told when a rewrite is due", async () => {
  const profile = { engine_program_version: "p1", engine_goal: "row faster", engine_reset_at: null };
  const trial = { created_at: "2026-11-01T10:00:00Z" };
  const row = { assessment: GOOD, basis: BASIS, created_at: "2026-11-10T09:00:00Z" };
  const current = await storedAssessmentForCoach(fakeSupa({ athlete_profiles: [profile], engine_time_trials: [trial], engine_assessments: [row] }, { count: 22 }).supa, "u");
  assert(current.text.startsWith("ENGINE ASSESSMENT (the standing read"));
  assertEquals(current.due, false);
  const stale = await storedAssessmentForCoach(fakeSupa({ athlete_profiles: [profile], engine_time_trials: [trial], engine_assessments: [row] }, { count: 25 }).supa, "u");
  assert(stale.text.startsWith("ENGINE ASSESSMENT"), "an out-of-date read is still used until the new one is written");
  assertEquals(stale.due, true);
  const none = await storedAssessmentForCoach(fakeSupa({ athlete_profiles: [profile], engine_time_trials: [trial] }, { count: 3 }).supa, "u");
  assertEquals(none, { text: "", due: true });
  const notEngine = await storedAssessmentForCoach(fakeSupa({ athlete_profiles: [{ engine_program_version: null }] }).supa, "u");
  assertEquals(notEngine, { text: "", due: false });
});

Deno.test("a current stored read is returned as is: no AI call, nothing written", async () => {
  const f = fakeSupa({
    athlete_profiles: [{ engine_program_version: "p1", engine_goal: "row faster", engine_reset_at: null }],
    engine_time_trials: [{ created_at: "2026-11-01T10:00:00Z" }],
    engine_assessments: [{ assessment: GOOD, basis: BASIS, created_at: "2026-11-10T09:00:00Z" }],
  }, { count: 21 });
  const e = await ensureEngineAssessment(f.supa, "u");
  assertEquals(e?.source, "stored");
  assertEquals(f.inserted.length, 0);
});
