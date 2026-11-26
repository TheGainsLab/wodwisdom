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
  "incorporate-movements": { kind: "excluded", why: "Analyze my program: the athlete picks movements to add to their OWN uploaded program; no avoid-list handling on this route (founder, 2026-11-26)" },
  "apply-block-edit": { kind: "not_ai", why: "applies a proposal that chat already gated and logged; it writes no content of its own" },
  "finalize-modification": { kind: "not_ai", why: "applies rewrites from incorporate-movements; the athlete accepts or rejects each" },
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

Deno.test("the fit check runs on the generator and on coach edits, before the restriction check has the last word", () => {
  const gen = read("generate-program-v3/index.ts");
  const stage = gen.slice(gen.indexOf("async function stageSafetyReview"), gen.indexOf("async function stageSaving"));
  const fit = stage.indexOf("runFitGate("); const restr = stage.indexOf("runRestrictionGate(");
  assert(fit > 0 && restr > fit, "the fit gate must run, and before the restriction gate");
  const chat = read("chat/index.ts");
  const cFit = chat.indexOf("fitBlock(input.block"); const cRestr = chat.indexOf("gateBlock(input.block");
  assert(cFit > 0 && cRestr > cFit && chat.indexOf('.from("ai_edit_log")', cRestr) > cRestr);
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

Deno.test("Analyze my program has no avoid-list handling: no refusal by name, no review, no dropped rewrite (2026-11-26)", () => {
  const src = read("incorporate-movements/index.ts");
  for (const gone of ["isRuledOutByName", "reviewTextChanges", "loadRestrictions", "MOVEMENT_RULED_OUT", "restriction-text"]) {
    assert(!src.includes(gone), `${gone} is back in incorporate-movements`);
  }
  assert(src.includes("const modifications = proposed;"));
  let exists = true;
  try { read("_shared/restriction-text.ts"); } catch { exists = false; }
  assertEquals(exists, false, "restriction-text.ts has no caller and was removed");
});

// ── The coach's day edit, behaving ───────────────────────────────────────────

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

Deno.test("coach edit: with the AI unreachable the proposal is offered as written — no code matches names against the avoid list", async () => {
  const g = await gateBlock({ block_type: "metcon", movements: [{ movement: "Run", distance: 400 }, { movement: "Push Up", reps: 10 }] }, KNEE, { judge: () => Promise.resolve(null) });
  assertEquals(g.block!.movements!.map((m) => m.movement), ["Run", "Push Up"]);
  assertEquals(g.actions, []);
  assert(g.judgeUnavailable);
});

Deno.test("coach edit: a proposal the AI rules out entirely, with no replacement named, comes back empty, so the coach must re-propose", async () => {
  const noReplacement = (out: Any) => Promise.resolve(
    (out.weeks[0].days[0].blocks[0]?.movements ?? []).map((m: Any, i: number) => ({ week_num: 1, day_num: 1, block_index: 0, movement_index: i, movement: m.movement, reason: "runner's knee", replacement: { movement: "" } })),
  );
  const g = await gateBlock({ block_type: "cool-down", movements: [{ movement: "Run", time_seconds: 300 }] }, KNEE, { judge: noReplacement });
  assertEquals(g.block, null);
});

Deno.test("coach edit: a clean proposal is offered exactly as written", async () => {
  const p = { block_type: "strength", movements: [{ movement: "Goblet Squat", sets: 4, reps: 8, weight: 24, weight_unit: "kg" }] };
  const g = await gateBlock(p, KNEE, { judge: () => Promise.resolve([]) });
  assertEquals(g.block, p); assertEquals(g.actions, []);
});
