// deno test supabase/functions/_shared/written-weeks_test.ts --no-check --allow-env
//
// The next week builds on the program as it stands now, edits included
// (2026-11-23).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadWrittenWeeksFromRows, priorWeeksForWeekJob, weeksFromRows } from "./written-weeks.ts";
import { memorySupa } from "./fixtures/memory-supa.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

/** Week 1 as it was FIRST written (the copy kept in program_month_skeletons). */
const STORED: Any[] = [{
  week_num: 1,
  days: [{ day_num: 1, blocks: [{ block_type: "strength", scheme_format: { format: "work_sets" }, movements: [{ movement: "Back Squat", sets: 5, reps: 5, weight: 100, weight_unit: "kg" }] }] }],
}];

/** The same week in the tables today: the coach swapped the lift and the athlete lowered the load. */
function tables(extra: Record<string, Any[]> = {}) {
  const pw = (id: string, week: number, day: number, status = "written", month = 1) =>
    ({ id, program_id: "P", month_number: month, week_num: week, day_num: day, status, sort_order: (week - 1) * 10 + day });
  return {
    program_workouts: [pw("w1d2", 1, 2), pw("w1d1", 1, 1), pw("w2d1", 2, 1), pw("w3d1", 3, 1, "outline"), pw("m2", 1, 1, "written", 2)],
    program_blocks_v2: [
      { id: "b2", program_workout_id: "w1d1", block_type: "metcon", block_scheme: "3 rounds for time", scheme_format: { format: "rft", rounds: 3 }, time_cap_seconds: 600, block_notes: "fast", sort_order: 1 },
      { id: "b1", program_workout_id: "w1d1", block_type: "strength", block_label: null, scheme_format: { format: "work_sets" }, sort_order: 0 },
      { id: "b3", program_workout_id: "w1d2", block_type: "accessory", sort_order: 0 },
      { id: "b4", program_workout_id: "w2d1", block_type: "strength", sort_order: 0 },
      { id: "bm2", program_workout_id: "m2", block_type: "strength", sort_order: 0 },
    ],
    program_movements_v2: [
      { block_id: "b1", movement: "Front Squat", sets: 5, reps: 5, rep_scheme: null, weight: 80, weight_unit: "kg", target_pct_1rm: 70, sort_order: 0 },
      { block_id: "b2", movement: "Row", sets: 3, distance: 250, distance_unit: "m", sort_order: 1 },
      { block_id: "b2", movement: "Burpee", reps: 45, rep_scheme: [15, 15, 15], sort_order: 0 },
      { block_id: "b3", movement: "Cal Bike", calories: 45, cal_scheme: [21, 15, 9], sort_order: 0 },
      { block_id: "b4", movement: "Deadlift", sets: 3, reps: 3, weight: 140, weight_unit: "kg", sort_order: 0 },
      { block_id: "bm2", movement: "Bench Press", sets: 3, reps: 5, sort_order: 0 },
    ],
    ...extra,
  };
}

Deno.test("an edit to a written day is what the next week is built from, not the week as first written", async () => {
  const { supa } = memorySupa(tables());
  const { weeks, source } = await priorWeeksForWeekJob(supa, "P", 1, 2, STORED);
  assertEquals(source, "rows");
  const strength = weeks[0].days[0].blocks[0];
  assertEquals(strength.movements[0], { movement: "Front Squat", sets: 5, reps: 5, weight: 80, weight_unit: "kg", target_pct_1rm: 70 } as Any);
  assertEquals(JSON.stringify(weeks).includes("Back Squat"), false); // the original prescription is gone from the context
});

Deno.test("prior weeks are this month's written weeks before the one being written, in week, day, block and movement order", async () => {
  const { supa } = memorySupa(tables());
  const w2 = await loadWrittenWeeksFromRows(supa, "P", 1, 2);
  assertEquals(w2.map((w) => w.week_num), [1]);
  assertEquals(w2[0].days.map((d) => d.day_num), [1, 2]);
  assertEquals(w2[0].days[0].blocks.map((b) => b.block_type), ["strength", "metcon"]);
  assertEquals(w2[0].days[0].blocks[1].movements.map((m) => m.movement), ["Burpee", "Row"]);
  // Week 3's job sees weeks 1 and 2; outline weeks and other months are never included.
  const w3 = await loadWrittenWeeksFromRows(supa, "P", 1, 3);
  assertEquals(w3.map((w) => w.week_num), [1, 2]);
  assertEquals(JSON.stringify(w3).includes("Bench Press"), false);
});

Deno.test("rows come back in the writer's shape: a scheme alone where one is stored, no empty fields", () => {
  const [week] = weeksFromRows(
    [{ id: "w", week_num: 1, day_num: 1 }],
    [{ id: "b", program_workout_id: "w", block_type: "metcon", block_label: null, block_scheme: "21-15-9", scheme_format: { format: "for_time", rounds_pattern: [21, 15, 9] }, time_cap_seconds: null, sort_order: 0 }],
    [
      { block_id: "b", movement: "Thruster", reps: 45, rep_scheme: [21, 15, 9], weight: 43, weight_unit: "kg", sets: null, sort_order: 0 },
      { block_id: "b", movement: "Cal Row", calories: 45, cal_scheme: [21, 15, 9], sort_order: 1 },
      { block_id: "b", movement: "Run", distance: 1200, distance_scheme: [600, 400, 200], distance_unit: "m", sort_order: 2 },
      { block_id: "b", movement: "Burpee", max_effort: true, sort_order: 3 },
    ],
  );
  assertEquals(week.days[0].blocks[0] as Any, {
    block_type: "metcon",
    block_scheme: "21-15-9",
    scheme_format: { format: "for_time", rounds_pattern: [21, 15, 9] },
    movements: [
      { movement: "Thruster", rep_scheme: [21, 15, 9], weight: 43, weight_unit: "kg" },
      { movement: "Cal Row", cal_scheme: [21, 15, 9] },
      { movement: "Run", distance_scheme: [600, 400, 200], distance_unit: "m" },
      { movement: "Burpee", max_effort: true },
    ],
  });
});

Deno.test("a day stored twice is used once", () => {
  const weeks = weeksFromRows(
    [{ id: "a", week_num: 1, day_num: 1, sort_order: 1 }, { id: "dup", week_num: 1, day_num: 1, sort_order: 1 }],
    [{ id: "b", program_workout_id: "a", block_type: "strength" }, { id: "b2", program_workout_id: "dup", block_type: "strength" }],
    [],
  );
  assertEquals(weeks[0].days.length, 1);
});

Deno.test("when the rows cannot be read, the stored copy of the earlier weeks is used instead", async () => {
  for (const broken of ["program_workouts", "program_blocks_v2", "program_movements_v2"]) {
    const { supa } = memorySupa(tables(), { fail: (t, op) => (t === broken && op === "select" ? "connection lost" : null) });
    const stored = [...STORED, { week_num: 2, days: [] }];
    const { weeks, source } = await priorWeeksForWeekJob(supa, "P", 1, 2, stored);
    assertEquals(source, "stored", broken);
    assertEquals(weeks, STORED);
  }
});

Deno.test("rows that read fine but are empty are the truth: the stored copy is not used", async () => {
  const { supa } = memorySupa({ program_workouts: [], program_blocks_v2: [], program_movements_v2: [] });
  assertEquals(await priorWeeksForWeekJob(supa, "P", 1, 2, STORED), { weeks: [], source: "rows" });
});
