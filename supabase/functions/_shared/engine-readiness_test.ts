// deno test supabase/functions/_shared/engine-readiness_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeReadyDayTypes, missingPrerequisites, sequencerGate, thinDataNote, validateWeekRules, type ReadinessTypeRow } from "./engine-readiness.ts";

const T: ReadinessTypeRow[] = [
  { id: "time_trial", class: "assess", prerequisites: [] },
  { id: "endurance", class: "develop", prerequisites: [] },
  { id: "max_aerobic_power", class: "develop", prerequisites: [] },
  { id: "threshold", class: "develop", prerequisites: [] },
  { id: "anaerobic", class: "develop", prerequisites: [] },
  { id: "polarized", class: "develop", prerequisites: [] },
  { id: "flux", class: "develop", prerequisites: ["endurance", "threshold"] },
  { id: "ascending", class: "develop", prerequisites: ["anaerobic"] },
  { id: "devour", class: "develop", prerequisites: ["anaerobic", "max_aerobic_power"] },
  { id: "towers", class: "develop", prerequisites: ["devour", "max_aerobic_power"] },
  { id: "rocket_races_a", class: "develop", prerequisites: ["max_aerobic_power"] },
  { id: "rocket_races_b", class: "assess", prerequisites: ["rocket_races_a"] },
  { id: "infinity", class: "assess", prerequisites: ["devour"] },
  { id: "synthesis", class: "assess", prerequisites: ["devour"] },
];
const classById = new Map(T.map((t) => [t.id, t.class]));

Deno.test("a fresh athlete is ready for tier-1 types and the time trial only", () => {
  const r = computeReadyDayTypes(T, {});
  assertEquals([...r].sort(), ["anaerobic", "endurance", "max_aerobic_power", "polarized", "threshold", "time_trial"]);
});

Deno.test("prerequisites need two completions each, any ratio, across modalities", () => {
  assertEquals(computeReadyDayTypes(T, { endurance: 2, threshold: 1 }).has("flux"), false);
  assertEquals(computeReadyDayTypes(T, { endurance: 2, threshold: 2 }).has("flux"), true);
  assertEquals(computeReadyDayTypes(T, { anaerobic: 2 }).has("ascending"), true);
  assertEquals(computeReadyDayTypes(T, { anaerobic: 2, max_aerobic_power: 1 }).has("devour"), false);
});

Deno.test("after a 3-day assessment month, depth not breadth: tier-2 opens, tier-3 chains do not", () => {
  const afterMonthOne = { time_trial: 1, anaerobic: 4, max_aerobic_power: 4, endurance: 3 };
  const r = computeReadyDayTypes(T, afterMonthOne);
  assertEquals(r.has("ascending"), true);       // anaerobic x4
  assertEquals(r.has("devour"), true);          // anaerobic + MAP
  assertEquals(r.has("rocket_races_a"), true);  // MAP
  assertEquals(r.has("flux"), false);           // threshold not in the 3-day month one
  assertEquals(r.has("towers"), false);         // devour not yet completed twice
  assertEquals(r.has("infinity"), false);
});

Deno.test("missingPrerequisites explains the gap", () => {
  assertEquals(missingPrerequisites(T[9], { devour: 1, max_aerobic_power: 5 }), ["devour (1/2)"]);
});

Deno.test("rocket races pairing: A needs B after it in the same block, and vice versa", () => {
  assertEquals(validateWeekRules([{ day_type: "rocket_races_a" }, { day_type: "endurance" }], classById).length, 1);
  assertEquals(validateWeekRules([{ day_type: "rocket_races_b" }], classById).length, 1);
  assertEquals(validateWeekRules([{ day_type: "rocket_races_b" }, { day_type: "rocket_races_a" }], classById).length, 1);
  assertEquals(validateWeekRules([{ day_type: "rocket_races_a" }, { day_type: "endurance" }, { day_type: "rocket_races_b" }], classById), []);
});

Deno.test("at most one assessment day per block, time trial and rocket B excepted", () => {
  assertEquals(validateWeekRules([{ day_type: "infinity" }, { day_type: "synthesis" }], classById).length, 1);
  assertEquals(validateWeekRules([{ day_type: "time_trial" }, { day_type: "infinity" }, { day_type: "endurance" }], classById), []);
});

Deno.test("gate: closed for the whole assessment month, whatever the data", () => {
  assertEquals(sequencerGate(1).ok, false);
});

Deno.test("gate: opens when the next block lies in month 2 or later, including a mid-program subscriber", () => {
  assertEquals(sequencerGate(2).ok, true);
  assertEquals(sequencerGate(7).ok, true);
});

Deno.test("gate: a program with no mapping is a data error — closed, and the reason says so", () => {
  const r = sequencerGate(null);
  assertEquals(r.ok, false);
  assertEquals(r.reason.includes("no mapping"), true);
});

Deno.test("gate: month 0 / NaN close and report the value", () => {
  assertEquals(sequencerGate(0).reason.includes("month 0"), true);
  assertEquals(sequencerGate(Number.NaN).ok, false);
});

Deno.test("thinDataNote names short month-one types and ignores the time trial; null when nothing is short", () => {
  assertEquals(thinDataNote({ anaerobic: 4, max_aerobic_power: 4, endurance: 1 }, ["time_trial", "anaerobic", "max_aerobic_power", "endurance"]), "thin data: endurance 1/2");
  assertEquals(thinDataNote({ anaerobic: 2, endurance: 2 }, ["time_trial", "anaerobic", "endurance"]), null);
});
