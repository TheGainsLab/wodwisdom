// deno test supabase/functions/_shared/weekly-routes_test.ts --no-check --allow-env --allow-read
//
// THE WIRING, AS A TEST (2026-11-23). The weekly-writing fixes are pure
// functions with their own tests; this file reads the source of the three
// routes — the weekly job, the month build and the admin rebuild — and fails
// if a route stops using them. Same idea as restriction-routes_test.ts.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, FN));
const GEN = read("generate-program-v3/index.ts");
const CRON = read("weekly-programming-cron/index.ts");
const stage = (name: string, next: string) => {
  const a = GEN.indexOf(`async function ${name}(`); const b = GEN.indexOf(`async function ${next}(`);
  assert(a > 0 && b > a, `${name} not found`);
  return GEN.slice(a, b);
};
const SAVING = stage("stageSaving", "runStage");
const SKELETON = stage("stageSkeleton", "stageMetcons");

Deno.test("routes: the weekly job, the month build and the admin rebuild all end in the same generator stages", () => {
  assert(CRON.includes("/functions/v1/generate-program-v3") && CRON.includes("fill_week: due"));
  assert(read("admin-rebuild-month/index.ts").includes("/functions/v1/generate-next-month"));
  assert(read("generate-next-month/index.ts").includes("/functions/v1/generate-program-v3"));
});

Deno.test("the weekly job picks from every month with unwritten weeks, in turn, and no longer reads the newest month number", () => {
  assert(CRON.includes("pickMonthToFill(await loadMonthFillStates("));
  assert(CRON.includes("for (const c of orderForKicks(candidates))"));
  assertEquals(CRON.includes("generated_months"), false);
  assert(CRON.includes("body: JSON.stringify({ program_id: pid, month_number: month, fill_week: due })"), "the week job must be told WHICH month");
  // One candidate per program, and the cap still holds.
  assertEquals((CRON.match(/candidates\.push\(/g) ?? []).length, 1);
  assert(CRON.includes("if (kicks >= MAX_KICKS_PER_TICK)"));
});

Deno.test("opening a week and reading what was trained use the one shared definition of a trained day", () => {
  assert(read("_shared/weekly-fill.ts").includes("loadTrainedDayLogs("));
  const evidence = read("_shared/program-evidence.ts");
  assert(evidence.includes("loadTrainedDayLogs("));
  assertEquals(evidence.includes('.eq("status", "completed")'), false);
  assertEquals(/from\("workout_logs"\)/.test(CRON), false); // the weekly job has no log query of its own
});

Deno.test("a week job builds on the program's current rows, not the copy stored when the weeks were first written", () => {
  assert(SKELETON.includes("priorWeeksForWeekJob("));
  assert(SKELETON.includes("priorWrittenWeeks: prior.weeks"));
  assertEquals(SKELETON.includes("priorWrittenWeeks: store.written_weeks"), false);
});

Deno.test("a failed re-plan is carried to the save, which then keeps the old built_from", () => {
  const failed = SKELETON.slice(SKELETON.indexOf("re-plan failed, filling from the stored skeleton"));
  assert(failed.includes("replan = { failed: true, notesNeededIt }"));
  assert(SKELETON.includes("priorWrittenWeeks: prior.weeks, replan,"));
  assert(SAVING.includes("builtFromForWeekSave(rs.replan?.failed === true, builtFromOf(rs.payload!.training_context))"));
});

Deno.test("after a save only the notes the job read are marked used — on every route", () => {
  assertEquals(GEN.includes("markUserNotesConsumed"), false);
  assert(stage("stagePayloadBuilding", "stageCoachState").includes("noteIdsForTexts(ns, payload.training_context.coach_notes)"));
  assert(/markNotesConsumed\(\s*supa,\s*noteIdsToConsume\(rs\.coachNoteIds, rs\.replan \?\? \{ failed: false, notesNeededIt: false \}\),\s*"programming",\s*\)/.test(SAVING));
  assertEquals((GEN.match(/markNotesConsumed\(/g) ?? []).length, 1);
});

Deno.test("a first build records its new program on the job before the month is claimed or anything is saved", () => {
  const insert = SAVING.indexOf('.from("programs")');
  const persist = SAVING.indexOf("persistCreatedProgramId(supa, job.id, job.claim_token, rs, programId)");
  const marker = SAVING.indexOf('supa.from("program_months").insert(');
  const save = SAVING.indexOf("await saveProgramV3(");
  assert(insert > 0 && persist > insert && marker > persist && save > marker, "order must be: create program, record it on the job, claim the month, save");
  assert(SAVING.includes("let programId = rs.continuation.programId ?? rs.programId ?? null;"), "a re-entered stage must reuse the recorded program");
  assert(SAVING.includes("firstBuildSavePlan({"));
});

Deno.test("a week job neither hides nor reveals the month's evaluation; a month build still does both", () => {
  const coach = stage("stageCoachState", "stageSkeleton");
  const guard = coach.indexOf("if (review && !rs.weeklyFill) {");
  assert(guard > 0, "the evaluation rewrite must be skipped for week jobs");
  for (const write of ['from("training_evaluations").delete()', 'from("training_evaluations").insert(']) {
    assertEquals((coach.match(new RegExp(write.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1);
    assert(coach.indexOf(write) > guard, `${write} must be inside the month-build-only branch`);
  }
  assert(coach.slice(guard).includes("visible: false")); // a month build still writes it hidden…
  const reveal = SAVING.indexOf("if (!rs.weeklyFill) {\n    try {\n      await Promise.allSettled([");
  assert(reveal > 0, "the reveal must be skipped for week jobs");
  assertEquals((SAVING.match(/update\(\{ visible: true \}\)/g) ?? []).length, 3); // …and reveals all three on save
  assert(SAVING.indexOf("update({ visible: true })") > reveal);
  // No other stage of the generator touches an evaluation's visibility.
  assertEquals((GEN.match(/visible: (true|false)/g) ?? []).length, 4);
});

Deno.test("the week fill's one retry lives in callWeekFill and nowhere else", () => {
  const pipeline = read("_shared/engine/pipeline.ts");
  const fill = pipeline.slice(pipeline.indexOf("export async function callWeekFill("), pipeline.indexOf("export async function generateSkeletonWithAudits("));
  assert(fill.includes("return await withOneTransientRetry("));
  assert(fill.includes("throw new ClaudeHttpError(resp.status, body)"));
  assertEquals((pipeline.match(/withOneTransientRetry\(/g) ?? []).length, 1); // callWeekFill is its only caller
  // A writer stage that throws still fails the job: the dispatcher's rule is unchanged.
  assert(read("_shared/v3-dispatcher.ts").includes('"fill_week_1",\n  "fill_week_2",\n  "fill_week_3",\n  "fill_week_4",\n  "surgical",\n]);'));
});
