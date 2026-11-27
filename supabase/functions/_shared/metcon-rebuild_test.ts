/**
 * metcon-rebuild_test.ts — the metcon rebuild of 2026-11-27, one test per
 * decision the founder made:
 *
 *   coach state  no conditioning paragraph; the "longer time domains" rule gone
 *   planner      one metcon decision, a typed time domain; no pace, focus
 *                label or minutes; the mix is counted on re-plans too
 *   composer     given the slot (time domain + week role), the athlete's own
 *                profile and goal, 100 real examples, three articles, the
 *                month so far and last month; NOT given the coach state
 *   loads        medicine ball fixed; dumbbell / kettlebell chosen by the composer
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { COACH_STATE_SYSTEM_PROMPT, ENGINE_COACH_STATE_ADDENDUM } from "./coach-state-prompt.ts";
import { buildCoachStateDocumentBlock, EMIT_COACH_STATE_TOOL, renderCoachStateForChat } from "./coach-state.ts";
import { V3_SKELETON_SYSTEM_PROMPT } from "./v3-skeleton-prompt.ts";
import { buildEmitSkeletonTool } from "./v3-output-schema.ts";
import { auditSkeletonMetconMix } from "./v3-skeleton-audits.ts";
import { CROSSFIT_PACK } from "./domain-packs/crossfit/index.ts";
import {
  buildComposerUserMessage,
  deriveMetconSlots,
  describeComposedPiece,
  EMIT_METCON_MONTH_TOOL,
  metconTimeDomainOfDay,
  type MetconComposerInputs,
  normalizeMetconTimeDomains,
} from "./metcon-composer.ts";
import { METCON_COMPOSER_SYSTEM_PROMPT, TWO_DAY_COMPOSER_ADDENDUM } from "./metcon-composer-prompt.ts";
import { CYCLING_LOAD_BANDS_PROMPT } from "./conditioning-definitions.ts";
import { V2_GENERATE_PROGRAM_SYSTEM_PROMPT } from "./v2-system-prompt.ts";
import {
  COMPOSER_ARTICLES,
  joinArticle,
  loadArticleBlock,
  loadExampleBlock,
  PLANNER_ARTICLES,
  renderArticles,
  renderExamples,
} from "./metcon-library.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, import.meta.url));

// ── Coach state ──

Deno.test("the coach state writes no conditioning paragraph and has no rule pushing metcons longer", () => {
  for (const gone of ["METCON GUIDANCE", "metcon_guidance", "longer time domains", "sustained pace IS aerobic", "loading_deemphasis", "fatigue_skill_exclusions"]) {
    assert(!COACH_STATE_SYSTEM_PROMPT.includes(gone), `coach state prompt still says "${gone}"`);
    assert(!ENGINE_COACH_STATE_ADDENDUM.includes(gone), `Engine add-on still says "${gone}"`);
  }
  const schema = EMIT_COACH_STATE_TOOL.input_schema as Any;
  for (const field of ["metcon_guidance", "loading_deemphasis", "fatigue_skill_exclusions"]) {
    assertEquals(field in schema.properties, false);
    assertEquals(schema.required.includes(field), false);
  }
});

Deno.test("a coach state stored before the change does not pass its old paragraph on", () => {
  const stored: Any = {
    headline: "h", summary: "s", priorities: [], maintain: [], deprioritize: [],
    recovery_posture: { stance: "standard" }, strength_emphasis: { value: "balanced" },
    metcon_guidance: "Bias toward longer sustained-pace efforts in the 15-25 minute range.",
    loading_deemphasis: true, fatigue_skill_exclusions: ["midline"],
  };
  const forPlanner = buildCoachStateDocumentBlock(stored);
  const forChat = renderCoachStateForChat(stored);
  for (const text of [forPlanner, forChat]) {
    assert(!text.includes("longer sustained-pace"));
    assert(!text.includes("loading_deemphasis"));
    assert(!text.includes("fatigue_skill_exclusions"));
  }
  assert(forPlanner.includes('"headline": "h"')); // the rest of the document is unchanged
});

// ── Planner ──

Deno.test("the planner decides one thing about a metcon: its time domain", () => {
  const p = V3_SKELETON_SYSTEM_PROMPT;
  assert(p.includes("THE METCON SLOT — YOU DECIDE ONE THING: ITS TIME DOMAIN"));
  assert(p.includes("short: under 7 min · medium: 7-14 min · long: 14-22 min, never over 22"));
  assert(p.includes("Do not give the metcon minutes, a pace, a focus label"));
  for (const gone of ["intensity character", "sustained", "YOU DECIDE THREE THINGS", "longer long pieces"]) {
    assert(!p.includes(gone), `planner prompt still says "${gone}"`);
  }
  // Only a conditioning priority moves the mix; strength and skill priorities do not.
  assert(p.includes("A conditioning focus among the priorities is the ONLY thing that changes the mix"));
  assert(p.includes("Strength and skill priorities do not change the metcon time domains."));
  const day = (buildEmitSkeletonTool(5).input_schema as Any).properties.weeks.items.properties.days.items.properties;
  assertEquals(day.metcon_time_domain.enum, ["short", "medium", "long"]);
});

Deno.test("the planner gives minutes to every block except the metcon", () => {
  const recap = CROSSFIT_PACK.writer.skeletonRuleRecap(5, { session_length_minutes: 60, days_per_week: 5 } as Any);
  assert(recap.includes("EXCEPT the metcon"));
  assert(recap.includes("The metcon gets no minutes: its length is its time domain"));
  assert(recap.includes("sets metcon_time_domain"));
});

const day = (n: number, extra: Any = {}) => ({
  day_num: n, day_intent: "x", block_types: ["warm-up", "skills", "strength", "accessory", "metcon", "cool-down"],
  primary_lift: "Back Squat", strength_scheme: "5x5 @75%", skill_focus: "Pull-up volume",
  block_intents: [{ block_type: "accessory", focus: "midline", purpose: "support" }],
  ...extra,
});

Deno.test("a metcon day's time domain is the typed field; an older month is read from its line", () => {
  assertEquals(metconTimeDomainOfDay({ metcon_time_domain: "short", metcon_focus: "long aerobic" }), "short");
  assertEquals(metconTimeDomainOfDay({ metcon_focus: "long · build, sustained · aerobic_capacity" }), "long");
  assertEquals(metconTimeDomainOfDay({ metcon_focus: "piece (5-6 min)" }), "short");
  assertEquals(metconTimeDomainOfDay({}), null);
  assertEquals(metconTimeDomainOfDay({ metcon_time_domain: "huge" }), null);

  const plan: Any = { weeks: [{ week_num: 1, weekly_intent: "build", days: [
    day(1, { metcon_time_domain: "long" }),
    day(2, { metcon_focus: "short · deload, easy · mixed_modal_conditioning" }),
    day(3),
  ] }] };
  normalizeMetconTimeDomains(plan);
  const [a, b, c] = plan.weeks[0].days;
  assertEquals([a.metcon_time_domain, a.metcon_focus], ["long", "long"]); // the line the screens read
  assertEquals([b.metcon_time_domain, b.metcon_focus], ["short", "short · deload, easy · mixed_modal_conditioning"]);
  assertEquals([c.metcon_time_domain, c.metcon_focus], [undefined, undefined]); // nothing invented
});

Deno.test("a slot carries the time domain, the week's role and the day's other work, and nothing else from the plan", () => {
  const plan: Any = { weeks: [{ week_num: 2, weekly_intent: "overreach", days: [
    day(1, { metcon_time_domain: "short", block_minutes: [{ block_type: "metcon", minutes: 25 }],
      block_intents: [{ block_type: "metcon", focus: "aerobic_capacity", purpose: "develop" }, { block_type: "accessory", focus: "midline", purpose: "support" }] }),
  ] }] };
  const [slot] = deriveMetconSlots(plan);
  assertEquals(slot, {
    week_num: 2, day_num: 1, time_domain: "short", week_role: "overreach",
    day_context: { primary_lift: "Back Squat", strength_scheme: "5x5 @75%", skill_focus: "Pull-up volume", accessory_focuses: ["midline"] },
  } as Any);
  const text = JSON.stringify(slot);
  for (const gone of ["allocated_minutes", "intensity", "aerobic_capacity", "25"]) assert(!text.includes(gone));
});

Deno.test("the time-domain mix reads the typed field, flags a metcon with none, and on a re-plan counts only the re-planned weeks", () => {
  const week = (n: number, domains: Array<string | null>) => ({
    week_num: n, weekly_intent: "build",
    days: domains.map((d, i) => day(i + 1, d ? { metcon_time_domain: d } : {})),
  });
  const good: Any = { weeks: [week(1, ["short", "medium", "long"])] };
  assertEquals(auditSkeletonMetconMix(good).passed, true);
  const allLong: Any = { weeks: [week(1, ["long", "long", "long", "long", "long"])] };
  const r = auditSkeletonMetconMix(allLong);
  assert(r.violations.some((v) => v.includes("no short metcon")));
  assert(r.violations.some((v) => v.includes("5/5 metcons are long")));
  const missing: Any = { weeks: [week(1, ["short", "medium", "long", null])] };
  assert(auditSkeletonMetconMix(missing).violations.some((v) => v.includes("Day 4: the metcon has no time domain")));
  // Re-plan from week 3: weeks 1-2 are written and not counted.
  const replanned: Any = { weeks: [week(1, ["long", "long", "long"]), week(2, ["long", "long", "long"]), week(3, ["short", "medium", "long"]), week(4, ["medium", "long", "short"])] };
  assertEquals(auditSkeletonMetconMix(replanned).passed, false);
  assertEquals(auditSkeletonMetconMix(replanned, 3).passed, true);
});

Deno.test("the time domains rotate: two weeks in a row with the same days is a miss, sent back like the mix", () => {
  const week = (n: number, domains: string[]) => ({ week_num: n, weekly_intent: "build", days: domains.map((d, i) => day(i + 1, { metcon_time_domain: d })) });
  const fixed: Any = { weeks: [1, 2, 3, 4].map((n) => week(n, ["medium", "long", "short", "long", "medium"])) };
  const r = auditSkeletonMetconMix(fixed);
  assertEquals(r.violations.length, 3);
  assert(r.violations[0].includes("Week 2: the metcon time domains fall on the same days as week 1 (D1 medium · D2 long · D3 short · D4 long · D5 medium)"));
  const rotated: Any = { weeks: [
    week(1, ["medium", "long", "short", "long", "medium"]), week(2, ["long", "short", "medium", "medium", "long"]),
    week(3, ["short", "medium", "long", "medium", "long"]), week(4, ["medium", "long", "short", "long", "medium"]),
  ] };
  assertEquals(auditSkeletonMetconMix(rotated).passed, true); // week 4 may match week 1: only neighbours are compared
  // A re-plan from week 3 is compared with written week 2.
  const replan: Any = { weeks: [week(1, ["short", "medium", "long"]), week(2, ["long", "short", "medium"]), week(3, ["long", "short", "medium"]), week(4, ["medium", "long", "short"])] };
  assert(auditSkeletonMetconMix(replan, 3).violations.some((v) => v.startsWith("Week 3:")));
  // Two metcon days a week: not counted.
  assertEquals(auditSkeletonMetconMix({ weeks: [week(1, ["short", "long"]), week(2, ["short", "long"])] } as Any).passed, true);
  assert(V3_SKELETON_SYSTEM_PROMPT.includes("ROTATE THE DAYS"));
});

Deno.test("the mix is counted on a first build and on a re-plan, and the planner reads the Theoretical Template", () => {
  const gen = read("../generate-program-v3/index.ts");
  assert(gen.includes("skeleton = await withMixCheck(supa, job, rs, { skeleton, tdi, doc: intentDocument, fromWeek: 1 });"));
  assert(gen.includes("fromWeek: weekNum, finish }"));
  assert(gen.includes("const plannerArticles = await loadArticleBlock(supa, PLANNER_ARTICLES);"));
  assertEquals(PLANNER_ARTICLES, ["template"]);
  assertEquals(COMPOSER_ARTICLES, ["template", "metabolic_conditioning", "benchmark_workouts"]);
});

// ── Composer ──

const INPUTS: MetconComposerInputs = {
  slots: [{ week_num: 1, day_num: 1, time_domain: "short", week_role: "build", day_context: { primary_lift: "Back Squat" } }],
  goal_text: "Increased capacity across the board.",
  basics: { age: 41, sex: "male", bodyweight: 190 },
  units: "lbs",
  lifts: { back_squat: 315 },
  skills: { "Muscle-Ups": "beginner" },
  conditioning_benchmarks: { row_2k: "7:20" },
  equipment: { barbell: true, ski_erg: false },
  injuries_text: "None",
  do_not_program: ["Ski Erg"],
  athlete_words: [],
  coach_notes: ["more gymnastics please"],
  previous_cycle_metcons: ["W1D1 · AMRAP 12 (12 min): 10 Thruster, 12 cal Row"],
  already_composed_this_month: ["W1D2 · 21-15-9 for time (6 min): 21-15-9 Deadlift, 21-15-9 Burpee"],
  vocabulary: ["Thruster", "Row"],
  examples: renderExamples([{ text: "Fran\n21-15-9 reps for time of:\n95-lb thrusters\nPull-ups" }]),
  articles: renderArticles([{ key: "template", text: "The template text." }]),
  engine_training: null,
};

Deno.test("the composer is given the athlete's own profile, the examples, the articles, the month so far and last month", () => {
  const msg = buildComposerUserMessage(INPUTS);
  for (const want of [
    'THE ATHLETE\'S GOAL, in their own words: "Increased capacity across the board."',
    "THE ATHLETE: age 41 · sex male · bodyweight 190 lbs · units lbs",
    "Never program: Ski Erg.",
    '"more gymnastics please"',
    '{"back_squat":315}',
    '{"Muscle-Ups":"beginner"}',
    '{"row_2k":"7:20"}',
    '"ski_erg":false',
    "EXAMPLE WORKOUTS (1 real CrossFit main site metcons",
    "95-lb thrusters",
    "A Theoretical Template for CrossFit's Programming",
    "LAST MONTH'S METCONS (do not serve any of these again):\n  - W1D1 · AMRAP 12 (12 min): 10 Thruster, 12 cal Row",
    "THIS MONTH SO FAR",
    "21-15-9 Deadlift",
    "SLOTS TO WRITE NOW (1; exactly one metcon per slot)",
    '"time_domain": "short"',
    '"week_role": "build"',
  ]) assert(msg.includes(want), `composer message is missing: ${want}`);
  // An athlete who gave no goal and no injuries: said plainly, nothing invented.
  const bare = buildComposerUserMessage({ ...INPUTS, goal_text: null, injuries_text: null, do_not_program: [], previous_cycle_metcons: [], already_composed_this_month: [] });
  assert(bare.includes("in their own words: (none given)"));
  assert(bare.includes("INJURIES AND AVOID LIST: the athlete has stated none."));
  assert(bare.includes("(none: this is the first month)"));
  assert(bare.includes("(nothing yet)"));
});

Deno.test("the composer is not given the coach state, priorities, recovery stance, a pace, a focus label or minutes", () => {
  const msg = buildComposerUserMessage(INPUTS) + METCON_COMPOSER_SYSTEM_PROMPT + TWO_DAY_COMPOSER_ADDENDUM;
  for (const gone of [
    "COACH'S CONDITIONING GUIDANCE", "TYPED COACHING DECISIONS", "development axes", "development axis", "maintain axes", "maintain axis",
    "loading_deemphasis", "fatigue_skill_exclusions", "recovery stance", "allocated_minutes", "intensity character",
    "aerobic_capacity", "FIT TO ATHLETE", "floor 60", "per-fortnight",
  ]) assert(!msg.includes(gone), `the composer is still told "${gone}"`);
  const gen = read("../generate-program-v3/index.ts");
  const stage = gen.slice(gen.indexOf("async function stageMetcons("), gen.indexOf("async function stageFillWeek("));
  const builder = read("./compose-metcons.ts");
  for (const gone of ["coachState", "metcon_guidance", "recovery_stance", "priorities", "tdi.maintain", "buildStratifiedMetconExamples"]) {
    assert(!stage.includes(gone), `the metcons stage still reads ${gone}`);
    assert(!builder.includes(gone), `the composer's inputs still read ${gone}`);
  }
  assert(stage.includes("loadExampleBlock(supa)"));
  assert(stage.includes("loadArticleBlock(supa, COMPOSER_ARTICLES)"));
  assert(stage.includes("buildComposerInputs(payload, tdi, { examples, articles, previousCycleMetcons })"));
  assert(builder.includes("goal_text: payload.training_context.goal_text"));
  assert(stage.includes("rs.continuation.monthNumber - 1"));
});

Deno.test("the composer's rules: which are counted, which are its own, and what the examples are for", () => {
  const p = METCON_COMPOSER_SYSTEM_PROMPT;
  assert(p.includes("THE OBJECTIVE — PROGRAM TO THIS ATHLETE"));
  assert(p.includes("COMPOSE LIKE A CRAFTSMAN"));
  assert(p.includes("Rules 4, 6, 7 and 8 are counted after you"));
  assert(p.includes("Do not copy one and do not pick one to adapt"));
  assert(p.includes("The time domain and the week's role are the only decisions made for you."));
  assert(p.includes("each is judged across the whole month: THIS MONTH SO FAR together with what you write now"));
  assert(TWO_DAY_COMPOSER_ADDENDUM.includes("variety is judged across the month"));
  // A stated length cannot be over the long cap.
  const piece = (EMIT_METCON_MONTH_TOOL.input_schema as Any).properties.metcons.items.properties;
  assertEquals(piece.stated_duration_minutes.maximum, 22);
  const mv = piece.movements.items.properties;
  assertEquals(mv.machine.enum, ["row", "bike", "ski", "run", "swim"]);
  assertEquals(mv.weight.type, "number");
});

Deno.test("loads: the medicine ball is one weight per sex, dumbbells are two fixed sizes per sex, and the composer chooses kettlebell weights", () => {
  for (const text of [METCON_COMPOSER_SYSTEM_PROMPT, V2_GENERATE_PROGRAM_SYSTEM_PROMPT]) {
    assert(text.includes("medicine ball: always 20 lb / 9 kg for men and 14 lb / 6 kg for women."));
    assert(text.includes("dumbbell (metcons): 50 lb / 22.5 kg for men and 35 lb / 15 kg for women; for a stronger or more advanced athlete, 70 lb / 32 kg for men and 50 lb / 22.5 kg for women. No other dumbbell weight."));
    assert(text.includes("kettlebell: no band and no default. The composer chooses the weight for THIS athlete from their lifts"));
  }
  // The fixed table is gone.
  assert(!/light 35 · moderate 50 · heavy 70/.test(CYCLING_LOAD_BANDS_PROMPT));
  assert(!read("./conditioning-definitions.ts").includes("IMPLEMENT_TIER_DEFAULTS"));
  assert(V2_GENERATE_PROGRAM_SYSTEM_PROMPT.includes("A dumbbell or kettlebell movement carries the composer's chosen weight: use it as given."));
});

Deno.test("a composed piece is described on one line, with what the athlete does", () => {
  assertEquals(
    describeComposedPiece({
      week_num: 2, day_num: 3, format: "amrap", block_scheme: "AMRAP 12", stated_duration_minutes: 12,
      stimulus_note: "x", monostructural: false,
      movements: [{ movement: "Thruster", prescription: "10" }, { movement: "Row", prescription: "12 cal" }],
    }),
    "W2D3 · AMRAP 12 (12 min): 10 Thruster, 12 cal Row",
  );
});

// ── Library ──

Deno.test("an article stored in overlapping pieces is read once, in order", () => {
  const whole = "The CrossFit template is a three-days-on, one-day-off pattern built from three modalities and it rotates them across the cycle.";
  const pieces = [
    { chunk_index: 1, content: whole.slice(40) },
    { chunk_index: 0, content: whole.slice(0, 70) },
  ];
  assertEquals(joinArticle(pieces), whole);
  assertEquals(joinArticle([]), "");
  assertEquals(renderArticles([{ key: "template", text: "" }]), "");
});

Deno.test("examples are drawn fresh from the stored main site metcons; a library failure never stops a build", async () => {
  const calls: Any[] = [];
  const supa: Any = { rpc: (name: string, args: Any) => { calls.push([name, args]); return Promise.resolve({ data: [{ text: "Fran\n21-15-9" }, { text: "  " }, { text: "Cindy\nAMRAP 20" }], error: null }); } };
  const block = await loadExampleBlock(supa);
  assertEquals(calls, [["sample_mainsite_examples", { n: 100 }]]);
  assert(block.startsWith("EXAMPLE WORKOUTS (2 real CrossFit main site metcons"));
  assert(block.includes("Fran\n21-15-9\n\n---\n\nCindy\nAMRAP 20"));
  assertEquals(await loadExampleBlock({ rpc: () => Promise.resolve({ data: null, error: { message: "down" } }) } as Any), "");
  assertEquals(await loadExampleBlock({ rpc: () => Promise.reject(new Error("net")) } as Any), "");
  assertEquals(await loadExampleBlock({ rpc: () => Promise.resolve({ data: [], error: null }) } as Any), "");

  const titles: string[] = [];
  const chunks: Any = { from: () => ({ select: () => ({ eq: (_c: string, title: string) => ({ order: () => { titles.push(title); return Promise.resolve({ data: [{ chunk_index: 0, content: `text of ${title}` }], error: null }); } }) }) }) };
  const articles = await loadArticleBlock(chunks, COMPOSER_ARTICLES);
  assertEquals(titles, ["06 03 CF Template", "Metabolic Conditioning English", "13 03 Benchmark Workouts"]);
  assert(articles.includes("=== Metabolic Conditioning (Greg Glassman, CrossFit Journal, June 2003) ===\ntext of Metabolic Conditioning English"));
  const broken: Any = { from: () => { throw new Error("down"); } };
  assertEquals(await loadArticleBlock(broken, PLANNER_ARTICLES), "");
});

Deno.test("the twelve search-picked examples are gone", () => {
  let exists = true;
  try { Deno.statSync(new URL("./metcon-examples.ts", import.meta.url)); } catch { exists = false; }
  assertEquals(exists, false);
  assert(!read("../generate-program-v3/index.ts").includes("metcon-examples"));
});

// ── Movement list clean-up (founder, 2026-11-27) ──

Deno.test("no bike on the profile rules out Air Bike under its new name and its old ones", async () => {
  const { EQUIPMENT_TO_MOVEMENTS } = await import("./equipment-movements.ts");
  for (const name of ["Air Bike", "Bike", "Assault Bike", "Echo Bike"]) {
    assert(EQUIPMENT_TO_MOVEMENTS.assault_bike.includes(name), `${name} is not ruled out without a bike`);
  }
});

Deno.test("the composer is told not to bring out a second implement as an obstacle", () => {
  const p = METCON_COMPOSER_SYSTEM_PROMPT;
  assert(p.includes("do not bring out a second implement only as an obstacle or a marker"));
});

Deno.test("the movement list migration removes Kipping Pull Up and leaves one bike, Air Bike", () => {
  const sql = read("../../migrations/20261127200000_movement_list_pull_up_air_bike.sql");
  assert(sql.includes("DELETE FROM public.movements WHERE canonical_name = 'kipping_pull_up';"));
  assert(sql.includes("SET display_name = 'Air Bike'"));
  assert(sql.includes("DELETE FROM public.movements WHERE canonical_name IN ('assault_bike', 'echo_bike');"));
  assert(sql.includes('["Bike", "Biking", "Assault Bike", "Echo Bike"]'));
});

Deno.test("every AI that writes a programmed movement is told an air bike is always written Air Bike", async () => {
  const { AIR_BIKE_NAME_RULE } = await import("./conditioning-definitions.ts");
  const { SURGICAL_SYSTEM_PROMPT } = await import("./surgical-block-fix.ts");
  assert(AIR_BIKE_NAME_RULE.includes('always written "Air Bike"'));
  for (const [who, text] of [
    ["composer", METCON_COMPOSER_SYSTEM_PROMPT],
    ["writer", V2_GENERATE_PROGRAM_SYSTEM_PROMPT],
    ["rewriter", SURGICAL_SYSTEM_PROMPT],
  ] as const) assert(text.includes(AIR_BIKE_NAME_RULE), `the ${who} is not told`);
  assert(read("../chat/index.ts").includes("`- ${AIR_BIKE_NAME_RULE}\\n`"));
  const { EQUIPMENT_LABELS } = await import("./equipment-labels.ts");
  assertEquals(EQUIPMENT_LABELS.assault_bike, "Air Bike (Echo / Assault / other)");
});

Deno.test("the migration renames the old bike names on programs already written, by exact name only", () => {
  const sql = read("../../migrations/20261127200000_movement_list_pull_up_air_bike.sql");
  assert(sql.includes("UPDATE public.program_movements_v2\nSET movement = 'Air Bike'\nWHERE movement IN ('Bike', 'Assault Bike', 'Echo Bike');"));
  assert(!/program_movements_v2[\s\S]*(ilike|LIKE)/i.test(sql.slice(sql.indexOf("-- 3."))));
});
