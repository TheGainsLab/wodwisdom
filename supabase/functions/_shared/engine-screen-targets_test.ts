// What the AI Coach is told about today's Engine targets: the athlete's
// screen, line by line, and that the screen is the authority.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanScreenTargets, screenTargetsBlock, screenTargetsKey } from "./engine-screen-targets.ts";
import { calculatePace, energySystemPaces, heartRate, machineUnit, workSeconds } from "./engine-analytics.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

const LINES = ["R1 2min: ~36 cal (18 cal/min)", "REST 1min", "R2 2min: ~40 cal (20 cal/min)", "R3 30s: Max Effort"];

Deno.test("the coach is given the screen's lines exactly, and told the screen is the authority", () => {
  const block = screenTargetsBlock(LINES, 19, "cal");
  for (const l of LINES) assert(block.includes(`  ${l}`), l);
  assert(block.includes("EXACTLY AS SHOWN ON THE ATHLETE'S SCREEN"));
  assert(block.includes("THE SCREEN IS THE AUTHORITY"));
  assert(block.includes("never blend them into one pace"));
  assert(block.includes("their screen is right"));
  // The average is not mentioned at all when the screen's lines are there.
  assert(!block.includes("19"));
});

Deno.test("the old instruction is gone: no single number is called authoritative or 'on the screen'", async () => {
  const chat = await Deno.readTextFile(new URL("../chat/index.ts", import.meta.url));
  assert(!chat.includes("This is the number on the athlete's screen"));
  assert(!chat.includes("AUTHORITATIVE): "));
  assert(!chat.includes("rather than proposing a different number"));
  assert(chat.includes("screenTargetsBlock(screenTargets, targetPace, selectedUnits)"));
  assert(chat.includes("cleanScreenTargets(engine_screen_targets)"));
  // A cached quick answer is keyed by the screen it was written for.
  assert(chat.includes("screenTargetsKey(engineScreenTargets)"));
});

Deno.test("an older copy of the app sends only an average: it is called an average, never the screen's number", () => {
  const block = screenTargetsBlock([], 18.456, "cal");
  assert(block.includes("AVERAGE TARGET: 18.46 cal/min"));
  assert(block.includes("This is NOT a number on the athlete's screen"));
  assert(block.includes("THE SCREEN IS THE AUTHORITY"));
  assert(block.includes("Never present it as the pace for a specific interval"));
  assertEquals(screenTargetsBlock([], null, "cal"), "");
});

Deno.test("what the page sends is bounded and made safe for a prompt", () => {
  assertEquals(cleanScreenTargets(null), []);
  assertEquals(cleanScreenTargets("R1 2min"), []);
  assertEquals(cleanScreenTargets(["  R1 2min:\n~36 cal ", 7, "", "REST 1min"]), ["R1 2min: ~36 cal", "REST 1min"]);
  assertEquals(cleanScreenTargets(Array.from({ length: 200 }, (_, i) => `R${i}`)).length, 80);
  assertEquals(cleanScreenTargets(["x".repeat(500)])[0].length, 160);
});

Deno.test("a cached answer belongs to one screen: different lines, different key", () => {
  assertEquals(screenTargetsKey(LINES), screenTargetsKey([...LINES]));
  assert(screenTargetsKey(LINES) !== screenTargetsKey([...LINES.slice(0, 3), "R3 30s: ~9 cal"]));
});

const session = (o: Any) => ({ date: "2026-11-01", day_type: "interval", modality: "echo_bike", units: "cal", actual_pace: 18, total_output: 180, performance_ratio: 1, ...o });

Deno.test("work time is read from the field the day page saves", () => {
  assertEquals(workSeconds(session({ workout_data: { total_work_time: 600 } })), 600);
  assertEquals(workSeconds(session({ workout_data: { total_work_seconds: 300 } })), 300);
  assertEquals(workSeconds(session({ workout_data: {} })), null);
  assertEquals(calculatePace(session({ actual_pace: null, total_output: 200, workout_data: { total_work_time: 600 } })), 20);
});

Deno.test("heart-rate Load grows with the session's length (it ignored duration)", () => {
  const trials = [{ modality: "echo_bike", units: "cal", date: "2026-10-01", calculated_rpm: 18 }];
  const load = (seconds: number) => heartRate([session({ average_heart_rate: 150, workout_data: { total_work_time: seconds } })], trials, "echo_bike")[0].training_load!;
  assertEquals(Math.round(load(600)), Math.round(150 * Math.sqrt(10)));
  assertEquals(Math.round(load(2400)), Math.round(150 * Math.sqrt(40)));
  assert(load(2400) > load(600));
});

Deno.test("a pace is only ever compared with a time trial in the same unit", () => {
  const trials = [
    { modality: "echo_bike", units: "cal", date: "2026-08-06", calculated_rpm: 20 },
    { modality: "echo_bike", units: "watts", date: "2026-10-25", calculated_rpm: 300 }, // the latest, in another unit
  ];
  const sessions = [
    session({ day_type: "anaerobic", actual_pace: 30 }),
    session({ day_type: "max_aerobic_power", actual_pace: 22 }),
    session({ day_type: "anaerobic", units: "watts", actual_pace: 450 }),
  ];
  assertEquals(machineUnit(sessions, trials, "echo_bike"), "cal");
  const p = energySystemPaces(sessions, trials, "echo_bike");
  assertEquals(p.units, "cal");
  assertEquals(p.glycolytic, 30 / 20); // not 30 ÷ 300, and the 450-watt session is left out
  assertEquals(p.aerobic, 22 / 20);
  assertEquals(p.peak, 30);
  // Load: each session against the trial in its own unit.
  const hr = heartRate([session({ average_heart_rate: 150, actual_pace: 20, workout_data: { total_work_time: 60 } })], trials, "echo_bike")[0];
  assertEquals(Math.round(hr.training_load!), 150); // (20 ÷ 20)³ × 150 × √1
});
