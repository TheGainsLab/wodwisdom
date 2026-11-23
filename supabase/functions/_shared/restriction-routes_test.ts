// deno test supabase/functions/_shared/restriction-routes_test.ts --no-check --allow-env --allow-read
//
// THE PROMISE, AS A TEST: every route by which AI-written training reaches an
// athlete passes through the restriction check, and a NEW route cannot be
// added without declaring itself here.
//
// Why this exists (2026-11-23): the check was first built into the program
// generator only. The coach's day edit and the uploaded-program rewrite were
// left out, by omission, not decision. This test reads the source: it fails
// if a known route stops calling the check, and it fails if a function that
// was not on the list starts writing training.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gateBlock, type Restrictions } from "./restriction-gate.ts";
import { avoidNamesIn, reviewTextChanges } from "./restriction-text.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

const FN = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, FN));

/** Tables that hold what an athlete is told to do. */
const TRAINING_TABLES = ["program_movements_v2", "program_blocks_v2", "program_workout_blocks", "modified_workouts", "program_workouts"];

/**
 * Every edge function allowed to write those tables, and why it is safe.
 *   gated     = AI-written content; the named call must appear in the source.
 *   not_ai    = the athlete's own entry, a parse of existing text, or bookkeeping.
 *   excluded  = decided out of scope by the founder, with the date.
 */
const ROUTES: Record<string, { kind: "gated"; via: string; file: string } | { kind: "not_ai" | "excluded"; why: string }> = {
  "generate-program-v3": { kind: "gated", via: "runRestrictionGate(", file: "generate-program-v3/index.ts" },
  "chat": { kind: "gated", via: "gateBlock(", file: "chat/index.ts" },
  "incorporate-movements": { kind: "gated", via: "reviewTextChanges(", file: "incorporate-movements/index.ts" },
  "apply-block-edit": { kind: "not_ai", why: "applies a proposal that chat already gated and logged; it writes no content of its own" },
  "finalize-modification": { kind: "not_ai", why: "applies rewrites that incorporate-movements already gated; the athlete accepts or rejects each" },
  "preprocess-program": { kind: "not_ai", why: "stores the athlete's own uploaded program as they wrote it" },
  "save-workout-block": { kind: "not_ai", why: "the athlete logging what they did" },
  "sync-program-blocks": { kind: "not_ai", why: "splits existing workout text into blocks; adds no movements" },
  "parse-strength": { kind: "not_ai", why: "parses existing text" },
  "parse-accessory": { kind: "not_ai", why: "parses existing text" },
  "parse-metcon": { kind: "not_ai", why: "parses existing text" },
  "parse-skills": { kind: "not_ai", why: "parses existing text" },
  "analyze-program": { kind: "not_ai", why: "reads a program to analyse it; rewrites come only through incorporate-movements" },
  "workout-review": { kind: "not_ai", why: "reviews a logged workout; does not change the program" },
  "ailog-gap-analysis": { kind: "not_ai", why: "analysis of logged training; not called by the app" },
  "generate-next-month": { kind: "not_ai", why: "starts a generate-program-v3 job; writes no training itself" },
  "admin-data": { kind: "not_ai", why: "admin reads and archive/restore; writes no training content" },
  "admin-rebuild-month": { kind: "not_ai", why: "admin deletes a month and starts a generate-program-v3 build for it; the rebuilt month goes through the gate like any other" },
  "adjust-workout": { kind: "excluded", why: "old AI Edit: deployed but nothing in the app calls it, and it only proposes (founder, 2026-11-23: leave, remove later)" },
  "generate-program": { kind: "excluded", why: "the first generator: nothing calls it any more (v3 replaced it)" },
  "generate-program-v2": { kind: "excluded", why: "the second generator: nothing calls it any more" },
  "gym-generate": { kind: "excluded", why: "gym class programs: a separate product with no individual injury notes (founder, 2026-11-23)" },
  "gym-program": { kind: "excluded", why: "gym class programs (see gym-generate)" },
};

function functionsWritingTraining(): string[] {
  const out: string[] = [];
  for (const e of Deno.readDirSync(FN)) {
    if (!e.isDirectory || e.name.startsWith("_")) continue;
    let src = "";
    try { src = read(`${e.name}/index.ts`); } catch { continue; }
    const writes = TRAINING_TABLES.some((t) => {
      const re = new RegExp(`from\\(["']${t}["']\\)[\\s\\S]{0,160}?\\.(insert|update|upsert|delete)\\(`);
      return re.test(src);
    });
    if (writes) out.push(e.name);
  }
  return out.sort();
}

Deno.test("every function that writes training is on the list, with a reason", () => {
  const unknown = functionsWritingTraining().filter((f) => !(f in ROUTES));
  assertEquals(unknown, [], `These functions write training and are not declared in ROUTES. Add each one: gated (and call the restriction check), not_ai, or excluded with the founder's decision: ${unknown.join(", ")}`);
});

Deno.test("every gated route still calls the restriction check", () => {
  for (const [name, r] of Object.entries(ROUTES)) {
    if (r.kind !== "gated") continue;
    assert(read(r.file).includes(r.via), `${name} no longer calls ${r.via} — AI-written training would reach athletes unchecked`);
  }
});

Deno.test("the generator has ONE door to saving, and it is the gate", () => {
  const src = read("generate-program-v3/index.ts");
  assertEquals((src.match(/next: "saving"/g) ?? []).length, 1, "a second path to saving would bypass the gate");
  const stage = src.slice(src.indexOf("async function stageSafetyReview"), src.indexOf("async function stageSaving"));
  assert(stage.includes("runRestrictionGate(") && stage.includes('next: "saving"'));
});

Deno.test("the coach's day edit is gated BEFORE the proposal is recorded or shown", () => {
  const src = read("chat/index.ts");
  const gate = src.indexOf("gateBlock(input.block");
  const log = src.indexOf('.from("ai_edit_log")', gate);
  const card = src.indexOf('type: "proposal"', gate);
  assert(gate > 0 && log > gate && card > log, "gateBlock must run before the ai_edit_log insert and the proposal card");
  // If the check cannot run, nothing unchecked may be offered.
  const between = src.slice(gate, log);
  assert(between.includes("catch (e)") && between.includes("it was not offered"));
});

Deno.test("the uploaded-program rewrite is gated BEFORE anything is saved", () => {
  const src = read("incorporate-movements/index.ts");
  const review = src.indexOf("reviewTextChanges(");
  const save = src.indexOf('.from("modified_workouts")');
  assert(review > 0 && save > review);
  assert(src.includes("const modifications = reviewed.kept"), "only reviewed rewrites may be saved");
});

// ── The two new routes, behaving ───────────────────────────────────────────

const KNEE: Restrictions = {
  injuriesText: "Runners Knee, no lunges or back squats",
  doNotProgram: ["running", "400m run", "back squat", "walking lunge"],
  suggestedSubs: [],
  vocabulary: ["Run", "Bike", "Row", "Goblet Squat", "Back Squat", "Walking Lunge", "Push Up"],
};
const flagRuns = (out: Any) => Promise.resolve(
  out.weeks[0].days[0].blocks[0].movements
    .map((m: Any, i: number) => ({ m, i }))
    .filter(({ m }: Any) => /run|lunge|back squat/i.test(m.movement))
    .map(({ m, i }: Any) => ({ week_num: 1, day_num: 1, block_index: 0, movement_index: i, movement: m.movement, reason: "runner's knee", replacement: { movement: "Bike", time_seconds: 180 } })),
);

Deno.test("coach edit: a run proposed for a runner's-knee athlete is swapped before the card", async () => {
  const proposal = { block_type: "metcon", movements: [{ movement: "Run", distance: 400, distance_unit: "m" }, { movement: "Push Up", rep_scheme: [15] }] };
  const g = await gateBlock(proposal, KNEE, { judge: flagRuns });
  assertEquals(g.block!.movements!.map((m) => m.movement), ["Bike", "Push Up"]);
  assertEquals(g.actions.length, 1);
  assert(!g.actions[0].startsWith("W1D1"));
  assertEquals(proposal.movements[0].movement, "Run"); // the caller's object is not mutated
});

Deno.test("coach edit: with the AI unreachable the banned name still cannot be offered", async () => {
  const g = await gateBlock({ block_type: "metcon", movements: [{ movement: "Run", distance: 400 }, { movement: "Push Up", reps: 10 }] }, KNEE, { judge: () => Promise.resolve(null) });
  assertEquals(g.block!.movements!.map((m) => m.movement), ["Push Up"]);
  assert(g.judgeUnavailable);
});

Deno.test("coach edit: a proposal that is ONLY the banned movement comes back empty, so the coach must re-propose", async () => {
  const g = await gateBlock({ block_type: "cool-down", movements: [{ movement: "Run", time_seconds: 300 }] }, KNEE, { judge: () => Promise.resolve(null) });
  assertEquals(g.block, null);
});

Deno.test("coach edit: a clean proposal is offered exactly as written", async () => {
  const p = { block_type: "strength", movements: [{ movement: "Goblet Squat", sets: 4, reps: 8, weight: 24, weight_unit: "kg" }] };
  const g = await gateBlock(p, KNEE, { judge: () => Promise.resolve([]) });
  assertEquals(g.block, p); assertEquals(g.actions, []);
});

const CH = [
  { id: "w1", original_text: "5 rounds: 10 push-ups, 15 air squats", modified_text: "5 rounds: 10 push-ups, 15 air squats, 400m run" },
  { id: "w2", original_text: "Back Squat 5x5", modified_text: "Back Squat 5x5 then 3x10 ring rows" },
  { id: "w3", original_text: "AMRAP 12: burpees, sit-ups", modified_text: "AMRAP 12: burpees, sit-ups, 20 cal bike" },
];

Deno.test("uploaded program: avoid-list names are found as whole words; the last look errs on the side of dropping", () => {
  assertEquals(avoidNamesIn("400m Run, then rest", KNEE.doNotProgram), ["run"]);
  assertEquals(avoidNamesIn("prune the list", KNEE.doNotProgram), []); // not inside another word
  // Deliberately blunt: "row" is also found in "ring rows". This look only ever
  // DROPS an AI rewrite (the athlete keeps their own workout), so a false
  // alarm costs an optional change, never safety. Choosing swaps is the AI's job.
  assertEquals(avoidNamesIn("3x10 ring rows", ["row"]), ["row"]);
});

Deno.test("uploaded program: the AI's correction is used; clean rewrites pass untouched", async () => {
  const judge = () => Promise.resolve([{ id: "w1", reason: "no running", corrected_text: "5 rounds: 10 push-ups, 15 air squats, 20 cal bike" }]);
  const r = await reviewTextChanges(CH, KNEE, { judge });
  assertEquals(r.kept.map((c) => c.id), ["w1", "w2", "w3"]);
  assertEquals(r.kept[0].modified_text, "5 rounds: 10 push-ups, 15 air squats, 20 cal bike");
  assertEquals(r.kept[2].modified_text, CH[2].modified_text);
});

Deno.test("uploaded program: AI unreachable — a rewrite that ADDS a banned movement is dropped, the original stays", async () => {
  const r = await reviewTextChanges(CH, KNEE, { judge: () => Promise.resolve(null) });
  assertEquals(r.kept.map((c) => c.id), ["w2", "w3"]); // w1 added a run
  assert(r.judgeUnavailable && r.actions[0].includes("dropped"));
});

Deno.test("uploaded program: a banned movement already in the athlete's OWN workout does not block a rewrite of it", async () => {
  // w2's original is their own Back Squat day; the rewrite did not add it.
  const r = await reviewTextChanges([CH[1]], KNEE, { judge: () => Promise.resolve([]) });
  assertEquals(r.kept.length, 1);
});

Deno.test("uploaded program: a judge that throws never stops the request and never lets a banned addition through", async () => {
  const r = await reviewTextChanges(CH, KNEE, { judge: () => Promise.reject(new Error("down")) });
  assertEquals(r.kept.map((c) => c.id), ["w2", "w3"]);
});
