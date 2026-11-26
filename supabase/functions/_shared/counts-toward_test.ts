// What a movement counts toward: the fixed profile lists, the stored values,
// and every reader that used to work it out from the name's spelling.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  COUNTS_TOWARD_INSTRUCTION, COUNTS_TOWARD_VALUES, isLabelled, liftCountedToward, PROFILE_LIFT_KEYS, PROFILE_SKILL_KEYS,
  skillCountedToward, storedCountsToward,
} from "./counts-toward.ts";
import { ALL_LIFT_KEYS, ALL_SKILL_KEYS } from "./tier-status.ts";
import { DISPLAY_TO_LIFT_KEY, liftKeyOf } from "./lift-key.ts";
import { buildEmitBlockTool } from "./v2-output-schema.ts";
import { countsTowardForDay, insertLogEntries } from "./log-counts-toward.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

const sorted = (a: readonly string[]) => [...a].sort();

Deno.test("the two lists are exactly the profile's own lifts and skills", () => {
  assertEquals(sorted(PROFILE_LIFT_KEYS), sorted(ALL_LIFT_KEYS as readonly string[]));
  assertEquals(sorted(PROFILE_SKILL_KEYS), sorted(ALL_SKILL_KEYS as readonly string[]));
  assertEquals(PROFILE_LIFT_KEYS.length, 14);
  assertEquals(PROFILE_SKILL_KEYS.length, 20);
  // No key is on both lists, so one stored value is never ambiguous.
  assertEquals(PROFILE_LIFT_KEYS.filter((k) => (PROFILE_SKILL_KEYS as readonly string[]).includes(k)), []);
});

Deno.test("the carry-over function in the migration uses the same 20 skill keys", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20261125100000_movement_counts_toward.sql", import.meta.url));
  const block = sql.slice(sql.indexOf("v_skill_keys text[] := ARRAY["));
  const keys = [...block.slice(0, block.indexOf("];")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assertEquals(sorted(keys), sorted(PROFILE_SKILL_KEYS));
  // …and reads the label before it ever compares a spelling.
  assert(sql.indexOf("WHEN wle.counts_toward IS NOT NULL") < sql.indexOf("WHEN LOWER(REGEXP_REPLACE(TRIM(wle.movement)"));
});

Deno.test("stored value: a known key, \"none\", or nothing", () => {
  assertEquals(storedCountsToward("back_squat"), "back_squat");
  assertEquals(storedCountsToward("chest_to_bar_pull_ups"), "chest_to_bar_pull_ups");
  assertEquals(storedCountsToward("none"), "none");
  for (const bad of ["Back Squat", "chest_to_bar", "", null, undefined, 3, "NONE"]) assertEquals(storedCountsToward(bad), null);
  assert(isLabelled("none")); assert(!isLabelled(null)); assert(!isLabelled("squat"));
  assertEquals(liftCountedToward("power_clean"), "power_clean");
  assertEquals(liftCountedToward("toes_to_bar"), null);
  assertEquals(skillCountedToward("toes_to_bar"), "toes_to_bar");
  assertEquals(skillCountedToward("none"), null);
});

Deno.test("the writer must answer for every movement, from the fixed set", () => {
  const block = buildEmitBlockTool("lbs", 60).input_schema as Any;
  const mv = block.properties.movements.items;
  assert(mv.required.includes("counts_toward"));
  assertEquals(mv.properties.counts_toward.enum, [...COUNTS_TOWARD_VALUES]);
  assert(mv.properties.counts_toward.description.includes(COUNTS_TOWARD_INSTRUCTION));
  // The name itself stays free text: no fixed list of movement names.
  assertEquals(mv.properties.movement.enum, undefined);
});

Deno.test("which lift a weight is judged against follows the AI's answer, not the spelling", () => {
  // The catalogue's own spelling missed the old list on a capital A.
  assertEquals(DISPLAY_TO_LIFT_KEY["Clean And Jerk"], undefined);
  assertEquals(liftKeyOf({ movement: "Clean And Jerk", counts_toward: "clean_and_jerk" }), "clean_and_jerk");
  assertEquals(liftKeyOf({ movement: "Barbell Back Squat", counts_toward: "back_squat" }), "back_squat");
  assertEquals(liftKeyOf({ movement: "Hang Power Clean", counts_toward: "power_clean", on_barbell: true }), "power_clean");
  // The AI said it is not a profile lift: the name is not consulted.
  assertEquals(liftKeyOf({ movement: "Back Squat", counts_toward: "none" }), undefined);
  assertEquals(liftKeyOf({ movement: "Deadlift", counts_toward: "toes_to_bar" }), undefined);
  // A weight the writer marked as not on a barbell is never judged against a barbell max.
  assertEquals(liftKeyOf({ movement: "Dumbbell Bench Press", counts_toward: "bench_press", on_barbell: false }), undefined);
  // Nobody has answered yet: the old list still applies, so nothing loses its limit.
  assertEquals(liftKeyOf({ movement: "Back Squat" }), "back_squat");
  assertEquals(liftKeyOf({ movement: "Back Squat", counts_toward: null }), "back_squat");
  assertEquals(liftKeyOf({ movement: "Clean And Jerk" }), undefined);
});

// A stand-in database for the log helpers.
function fakeDb(opts: { movements?: Any[]; movementsError?: string; failLabelledInsert?: boolean }) {
  const inserts: Any[][] = [];
  const from = (table: string) => {
    const q: Any = {
      select: () => q, eq: () => q,
      in: () => Promise.resolve(table === "program_movements_v2"
        ? (opts.movementsError ? { data: null, error: { message: opts.movementsError } } : { data: opts.movements ?? [], error: null })
        : { data: [], error: null }),
      then: (res: Any) => Promise.resolve({ data: table === "program_blocks_v2" ? [{ id: "b1" }] : [], error: null }).then(res),
      insert: (rows: Any[]) => {
        inserts.push(rows);
        const labelled = rows.some((r) => "counts_toward" in r);
        return Promise.resolve(opts.failLabelledInsert && labelled ? { error: { message: 'column "counts_toward" of relation "workout_log_entries" does not exist' } } : { error: null });
      },
    };
    return q;
  };
  return { supa: { from } as Any, inserts };
}

Deno.test("a logged entry takes the answer of the movement it was logged against", async () => {
  const { supa, inserts } = fakeDb({ movements: [
    { movement: "Chest To Bar", counts_toward: "chest_to_bar_pull_ups" },
    { movement: "Farmer Carry", counts_toward: "none" },
    { movement: "Row", counts_toward: null },
  ] });
  assertEquals([...(await countsTowardForDay(supa, "day1")).entries()], [["Chest To Bar", "chest_to_bar_pull_ups"], ["Farmer Carry", "none"]]);
  const err = await insertLogEntries(supa, [{ movement: "Chest To Bar" }, { movement: " Farmer Carry " }, { movement: "Row" }, { movement: "Typed By Hand" }], "day1");
  assertEquals(err, null);
  assertEquals(inserts.at(-1), [
    { movement: "Chest To Bar", counts_toward: "chest_to_bar_pull_ups" },
    { movement: " Farmer Carry ", counts_toward: "none" },
    { movement: "Row" },
    { movement: "Typed By Hand" },
  ]);
});

Deno.test("logging works exactly as before when the column is not there yet, or there is no program day", async () => {
  const before = fakeDb({ movementsError: "column program_movements_v2.counts_toward does not exist" });
  assertEquals(await insertLogEntries(before.supa, [{ movement: "Row" }], "day1"), null);
  assertEquals(before.inserts, [[{ movement: "Row" }]]);

  const half = fakeDb({ movements: [{ movement: "Row", counts_toward: "none" }], failLabelledInsert: true });
  assertEquals(await insertLogEntries(half.supa, [{ movement: "Row" }], "day1"), null);
  assertEquals(half.inserts, [[{ movement: "Row", counts_toward: "none" }], [{ movement: "Row" }]]);

  const noDay = fakeDb({ movements: [{ movement: "Row", counts_toward: "none" }] });
  await insertLogEntries(noDay.supa, [{ movement: "Row" }], null);
  assertEquals(noDay.inserts, [[{ movement: "Row" }]]);
});

Deno.test("the instruction says a pull is \"none\", so the lift's ceiling is never applied to it", () => {
  assert(/Snatch Pull/.test(COUNTS_TOWARD_INSTRUCTION) && /Clean Pull/.test(COUNTS_TOWARD_INSTRUCTION));
  assert(/Snatch Balance/.test(COUNTS_TOWARD_INSTRUCTION) && /Jerk Balance/.test(COUNTS_TOWARD_INSTRUCTION));
  assert(/not limited by that lift's max/.test(COUNTS_TOWARD_INSTRUCTION));
  // And with "none" code leaves a pull's weight alone, however heavy.
  assertEquals(liftKeyOf({ movement: "Snatch Pull", counts_toward: "none", on_barbell: true }), undefined);
});

Deno.test("the instruction says a progression toward a skill is not the skill", () => {
  for (const w of ["negatives", "holds", "transitions", "banded", "jumping"]) assert(COUNTS_TOWARD_INSTRUCTION.includes(w), w);
  assert(/Strict Pull-Up Negatives are not strict pull-ups/.test(COUNTS_TOWARD_INSTRUCTION));
});
