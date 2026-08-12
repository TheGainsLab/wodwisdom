/**
 * block-edit_test.ts — the pure halves of the chat coach's hands: proposal
 * validation (safety is forever-hard), rep reconciliation, and the tool's
 * block_id fence.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import type { BlockPrescription } from "./v2-output-schema.ts";
import {
  buildProposeBlockEditTool,
  reconcileReps,
  validateBlockProposal,
} from "./block-edit.ts";

const VOCAB = ["Back Squat", "Strict Press", "Dumbbell Bench Press", "Row", "Wall Ball"];

function proposal(movements: BlockPrescription["movements"]): BlockPrescription {
  return { block_type: "strength", block_scheme: "4x5", movements };
}

Deno.test("a legal proposal passes", () => {
  const p = proposal([{ movement: "Dumbbell Bench Press", sets: 4, reps: 8, weight: 50 }]);
  assertEquals(validateBlockProposal(p, { doNotProgram: [], vocabulary: VOCAB }), []);
});

Deno.test("do-not-program is absolute — even by exact name", () => {
  const p = proposal([{ movement: "Back Squat", sets: 4, reps: 5, weight: 225 }]);
  const problems = validateBlockProposal(p, { doNotProgram: ["Back Squat"], vocabulary: VOCAB });
  assert(problems.some((s) => s.includes("do-not-program")));
});

Deno.test("out-of-vocabulary movements are rejected; empty vocabulary skips the check", () => {
  const p = proposal([{ movement: "Invented Machine Slam", sets: 3, reps: 10 }]);
  const problems = validateBlockProposal(p, { doNotProgram: [], vocabulary: VOCAB });
  assert(problems.some((s) => s.includes("vocabulary")));
  // Soft-fail posture: if the vocabulary fetch came back empty, don't reject everything.
  assertEquals(validateBlockProposal(p, { doNotProgram: [], vocabulary: [] }), []);
});

Deno.test("movements need a name and at least one volume specifier", () => {
  const noWork = proposal([{ movement: "Strict Press" }]);
  assert(validateBlockProposal(noWork, { doNotProgram: [], vocabulary: VOCAB })
    .some((s) => s.includes("no work specified")));
  const empty = proposal([]);
  assert(validateBlockProposal(empty, { doNotProgram: [], vocabulary: VOCAB })
    .some((s) => s.includes("no movements")));
  // rep_scheme alone is a valid specifier (the writer's preferred shape).
  const schemeOnly = proposal([{ movement: "Wall Ball", rep_scheme: [21, 15, 9] }]);
  assertEquals(validateBlockProposal(schemeOnly, { doNotProgram: [], vocabulary: VOCAB }), []);
});

Deno.test("reconcileReps matches the client: reps = sum of cleaned scheme", () => {
  assertEquals(reconcileReps(null, [21, 15, 9]), { reps: 45, rep_scheme: [21, 15, 9] });
  assertEquals(reconcileReps(10, null), { reps: 10, rep_scheme: null });
  assertEquals(reconcileReps(10, [0, -5]), { reps: 10, rep_scheme: null });
});

Deno.test("the tool fences block_id to today's blocks", () => {
  const tool = buildProposeBlockEditTool("lbs", [
    { id: "b1", block_type: "strength", block_label: null, block_scheme: "4x5" },
    { id: "b2", block_type: "metcon", block_label: null, block_scheme: "AMRAP 12" },
  ]);
  assertEquals(tool.name, "propose_block_edit");
  // deno-lint-ignore no-explicit-any
  const schema = tool.input_schema as any;
  assertEquals(schema.properties.block_id.enum, ["b1", "b2"]);
  assertEquals(schema.required, ["block_id", "rationale", "block"]);
  assert(schema.properties.block.properties.movements != null);
});
