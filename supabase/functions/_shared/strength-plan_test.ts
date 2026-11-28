/**
 * strength-plan_test.ts — the strength block is planned from the athlete's
 * own lifts and goal, with the reference comparisons as plain facts, not from
 * the coach state's ranking (founder, 2026-11-28).
 */
import { assert, assertEquals } from "jsr:@std/assert";
import { buildLiftsBrief, coachStateWithoutStrength, standingLine, stripStrengthFromTdi } from "./strength-plan.ts";
import { plannerDocument, tdiForPlanner } from "./planner-inputs.ts";
import { V3_SKELETON_SYSTEM_PROMPT, V3_SKELETON_SYSTEM_PROMPT_CLASS } from "./v3-skeleton-prompt.ts";
import { checkAllocationInvariants } from "./training-design-invariants.ts";
import { CROSSFIT_PACK } from "./domain-packs/crossfit/index.ts";
import { machineRowM8 } from "./stage3-machine-rows.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const TDI: Any = {
  priorities: [
    { focus: "upper_body_pressing", rank: 1, confidence: "medium" },
    { focus: "aerobic_capacity", rank: 2, confidence: "medium" },
    { focus: "gymnastics_pulling", rank: 3, confidence: "medium" },
    { focus: "powerlifting_strength", rank: 4, confidence: "medium" },
  ],
  maintain: ["olympic_lifting", "midline", "mixed_modal_conditioning"],
  deprioritize: ["posterior_chain", "skill_coordination", "anaerobic_capacity"],
  recovery_stance: "conservative", strength_emphasis: "absolute_strength",
  days_per_week: 5, equipment: {}, do_not_program: [], vocabulary: [], lifts: {},
};

Deno.test("the planner is given no strength area and no strength emphasis: nothing is ranked and nothing is set aside", () => {
  const t: Any = stripStrengthFromTdi(TDI);
  assertEquals(t.priorities.map((p: Any) => p.focus), ["aerobic_capacity", "gymnastics_pulling"]);
  assertEquals(t.maintain, ["midline", "mixed_modal_conditioning"]);
  assertEquals(t.deprioritize, ["skill_coordination", "anaerobic_capacity"]);
  assertEquals("strength_emphasis" in t, false);
  assertEquals(t.recovery_stance, "conservative"); // left for later
  assertEquals(TDI.strength_emphasis, "absolute_strength"); // the input is not changed
  // With skills out as well, what is left of the coach's lists is conditioning.
  const p: Any = tdiForPlanner(TDI);
  assertEquals(p.priorities.map((x: Any) => [x.focus, x.rank]), [["aerobic_capacity", 2]]);
  assertEquals(p.maintain, ["mixed_modal_conditioning"]);
  assertEquals(p.deprioritize, ["anaerobic_capacity"]);
  const cs: Any = {
    headline: "h", strength_emphasis: { value: "absolute_strength" }, recovery_posture: { stance: "conservative" },
    priorities: TDI.priorities, maintain: [{ focus: "olympic_lifting" }, { focus: "midline" }], deprioritize: [{ focus: "posterior_chain" }, { focus: "anaerobic_capacity" }],
  };
  const out: Any = coachStateWithoutStrength(cs);
  assertEquals(out.priorities.map((x: Any) => x.focus), ["aerobic_capacity", "gymnastics_pulling"]);
  assertEquals(out.maintain.map((x: Any) => x.focus), ["midline"]);
  assertEquals(out.deprioritize.map((x: Any) => x.focus), ["anaerobic_capacity"]);
  assertEquals("strength_emphasis" in out, false);
  assertEquals(out.recovery_posture.stance, "conservative");
});

Deno.test("a reference comparison is stated as a plain fact, for a strong lift as well as a weak one", () => {
  assertEquals(standingLine("bench_to_bodyweight", { value: 1.111, threshold: 1.46, target_estimate: 330 }, "lbs"),
    "  - bench ÷ bodyweight: 1.11 against a bar of 1.46 (the bar is about 330 lbs) — 24% under the bar");
  assertEquals(standingLine("deadlift_to_bodyweight", { value: 2.378, threshold: 2.5, target_estimate: 565 }, "lbs"),
    "  - deadlift ÷ bodyweight: 2.38 against a bar of 2.50 (the bar is about 565 lbs) — at the bar");
  assertEquals(standingLine("overhead_squat_to_snatch", { value: 1.085, threshold: 0.95 }, "kg"),
    "  - overhead squat ÷ snatch: 1.08 against a bar of 0.95 — 14% over the bar");
  assertEquals(standingLine("x", { value: null, threshold: 1 }, "lbs"), "");
  assertEquals(standingLine("x", null, "lbs"), "");
});

Deno.test("the planner is given the athlete's goal, every max, each lift's standing, their basics and what they said about injuries", () => {
  const brief = buildLiftsBrief({
    lifts: { back_squat: 400, snatch: 235, bench_press: 250, push_jerk: null },
    normative: {
      bench_to_bodyweight: { value: 1.111, threshold: 1.46, target_estimate: 330 },
      snatch_to_back_squat: { value: 0.588, threshold: 0.6, target_estimate: 240 },
      row_2k_to_5k_retention: { value: 0.856, threshold: 0.95 },
    },
    goalText: " Olympic lifts are important. ",
    basics: { age: 51, gender: "male", bodyweight: 225, units: "lbs" },
    injuriesText: "Sore left elbow on heavy pressing",
    coachNotes: ["more squatting please"],
  });
  for (const want of [
    'Their goal, in their own words: "Olympic lifts are important."',
    "Age 51 · sex male · bodyweight 225 lbs",
    'What they wrote under injuries: "Sore left elbow on heavy pressing"',
    'Their notes for their coach: "more squatting please"',
    "  - back squat: 400",
    "No max entered for: push jerk",
    "The bars are ADVANCED standards: being under one is common.",
    "These are facts for you to weigh, not a ranking; a lift at or over its bar is a strength:",
    "— 24% under the bar",
    "  - snatch ÷ back squat: 0.59 against a bar of 0.60 (the bar is about 240 lbs) — at the bar",
  ]) assert(brief.includes(want), want);
  assert(!brief.includes("retention")); // conditioning comparisons are not lifting facts
  for (const label of ["well_below", "position", "priority"]) assert(!brief.includes(label), label);
  const bare = buildLiftsBrief({ injuriesText: "None" });
  assert(bare.includes("(none given)") && bare.includes("(none entered)") && bare.includes("(not enough lifts entered to compare)"));
  assert(!bare.includes("under injuries"));
});

Deno.test("the planner's document carries the lifts and skills sections and no strength or skill decision from the coach state", () => {
  const cs: Any = {
    headline: "h", strength_emphasis: { value: "technical" },
    priorities: TDI.priorities.map((p: Any) => ({ ...p, athlete_facing_rationale: "r" })),
    maintain: [{ focus: "olympic_lifting" }], deprioritize: [{ focus: "posterior_chain" }],
  };
  const payload: Any = { lifts: { back_squat: 400 }, skills: { "L-Sit": "beginner" }, equipment: {}, basics: { units: "lbs" }, athlete_model: { normative: {} }, training_context: { goal_text: "g" } };
  const doc = plannerDocument(cs, payload, "ARTICLE");
  for (const gone of ["upper_body_pressing", "powerlifting_strength", "olympic_lifting", "posterior_chain", "strength_emphasis", "gymnastics_pulling"]) {
    assert(!doc.includes(gone), `the planner is still sent ${gone}`);
  }
  assert(doc.includes('"focus": "aerobic_capacity"'));
  assert(doc.indexOf("ATHLETE'S LIFTS") > 0 && doc.indexOf("ATHLETE'S SKILLS") > doc.indexOf("ATHLETE'S LIFTS"));
  assert(doc.endsWith("ARTICLE"));
});

Deno.test("the individual planner chooses the lifts itself; the class planner text is unchanged", () => {
  const p = V3_SKELETON_SYSTEM_PROMPT;
  for (const want of [
    "THE STRENGTH BLOCK — YOURS TO DECIDE, FROM THE ATHLETE'S OWN LIFTS",
    "no lift family is switched off",
    "Two things matter most, and both matter: a lift or a kind of lifting the athlete named in their goal, and a lift that is a real weakness for them.",
    "Read the comparisons as facts to weigh, not as a ranking to follow.",
    "never drop a lift because it is strong",
    "No lift family is left out of a month",
    "THE LISTS COVER CONDITIONING ONLY.",
    "DECLARE the coaching purpose of the METCON block this day",
  ]) assert(p.includes(want), want);
  for (const gone of ["STRENGTH EMPHASIS — how to bias", "strength_emphasis", "MAINTAIN PRIMARIES", "absolute_strength", "olympic_lifting · powerlifting_strength", "dedicated strength emphases"]) {
    assert(!p.includes(gone), `individual planner still says "${gone}"`);
  }
  // Left for later, so still there: the volume rule and the recovery stance.
  assert(p.includes("STRENGTH PRESCRIPTION — VOLUME OVER INTENSITY"));
  assert(p.includes("RECOVERY STANCE — shape the arc"));
  const c = V3_SKELETON_SYSTEM_PROMPT_CLASS;
  assert(c.includes("STRENGTH EMPHASIS — how to bias the strength block") && c.includes("MAINTAIN PRIMARIES"));
  assert(!c.includes("YOURS TO DECIDE"));
  const recap = CROSSFIT_PACK.writer.skeletonRuleRecap(5, { days_per_week: 5 } as Any);
  assert(recap.includes("You choose each strength day's lift from the ATHLETE'S LIFTS section."));
});

Deno.test("a plan with no strength or skills entry in block_intents passes the allocation checks", () => {
  const day = (n: number) => ({
    day_num: n, day_intent: "x", block_types: ["warm-up", "skills", "strength", "accessory", "metcon", "cool-down"],
    primary_lift: "Snatch", strength_scheme: "5x2 @75%", skill_names: ["Muscle-Ups"], skill_focus: "transitions", metcon_time_domain: "short",
    block_intents: [
      { block_type: "accessory", focus: "posterior_chain", purpose: "support" },
      { block_type: "metcon", focus: "aerobic_capacity", purpose: "develop", source_priority_rank: 2 },
    ],
  });
  const plan: Any = { weeks: [{ week_num: 1, weekly_intent: "build", days: [day(1), day(2), day(3)] }] };
  assertEquals(checkAllocationInvariants(tdiForPlanner(TDI), plan).violations, []);
  // Against the old lists the same plan would be sent back for not developing pressing.
  assert(checkAllocationInvariants(TDI, plan).violations.some((v) => v.includes("upper_body_pressing")));
});

Deno.test("a plan that leaves the strength and skills blocks out of block_intents passes EVERY hard plan check (it used to be rejected on all three attempts)", () => {
  const day = (n: number, extra: Any = {}) => ({
    day_num: n, day_intent: "day intent text", block_types: ["warm-up", "skills", "strength", "accessory", "metcon", "cool-down"],
    primary_lift: ["Snatch", "Bench Press", "Back Squat", "Clean and Jerk", "Deadlift"][n - 1], strength_scheme: "5x2 @75%",
    skill_names: ["Muscle-Ups"], skill_focus: "transition drills", metcon_time_domain: ["short", "medium", "long", "medium", "long"][n - 1],
    block_intents: [
      { block_type: "accessory", focus: "posterior_chain", purpose: "support" },
      { block_type: "metcon", focus: "aerobic_capacity", purpose: n === 1 ? "develop" : "support", ...(n === 1 ? { source_priority_rank: 2 } : {}) },
    ],
    ...extra,
  });
  const plan = (days: Any[]): Any => ({
    month_plan: { weekly_intent: ["build", "build", "build", "deload"], strength_progression: "Snatch: 5x2 @75% → 5x2 @78% → 5x1 @82% → deload", deload_placement: "Week 4", programming_priorities: "x" },
    weeks: [1, 2, 3, 4].map((w) => ({ week_num: w, weekly_intent: w === 4 ? "deload" : "build", days })),
  });
  const tdi = tdiForPlanner({ ...TDI, maintain: ["olympic_lifting", "midline"] });
  const good = CROSSFIT_PACK.audits.runSkeleton({ skeleton: plan([1, 2, 3, 4, 5].map((n) => day(n))), daysPerWeek: 5, trainingDesignInput: tdi });
  assertEquals(good.failures.map((f: Any) => [f.rule, f.violations[0]]), []);
  // A skills block that names no skill, and has no tag either, is still caught.
  const bad = CROSSFIT_PACK.audits.runSkeleton({ skeleton: plan([1, 2, 3, 4, 5].map((n) => day(n, n === 3 ? { skill_names: [] } : {}))), daysPerWeek: 5, trainingDesignInput: tdi });
  const m8 = bad.failures.find((f: Any) => f.rule === "machine_row_m8");
  assert(m8 && m8.violations.every((v: string) => v.includes('declares "skills" but nothing says what it is for')));
  assertEquals(m8!.violations.length, 4);
});

// ── Accessory supports the strength work (founder, 2026-11-28) ──

Deno.test("the planner names the lift each accessory block supports, and gymnastics skill work leaves accessory", async () => {
  const p = V3_SKELETON_SYSTEM_PROMPT;
  for (const want of [
    "THE ACCESSORY BLOCK — IT SUPPORTS THE STRENGTH WORK",
    "Set accessory_focus on every day that has an accessory block",
    "It supports that day's lift, or another lift you are building this cycle",
    "Gymnastics skill work belongs in the skills block, not here. Midline work is allowed in both.",
    "DECLARE the coaching purpose of the METCON block this day",
  ]) assert(p.includes(want), want);
  assert(!p.includes("The accessory block complements the day's primary lift + supports the priorities."));
  assert(!V3_SKELETON_SYSTEM_PROMPT_CLASS.includes("THE ACCESSORY BLOCK — IT SUPPORTS"));
  const { V2_GENERATE_PROGRAM_SYSTEM_PROMPT: w } = await import("./v2-system-prompt.ts");
  assert(w.includes("Accessory SUPPORTS THE STRENGTH WORK. The skeleton's accessory_focus names the lift the block supports"));
  assert(w.includes("Gymnastics skill work (pull-up, muscle-up, handstand, dip and rope skills) belongs in the Skills block, not here."));
  assert(w.includes("Midline work is allowed here as well as in Skills"));
  assert(!w.includes("Don't re-derive the athlete's gaps here"));
  assert(!w.includes("Skills-style accessory"));
  const { buildEmitSkeletonTool } = await import("./v3-output-schema.ts");
  const day = (buildEmitSkeletonTool(5).input_schema as Any).properties.weeks.items.properties.days.items.properties;
  assertEquals(day.accessory_focus.type, "string");
});

Deno.test("an accessory block is accounted for by its accessory_focus; with neither a tag nor the field it is caught", () => {
  const day = (extra: Any = {}) => ({
    day_num: 1, day_intent: "day intent text", block_types: ["warm-up", "skills", "strength", "accessory", "metcon", "cool-down"],
    primary_lift: "Deadlift", strength_scheme: "4x4 @75%", skill_names: ["L-Sit"], skill_focus: "holds", metcon_time_domain: "short",
    accessory_focus: "Supports the deadlift: hamstrings",
    block_intents: [{ block_type: "metcon", focus: "aerobic_capacity", purpose: "support" }],
    ...extra,
  });
  const plan = (d: Any): Any => ({ weeks: [{ week_num: 1, weekly_intent: "build", days: [d] }] });
  assertEquals(machineRowM8(plan(day())).violations, []);
  const r = machineRowM8(plan(day({ accessory_focus: "  " })));
  assertEquals(r.violations.length, 1);
  assert(r.violations[0].includes('declares "accessory" but nothing says what it is for (no block_intents entry and no accessory_focus)'));
});

Deno.test("what the accessory block supports reaches the composer, the stored block, the dry-run text and the writer's lift facts", async () => {
  const { deriveMetconSlots } = await import("./metcon-composer.ts");
  const { planForBlock } = await import("./metcon-dry-run-text.ts");
  const d: Any = {
    day_num: 1, block_types: ["strength", "accessory", "metcon"], primary_lift: "Deadlift", metcon_time_domain: "short",
    accessory_focus: "Supports the deadlift: hamstrings", block_intents: [{ block_type: "accessory", focus: "posterior_chain", purpose: "support" }],
  };
  const [slot] = deriveMetconSlots({ weeks: [{ week_num: 1, weekly_intent: "build", days: [d] }] } as Any);
  assertEquals(slot.day_context.accessory_focuses, ["Supports the deadlift: hamstrings"]);
  // A month planned before the field: the old tag is still passed on.
  const [old] = deriveMetconSlots({ weeks: [{ week_num: 1, weekly_intent: "build", days: [{ ...d, accessory_focus: undefined }] }] } as Any);
  assertEquals(old.day_context.accessory_focuses, ["posterior_chain"]);
  assert(planForBlock(d, "accessory").startsWith("Supports the deadlift: hamstrings"));
  const read = (rel: string) => Deno.readTextFileSync(new URL(rel, import.meta.url));
  assert(read("./save-program-v3.ts").includes("if (daySkel.accessory_focus) base.focus = daySkel.accessory_focus;"));
  const pipe = read("./engine/pipeline.ts");
  assert(pipe.includes("const liftsBlock = planNamesAccessory"));
  assert(pipe.includes("ATHLETE'S LIFTS (for the ACCESSORY block: where each lift stands, to find the weak link the block should work)"));
  const brief = buildLiftsBrief({ heading: "H", lifts: { deadlift: 500 } });
  assert(brief.startsWith("H\n"));
});
