// What the writer is told about an athlete, and that NOTHING changes the week
// after it is written (founder, 2026-11-26).
//
// The two AI checks built on 2026-11-23 are gone. On a real build they removed
// handstand push-ups and a shuttle run from a member with no injury ("the
// athlete reported shoulder pain", "running is banned" — both phrases were
// worked examples in the instructions), swapped seven movements for not being
// on a list, and replaced a muscle-up because it "requires advanced".
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { athleteFileForWriter, athleteWordsElsewhere, EFFORT_NOTE, hasInjuryText, restrictionsForPrompt } from "./athlete-file-text.ts";
// deno-lint-ignore no-explicit-any
type Any = any;
const FN = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, FN));
const exists = (rel: string) => { try { read(rel); return true; } catch { return false; } };

Deno.test("the two checks are gone: their files, and every call to them", () => {
  for (const f of ["_shared/restriction-gate.ts", "_shared/fit-gate.ts", "_shared/restriction-load.ts", "_shared/restriction-text.ts"]) {
    assertEquals(exists(f), false, `${f} is back`);
  }
  const calls = ["runRestrictionGate(", "runFitGate(", "gateBlock(", "fitBlock(", "applyFindings(", "removeByRule(", "applyTimeTrims(", "askJudge", "askFitJudge"];
  for (const e of Deno.readDirSync(FN)) {
    if (!e.isDirectory) continue;
    for (const f of Deno.readDirSync(new URL(`${e.name}/`, FN))) {
      if (!f.isFile || !f.name.endsWith(".ts") || f.name.endsWith("_test.ts")) continue;
      const src = read(`${e.name}/${f.name}`);
      for (const c of calls) assert(!src.includes(c), `${c} found in ${e.name}/${f.name}`);
    }
  }
});

Deno.test("the build: nothing changes the written week between the checks stage and the save", () => {
  const gen = read("generate-program-v3/index.ts");
  const stage = gen.slice(gen.indexOf("async function stageSafetyReview("), gen.indexOf("async function stageSaving("));
  assert(stage.includes("output: rs.output!"));
  assertEquals((stage.match(/next: "[a-z_]+"/g) ?? []), ['next: "saving"']);
  // No AI call, no log write and no edit of the output in this stage.
  for (const gone of ["await ", "logGenerationAudit", "renderWeekSchemesInPlace", "fetch("]) assert(!stage.includes(gone), `${gone} in the stage`);
});

Deno.test("the coach's day edit: the proposal is offered as the coach wrote it", () => {
  const chat = read("chat/index.ts");
  const from = chat.indexOf("const owned = await loadOwnedBlock(supa, blockRef.id, userId);");
  const to = chat.indexOf('.from("ai_edit_log")', from);
  assert(from > 0 && to > from);
  const between = chat.slice(from, to);
  assert(!between.includes("input.block ="), "nothing reassigns the proposal before it is recorded");
  assert(between.includes('const gateNote = "";'));
});

// ── No examples in what an AI is told about an athlete ────────────────────
// "Remove them and never put them back." / "Just read the stuff the user
// actually enters."

const EXAMPLE_WORDS = [
  "run", "runs", "running", "runner", "runner's", "jog", "sprint", "shoulder", "knee", "wrist", "elbow", "hip", "ankle", "back", "lunge", "squat",
  "muscle-up", "muscle up", "handstand", "hspu", "overhead", "rotator", "meniscus", "pull-up", "pull up", "press", "deadlift", "row", "bike",
  "e.g.", "for example", "such as",
];
const wordsFound = (text: string) => EXAMPLE_WORDS.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/[.]/g, "\\.")}([^a-z]|$)`, "i").test(text));

Deno.test("the test's own word check works", () => {
  assertEquals(wordsFound("no running; pain in shoulder; e.g. a Squat"), ["running", "shoulder", "squat", "e.g."]);
});

Deno.test("the restrictions text holds the athlete's own words and rules only: no injury, body part or movement of ours", () => {
  // Inputs that contain none of the words, so anything found came from us.
  const block = restrictionsForPrompt("Sore left thumb", ["Farmer Carry"], ['Note to the coach: "thumb still sore"']);
  assertEquals(wordsFound(block), []);
  assert(block.includes('"Sore left thumb"') && block.includes("Never program: Farmer Carry.") && block.includes('thumb still sore'));
  assert(block.includes("Do not add a restriction they did not state."));
  // Nothing to say when the athlete has said nothing.
  assertEquals(restrictionsForPrompt("None", [], []), "");
  assertEquals(restrictionsForPrompt("", null, null), "");
  assert(!hasInjuryText("none") && !hasInjuryText("") && !hasInjuryText(null) && hasInjuryText("sore thumb"));
});

Deno.test("the writer's own instructions carry no example injury", () => {
  const writer = read("_shared/v2-system-prompt.ts");
  for (const gone of ["torn rotator cuff", 'who wrote "no running"']) assert(!writer.includes(gone), gone);
  assert(!read("_shared/coaching-intake.ts").includes("left shoulder pain on overhead"));
});

Deno.test("what the athlete said outside the injury box is passed on in their words", () => {
  const intake = { preferences: { avoid: ["A"] }, constraints: { injuries: ["B"], schedule_equipment_notes: null }, response: { recovery_notes: null }, freeform_notes: "C" };
  assertEquals(athleteWordsElsewhere(intake, ["D"]), [
    'Injuries or limitations (signup): "B"', 'Avoiding (signup): "A"', 'Anything else (signup): "C"', 'Note to the coach: "D"',
  ]);
  assertEquals(athleteWordsElsewhere(null, null), []);
});

Deno.test("the athlete's file for the writer is facts only: no ceiling by level, and no claim that anything checks the week", () => {
  const text = athleteFileForWriter({
    lifts: { back_squat: 300, deadlift: null },
    liftNames: { "Back Squat": "back_squat", "Deadlift": "deadlift", "Press": "press", "Strict Press": "press" },
    conditioning: {},
    equipment: { rower: true, ski_erg: false, ghd: false },
    sessionMinutes: 60,
  });
  assert(text.startsWith("THIS ATHLETE'S FILE (yours to get right — nothing checks these after you):"));
  assert(text.includes("NO MAX ON FILE for: Deadlift, Press.") && text.includes(EFFORT_NOTE)); // Press once, not twice
  assert(text.includes("No conditioning benchmarks on file"));
  assert(text.includes("is 60 minutes"));
  assert(text.includes("They do NOT have: ski erg, ghd."));
  for (const gone of ["never above", "a check after you", "ceiling", "%"]) assert(!text.includes(gone), gone);
  assertEquals(athleteFileForWriter({ lifts: { back_squat: 300 }, liftNames: { "Back Squat": "back_squat" }, conditioning: { mile: "7:00" }, equipment: { rower: true }, sessionMinutes: null }), "");
});

Deno.test("the writer is given both texts", () => {
  const pipeline = read("_shared/engine/pipeline.ts");
  assert(pipeline.includes("athleteFileForWriter({") && pipeline.includes("restrictionsForPrompt("));
  assert(!pipeline.includes("fitRulesForWriter") && !pipeline.includes("a check after you enforces"));
});

// ── The full instruction audit of 2026-11-26: none of this comes back ──────

Deno.test("no example athlete, injury, quote or invented concept in any generator instruction", () => {
  const files = [
    "_shared/coach-state-prompt.ts", "_shared/coach-state.ts", "_shared/v3-skeleton-prompt.ts", "_shared/weekly-fill.ts",
    "_shared/v2-system-prompt.ts", "_shared/metcon-composer-prompt.ts", "_shared/conditioning-definitions.ts",
    "_shared/program-evidence.ts", "_shared/engine/pipeline.ts", "_shared/v2-output-schema.ts", "chat/index.ts",
    "_shared/domain-packs/crossfit/index.ts",
  ];
  const gone = [
    "shoulder rehab", "shoulder felt off", "had another round in me", "more chest-to-bar", "riding 5 extra hours", "an FTP test",
    "3x-bodyweight deadlift", "HYROX", "run twice a week", "improve my 5k row", "my top goal is my running", "270 for easy sets",
    "your bench is right at bodyweight", "19:35 5k", "injury-prone", "hotel gym", "a travel week", "3 days from now on",
    "no rower →", "a beginner at GHD Sit-Ups", "a beginner at Deficit HSPU", "Ring Row if no strict Pull Up", "Ring Row — Pull Up scaled",
    "just activate shoulders", "coming off a hard competition", "preference in disguise", "to go for a run", "more squatting",
    "Critical/High-frequency", "tier default", "intermediate-or-better capacity", "for an advanced athlete",
    "A separate safety review", "Skills 2–4 days", "Display name from the vocabulary list", "display_name strings from the vocabulary",
    "the athlete's allowed movements", "must declare a block_scheme", "legality were audited", "deterministically audited",
    "abundant by construction", "Athletes have one machine", "belong in Strength", "(that's Strength)",
  ];
  for (const f of files) {
    const src = read(f);
    for (const g of gone) assert(!src.includes(g), `"${g}" is back in ${f}`);
  }
  assertEquals(exists("_shared/v2-profile-analysis-prompt.ts"), false);
});

Deno.test("skill ratings: each rating is defined in the founder's words, and none means progressions only", async () => {
  const { SKILL_RATINGS_PROMPT, SKILL_RATING_MEANINGS } = await import("./conditioning-definitions.ts");
  assertEquals(SKILL_RATING_MEANINGS, {
    none: "can't do it yet", beginner: "small sets only, not consistent",
    intermediate: "can do it comfortably in workouts", advanced: "big unbroken sets even under fatigue",
  });
  assert(SKILL_RATINGS_PROMPT.includes("never use one skill's rating for another"));
  assert(SKILL_RATINGS_PROMPT.includes("Never program the movement itself — progressions toward it only."));
  assert(SKILL_RATINGS_PROMPT.includes("metcons included"));
  assert(read("_shared/v2-system-prompt.ts").includes("${SKILL_RATINGS_PROMPT}"));
  assert(read("_shared/metcon-composer-prompt.ts").includes("${SKILL_RATINGS_PROMPT}"));
});

Deno.test("every block rewrite is recorded: before, after and why", async () => {
  const { applySurgicalFixes, blockLine } = await import("./engine/pipeline.ts");
  const output: Any = { month_plan: {}, weeks: [{ week_num: 1, days: [{ day_num: 3, blocks: [
    { block_type: "metcon", block_scheme: "4 rounds", movements: [{ movement: "Row", calories: 15 }, { movement: "Echo Bike", calories: 12 }] },
  ] }] }] };
  const pack: Any = { recovery: {
    surgicallyRewriteBlock: () => Promise.resolve({ block_type: "metcon", scheme_format: { format: "rft", rounds: 4 }, movements: [{ movement: "Row", calories: 15 }, { movement: "Burpee", rep_scheme: [10] }] }),
    spliceBlock: (out: Any, _w: number, _d: number, i: number, nb: Any) => { out.weeks[0].days[0].blocks[i] = nb; return true; },
  } };
  const failures: Any = [{ rule: "metcon_one_monostructural", passed: false, violations: ["Week 1 Day 3 block[0] (metcon): contains 2 monostructural cardio modalities"] }];
  const r = await applySurgicalFixes(output, failures, { basics: {}, training_context: {} } as Any, { weeks: [] } as Any, pack, []);
  assertEquals(r.rewrites.length, 1);
  const w = r.rewrites[0];
  assertEquals([w.week, w.day, w.blockIdx, w.block_type], [1, 3, 0, "metcon"]);
  assertEquals(w.before, "4 rounds: Row 15 cal; Echo Bike 12 cal");
  assert(w.after.includes("Burpee [10]"));
  assert(w.reasons[0].includes("2 monostructural cardio modalities"));
  assertEquals(blockLine(null), "(none)");
  const gen = read("generate-program-v3/index.ts");
  const stage = gen.slice(gen.indexOf("async function stageSurgical("), gen.indexOf("async function stageSafetyReview("));
  assert(stage.includes('stage: "block_rewrite"') && stage.includes("before: ${r.before} | after: ${r.after}"));
});

Deno.test("days per week: the default of 5 stays, and using it (or a number outside 2 to 6) is logged", async () => {
  const { clampDaysPerWeek, daysPerWeekLogLine } = await import("./build-writer-payload.ts");
  assertEquals(clampDaysPerWeek(null), 5);
  assertEquals(daysPerWeekLogLine(null), "days_per_week: none saved on the profile; built with the default of 5 days.");
  assertEquals(daysPerWeekLogLine(8), "days_per_week: profile says 8; built with 6 days (the range is 2 to 6).");
  assertEquals(daysPerWeekLogLine(4), null);
  const gen = read("generate-program-v3/index.ts");
  assert(gen.includes('stage: "payload_default"') && gen.includes("daysPerWeekLogLine("));
});
