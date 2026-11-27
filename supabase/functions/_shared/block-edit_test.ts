/**
 * block-edit_test.ts — the pure halves of the chat coach's hands: proposal
 * validation (safety is forever-hard), rep reconciliation, and the tool's
 * block_id fence.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import type { BlockPrescription } from "./v2-output-schema.ts";
import {
  applyBlockProposal,
  buildProposeBlockEditTool,
  purposeAfterEdit,
  reconcileReps,
  validateBlockProposal,
} from "./block-edit.ts";

function proposal(movements: BlockPrescription["movements"]): BlockPrescription {
  // Every prescription block declares its typed format (the checker requires it).
  return { block_type: "strength", block_scheme: "4x5", scheme_format: { format: "straight_sets", rest_seconds: 90 }, movements };
}

Deno.test("a legal proposal passes", () => {
  const p = proposal([{ movement: "Dumbbell Bench Press", sets: 4, reps: 8, weight: 50 }]);
  assertEquals(validateBlockProposal(p, { doNotProgram: [] }), []);
});

Deno.test("the format check does not match names against the avoid list (2026-11-26): the restriction check reads the proposal by meaning", () => {
  const p = proposal([{ movement: "Back Squat", sets: 4, reps: 5, weight: 225 }]);
  assertEquals(validateBlockProposal(p, { doNotProgram: ["Back Squat"] }), []);
  assertEquals(validateBlockProposal(p), []);
});

Deno.test("movement naming is free — off-catalog names pass (2026-09: Echo Bike / KB Row)", () => {
  const p = proposal([{ movement: "Kettlebell Row", sets: 3, reps: 10, weight: 40 }]);
  assertEquals(validateBlockProposal(p, { doNotProgram: [] }), []);
});

Deno.test("movements need a name and at least one volume specifier", () => {
  const noWork = proposal([{ movement: "Strict Press" }]);
  assert(validateBlockProposal(noWork, { doNotProgram: [] })
    .some((s) => s.includes("no work specified")));
  const empty = proposal([]);
  assert(validateBlockProposal(empty, { doNotProgram: [] })
    .some((s) => s.includes("no movements")));
  // rep_scheme alone is a valid specifier (the writer's preferred shape).
  const schemeOnly = proposal([{ movement: "Wall Ball", rep_scheme: [21, 15, 9] }]);
  assertEquals(validateBlockProposal(schemeOnly, { doNotProgram: [] }), []);
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

// ── Applied edit: the old purpose line is replaced by the coach's reason (2026-11-26) ──

function fakeSupa(failColumn?: string) {
  const updates: Array<Record<string, unknown>> = [];
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => ({
    update: (row: Record<string, unknown>) => ({
      eq: () => {
        if (table === "program_blocks_v2") {
          if (failColumn && failColumn in row) return Promise.resolve({ error: { message: `column "${failColumn}" does not exist` } });
          updates.push(row);
        }
        return Promise.resolve({ error: null });
      },
    }),
    delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    insert: () => Promise.resolve({ error: null }),
  });
  // deno-lint-ignore no-explicit-any
  return { supa: { from } as any, updates };
}

const metcon = (extra: Record<string, unknown> = {}): BlockPrescription => ({
  block_type: "metcon", block_scheme: "AMRAP 12", scheme_format: { format: "amrap", minutes: 12 },
  movements: [{ movement: "Burpee", rep_scheme: [10] }], ...extra,
} as BlockPrescription);

Deno.test("an applied edit replaces the old purpose line with the coach's reason for the change", async () => {
  const { supa, updates } = fakeSupa();
  await applyBlockProposal(supa, "b1", metcon({ stimulus_note: "  Swapped the wall balls for burpees: same 12-minute push, no ball needed.  " }));
  assertEquals(updates[0].stimulus_note, "Swapped the wall balls for burpees: same 12-minute push, no ball needed.");
});

Deno.test("an applied edit with no reason still clears the old purpose line", async () => {
  const { supa, updates } = fakeSupa();
  await applyBlockProposal(supa, "b1", metcon());
  assert("stimulus_note" in updates[0]);
  assertEquals(updates[0].stimulus_note, null);
  assertEquals(purposeAfterEdit(metcon({ stimulus_note: "   " })), null);
});

Deno.test("before the purpose column exists, the edit still saves", async () => {
  const { supa, updates } = fakeSupa("stimulus_note");
  await applyBlockProposal(supa, "b1", metcon({ stimulus_note: "Reason" }));
  assertEquals(updates.length, 1);
  assertEquals("stimulus_note" in updates[0], false);
});

Deno.test("the coach's reason is stored with the proposal it applies to", () => {
  const chat = Deno.readTextFileSync(new URL("../chat/index.ts", import.meta.url));
  assert(chat.includes('proposal: { ...input.block, stimulus_note: (input.rationale ?? "").trim() || undefined },'));
});
