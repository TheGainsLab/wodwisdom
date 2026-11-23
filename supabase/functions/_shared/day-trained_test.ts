// deno test supabase/functions/_shared/day-trained_test.ts --no-check --allow-env
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadTrainedDayLogs, trainedDayLogs } from "./day-trained.ts";
import { loadProgramEvidence, summarizeEvidence } from "./program-evidence.ts";
import { loadMonthFillStates, pickMonthToFill } from "./weekly-fill.ts";
import { memorySupa } from "./fixtures/memory-supa.ts";

const log = (id: string, source_id: string, status: string, workout_date = "2026-11-20") => ({ id, source_id, status, workout_date });

Deno.test("a day is trained when it has a log with at least one saved block, in progress or completed", () => {
  const got = trainedDayLogs(
    [log("l1", "d1", "completed"), log("l2", "d2", "in_progress"), log("l3", "d3", "in_progress")],
    ["l1", "l2"], // l3 was opened but no block was saved
  );
  assertEquals([...got.keys()].sort(), ["d1", "d2"]);
});

Deno.test("a log with no saved block does not make the day trained, even when it is marked completed", () => {
  assertEquals(trainedDayLogs([log("l1", "d1", "completed")], []).size, 0);
});

Deno.test("a day with two logs is represented by the completed one", () => {
  const got = trainedDayLogs([log("a", "d1", "in_progress"), log("b", "d1", "completed"), log("c", "d1", "in_progress")], ["a", "b", "c"]);
  assertEquals(got.get("d1")!.id, "b");
});

// One program, month 1: week 1 (3 days) written, week 2 outline. Day 1 is
// completed, day 2 is in progress with one saved block, day 3 was opened and
// nothing was saved.
function program(day3HasBlock: boolean) {
  const pw = (id: string, week: number, day: number, status: string) =>
    ({ id, program_id: "P", month_number: 1, week_num: week, day_num: day, status });
  return memorySupa({
    program_workouts: [pw("d1", 1, 1, "written"), pw("d2", 1, 2, "written"), pw("d3", 1, 3, "written"), pw("o1", 2, 1, "outline"), pw("o2", 2, 2, "outline"), pw("o3", 2, 3, "outline")],
    workout_logs: [
      { id: "l1", user_id: "U", source_type: "program", source_id: "d1", status: "completed", workout_date: "2026-11-16" },
      { id: "l2", user_id: "U", source_type: "program", source_id: "d2", status: "in_progress", workout_date: "2026-11-18" },
      { id: "l3", user_id: "U", source_type: "program", source_id: "d3", status: "in_progress", workout_date: "2026-11-19" },
    ],
    workout_log_blocks: [
      { id: "b1", log_id: "l1", block_type: "strength", block_label: "Strength", sort_order: 0 },
      { id: "b2", log_id: "l2", block_type: "strength", block_label: "Strength", sort_order: 0 },
      ...(day3HasBlock ? [{ id: "b3", log_id: "l3", block_type: "metcon", block_label: "Metcon", score: "8:41", sort_order: 0 }] : []),
    ],
    workout_log_entries: [
      { log_id: "l2", block_id: "b2", movement: "Back Squat", sets: 1, reps: 5, reps_completed: 5, weight: 100, weight_unit: "kg", completed: true, sort_order: 0 },
    ],
    program_month_skeletons: [{ program_id: "P", month_number: 1, created_at: "2026-11-15T00:00:00Z", last_fill_error: null, last_fill_attempt_at: null }],
    program_jobs: [],
  });
}
const NOW = new Date("2026-11-19T12:00:00Z"); // day 4 of the month: the clock has not opened week 2

Deno.test("an in-progress day is reported to the writer as done, with the blocks that were saved — not as NOT DONE", async () => {
  const { supa } = program(true);
  const days = await loadProgramEvidence(supa, "U", "P", 2, 1);
  assertEquals(days.map((d) => `${d.day}:${d.status}`), ["1:logged", "2:logged", "3:logged"]);
  const day2 = days.find((d) => d.day === 2)!;
  assertEquals(day2.blocks.length, 1);
  assertEquals(day2.blocks[0].movements[0].movement, "Back Squat");
  const text = summarizeEvidence(days, NOW);
  assertEquals(text.includes("NOT DONE"), false);
  assertEquals(text.includes("W1D2 (2026-11-18): Strength: Back Squat 1×5 @ 100 kg"), true);
});

Deno.test("opening a week and reading what was trained agree: the days that open week 2 are exactly the days the writer is told were done", async () => {
  for (const day3HasBlock of [true, false]) {
    const { supa } = program(day3HasBlock);
    const pick = pickMonthToFill(await loadMonthFillStates(supa, "P", "U"), NOW);
    const evidence = await loadProgramEvidence(supa, "U", "P", 2, 1);
    const allDone = evidence.every((d) => d.status === "logged");
    assertEquals(pick.action === "fill", allDone, `day 3 saved a block: ${day3HasBlock}`);
    assertEquals(allDone, day3HasBlock);
  }
});

Deno.test("the loader asks for in-progress and completed logs of this athlete's program days only", async () => {
  const { supa } = program(true);
  assertEquals([...(await loadTrainedDayLogs(supa, "U", ["d1", "d2", "d3"])).keys()].sort(), ["d1", "d2", "d3"]);
  assertEquals((await loadTrainedDayLogs(supa, "someone-else", ["d1", "d2", "d3"])).size, 0);
  assertEquals((await loadTrainedDayLogs(supa, "U", [])).size, 0);
});
