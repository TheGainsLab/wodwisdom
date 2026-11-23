// deno test supabase/functions/_shared/restriction-gate_test.ts --no-check --allow-env
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyFindings, type Finding, hasInjuryText, isRuledOutByName, judgeUserMessage, nameHits, plainName,
  type Restrictions, restrictionsForPrompt, runRestrictionGate, takeOutByRule,
} from "./restriction-gate.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

const VOCAB = ["Run", "Shuttle Run", "Bike", "Row", "Ring Row", "Walking Lunge", "Goblet Squat", "Back Squat", "Glute Bridge", "Hip Flexor Stretch", "Push Up", "Box Jump", "Step Up"];

// The real case: runner's knee, a confirmed list that says "running", a program that says "Run".
const ERIC: Restrictions = {
  injuriesText: "Runners Knee, no lunges or back squats",
  doNotProgram: ["running", "100m run", "400m run", "mile run", "back squat", "lunge", "walking lunge", "box jump"],
  suggestedSubs: [{ instead_of: "running", use: "Bike" }, { instead_of: "back squat", use: "Glute Bridge" }],
  vocabulary: VOCAB,
};

const week = (): Any => ({
  weeks: [{
    week_num: 1,
    days: [{
      day_num: 1,
      blocks: [
        { block_type: "warm-up", movements: [{ movement: "Bike", time_seconds: 240 }, { movement: "Push Up", sets: 2, reps: 10 }] },
        { block_type: "strength", movements: [{ movement: "Goblet Squat", sets: 4, reps: 8, weight: 24, weight_unit: "kg", target_pct_1rm: 60 }] },
        { block_type: "metcon", scheme_format: { format: "emom", minutes: 12, stations: [[0], [1], [2]] },
          movements: [{ movement: "Row", calories: 12 }, { movement: "Shuttle Run", rep_scheme: [6] }, { movement: "Push Up", rep_scheme: [10] }] },
        { block_type: "cool-down", movements: [{ movement: "Run", distance: 400, distance_unit: "m", scaling_note: "Easy pace" }, { movement: "Hip Flexor Stretch", time_seconds: 60 }] },
      ],
    }, {
      day_num: 2,
      blocks: [{ block_type: "mobility", movements: [{ movement: "Run", time_seconds: 300, scaling_note: "Easy jog" }] }],
    }],
  }],
});
const names = (o: Any) => o.weeks[0].days.map((d: Any) => d.blocks.map((b: Any) => b.movements.map((m: Any) => m.movement)));

Deno.test("plain names: quantities and -ing fold, describing words stay", () => {
  assertEquals(plainName("400m Run"), "run");
  assertEquals(plainName("Mile Run"), "run");
  assertEquals(plainName("Running"), "run");
  assertEquals(plainName("Box Jumps"), "box jump");
  assertEquals(plainName("Rowing"), "row");
  assertEquals(plainName("Ring Row"), "ring row"); // never collapses to "row"
  assertEquals(plainName("Shuttle Run"), "shuttle run");
  assertEquals(plainName("Strict Press"), "strict press");
  assertEquals(plainName("Kettlebell Swing"), "kettlebell swing");
});

Deno.test("'running' on the list rules out 'Run' — the spelling gap that let ten runs through", () => {
  assert(isRuledOutByName("Run", ERIC.doNotProgram));
  assert(isRuledOutByName("Back Squat", ERIC.doNotProgram));
  assert(!isRuledOutByName("Ring Row", ["Row"]));
  assert(!isRuledOutByName("Bike", ERIC.doNotProgram));
  assertEquals(nameHits(week(), ERIC.doNotProgram).map((h) => `${h.day_num}:${h.block_index}:${h.movement}`), ["1:3:Run", "2:0:Run"]);
});

Deno.test("the restriction is stated first, in the athlete's words, as an absolute", () => {
  const t = restrictionsForPrompt(ERIC.injuriesText, ERIC.doNotProgram);
  assert(t.startsWith("ABSOLUTE RESTRICTIONS"));
  assert(t.includes('"Runners Knee, no lunges or back squats"'));
  assert(t.includes("EVERY block"));
  assert(t.includes("Do NOT scale"));
  assertEquals(restrictionsForPrompt("None", []), "");
  assert(!hasInjuryText("none") && !hasInjuryText("") && !hasInjuryText(null) && hasInjuryText("sore knee"));
});

Deno.test("the judge is given the athlete's words and only allowed movements to choose from", () => {
  const msg = judgeUserMessage(week(), ERIC);
  assert(msg.includes("Runners Knee"));
  const allowed = msg.split("ALLOWED MOVEMENTS")[1].split("\n")[0];
  assert(allowed.includes("Bike") && allowed.includes("Shuttle Run"));
  assert(!/\bRun, /.test(allowed.replace("Shuttle Run, ", "")) && !allowed.includes("Back Squat") && !allowed.includes("Walking Lunge"));
});

Deno.test("a judge's replacement is applied; load and percentage do not carry over", () => {
  const o = week();
  const f: Finding[] = [
    { week_num: 1, day_num: 1, block_index: 1, movement_index: 0, movement: "Goblet Squat", reason: "deep knee flexion", replacement: { movement: "glute bridge" } },
    { week_num: 1, day_num: 1, block_index: 3, movement_index: 0, movement: "Run", reason: "no running", replacement: { movement: "Bike", time_seconds: 180 } },
  ];
  const { applied, unresolved } = applyFindings(o, f, ERIC);
  assertEquals(applied.length, 2); assertEquals(unresolved.length, 0);
  assertEquals(o.weeks[0].days[0].blocks[1].movements[0], { movement: "Glute Bridge", sets: 4, reps: 8 });
  assertEquals(o.weeks[0].days[0].blocks[3].movements[0], { movement: "Bike", time_seconds: 180, scaling_note: "Easy pace" });
});

Deno.test("a replacement that is not a real movement, or is itself ruled out, is refused", () => {
  const o = week();
  const f: Finding[] = [
    { week_num: 1, day_num: 1, block_index: 3, movement_index: 0, movement: "Run", reason: "x", replacement: { movement: "Treadmill Jog" } }, // not in vocabulary
    { week_num: 1, day_num: 2, block_index: 0, movement_index: 0, movement: "Run", reason: "x", replacement: { movement: "Walking Lunge" } }, // ruled out
    { week_num: 1, day_num: 1, block_index: 9, movement_index: 0, movement: "Run", reason: "x", replacement: { movement: "Bike" } }, // no such block
  ];
  const { applied, unresolved } = applyFindings(o, f, ERIC);
  assertEquals(applied.length, 0);
  assertEquals(unresolved.length, 2);
  assertEquals(names(o), names(week()));
});

Deno.test("the rule step: stored substitute when usable, otherwise the movement is removed", () => {
  const o = week();
  const acts = takeOutByRule(o, nameHits(o, ERIC.doNotProgram), ERIC);
  assertEquals(acts.length, 2);
  assertEquals(o.weeks[0].days[0].blocks[3].movements[0].movement, "Bike"); // "running" → Bike
  assertEquals(o.weeks[0].days[1].blocks[0].movements[0].movement, "Bike");
  const o2 = week();
  takeOutByRule(o2, nameHits(o2, ERIC.doNotProgram), { ...ERIC, suggestedSubs: [] });
  assertEquals(o2.weeks[0].days[0].blocks[3].movements.map((m: Any) => m.movement), ["Hip Flexor Stretch"]); // run removed, stretch kept
  assertEquals(o2.weeks[0].days[1].blocks.length, 0); // a block that was only the run is dropped
});

Deno.test("removing a station from an EMOM keeps its map and minutes consistent", () => {
  const o = week();
  takeOutByRule(o, [{ week_num: 1, day_num: 1, block_index: 2, movement_index: 1, movement: "Shuttle Run" }], { ...ERIC, suggestedSubs: [] });
  const b = o.weeks[0].days[0].blocks[2];
  assertEquals(b.movements.map((m: Any) => m.movement), ["Row", "Push Up"]);
  assertEquals(b.scheme_format.stations, [[0], [1]]);
  assertEquals(b.scheme_format.minutes % 2, 0);
});

Deno.test("GATE — Eric's week: the judge catches the shuttle run by meaning, every run is gone, the week still ships", async () => {
  const o = week();
  let calls = 0;
  const judge = (out: Any) => {
    calls++;
    const f: Finding[] = [];
    out.weeks[0].days.forEach((d: Any) => d.blocks.forEach((b: Any, bi: number) => b.movements.forEach((m: Any, mi: number) => {
      if (/run/i.test(m.movement)) f.push({ week_num: 1, day_num: d.day_num, block_index: bi, movement_index: mi, movement: m.movement, reason: "runner's knee: no running", replacement: { movement: "Bike", time_seconds: 120 } });
    })));
    return Promise.resolve(f);
  };
  const rep = await runRestrictionGate(o, ERIC, { judge });
  const all = names(o).flat(2);
  assert(!all.some((n: string) => /run/i.test(n)), `runs remain: ${all}`);
  assertEquals(rep.actions.length, 3);
  assertEquals(calls, 2); // read, fixed, read again and found clean
  assertEquals(o.weeks[0].days[0].blocks.length, 4); // nothing withheld
  assertEquals(o.weeks[0].days[0].blocks[2].scheme_format.stations, [[0], [1], [2]]); // structure intact
});

Deno.test("GATE — judge unreachable: the avoid-list names still come out, and it never throws", async () => {
  const o = week();
  const rep = await runRestrictionGate(o, ERIC, { judge: () => Promise.resolve(null) });
  assert(rep.judgeUnavailable);
  assertEquals(nameHits(o, ERIC.doNotProgram), []);
  const o2 = week();
  const rep2 = await runRestrictionGate(o2, ERIC, { judge: () => Promise.reject(new Error("network down")) });
  assert(rep2.judgeUnavailable);
  assertEquals(nameHits(o2, ERIC.doNotProgram), []);
});

Deno.test("GATE — a judge that keeps offering bad replacements cannot leave the movement in", async () => {
  const o = week();
  const stubborn = (out: Any) => Promise.resolve(
    out.weeks[0].days[0].blocks[2].movements.some((m: Any) => m.movement === "Shuttle Run")
      ? [{ week_num: 1, day_num: 1, block_index: 2, movement_index: 1, movement: "Shuttle Run", reason: "running", replacement: { movement: "Sprint" } }]
      : [],
  );
  await runRestrictionGate(o, ERIC, { judge: stubborn });
  assert(!names(o).flat(2).includes("Shuttle Run"));
});

Deno.test("GATE — no injury text: no AI call; equipment-only avoid list is still enforced by name", async () => {
  const o = week();
  let calls = 0;
  const rep = await runRestrictionGate(o, { injuriesText: "None", doNotProgram: ["Row"], suggestedSubs: [], vocabulary: VOCAB }, { judge: () => { calls++; return Promise.resolve([]); } });
  assertEquals(calls, 0); assertEquals(rep.reviews, 0);
  assert(!names(o).flat(2).includes("Row"));
  assert(names(o).flat(2).includes("Run")); // nothing rules running out for this athlete
});

Deno.test("GATE — a clean week is left exactly as written, after one reading", async () => {
  const o = week(); const before = JSON.stringify(o);
  let calls = 0;
  const rep = await runRestrictionGate(o, { ...ERIC, injuriesText: "Sore left wrist", doNotProgram: [] }, { judge: () => { calls++; return Promise.resolve([]); } });
  assertEquals(JSON.stringify(o), before); assertEquals(rep.actions, []); assertEquals(calls, 1);
});
