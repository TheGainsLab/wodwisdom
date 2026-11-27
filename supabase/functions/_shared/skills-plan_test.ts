/**
 * skills-plan_test.ts — the skills block is planned from the athlete's own
 * skill ratings, not from the coach state's skill areas (founder, 2026-11-28).
 */
import { assert, assertEquals } from "jsr:@std/assert";
import {
  auditSkeletonSkillNames,
  buildSkillsBrief,
  coachStateForPlanner,
  MAINSITE_SKILL_FREQUENCY,
  PLAN_SKILL_OPTIONS,
  stripSkillAreasFromTdi,
} from "./skills-plan.ts";
import { planCounts, plannerDocument } from "./planner-inputs.ts";
import { V3_SKELETON_SYSTEM_PROMPT, V3_SKELETON_SYSTEM_PROMPT_CLASS } from "./v3-skeleton-prompt.ts";
import { V2_GENERATE_PROGRAM_SYSTEM_PROMPT } from "./v2-system-prompt.ts";
import { buildEmitSkeletonTool } from "./v3-output-schema.ts";
import { checkAllocationInvariants } from "./training-design-invariants.ts";
import { CROSSFIT_PACK } from "./domain-packs/crossfit/index.ts";
import { deriveMetconSlots } from "./metcon-composer.ts";
import { planForBlock } from "./metcon-dry-run-text.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, import.meta.url));

const TDI: Any = {
  priorities: [
    { focus: "upper_body_pressing", rank: 1, confidence: "medium" },
    { focus: "aerobic_capacity", rank: 2, confidence: "medium" },
    { focus: "gymnastics_pulling", rank: 3, confidence: "medium" },
    { focus: "powerlifting_strength", rank: 4, confidence: "medium" },
  ],
  maintain: ["olympic_lifting", "midline", "gymnastics_pressing"],
  deprioritize: ["posterior_chain", "skill_coordination", "anaerobic_capacity"],
  days_per_week: 5, equipment: {}, do_not_program: [], vocabulary: [], lifts: {},
};

Deno.test("the planner is not given a skill area in any list: none is ranked and none is switched off", () => {
  const t = stripSkillAreasFromTdi(TDI);
  assertEquals(t.priorities.map((p: Any) => [p.focus, p.rank]), [["upper_body_pressing", 1], ["aerobic_capacity", 2], ["powerlifting_strength", 4]]);
  assertEquals(t.maintain, ["olympic_lifting"]);
  assertEquals(t.deprioritize, ["posterior_chain", "anaerobic_capacity"]);
  assertEquals(TDI.priorities.length, 4); // the input is not changed
  const cs: Any = {
    headline: "h", summary: "s",
    priorities: TDI.priorities.map((p: Any) => ({ ...p, athlete_facing_rationale: "r" })),
    maintain: [{ focus: "midline" }, { focus: "olympic_lifting" }],
    deprioritize: [{ focus: "skill_coordination" }, { focus: "posterior_chain" }],
  };
  const forPlanner = coachStateForPlanner(cs);
  assertEquals(forPlanner.priorities.map((p: Any) => p.focus), ["upper_body_pressing", "aerobic_capacity", "powerlifting_strength"]);
  assertEquals(forPlanner.maintain.map((m: Any) => m.focus), ["olympic_lifting"]);
  assertEquals(forPlanner.deprioritize.map((d: Any) => d.focus), ["posterior_chain"]);
  assertEquals(forPlanner.headline, "h");
  const doc = plannerDocument(cs, { skills: {}, equipment: {}, training_context: { goal_text: null } } as Any, "");
  for (const area of ["gymnastics_pulling", "gymnastics_pressing", "skill_coordination", '"midline"']) assert(!doc.includes(area), area);
});

Deno.test("the planner is given the athlete's own ratings, what they mean, their goal, missing equipment and main site frequency", () => {
  const brief = buildSkillsBrief({
    skills: { "Muscle-Ups": "intermediate", "L-Sit": "beginner", "Rope Climbs": null },
    goalText: "  Get my first strict muscle-up.  ",
    equipment: { rope: false, rings: true, ski_erg: false },
  });
  for (const want of [
    'Their goal, in their own words: "Get my first strict muscle-up."',
    "  - Muscle-Ups: intermediate",
    "  - L-Sit: beginner",
    "  - Rope Climbs: not rated",
    "  - none: can't do it yet",
    "  - beginner: small sets only, not consistent",
    "  - intermediate: can do it comfortably in workouts",
    "  - advanced: big unbroken sets even under fatigue",
    "Equipment they do NOT have: rope, ski erg",
    "Pull-Ups 1653 · HSPU 491 · Double-Unders 400",
    '"Pull-Ups" covers the Kipping Pull-Ups and Butterfly Pull-Ups ratings.',
  ]) assert(brief.includes(want), want);
  const bare = buildSkillsBrief({});
  assert(bare.includes("in their own words: (none given)"));
  assert(bare.includes("(no skills rated)"));
  assert(bare.includes("Equipment they do NOT have: (nothing missing)"));
});

Deno.test("a skills day names one or two skills from a fixed list; kipping and butterfly are not on it, midline is", () => {
  const day = (buildEmitSkeletonTool(5).input_schema as Any).properties.weeks.items.properties.days.items.properties;
  assertEquals(day.skill_names.maxItems, 2);
  assertEquals(day.skill_names.minItems, 1);
  assertEquals(day.skill_names.items.enum, [...PLAN_SKILL_OPTIONS]);
  for (const gone of ["Kipping Pull-Ups", "Butterfly Pull-Ups", "gymnastics_pulling"]) assert(!(PLAN_SKILL_OPTIONS as readonly string[]).includes(gone), gone);
  for (const on of ["Pull-Ups", "Strict Pull-Ups", "Chest-to-Bar Pull-Ups", "Midline", "L-Sit", "Double-Unders"]) assert((PLAN_SKILL_OPTIONS as readonly string[]).includes(on), on);
  assertEquals(PLAN_SKILL_OPTIONS.length, 20);
  // Every skill with a main site count is one the planner can name.
  for (const [s] of MAINSITE_SKILL_FREQUENCY) assert((PLAN_SKILL_OPTIONS as readonly string[]).includes(s), s);
});

Deno.test("the individual planner decides skills itself; the class planner text is unchanged", () => {
  const p = V3_SKELETON_SYSTEM_PROMPT;
  for (const want of [
    "THE SKILLS BLOCK — YOURS TO DECIDE, FROM THE ATHLETE'S OWN RATINGS",
    "no skill is switched off",
    "Two things matter most, and both matter: a skill the athlete named in their goal, and a skill they rated low.",
    "How often a skill comes up in the sport is a third consideration",
    "ONE or TWO skills from the list",
    "Never plan a skill that needs equipment the athlete does not have.",
    "No barbell work in the skills block, ever.",
    "Do NOT write a block_intents entry for the skills block.",
  ]) assert(p.includes(want), want);
  for (const gone of ["SKILLS BLOCK — DEVELOP vs MAINTAIN", "gymnastics_pulling · gymnastics_pressing", "dedicated skill emphases", "a short skill EMOM"]) {
    assert(!p.includes(gone), `individual planner still says "${gone}"`);
  }
  assert(V3_SKELETON_SYSTEM_PROMPT_CLASS.includes("SKILLS BLOCK — DEVELOP vs MAINTAIN"));
  assert(!V3_SKELETON_SYSTEM_PROMPT_CLASS.includes("YOURS TO DECIDE"));
  const recap = CROSSFIT_PACK.writer.skeletonRuleRecap(5, { days_per_week: 5 } as Any);
  assert(recap.includes("Every day with a skills block sets skill_names"));
});

const day = (n: number, extra: Any = {}) => ({
  day_num: n, day_intent: "x", block_types: ["warm-up", "skills", "strength", "accessory", "metcon", "cool-down"],
  primary_lift: "Bench Press", strength_scheme: "5x5 @75%", skill_focus: "transition drills", metcon_time_domain: ["short", "medium", "long"][(n - 1) % 3],
  block_intents: [
    { block_type: "strength", focus: "upper_body_pressing", purpose: "develop", source_priority_rank: 1 },
    { block_type: "metcon", focus: "aerobic_capacity", purpose: "develop", source_priority_rank: 2 },
    { block_type: "accessory", focus: "powerlifting_strength", purpose: "develop", source_priority_rank: 4 },
  ],
  ...extra,
});

Deno.test("a plan with no skills entry in block_intents passes the allocation checks once the skill areas are out", () => {
  const plan: Any = { weeks: [{ week_num: 1, weekly_intent: "build", days: [day(1, { skill_names: ["Muscle-Ups"] }), day(2, { skill_names: ["L-Sit", "Pull-Ups"] }), day(3, { skill_names: ["Midline"] })] }] };
  assertEquals(checkAllocationInvariants(stripSkillAreasFromTdi(TDI), plan).violations, []);
  // With the skill areas still in, the same plan would be sent back for not developing gymnastics pulling.
  assert(checkAllocationInvariants(TDI, plan).violations.some((v) => v.includes("gymnastics_pulling")));
});

Deno.test("a skills day that names no skill, too many, or one off the list goes back to the planner once with the metcon mix", () => {
  const plan: Any = { weeks: [
    { week_num: 1, weekly_intent: "build", days: [day(1, { skill_names: ["Muscle-Ups"] }), day(2), day(3, { skill_names: ["Gymnastics pulling"] })] },
    { week_num: 2, weekly_intent: "build", days: [day(1, { skill_names: ["L-Sit", "HSPU", "Pistols"], metcon_time_domain: "long" }), day(2, { skill_names: ["HSPU"], metcon_time_domain: "short" }), { day_num: 3, block_types: ["active-recovery"] }] },
  ] };
  const lines = auditSkeletonSkillNames(plan);
  assertEquals(lines.length, 3);
  assert(lines[0].startsWith("Week 1 Day 2: the skills block names no skill"));
  assert(lines[1].includes("not on the list (Gymnastics pulling)"));
  assert(lines[2].includes("has 3 skills"));
  assertEquals(auditSkeletonSkillNames(plan, 2).length, 1); // a re-plan counts only the re-planned weeks
  const counts = planCounts(plan);
  assertEquals(counts.passed, false);
  assert(counts.violations.some((v) => v.includes("names no skill")));
  const gen = read("../generate-program-v3/index.ts");
  assert(gen.includes("let mix = planCounts(skeleton, o.fromWeek);"));
  assert(gen.includes("stripSkillAreasFromTdi(buildTrainingDesignInput(coachState, {"));
  assert(gen.includes("const intentDocument = plannerDocument(rs.coachState ?? null, rs.payload!, plannerArticles);"));
});

Deno.test("the named skills reach the writer, the composer, the stored block and the dry-run text", () => {
  const w = V2_GENERATE_PROGRAM_SYSTEM_PROMPT;
  assert(w.includes("skill_names (the one or two skills, when present)"));
  assert(w.includes("a skill rated none gets progressions toward it and never the movement itself"));
  assert(w.includes("When the skeleton names two skills, the block trains both."));
  assert(!w.includes("Skills block content follows the skeleton's role tag"));
  const [slot] = deriveMetconSlots({ weeks: [{ week_num: 1, weekly_intent: "build", days: [day(1, { skill_names: ["Muscle-Ups", "L-Sit"] })] }] } as Any);
  assertEquals(slot.day_context.skill_names, ["Muscle-Ups", "L-Sit"]);
  assert(read("./save-program-v3.ts").includes("base.skills = daySkel.skill_names;"));
  assertEquals(planForBlock(day(1, { skill_names: ["Muscle-Ups", "L-Sit"] }), "skills"), "skills: Muscle-Ups + L-Sit · transition drills");
});
