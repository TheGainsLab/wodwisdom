// deno test supabase/functions/_shared/restriction-gate_test.ts --no-check --allow-env
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyFindings, athleteWordsElsewhere, type Finding, hasInjuryText, isRuledOutByName, judgeUserMessage, nameHits, plainName,
  removeByRule, type Restrictions, restrictionsForPrompt, runRestrictionGate,
} from "./restriction-gate.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

const VOCAB = ["Run", "Shuttle Run", "Bike", "Row", "Ring Row", "Walking Lunge", "Goblet Squat", "Back Squat", "Glute Bridge", "Hip Flexor Stretch", "Push Up", "Box Jump", "Step Up"];

// The real case: runner's knee, a confirmed list that says "running", a program that says "Run".
const ERIC: Restrictions = {
  injuriesText: "Runners Knee, no lunges or back squats",
  doNotProgram: ["running", "100m run", "400m run", "mile run", "back squat", "lunge", "walking lunge", "box jump"],
  // As really stored: phrases, not catalogue names.
  suggestedSubs: [{ instead_of: "Running", use: "Row (Concept2) or Bike Erg (low resistance, flat foot)" }, { instead_of: "Back Squat", use: "Seated Leg Press (if available) or Sled Push" }],
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

Deno.test("the last resort removes; a block that was only the banned movement is dropped", () => {
  const o = week();
  const acts = removeByRule(o, nameHits(o, ERIC.doNotProgram));
  assertEquals(acts.length, 2);
  assertEquals(o.weeks[0].days[0].blocks[3].movements.map((m: Any) => m.movement), ["Hip Flexor Stretch"]); // run removed, stretch kept
  assertEquals(o.weeks[0].days[1].blocks.length, 0);
});

Deno.test("stored substitutes reach the AI as guidance; known conflicts are handed to it by location", () => {
  const msg = judgeUserMessage(week(), ERIC, [{ week_num: 1, day_num: 2, block_index: 0, movement_index: 0, movement: "Run" }]);
  assert(msg.includes("Running → Row (Concept2) or Bike Erg (low resistance, flat foot)"));
  assert(msg.includes('ALREADY KNOWN') && msg.includes('week 1 day 2 block_index 0 movement_index 0 "Run"'));
});

Deno.test("removing a station from an EMOM keeps its map and minutes consistent", () => {
  const o = week();
  removeByRule(o, [{ week_num: 1, day_num: 1, block_index: 2, movement_index: 1, movement: "Shuttle Run" }]);
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

Deno.test("GATE — a name the second look spots is handed to the AI, which chooses the replacement", async () => {
  const o = week();
  const seen: Any[] = [];
  const judge = (_o: Any, _r: Any, must?: Any[]) => {
    seen.push(must ?? null);
    if (!must) return Promise.resolve([]); // the reading itself misses the runs
    return Promise.resolve(must.map((m) => ({ ...m, reason: "no running", replacement: { movement: "Bike", time_seconds: 240 } })));
  };
  await runRestrictionGate(o, ERIC, { judge });
  assertEquals(seen[seen.length - 1].map((m: Any) => m.movement), ["Run", "Run"]);
  assertEquals(o.weeks[0].days[0].blocks[3].movements[0], { movement: "Bike", time_seconds: 240, scaling_note: "Easy pace" });
  assertEquals(o.weeks[0].days[1].blocks[0].movements[0].movement, "Bike"); // swapped, not deleted
});

Deno.test("GATE — never skipped: an empty injury box is still read, and an avoid-list name still comes out", async () => {
  const o = week();
  let readings = 0;
  const rep = await runRestrictionGate(o, { injuriesText: "None", doNotProgram: ["Row"], suggestedSubs: [], vocabulary: VOCAB }, { judge: (_o: Any, _r: Any, must?: Any[]) => { if (!must) readings++; return Promise.resolve([]); } });
  assertEquals(readings, 1);
  assert(rep.actions.length === 1);
  assert(!names(o).flat(2).includes("Row"));
  assert(names(o).flat(2).includes("Run")); // nothing rules running out for this athlete
});

// The second real case: injury box empty, shoulder pain written under "anything else".
const BEN_INTAKE = {
  preferences: { loved: [], disliked: [], skill_goals: [], avoid: ["muscle-ups due to pain in shoulder"] },
  constraints: { injuries: ["shoulder pain on muscle-ups"], schedule_equipment_notes: null },
  response: { volume_tolerance: null, recovery_notes: null },
  freeform_notes: "Athlete wants to come away from muscle-ups due to shoulder pain.",
};

Deno.test("what the athlete said outside the injury box is collected in their words", () => {
  const w = athleteWordsElsewhere(BEN_INTAKE, ["more warm-up before strict gymnastics"]);
  assertEquals(w, [
    'Injuries or limitations (signup): "shoulder pain on muscle-ups"',
    'Avoiding (signup): "muscle-ups due to pain in shoulder"',
    'Anything else (signup): "Athlete wants to come away from muscle-ups due to shoulder pain."',
    'Note to the coach: "more warm-up before strict gymnastics"',
  ]);
  assertEquals(athleteWordsElsewhere(null, null), []);
});

Deno.test("GATE — Ben's case: injury box says None, the shoulder pain still reaches the writer and the judge", async () => {
  const words = athleteWordsElsewhere(BEN_INTAKE, []);
  const forWriter = restrictionsForPrompt("None", ["Ring Muscle Up"], words);
  assert(forWriter.includes("shoulder pain on muscle-ups") && forWriter.includes("an injury is not always written in the injury box"));
  assert(restrictionsForPrompt("None", [], words) !== ""); // stated even with no avoid list
  const o: Any = { weeks: [{ week_num: 1, days: [{ day_num: 1, blocks: [{ block_type: "skills", movements: [{ movement: "Strict HSPU", sets: 5, reps: 3 }] }] }] }] };
  let told = "";
  const judge = (out: Any, r: Any) => {
    told = judgeUserMessage(out, r);
    return Promise.resolve(out.weeks[0].days[0].blocks[0].movements[0].movement === "Strict HSPU"
      ? [{ week_num: 1, day_num: 1, block_index: 0, movement_index: 0, movement: "Strict HSPU", reason: "shoulder pain: no strict overhead skill work", replacement: { movement: "Push Up" } }]
      : []);
  };
  await runRestrictionGate(o, { injuriesText: "None", doNotProgram: ["Ring Muscle Up"], otherWords: words, suggestedSubs: [], vocabulary: [...VOCAB, "Strict HSPU"] }, { judge });
  assert(told.includes("shoulder pain on muscle-ups"));
  assertEquals(o.weeks[0].days[0].blocks[0].movements[0], { movement: "Push Up", sets: 5, reps: 3 });
});

Deno.test("GATE — a clean week is left exactly as written, after one reading", async () => {
  const o = week(); const before = JSON.stringify(o);
  let calls = 0;
  const rep = await runRestrictionGate(o, { ...ERIC, injuriesText: "Sore left wrist", doNotProgram: [] }, { judge: () => { calls++; return Promise.resolve([]); } });
  assertEquals(JSON.stringify(o), before); assertEquals(rep.actions, []); assertEquals(calls, 1);
});
