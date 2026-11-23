// deno test supabase/functions/_shared/fit-gate_test.ts --no-check --allow-env
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyLoadArithmetic, applyLoadFixes, applyTimeTrims, ceilingFor, EFFORT_NOTE, fitBlock, fitJudgeMessage,
  type FitProfile, type FitVerdict, liftLevelsFor, roundDownToPlate, runFitGate,
} from "./fit-gate.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

// A beginner by bodyweight: 100 kg squat at 87 kg. Month plan: week 4 is the deload.
const LIFTS = { back_squat: 100, deadlift: 140, bench_press: 80, press: 50, front_squat: 85, snatch: 60, clean: null, power_clean: null };
const BEN: FitProfile = {
  units: "kg",
  lifts: LIFTS,
  liftLevels: liftLevelsFor({ lifts: LIFTS, bodyweight: 87, gender: "male", age: 37 }),
  equipment: { barbell: true, rower: false, rings: true, assault_bike: true, ski_erg: true },
  skills: { strict_hspu: "beginner", muscle_ups: "none", toes_to_bar: "advanced" },
  sessionMinutes: 60,
  deloadWeeks: [4],
  conditioning: {},
  vocabulary: ["Back Squat", "Front Squat", "Power Clean", "Hang Power Clean", "Row", "Bike", "Ski Erg", "Ring Muscle Up", "Ring Row", "Push Up", "Strict HSPU", "Pike Push Up", "Run"],
  avoidNames: ["Run"],
};
const NONE: FitVerdict = { swaps: [], loads: [], days: [], trims: [] };
const fits = () => Promise.resolve(NONE);

const day = (blocks: Any[], week = 1): Any => ({ weeks: [{ week_num: week, days: [{ day_num: 1, blocks }] }] });
const strength = (movement: string, weight: number | undefined, extra: Any = {}) =>
  ({ block_type: "strength", scheme_format: { format: "straight_sets", rest_seconds: 150 }, movements: [{ movement, sets: 5, reps: 5, weight, weight_unit: "kg", ...extra }] });
const first = (o: Any, b = 0) => o.weeks[0].days[0].blocks[b].movements[0];

Deno.test("levels are worked out from the lift against bodyweight; lifts without their own row take another's", () => {
  assertEquals(BEN.liftLevels.back_squat, "beginner");
  assertEquals(BEN.liftLevels.front_squat, BEN.liftLevels.back_squat); // takes the squat's
  assertEquals(BEN.liftLevels.push_press, BEN.liftLevels.press); // takes the press's
});

Deno.test("the ceiling table as agreed: squat 75/85/92, deadlift 78/85/90, bench and press 75/85/90, deload at 80%", () => {
  const at = (lift: string, level: Any, week = 1) => ceilingFor(lift, { ...BEN, liftLevels: { ...BEN.liftLevels, [lift]: level } }, week);
  assertEquals([at("back_squat", "beginner"), at("back_squat", "intermediate"), at("back_squat", "advanced")], [0.75, 0.85, 0.92]);
  assertEquals([at("deadlift", "beginner"), at("deadlift", "intermediate"), at("deadlift", "advanced")], [0.78, 0.85, 0.90]);
  assertEquals([at("bench_press", "advanced"), at("press", "advanced")], [0.90, 0.90]);
  assertEquals(at("snatch", "advanced"), 0.92); // an Olympic lift takes the squat's row
  assertEquals(at("push_press", "intermediate"), 0.85); // takes the press's row
  assertEquals(at("back_squat", "beginner", 4), 0.75 * 0.8); // deload week
  assertEquals(at("back_squat", null), 0.75); // level unknown: the careful end
  assertEquals(ceilingFor("kettlebell_swing", BEN, 1), null); // no rule for it
});

Deno.test("plates: a lowered weight always lands on a loadable weight below the limit", () => {
  assertEquals(roundDownToPlate(76.9, "kg"), 75);
  assertEquals(roundDownToPlate(75, "kg"), 75);
  assertEquals(roundDownToPlate(167, "lbs"), 165);
  assertEquals(roundDownToPlate(1, "kg"), 2.5);
});

Deno.test("LOADS — a beginner's squat written at 90% is lowered to the 75% ceiling", () => {
  const o = day([strength("Back Squat", 90, { target_pct_1rm: 90 })]);
  const acts = applyLoadArithmetic(o, BEN);
  assertEquals(first(o).weight, 75);
  assertEquals(first(o).target_pct_1rm, 75);
  assertEquals(acts.length, 1);
});

Deno.test("LOADS — the real first session: 90 kg squat for a 120 kg max in week one stays (75% is the ceiling for his level)", () => {
  const ben = { ...BEN, lifts: { ...LIFTS, back_squat: 120 }, liftLevels: { ...BEN.liftLevels, back_squat: "beginner" as const } };
  const o = day([strength("Back Squat", 90, { target_pct_1rm: 75 })]);
  assertEquals(applyLoadArithmetic(o, ben), []);
  assertEquals(first(o).weight, 90);
});

Deno.test("LOADS — a deload week uses 80% of the ceiling", () => {
  const o = day([strength("Back Squat", 75)], 4);
  applyLoadArithmetic(o, BEN);
  assertEquals(first(o).weight, 60); // 100 × 0.75 × 0.8
});

Deno.test("LOADS — a weight far above the percentage written beside it follows the percentage", () => {
  const o = day([strength("Deadlift", 105, { target_pct_1rm: 60 })]); // 60% of 140 = 84
  applyLoadArithmetic(o, BEN);
  assertEquals(first(o).weight, 82.5);
});

Deno.test("LOADS — a planned max attempt is left alone; a weight within the ceiling is left alone", () => {
  const attempt = day([{ ...strength("Back Squat", 102.5), block_notes: "Build to a new 1RM attempt" }]);
  assertEquals(applyLoadArithmetic(attempt, BEN), []);
  const fine = day([strength("Back Squat", 70)]);
  assertEquals(applyLoadArithmetic(fine, BEN), []);
  assertEquals(first(fine).weight, 70);
});

Deno.test("LOADS — an empty bar is never 'too heavy', however small the max", () => {
  const o = day([strength("Overhead Squat", 20)]);
  assertEquals(applyLoadArithmetic(o, { ...BEN, lifts: { ...LIFTS, overhead_squat: 22.5 } }), []);
  assertEquals(first(o).weight, 20);
});

Deno.test("NO MAX — a named lift with no max on file loses its number and is prescribed by effort", () => {
  const o = day([strength("Power Clean", 70, { target_pct_1rm: 80 })]);
  applyLoadArithmetic(o, BEN);
  const m = first(o);
  assertEquals([m.weight, m.weight_unit, m.target_pct_1rm], [undefined, undefined, undefined]);
  assertEquals(m.scaling_note, EFFORT_NOTE);
  assertEquals(m.rpe, 8);
  assertEquals([m.sets, m.reps], [5, 5]); // the work itself is unchanged
});

Deno.test("the judge is given the athlete's file: maxes, levels, ceilings, equipment, skills, time and benchmarks", () => {
  const msg = fitJudgeMessage(day([strength("Back Squat", 70)]), BEN, { checkTime: true });
  assert(msg.includes('"back_squat":100') && msg.includes("back squat: beginner 75%, intermediate 85%, advanced 92%"));
  assert(msg.includes("UNTICKED (do not use): rower"));
  assert(msg.includes("limit is 60 minutes") && msg.includes("may run to 66 minutes") && msg.includes("Never drop a whole block"));
  assert(msg.includes("Conditioning benchmarks on file: NONE"));
  assert(msg.includes('"load":"checked"')); // named lifts are marked as settled
  const allowed = msg.split("ALLOWED MOVEMENTS")[1].split("\n")[0];
  assert(!/\bRun\b/.test(allowed)); // a replacement can never be something the injuries rule out
  assert(fitJudgeMessage(day([]), { ...BEN, sessionMinutes: 40 }, { checkTime: true }).includes("accessory block may be dropped whole"));
  assert(fitJudgeMessage(day([]), BEN, { checkTime: false }).includes("TIME: not checked"));
});

Deno.test("SAFE DIRECTION — a judge can lower a weight but can never raise one", () => {
  const o = day([{ block_type: "accessory", movements: [{ movement: "Hang Power Clean", sets: 3, reps: 5, weight: 70, weight_unit: "kg", target_pct_1rm: 80 }] }]);
  const loc = { week_num: 1, day_num: 1, block_index: 0, movement_index: 0, movement: "Hang Power Clean", reason: "x" };
  assertEquals(applyLoadFixes(o, [{ ...loc, new_weight: 95 }], BEN), []);
  assertEquals(first(o).weight, 70);
  applyLoadFixes(o, [{ ...loc, new_weight: 52 }], BEN);
  assertEquals(first(o).weight, 50);
  assertEquals(first(o).target_pct_1rm, undefined);
  applyLoadFixes(o, [{ ...loc, by_effort: true }], BEN);
  assertEquals([first(o).weight, first(o).scaling_note], [undefined, EFFORT_NOTE]);
});

Deno.test("PACE — with no benchmarks on file a pace note is replaced by an effort cue; the distance stays", () => {
  const o = day([{ block_type: "metcon", movements: [{ movement: "Bike", calories: 20, scaling_note: "Hold 65 RPM / 1:45 per 500" }] }]);
  applyLoadFixes(o, [{ week_num: 1, day_num: 1, block_index: 0, movement_index: 0, movement: "Bike", reason: "no benchmarks", effort_note: "Hard but repeatable." }], BEN);
  assertEquals(first(o), { movement: "Bike", calories: 20, scaling_note: "Hard but repeatable." });
});

const longDay = () => day([
  { block_type: "warm-up", movements: [{ movement: "Bike", time_seconds: 300 }] },
  { block_type: "strength", scheme_format: { format: "straight_sets", rest_seconds: 180 }, movements: [{ movement: "Back Squat", sets: 6, reps: 5, rep_scheme: [5, 5, 5, 5, 5, 5], weight: 70, weight_unit: "kg" }, { movement: "Push Up", sets: 3, reps: 10 }] },
  { block_type: "accessory", movements: [{ movement: "Ring Row", sets: 4, reps: 10 }, { movement: "Push Up", sets: 4, reps: 12 }] },
  { block_type: "metcon", scheme_format: { format: "amrap", minutes: 20 }, time_cap_seconds: 1200, movements: [{ movement: "Bike", calories: 12 }] },
]);
const T = (block_index: number, op: Any, extra: Any = {}) => ({ week_num: 1, day_num: 1, block_index, op, reason: "over the limit", ...extra });

Deno.test("TIME — trims only ever shorten: fewer sets, shorter metcon, less rest", () => {
  const o = longDay();
  const acts = applyTimeTrims(o, [T(1, "set_sets", { movement_index: 0, value: 4 }), T(3, "set_minutes", { value: 14 }), T(1, "set_rest", { value: 120 })], BEN);
  const b = o.weeks[0].days[0].blocks;
  assertEquals([b[1].movements[0].sets, b[1].movements[0].rep_scheme], [4, [5, 5, 5, 5]]);
  assertEquals([b[3].scheme_format.minutes, b[3].time_cap_seconds], [14, 840]);
  assertEquals(b[1].scheme_format.rest_seconds, 120);
  assertEquals(acts.length, 3);
});

Deno.test("TIME — anything that would lengthen a day, or gut it, is ignored", () => {
  const o = longDay(); const before = JSON.stringify(o);
  const acts = applyTimeTrims(o, [
    T(1, "set_sets", { movement_index: 0, value: 8 }), // more sets
    T(3, "set_minutes", { value: 30 }), // longer
    T(1, "set_rest", { value: 240 }), // more rest
    T(1, "set_rest", { value: 10 }), // rest cut to nothing
    T(1, "drop_movement", { movement_index: 0 }), // the day's main lift
    T(3, "drop_movement", { movement_index: 0 }), // a block's only movement
    T(2, "drop_block"), // 60-minute athlete: no block may be dropped
    T(1, "drop_block"), T(3, "drop_block"),
  ], BEN);
  assertEquals(acts, []);
  assertEquals(JSON.stringify(o), before);
});

Deno.test("TIME — under 45 minutes the accessory block may be dropped, and only that block", () => {
  const short = { ...BEN, sessionMinutes: 40 };
  const o = longDay();
  applyTimeTrims(o, [T(2, "drop_block"), T(1, "drop_block"), T(3, "drop_block")], short);
  assertEquals(o.weeks[0].days[0].blocks.map((b: Any) => b.block_type), ["warm-up", "strength", "metcon"]);
});

Deno.test("GATE — Ben's first session: 80-minute day brought inside 66, and the gate stops once it fits", async () => {
  const o = longDay();
  let calls = 0;
  const judge = (out: Any) => {
    calls++;
    const sets = out.weeks[0].days[0].blocks[1].movements[0].sets;
    return Promise.resolve(sets > 4
      ? { ...NONE, days: [{ week_num: 1, day_num: 1, estimated_minutes: 82 }], trims: [T(1, "set_sets", { movement_index: 0, value: 4 }), T(3, "set_minutes", { value: 12 })] }
      : { ...NONE, days: [{ week_num: 1, day_num: 1, estimated_minutes: 63 }], trims: [T(3, "set_minutes", { value: 8 })] }); // 63 ≤ 66: nothing more is cut
  };
  const rep = await runFitGate(o, BEN, { judge });
  const b = o.weeks[0].days[0].blocks;
  assertEquals([b[1].movements[0].sets, b[3].scheme_format.minutes], [4, 12]);
  assertEquals(calls, 2);
  assertEquals(rep.actions.length, 2);
});

Deno.test("GATE — a day inside the limit is never trimmed, whatever trims the judge sends", async () => {
  const o = longDay(); const before = JSON.stringify(o);
  await runFitGate(o, BEN, { judge: () => Promise.resolve({ ...NONE, days: [{ week_num: 1, day_num: 1, estimated_minutes: 58 }], trims: [T(3, "set_minutes", { value: 5 })] }) });
  assertEquals(JSON.stringify(o), before);
});

Deno.test("GATE — equipment: a row for an athlete with no rower is swapped; skill: a muscle-up for 'none' is swapped", async () => {
  const o = day([{ block_type: "metcon", movements: [{ movement: "Row", calories: 15 }, { movement: "Ring Muscle Up", rep_scheme: [3] }] }]);
  const judge = (out: Any) => {
    const ms = out.weeks[0].days[0].blocks[0].movements;
    const swaps: Any[] = [];
    ms.forEach((m: Any, i: number) => {
      if (m.movement === "Row") swaps.push({ week_num: 1, day_num: 1, block_index: 0, movement_index: i, movement: "Row", kind: "equipment", reason: "rower unticked", replacement: { movement: "Bike" } });
      if (m.movement === "Ring Muscle Up") swaps.push({ week_num: 1, day_num: 1, block_index: 0, movement_index: i, movement: "Ring Muscle Up", kind: "skill", reason: "rated none", replacement: { movement: "Ring Row" } });
    });
    return Promise.resolve({ ...NONE, swaps });
  };
  await runFitGate(o, BEN, { judge });
  assertEquals(o.weeks[0].days[0].blocks[0].movements.map((m: Any) => m.movement), ["Bike", "Ring Row"]);
});

Deno.test("GATE — a replacement the athlete's injuries rule out is refused; unticked equipment with no usable swap is removed", async () => {
  const o = day([{ block_type: "metcon", movements: [{ movement: "Row", calories: 15 }, { movement: "Push Up", rep_scheme: [10] }] }]);
  const judge = (out: Any) => Promise.resolve(out.weeks[0].days[0].blocks[0].movements.some((m: Any) => m.movement === "Row")
    ? { ...NONE, swaps: [{ week_num: 1, day_num: 1, block_index: 0, movement_index: 0, movement: "Row", kind: "equipment" as const, reason: "no rower", replacement: { movement: "Run" } }] }
    : NONE);
  await runFitGate(o, BEN, { judge }); // "Run" is on his avoid list
  assertEquals(o.weeks[0].days[0].blocks[0].movements.map((m: Any) => m.movement), ["Push Up"]);
});

Deno.test("GATE — AI unreachable: the week still comes back, with the arithmetic rules applied", async () => {
  const o = day([strength("Back Squat", 95), strength("Power Clean", 60)]);
  const rep = await runFitGate(o, BEN, { judge: () => Promise.resolve(null) });
  assert(rep.judgeUnavailable);
  assertEquals(first(o, 0).weight, 75);
  assertEquals(first(o, 1).scaling_note, EFFORT_NOTE);
  const o2 = day([strength("Back Squat", 95)]);
  await runFitGate(o2, BEN, { judge: () => Promise.reject(new Error("down")) }); // never throws
  assertEquals(first(o2).weight, 75);
});

Deno.test("GATE — a week that fits is returned exactly as written", async () => {
  const o = day([strength("Back Squat", 70, { target_pct_1rm: 70 })]); const before = JSON.stringify(o);
  const rep = await runFitGate(o, BEN, { judge: fits });
  assertEquals(JSON.stringify(o), before); assertEquals(rep.actions, []);
});

Deno.test("COACH EDIT — one block: loads, equipment and skill are checked; time is not", async () => {
  let askedTime: boolean | null = null;
  const judge = (_o: Any, _p: Any, opts: Any) => { askedTime = opts.checkTime; return Promise.resolve(NONE); };
  const g = await fitBlock(strength("Back Squat", 95), BEN, { judge });
  assertEquals(askedTime, false);
  assertEquals(g.block!.movements![0].weight, 75);
  assert(g.actions[0].startsWith('"Back Squat"'));
  const deload = await fitBlock(strength("Back Squat", 95), BEN, { judge, deloadWeek: true });
  assertEquals(deload.block!.movements![0].weight, 60);
});
