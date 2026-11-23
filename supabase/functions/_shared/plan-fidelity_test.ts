// deno test supabase/functions/_shared/plan-fidelity_test.ts --no-check --allow-env --allow-read
//
// A written week is checked against its plan (2026-11-23) — before the fit
// gate and the restriction gate, so their deliberate removals are never
// flagged or undone.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { auditPlanBlockTypes, auditPlanPrimaryLift, auditWeekAgainstPlan, isPlannedLift, withPlanChecks } from "./plan-fidelity.ts";
import { AUDIT_KIND } from "./audits.ts";
import { classifyFailuresByKind, runAudits } from "./audit-runner.ts";
import { applyTimeTrims } from "./fit-gate.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

const PLAN: Any = {
  weeks: [{
    week_num: 2,
    days: [
      { day_num: 1, block_types: ["warm-up", "strength", "accessory", "metcon", "cool-down"], primary_lift: "Back Squat" },
      { day_num: 2, block_types: ["warm-up", "skills", "metcon", "cool-down"] },
    ],
  }],
};
const block = (block_type: string, ...movements: string[]): Any =>
  ({ block_type, movements: movements.map((movement) => ({ movement, sets: 3, reps: 5 })) });
const written = (day1: Any[], day2: Any[] = [block("warm-up", "Row"), block("skills", "Handstand Hold"), block("metcon", "Burpee"), block("cool-down", "Walk")]): Any =>
  ({ month_plan: {}, weeks: [{ week_num: 2, days: [{ day_num: 1, blocks: day1 }, { day_num: 2, blocks: day2 }] }] });
const DAY1 = () => [block("warm-up", "Row"), block("strength", "Back Squat"), block("accessory", "Dumbbell Row"), block("metcon", "Burpee"), block("cool-down", "Walk")];

Deno.test("a week written to its plan passes both checks", () => {
  assertEquals(auditWeekAgainstPlan(written(DAY1()), PLAN).map((r) => r.passed), [true, true]);
});

Deno.test("a planned block type missing from a day is named, with the day", () => {
  const day1 = DAY1().filter((b) => b.block_type !== "accessory");
  const day2 = [block("warm-up", "Row"), block("metcon", "Burpee")];
  const r = auditPlanBlockTypes(written(day1, day2), PLAN);
  assertEquals(r.passed, false);
  assertEquals(r.violations.length, 2);
  assert(r.violations[0].startsWith("Week 2 Day 1: planned block type missing from the written day: accessory "));
  assert(r.violations[1].startsWith("Week 2 Day 2: planned block types missing from the written day: skills, cool-down "));
});

Deno.test("an extra block the plan did not list is not a violation", () => {
  assertEquals(auditPlanBlockTypes(written([...DAY1(), block("mobility", "Couch Stretch")]), PLAN).passed, true);
});

Deno.test("a strength block whose main lift is not the planned one is flagged at its block, so the block rewrite can repair it", () => {
  const day1 = DAY1(); day1[1] = block("strength", "Front Squat", "Back Squat");
  const r = auditPlanPrimaryLift(written(day1), PLAN);
  assertEquals(r.passed, false);
  assertEquals(r.violations.length, 1);
  assert(r.violations[0].startsWith('Week 2 Day 1 block[1] (strength): the plan\'s primary_lift for this day is "Back Squat" but the block\'s main lift is "Front Squat".'));
  // The surgical stage finds the block by this pattern (engine/pipeline.ts groupBlockLocalFailures).
  assertEquals(r.violations[0].match(/Week (\d+) Day (\d+) block\[(\d+)\]/)!.slice(1), ["2", "1", "1"]);
});

Deno.test("the same lift under another spelling or variation is not flagged", () => {
  for (const [planned, main] of [
    ["Back Squat", "Back Squat"], ["Back Squat", "Pause Back Squat"], ["Back Squat", "Tempo Back Squats"], ["Clean and Jerk", "Clean & Jerk"],
    ["Clean and Jerk", "Clean"], ["Overhead Press", "Strict Press"], ["Press", "Shoulder Press"], ["Snatch", "Hang Power Snatch"],
    ["Snatch Pull + Hang Snatch + Overhead Squat (complex)", "Snatch Pull"], ["Hang Power Clean + Push Jerk", "Push Jerk"],
    ["Bench Press", "Dumbbell Bench Press"], ["Deadlift", "Romanian Deadlift"], ["Weighted Pull-Up", "Weighted Pull-Ups"], ["Barbell Row", "Bent Over Row"],
  ]) assertEquals(isPlannedLift(planned, main), true, `${planned} / ${main}`);
});

Deno.test("a different lift is flagged", () => {
  for (const [planned, main] of [
    ["Back Squat", "Front Squat"], ["Back Squat", "Deadlift"], ["Snatch", "Clean"], ["Deadlift", "Bench Press"], ["Press", "Push Press"],
    ["Bench Press", "Strict Press"], ["Clean and Jerk", "Snatch"], ["Hip Thrust", "Box Jump"],
  ]) assertEquals(isPlannedLift(planned, main), false, `${planned} / ${main}`);
});

Deno.test("days with no planned lift, no strength block, or no plan at all are left alone", () => {
  assertEquals(auditPlanPrimaryLift(written(DAY1()), PLAN).passed, true); // day 2 has no primary_lift
  const noStrength = DAY1().filter((b) => b.block_type !== "strength");
  assertEquals(auditPlanPrimaryLift(written(noStrength), PLAN).passed, true); // that is the block-type check's finding
  assertEquals(auditPlanBlockTypes(written(noStrength), PLAN).passed, false);
  assertEquals(auditWeekAgainstPlan(written([block("metcon", "Burpee")]), null).map((r) => r.passed), [true, true]);
  assertEquals(auditWeekAgainstPlan(written(DAY1()), { weeks: [{ week_num: 3, days: [] }] }).map((r) => r.passed), [true, true]);
});

Deno.test("the wrong lift goes to the block rewrite; a missing block is logged — the framework's routing for each kind", () => {
  assertEquals(AUDIT_KIND.plan_primary_lift, "block-local");
  assertEquals(AUDIT_KIND.plan_block_types, "structural-writer");
  const day1 = DAY1().filter((b) => b.block_type !== "accessory"); day1[1] = block("strength", "Deadlift");
  const byKind = classifyFailuresByKind(auditWeekAgainstPlan(written(day1), PLAN).filter((r) => !r.passed));
  assertEquals(byKind["block-local"].map((f) => f.rule), ["plan_primary_lift"]);
  assertEquals(byKind["structural-writer"].map((f) => f.rule), ["plan_block_types"]);
});

Deno.test("the plan checks are folded into an audit run without disturbing its other results", () => {
  const clean = { passed: true, failures: [], all: [{ rule: "x", passed: true, violations: [] }] };
  const good = withPlanChecks(clean, written(DAY1()), PLAN);
  assertEquals([good.passed, good.failures.length, good.all.map((r) => r.rule)], [true, 0, ["x", "plan_block_types", "plan_primary_lift"]]);
  const day1 = DAY1(); day1[1] = block("strength", "Deadlift");
  const bad = withPlanChecks(clean, written(day1), PLAN);
  assertEquals([bad.passed, bad.failures.map((f) => f.rule)], [false, ["plan_primary_lift"]]);
});

Deno.test("the plan checks are NOT part of the shared hard audits: other generators are unchanged", () => {
  const day1 = DAY1().filter((b) => b.block_type !== "accessory"); day1[1] = block("strength", "Deadlift");
  const run = runAudits({ output: written(day1), daysPerWeek: 2, lifts: {}, vocabulary: [], skeleton: PLAN });
  assertEquals(run.all.some((r) => r.rule.startsWith("plan_")), false);
});

// ── The gates' deliberate removals ─────────────────────────────────────────

const FN = new URL("../", import.meta.url);
const GEN = Deno.readTextFileSync(new URL("generate-program-v3/index.ts", FN));
const stage = (name: string, next: string) => GEN.slice(GEN.indexOf(`async function ${name}(`), GEN.indexOf(`async function ${next}(`));

Deno.test("the plan check runs with the audits, in the stages BEFORE the fit gate and the restriction gate", () => {
  assert(/function auditOutput\([\s\S]{0,300}withPlanChecks\(/.test(GEN), "the generator's audit must include the plan checks");
  assert(stage("stageBenchmarkAudit", "stageSurgical").includes("auditOutput("));
  assert(stage("stageSurgical", "stageSafetyReview").includes("auditOutput("));
  // The order of the stages is fixed by the dispatcher: audits, then the gates, then the save.
  const run = GEN.slice(GEN.indexOf("async function runStage("));
  assert(run.indexOf('case "benchmark_audit"') < run.indexOf('case "safety_review"') && run.indexOf('case "surgical"') < run.indexOf('case "safety_review"'));
});

Deno.test("nothing checks the week against its plan once the gates have run, so a deliberate removal cannot be flagged or undone", () => {
  const after = GEN.slice(GEN.indexOf("async function stageSafetyReview("), GEN.indexOf("async function runStage("));
  for (const call of ["auditOutput(", "auditOutputHard(", "withPlanChecks(", "auditWeekAgainstPlan(", "auditPlanBlockTypes(", "auditPlanPrimaryLift(", "applySurgicalFixes("]) {
    assertEquals(after.includes(call), false, `${call} must not be called in or after the safety stage`);
  }
  // The gates' stage goes straight to saving; it cannot send the week back to the audits.
  const safety = stage("stageSafetyReview", "stageSaving");
  assertEquals((safety.match(/next: "[a-z_]+"/g) ?? []), ['next: "saving"']);
});

Deno.test("the fit gate's accessory drop for a short session is a difference from the plan that only exists after the check has run", () => {
  const out = written(DAY1());
  assertEquals(auditWeekAgainstPlan(out, PLAN).map((r) => r.passed), [true, true]); // what the check sees: the week as written
  // Then the fit gate, on purpose, for a 40-minute session:
  const actions = applyTimeTrims(out, [{ week_num: 2, day_num: 1, block_index: 2, op: "drop_block", reason: "over time" } as Any], { sessionMinutes: 40 } as Any);
  assertEquals(actions.length, 1);
  assertEquals(out.weeks[0].days[0].blocks.map((b: Any) => b.block_type), ["warm-up", "strength", "metcon", "cool-down"]);
  // This is exactly what the check would call a missing block — which is why it must never run here.
  assertEquals(auditPlanBlockTypes(out, PLAN).passed, false);
});
