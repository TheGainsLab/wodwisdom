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
  assert(text.startsWith("THIS ATHLETE'S FILE (yours to get right — nothing changes the week after you):"));
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
