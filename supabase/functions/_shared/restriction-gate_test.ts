// deno test supabase/functions/_shared/restriction-gate_test.ts --no-check --allow-env
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyFindings, athleteWordsElsewhere, type Finding, hasInjuryText, judgeUserMessage,
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

Deno.test("no code matches movement names against the avoid list (removed 2026-11-26)", () => {
  const src = Deno.readTextFileSync(new URL("./restriction-gate.ts", import.meta.url));
  const code = src.slice(src.indexOf("import type"));
  for (const gone of ["plainName", "isRuledOutByName", "nameHits", "bannedPlainSet", "function canonical", "QUANTITY_TOKEN", "Second look"]) {
    assert(!code.includes(gone), `${gone} is back in restriction-gate.ts`);
  }
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

Deno.test("the judge is given the athlete's words and the whole movement list as spellings; no name is hidden from it", () => {
  const msg = judgeUserMessage(week(), ERIC);
  assert(msg.includes("Runners Knee"));
  assert(!msg.includes("ALLOWED MOVEMENTS"));
  const list = msg.split("MOVEMENT NAMES")[1].split("\n")[0];
  for (const name of VOCAB) assert(list.includes(name), `${name} missing from the list given to the judge`);
  assert(list.includes("you may name a movement that is not on it"));
  assert(list.includes("You decide what the athlete can do"));
});

Deno.test("a judge's replacement is applied; load and percentage do not carry over", () => {
  const o = week();
  const f: Finding[] = [
    { week_num: 1, day_num: 1, block_index: 1, movement_index: 0, movement: "Goblet Squat", reason: "deep knee flexion", replacement: { movement: "Glute Bridge" } },
    { week_num: 1, day_num: 1, block_index: 3, movement_index: 0, movement: "Run", reason: "no running", replacement: { movement: "Bike", time_seconds: 180 } },
  ];
  const { applied, unresolved } = applyFindings(o, f, ERIC);
  assertEquals(applied.length, 2); assertEquals(unresolved.length, 0);
  assertEquals(o.weeks[0].days[0].blocks[1].movements[0], { movement: "Glute Bridge", sets: 4, reps: 8 });
  assertEquals(o.weeks[0].days[0].blocks[3].movements[0], { movement: "Bike", time_seconds: 180, scaling_note: "Easy pace" });
});

Deno.test("the judge's replacement is applied as given: off the movement list, or a name on the avoid list, code does not refuse it", () => {
  const o = week();
  const f: Finding[] = [
    { week_num: 1, day_num: 1, block_index: 3, movement_index: 0, movement: "Run", reason: "x", replacement: { movement: "Treadmill Walk" } }, // not on the movement list
    { week_num: 1, day_num: 2, block_index: 0, movement_index: 0, movement: "Easy Jog", reason: "x", replacement: { movement: "Walking Lunge" } }, // echoed name differs from the row; replacement is on the avoid list
    { week_num: 1, day_num: 1, block_index: 9, movement_index: 0, movement: "Run", reason: "x", replacement: { movement: "Bike" } }, // no such block: skipped
  ];
  const { applied, unresolved } = applyFindings(o, f);
  assertEquals(applied.length, 2);
  assertEquals(unresolved.length, 0);
  assertEquals(o.weeks[0].days[0].blocks[3].movements[0].movement, "Treadmill Walk");
  assertEquals(o.weeks[0].days[1].blocks[0].movements[0].movement, "Walking Lunge");
  assert(applied[1].includes('"Run" replaced with "Walking Lunge"')); // the log names what was really there
});

Deno.test("a finding with no replacement named, or naming what is already there, is unresolved and changes nothing", () => {
  const o = week();
  const f: Finding[] = [
    { week_num: 1, day_num: 1, block_index: 3, movement_index: 0, movement: "Run", reason: "x", replacement: { movement: "  " } },
    { week_num: 1, day_num: 2, block_index: 0, movement_index: 0, movement: "Run", reason: "x", replacement: { movement: "run" } },
    { week_num: 1, day_num: 1, block_index: 0, movement_index: 0, movement: "Bike", reason: "x", replacement: null },
  ];
  const { applied, unresolved } = applyFindings(o, f);
  assertEquals([applied.length, unresolved.length], [0, 3]);
  assertEquals(names(o), names(week()));
});

Deno.test("the last resort removes; a block that was only the banned movement is dropped", () => {
  const o = week();
  const acts = removeByRule(o, [
    { week_num: 1, day_num: 1, block_index: 3, movement_index: 0, movement: "Run" },
    { week_num: 1, day_num: 2, block_index: 0, movement_index: 0, movement: "Run" },
    { week_num: 1, day_num: 2, block_index: 0, movement_index: 0, movement: "Run" }, // the same position twice is removed once
  ]);
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

Deno.test("GATE — judge unreachable: the week ships exactly as written, and it never throws", async () => {
  const o = week(); const before = JSON.stringify(o);
  const rep = await runRestrictionGate(o, ERIC, { judge: () => Promise.resolve(null) });
  assert(rep.judgeUnavailable);
  assertEquals([JSON.stringify(o), rep.actions], [before, []]);
  const o2 = week();
  const rep2 = await runRestrictionGate(o2, ERIC, { judge: () => Promise.reject(new Error("network down")) });
  assert(rep2.judgeUnavailable);
  assertEquals(JSON.stringify(o2), before);
});

Deno.test("GATE — a movement the judge flags but never names a replacement for is asked about once more, then removed", async () => {
  const o = week();
  const asked: Any[] = [];
  const stubborn = (out: Any, _r: Any, must?: Any[]) => {
    asked.push(must ?? null);
    return Promise.resolve(
      out.weeks[0].days[0].blocks[2].movements[1]?.movement === "Shuttle Run"
        ? [{ week_num: 1, day_num: 1, block_index: 2, movement_index: 1, movement: "Shuttle Run", reason: "running", replacement: { movement: "" } }]
        : [],
    );
  };
  const rep = await runRestrictionGate(o, ERIC, { judge: stubborn });
  assert(!names(o).flat(2).includes("Shuttle Run"));
  assertEquals(asked.length, 2); // the reading, then the one more ask
  assertEquals(asked[1].map((m: Any) => m.movement), ["Shuttle Run"]);
  assert(rep.actions[0].includes('"Shuttle Run" removed'));
  // Nothing the judge did not flag was touched: the runs it did not name are still there.
  assertEquals(names(o).flat(2).filter((n: string) => n === "Run").length, 2);
});

Deno.test("GATE — on the second ask the judge's choice is applied, and only for the movements it was asked about", async () => {
  const o = week();
  const judge = (_o: Any, _r: Any, must?: Any[]) => {
    if (!must) return Promise.resolve([{ week_num: 1, day_num: 1, block_index: 3, movement_index: 0, movement: "Run", reason: "no running", replacement: { movement: "" } }]);
    return Promise.resolve([
      { ...must[0], reason: "no running", replacement: { movement: "Bike", time_seconds: 240 } },
      { week_num: 1, day_num: 1, block_index: 0, movement_index: 0, movement: "Bike", reason: "unasked", replacement: { movement: "Row" } },
    ]);
  };
  await runRestrictionGate(o, ERIC, { judge });
  assertEquals(o.weeks[0].days[0].blocks[3].movements[0], { movement: "Bike", time_seconds: 240, scaling_note: "Easy pace" });
  assertEquals(o.weeks[0].days[0].blocks[0].movements[0].movement, "Bike"); // the unasked finding was not applied
});

Deno.test("GATE — never skipped: an empty injury box is still read; a name on the avoid list the judge does not flag stays", async () => {
  const o = week(); const before = JSON.stringify(o);
  let readings = 0;
  const rep = await runRestrictionGate(o, { injuriesText: "None", doNotProgram: ["Row"], suggestedSubs: [], vocabulary: VOCAB }, { judge: () => { readings++; return Promise.resolve([]); } });
  assertEquals(readings, 1);
  assertEquals(rep.actions, []);
  assertEquals(JSON.stringify(o), before); // "Row" is on the list; only the judge decides, and it flagged nothing
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
