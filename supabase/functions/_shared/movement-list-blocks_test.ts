/**
 * movement-list-blocks_test.ts — the movement list by training block
 * (founder, 2026-11-27: "goblet squats are useful in warm-ups and in
 * accessories, but they're not useful in metcons").
 *
 * Each AI is shown the part of the list for the block it writes. It is a
 * guide: nothing is checked against it. With no block marks, every reader
 * falls back to the whole list.
 */
import { assert, assertEquals } from "jsr:@std/assert";
import { fetchMovementsByBlock, groupMovementsByBlock, movementListFor } from "./build-writer-payload.ts";
import { buildComposerInputs } from "./compose-metcons.ts";
import { buildSurgicalUserMessage } from "./surgical-block-fix.ts";
import { EQUIPMENT_TO_MOVEMENTS } from "./equipment-movements.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, import.meta.url));

const ROWS = [
  { display_name: "Goblet Squat", blocks: ["warm-up", "accessory"] },
  { display_name: "Thruster", blocks: ["metcon"] },
  { display_name: "Back Squat", blocks: ["strength", "accessory", "metcon"] },
  { display_name: "Pull Up", blocks: ["skills", "metcon", "warm-up"] },
  { display_name: "Old Row", blocks: [] },
  { display_name: "Odd", blocks: ["cool-down"] },
];

Deno.test("the list is grouped by the blocks each movement is marked for", () => {
  const by = groupMovementsByBlock(ROWS)!;
  assertEquals(by.metcon, ["Back Squat", "Pull Up", "Thruster"]);
  assertEquals(by.accessory, ["Back Squat", "Goblet Squat"]);
  assertEquals(by["warm-up"], ["Goblet Squat", "Pull Up"]);
  assertEquals(by.strength, ["Back Squat"]);
  assertEquals(by.skills, ["Pull Up"]);
  assert(!by.metcon.includes("Goblet Squat"));
  // No marks at all (a database without the column, or before it is filled): null.
  assertEquals(groupMovementsByBlock([{ display_name: "Run" }, { display_name: "Row", blocks: [] }]), null);
});

Deno.test("each AI is shown its block's part; with no marks it is shown the whole list", () => {
  const payload = { vocabulary: ROWS.map((r) => r.display_name), vocabulary_by_block: groupMovementsByBlock(ROWS) };
  assertEquals(movementListFor(payload, ["metcon"]), ["Back Squat", "Pull Up", "Thruster"]);
  assertEquals(movementListFor(payload, ["strength", "skills"]), ["Back Squat", "Pull Up"]);
  const unmarked = { vocabulary: ["Run", "Row"], vocabulary_by_block: null };
  assertEquals(movementListFor(unmarked, ["metcon"]), ["Run", "Row"]);
  assertEquals(movementListFor({ vocabulary: ["Run"] }, ["metcon"]), ["Run"]); // a build stored before the field existed
});

Deno.test("reading the list by block never stops a build", async () => {
  const ok: Any = { from: () => ({ select: () => Promise.resolve({ data: ROWS, error: null }) }) };
  assertEquals((await fetchMovementsByBlock(ok))!.metcon.length, 3);
  const noColumn: Any = { from: () => ({ select: () => Promise.resolve({ data: null, error: { message: "column movements.blocks does not exist" } }) }) };
  assertEquals(await fetchMovementsByBlock(noColumn), null);
  const down: Any = { from: () => { throw new Error("down"); } };
  assertEquals(await fetchMovementsByBlock(down), null);
});

Deno.test("the composer is shown the metcon part, the planner strength and skills, the rewriter its own block", () => {
  const payload: Any = {
    vocabulary: ROWS.map((r) => r.display_name), vocabulary_by_block: groupMovementsByBlock(ROWS),
    basics: { units: "lbs" }, lifts: {}, skills: {}, conditioning: {}, training_context: {}, athlete_model: {},
  };
  const tdi: Any = { lifts: {}, equipment: {}, do_not_program: [], vocabulary: ["Back Squat", "Pull Up"] };
  const inputs = buildComposerInputs(payload, tdi, { examples: "", articles: "", previousCycleMetcons: [] });
  assertEquals(inputs.vocabulary, ["Back Squat", "Pull Up", "Thruster"]);
  const gen = read("../generate-program-v3/index.ts");
  assert(gen.includes('vocabulary: movementListFor(payloadForBuild, ["strength", "skills"]),'));
  assert(gen.includes("resumeState: { ...rs, payload: payloadForBuild, coachState, trainingDesignInput },"));
  // The evaluation and the chat coach are not sent it: the shared payload builder does not set it.
  assert(!read("./build-writer-payload.ts").includes("vocabulary_by_block,"));
  const block: Any = { block_type: "accessory", block_scheme: "3x10", movements: [{ movement: "Goblet Squat", sets: 3, reps: 10 }] };
  const msg = buildSurgicalUserMessage(payload, null, 1, 1, 0, block, ["x"]);
  assert(msg.includes('"Goblet Squat"'));
  assert(!msg.includes('"Thruster"'));
  // A block type with no marks (cool-down) gets the whole list.
  const cool = buildSurgicalUserMessage(payload, null, 1, 1, 0, { ...block, block_type: "cool-down" }, ["x"]);
  assert(cool.includes('"Thruster"'));
});

Deno.test("the writer is shown the list by block and told what it is; the flat list is dropped when marks exist", () => {
  const src = read("./engine/pipeline.ts");
  assert(src.includes("const fillPayload = payload.vocabulary_by_block ? fillPayloadByBlock : fillPayloadAll;"));
  assert(src.includes("MOVEMENT LIST BY BLOCK: the payload's vocabulary_by_block gives"));
  assert(src.includes("It is a guide: you may use a movement that is not on it"));
});

Deno.test("the migration: what is folded, removed, renamed, and the founder's block corrections", () => {
  const sql = read("../../migrations/20261127300000_movement_list_review_and_blocks.sql");
  for (const gone of ["weighted_walking_lunge", "lunge", "dumbbell_front_rack_walking_lunge", "dumbbell_overhead_lunge", "kb_swing", "chest_to_wall_hspu", "kipping_ring_dip"]) {
    assert(sql.includes(`DELETE FROM public.movements WHERE canonical_name = '${gone}';`), gone);
  }
  assert(sql.includes("DELETE FROM public.movements WHERE canonical_name IN ('sdhp', 'sumo_deadlift_high_pull', 'cluster');"));
  for (const name of ["Rowing", "Crossover Double Under", "HSPU", "Strict HSPU", "Deficit HSPU", "Strict Deficit HSPU", "Wall Facing HSPU", "Hanging Knee Raise"]) {
    assert(sql.includes(`SET display_name = '${name}'`), name);
  }
  const blocksOf = (canonical: string) => (sql.match(new RegExp(`\\('${canonical}', ARRAY\\[([^\\]]*)\\]`))?.[1] ?? "MISSING").replace(/'/g, "");
  assertEquals(blocksOf("goblet_squat"), "accessory, warm-up");
  assertEquals(blocksOf("squat_clean"), "metcon");
  assertEquals(blocksOf("squat_snatch"), "metcon");
  assert(blocksOf("wall_ball").includes("warm-up") && blocksOf("wall_ball").includes("metcon"));
  for (const squat of ["front_squat", "back_squat"]) {
    for (const b of ["accessory", "strength", "metcon"]) assert(blocksOf(squat).includes(b), `${squat} ${b}`);
  }
  assert(blocksOf("dumbbell_walking_lunge").includes("metcon"));
  // Removed entries get no block marks.
  for (const gone of ["cluster", "sdhp", "lunge", "kipping_ring_dip"]) assertEquals(blocksOf(gone), "MISSING");
  assert(sql.includes("UPDATE public.program_movements_v2 SET movement = 'Rowing' WHERE movement = 'Row';"));
});

Deno.test("no rower or no rope rules the renamed movements out too", () => {
  assert(EQUIPMENT_TO_MOVEMENTS.rower.includes("Rowing"));
  assert(EQUIPMENT_TO_MOVEMENTS.jump_rope.includes("Crossover Double Under"));
});
