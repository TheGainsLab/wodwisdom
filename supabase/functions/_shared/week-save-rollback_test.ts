// deno test supabase/functions/_shared/week-save-rollback_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rollBackFailedWeekSave } from "./week-save-rollback.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

interface Row { id: string; program_id: string; month_number: number; week_num: number; day_num: number; status: string }

/** A small in-memory stand-in for the two tables the rollback touches. */
function fakeDb(rows: Row[], store: Any | null, opts: { failInsert?: boolean; failDelete?: boolean } = {}) {
  const db = { rows: [...rows], store: store ? { ...store } : null, nextId: 1000 };
  const supa = {
    from(table: string) {
      const filters: Array<(r: Any) => boolean> = [];
      let op: "select" | "delete" | "update" | "insert" = "select";
      let payload: Any = null;
      const run = () => {
        if (table === "program_workouts") {
          if (op === "insert") {
            if (opts.failInsert) return { data: null, error: { message: "insert refused" } };
            for (const r of payload as Any[]) db.rows.push({ id: `new-${db.nextId++}`, ...r });
            return { data: null, error: null };
          }
          const hit = db.rows.filter((r) => filters.every((f) => f(r)));
          if (op === "delete") {
            if (opts.failDelete) return { data: null, error: { message: "delete refused" } };
            db.rows = db.rows.filter((r) => !hit.includes(r));
            return { data: null, error: null };
          }
          return { data: hit, error: null };
        }
        if (op === "update") { if (db.store) Object.assign(db.store, payload); return { data: null, error: null }; }
        return { data: db.store, error: null };
      };
      const chain: Any = {
        select() { return chain; },
        delete() { op = "delete"; return chain; },
        update(p: Any) { op = "update"; payload = p; return chain; },
        insert(p: Any) { op = "insert"; payload = p; return Promise.resolve(run()); },
        eq(col: string, v: Any) { filters.push((r) => r[col] === v); return chain; },
        in(col: string, vs: Any[]) { filters.push((r) => vs.includes(r[col])); return chain; },
        maybeSingle() { return Promise.resolve(run()); },
        then(res: Any, rej: Any) { return Promise.resolve(run()).then(res, rej); },
      };
      return chain;
    },
  } as Any;
  return { db, supa };
}

const P = "prog-1";
const SKELETON = { weeks: [1, 2, 3, 4].map((w) => ({ week_num: w, days: [1, 2, 3].map((d) => ({ day_num: d })) })) };
const row = (id: string, week: number, day: number, status: string, month = 1): Row =>
  ({ id, program_id: P, month_number: month, week_num: week, day_num: day, status });
const weeksWith = (rows: Row[], status: string, month = 1) =>
  [...new Set(rows.filter((r) => r.status === status && r.month_number === month).map((r) => r.week_num))].sort();

/** Week 1 trained, week 2 being written: its outline and weeks 3-4's were cleared, new rows went in, then a later step failed. */
function midSaveOfWeek2() {
  return [
    row("w1d1", 1, 1, "written"), row("w1d2", 1, 2, "written"), row("w1d3", 1, 3, "written"),
    row("n1", 2, 1, "written"), row("n2", 2, 2, "written"), row("n3", 2, 3, "written"),
    row("n4", 3, 1, "outline"), row("n5", 3, 2, "outline"), row("n6", 3, 3, "outline"),
    row("n7", 4, 1, "outline"), row("n8", 4, 2, "outline"), row("n9", 4, 3, "outline"),
    row("m2", 1, 1, "written", 2), // another month: must never be touched
  ];
}
const NEW_IDS = ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9"];

Deno.test("a failed week-2 save leaves week 1 untouched and week 2 back as an outline", async () => {
  const { db, supa } = fakeDb(midSaveOfWeek2(), { skeleton: SKELETON, last_fill_error: null });
  const rep = await rollBackFailedWeekSave(supa, {
    programId: P, monthNumber: 1, insertedWorkoutIds: NEW_IDS, clearedOutlineFromWeek: 2, error: new Error("movements insert failed"),
  });
  assertEquals(rep.problems, []);
  assertEquals(db.rows.filter((r) => r.id.startsWith("w1")).length, 3); // the trained week survives, same rows
  assertEquals(weeksWith(db.rows, "written"), [1]);
  assertEquals(weeksWith(db.rows, "outline"), [2, 3, 4]); // the weekly job still has weeks to write
  assertEquals(db.rows.filter((r) => r.month_number === 1).length, 12);
  assertEquals(db.rows.filter((r) => r.month_number === 2).length, 1);
  assertEquals(db.store.last_fill_error, "save failed: movements insert failed");
});

Deno.test("the insert itself failed: nothing to remove, the cleared outline comes back", async () => {
  const before = midSaveOfWeek2().filter((r) => !NEW_IDS.includes(r.id)); // only week 1 (+ month 2) left
  const { db, supa } = fakeDb(before, { skeleton: SKELETON });
  const rep = await rollBackFailedWeekSave(supa, {
    programId: P, monthNumber: 1, insertedWorkoutIds: [], clearedOutlineFromWeek: 2, error: new Error("insert failed"),
  });
  assertEquals(rep.removed, 0);
  assertEquals(rep.outlineRestored, 9);
  assertEquals(weeksWith(db.rows, "written"), [1]);
  assertEquals(weeksWith(db.rows, "outline"), [2, 3, 4]);
});

Deno.test("failed before anything was cleared: the month is left exactly as it was", async () => {
  const start = [row("w1d1", 1, 1, "written"), row("o2", 2, 1, "outline"), row("o3", 3, 1, "outline")];
  const { db, supa } = fakeDb(start, { skeleton: SKELETON });
  await rollBackFailedWeekSave(supa, { programId: P, monthNumber: 1, insertedWorkoutIds: [], clearedOutlineFromWeek: null, error: "boom" });
  assertEquals(db.rows.map((r) => r.id), ["w1d1", "o2", "o3"]);
  assertEquals(db.store.last_fill_error, "save failed: boom");
});

Deno.test("a week that was already written before this save is not turned back into an outline", async () => {
  const start = [row("w1", 1, 1, "written"), row("old2", 2, 1, "written"), row("dup2", 2, 1, "written"), row("n3", 3, 1, "outline")];
  const { db, supa } = fakeDb(start, { skeleton: SKELETON });
  await rollBackFailedWeekSave(supa, { programId: P, monthNumber: 1, insertedWorkoutIds: ["dup2", "n3"], clearedOutlineFromWeek: 2, error: "boom" });
  assertEquals(db.rows.some((r) => r.id === "old2"), true);
  assertEquals(weeksWith(db.rows, "written"), [1, 2]);
  assertEquals(weeksWith(db.rows, "outline"), [3, 4]);
});

Deno.test("no stored skeleton: the in-flight one rebuilds the outline", async () => {
  const { db, supa } = fakeDb([row("w1", 1, 1, "written")], null);
  const rep = await rollBackFailedWeekSave(supa, {
    programId: P, monthNumber: 1, insertedWorkoutIds: [], clearedOutlineFromWeek: 2, fallbackSkeleton: SKELETON, error: "boom",
  });
  assertEquals(rep.outlineRestored, 9);
  assertEquals(weeksWith(db.rows, "outline"), [2, 3, 4]);
});

Deno.test("when the cleanup itself fails it never throws and never deletes more; the problem is recorded", async () => {
  const { db, supa } = fakeDb(midSaveOfWeek2(), { skeleton: SKELETON }, { failDelete: true, failInsert: true });
  const rep = await rollBackFailedWeekSave(supa, {
    programId: P, monthNumber: 1, insertedWorkoutIds: NEW_IDS, clearedOutlineFromWeek: 2, error: new Error("x"),
  });
  assertEquals(db.rows.length, 13); // nothing lost
  assertEquals(rep.problems.length, 1);
  assertEquals(String(db.store.last_fill_error).includes("rollback: remove inserted rows: delete refused"), true);
});

// (2026-11-23) A week save now removes the week's existing rows — written
// ones too — before inserting, so a re-run replaces instead of duplicating.
Deno.test("a failed re-run that had removed the week's written rows leaves that week as an outline, and earlier weeks untouched", async () => {
  // Week 2 was written once; the re-run removed those rows, inserted n1-n3 (and the later outline), then failed.
  const { db, supa } = fakeDb(midSaveOfWeek2(), { skeleton: SKELETON, last_fill_error: null });
  const rep = await rollBackFailedWeekSave(supa, {
    programId: P, monthNumber: 1, insertedWorkoutIds: NEW_IDS, clearedOutlineFromWeek: 2, error: new Error("re-run failed"),
  });
  assertEquals(rep.problems, []);
  assertEquals(db.rows.filter((r) => r.id.startsWith("w1")).map((r) => r.id), ["w1d1", "w1d2", "w1d3"]);
  assertEquals(weeksWith(db.rows, "written"), [1]);
  assertEquals(weeksWith(db.rows, "outline"), [2, 3, 4]);
  assertEquals(db.rows.filter((r) => r.month_number === 1 && r.week_num === 2).length, 3); // once, not twice
});
