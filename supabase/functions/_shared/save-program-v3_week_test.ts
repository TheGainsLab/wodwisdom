// deno test supabase/functions/_shared/save-program-v3_week_test.ts --no-check --allow-env
//
// A week can only be saved once (2026-11-23): a re-run of the saving stage
// for a week job replaces the week's rows instead of adding a second copy,
// and a failed save still leaves earlier weeks untouched.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { saveProgramV3 } from "./save-program-v3.ts";
import { memorySupa } from "./fixtures/memory-supa.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

const P = "prog-1";
const DAYS = [1, 2, 3];
const SKELETON: Any = {
  month_plan: {},
  weeks: [1, 2, 3, 4].map((w) => ({ week_num: w, days: DAYS.map((d) => ({ day_num: d, day_intent: "x", block_types: ["strength"], block_intents: [] })) })),
};
const week = (n: number, lift = "Back Squat"): Any => ({
  week_num: n,
  days: DAYS.map((d) => ({ day_num: d, blocks: [{ block_type: "strength", scheme_format: { format: "work_sets" }, movements: [{ movement: lift, sets: 5, reps: 5, weight: 100, weight_unit: "kg" }] }] })),
});
const pw = (id: string, w: number, d: number, status: string, month = 1) =>
  ({ id, program_id: P, month_number: month, week_num: w, day_num: d, status, sort_order: (month - 1) * 100 + (w - 1) * 10 + d });

/** Month 1: week 1 written (and trained), weeks 2-4 outline. Month 2 exists too. */
function start(opts: Any = {}) {
  return memorySupa({
    programs: [{ id: P, generated_months: 2, weekly_mode: true }],
    program_workouts: [
      ...DAYS.map((d) => pw(`w1d${d}`, 1, d, "written")),
      ...[2, 3, 4].flatMap((w) => DAYS.map((d) => pw(`o${w}d${d}`, w, d, "outline"))),
      pw("m2", 1, 1, "written", 2),
    ],
    program_blocks_v2: [{ id: "w1-block", program_workout_id: "w1d1", block_type: "strength", sort_order: 0 }],
    program_movements_v2: [{ id: "w1-mv", block_id: "w1-block", movement: "Back Squat", sort_order: 0 }],
    program_month_skeletons: [{ id: "s", program_id: P, month_number: 1, skeleton: SKELETON, written_weeks: [week(1)], last_fill_error: null }],
  }, opts);
}
const saveWeek = (supa: Any, wk: Any) =>
  saveProgramV3(supa, "U", { month_plan: {}, weeks: [wk] } as Any, {
    name: "x", skeleton: SKELETON, programId: P, monthNumber: 1,
    weekly: { composedMetcons: [], weekAppend: true, skeletonToStore: SKELETON },
  });
const rowsOf = (db: Any, w: number, status?: string, month = 1) =>
  db.tables.program_workouts.filter((r: Any) => r.month_number === month && r.week_num === w && (!status || r.status === status));
const shape = (db: Any) => [1, 2, 3, 4].map((w) => `${rowsOf(db, w, "written").length}w/${rowsOf(db, w, "outline").length}o`).join(" ");

Deno.test("saving week 2 replaces its outline with written days and leaves every other week as it was", async () => {
  const db = start();
  await saveWeek(db.supa, week(2));
  assertEquals(shape(db), "3w/0o 3w/0o 0w/3o 0w/3o");
  assertEquals(rowsOf(db, 1).map((r: Any) => r.id), ["w1d1", "w1d2", "w1d3"]); // the trained week: same rows
  assertEquals(db.tables.program_workouts.filter((r: Any) => r.month_number === 2).length, 1);
});

Deno.test("a week can only be saved once: running the save again replaces the week, it does not add a second copy", async () => {
  const db = start();
  await saveWeek(db.supa, week(2));
  const firstIds = rowsOf(db, 2).map((r: Any) => r.id);
  await saveWeek(db.supa, week(2, "Front Squat")); // the saving stage re-entered
  assertEquals(shape(db), "3w/0o 3w/0o 0w/3o 0w/3o"); // still three days in week 2, not six
  assertEquals(rowsOf(db, 2).some((r: Any) => firstIds.includes(r.id)), false); // the first copy is gone
  assertEquals(rowsOf(db, 1).map((r: Any) => r.id), ["w1d1", "w1d2", "w1d3"]);
  // The week's blocks belong to the rows that are there now.
  const liveIds = new Set(rowsOf(db, 2).map((r: Any) => r.id));
  const liveBlocks = db.tables.program_blocks_v2.filter((b: Any) => liveIds.has(b.program_workout_id));
  assertEquals(liveBlocks.length, 3);
  const stored = db.tables.program_month_skeletons[0].written_weeks;
  assertEquals(stored.map((w: Any) => w.week_num), [1, 2]); // and once in the stored copy
});

Deno.test("a re-run that fails puts the week back as an outline and never touches the earlier weeks", async () => {
  const db = start();
  await saveWeek(db.supa, week(2));
  // The re-run removes week 2's written rows, inserts new ones, then the movements insert is refused.
  let refuse = true;
  const failing = memorySupa(db.tables, { fail: (t, op) => (refuse && t === "program_movements_v2" && op === "insert" ? "movements insert refused" : null) });
  await assertRejects(() => saveWeek(failing.supa, week(2)), Error, "movements insert refused");
  refuse = false;
  assertEquals(shape(failing), "3w/0o 0w/3o 0w/3o 0w/3o"); // week 2 is an outline again: the weekly job will write it
  assertEquals(rowsOf(failing, 1).map((r: Any) => r.id), ["w1d1", "w1d2", "w1d3"]);
  assertEquals(failing.tables.program_workouts.filter((r: Any) => r.month_number === 2).length, 1);
  assertEquals(String(failing.tables.program_month_skeletons[0].last_fill_error).startsWith("save failed: "), true);
});

Deno.test("a first save that fails also leaves week 1 untouched and week 2 as an outline", async () => {
  const db = start({ fail: (t: string, op: string) => (t === "program_blocks_v2" && op === "insert" ? "blocks insert refused" : null) });
  await assertRejects(() => saveWeek(db.supa, week(2)), Error, "blocks insert refused");
  assertEquals(shape(db), "3w/0o 0w/3o 0w/3o 0w/3o");
  assertEquals(rowsOf(db, 1).map((r: Any) => r.id), ["w1d1", "w1d2", "w1d3"]);
});

Deno.test("a month build still saves its weeks without removing anything first", async () => {
  const db = memorySupa({ programs: [{ id: P, generated_months: 0 }], program_workouts: [pw("old", 1, 1, "written", 1)], program_blocks_v2: [], program_movements_v2: [], program_month_skeletons: [] });
  await saveProgramV3(db.supa, "U", { month_plan: {}, weeks: [week(1)] } as Any, { name: "x", skeleton: SKELETON, programId: P, monthNumber: 2, weekly: { composedMetcons: [] } });
  assertEquals(db.calls.filter((c: Any) => c.table === "program_workouts" && c.op === "delete").length, 0);
  assertEquals(db.tables.program_workouts.some((r: Any) => r.id === "old"), true);
  assertEquals(shape({ tables: { program_workouts: db.tables.program_workouts.filter((r: Any) => r.month_number === 2).map((r: Any) => ({ ...r, month_number: 1 })) } }), "3w/0o 0w/3o 0w/3o 0w/3o");
});

Deno.test("a week the athlete has opened is never replaced: the rows, blocks and the log's link all stay", async () => {
  const db = start();
  await saveWeek(db.supa, week(2));
  const ids = rowsOf(db, 2).map((r: Any) => r.id);
  const blocksBefore = db.tables.program_blocks_v2.length;
  db.tables.workout_logs = [{ id: "log-1", user_id: "U", source_type: "program", source_id: ids[0], status: "in_progress" }];
  await saveWeek(db.supa, week(2, "Front Squat")); // the saving stage re-entered after the athlete started
  assertEquals(rowsOf(db, 2).map((r: Any) => r.id), ids); // the same rows the log points at
  assertEquals(db.tables.program_blocks_v2.length, blocksBefore);
  assertEquals(shape(db), "3w/0o 3w/0o 0w/3o 0w/3o"); // later weeks' outline untouched too
});

// ── The conditioning piece's purpose note (2026-11-24) ──────────────────────
const weekWithMetcon = (n: number): Any => ({
  week_num: n,
  days: DAYS.map((d) => ({ day_num: d, blocks: [
    { block_type: "strength", scheme_format: { format: "work_sets" }, movements: [{ movement: "Back Squat", sets: 5, reps: 5, weight: 100, weight_unit: "kg" }] },
    { block_type: "metcon", scheme_format: { format: "amrap", minutes: 12 }, block_notes: "Even pace.", stimulus_note: "Even pace.", movements: [{ movement: "Row", calories: 15 }] },
  ] })),
});

Deno.test("a metcon's purpose note is saved in its own field; other blocks carry none", async () => {
  const db = start();
  await saveWeek(db.supa, weekWithMetcon(2));
  const ids = new Set(rowsOf(db, 2).map((r: Any) => r.id));
  const blocks = db.tables.program_blocks_v2.filter((b: Any) => ids.has(b.program_workout_id));
  assertEquals(blocks.filter((b: Any) => b.block_type === "metcon").map((b: Any) => b.stimulus_note), ["Even pace.", "Even pace.", "Even pace."]);
  assertEquals(blocks.filter((b: Any) => b.block_type === "strength").every((b: Any) => !b.stimulus_note), true);
});

Deno.test("if the purpose-note column is not there yet, the week still saves, without it", async () => {
  const db = start();
  let first = true;
  const failing = memorySupa(db.tables, { fail: (t, op) => {
    if (t === "program_blocks_v2" && op === "insert" && first) { first = false; return 'column "stimulus_note" of relation "program_blocks_v2" does not exist'; }
    return null;
  } });
  await saveWeek(failing.supa, weekWithMetcon(2));
  assertEquals(shape(failing), "3w/0o 3w/0o 0w/3o 0w/3o"); // the week is saved
  const ids = new Set(rowsOf(failing, 2).map((r: Any) => r.id));
  const blocks = failing.tables.program_blocks_v2.filter((b: Any) => ids.has(b.program_workout_id));
  assertEquals(blocks.length, 6);
  assertEquals(blocks.some((b: Any) => "stimulus_note" in b), false);
});
