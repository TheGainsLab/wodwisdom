import { assert, assertEquals, assertNotEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { coachStateInputsHash, coachStateShapeProblems, generateAndPersistCoachState } from "./generate-coach-state.ts";
import { COACH_STATE_BUILDER_VERSION } from "./coach-state.ts";
import { persistCoachState } from "./persist-coach-state.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

const sound = {
  priorities: [], maintain: [], deprioritize: [],
  recovery_posture: { reasons: [] }, strength_emphasis: { reasons: [] },
};

Deno.test("sound shape has no problems", () => {
  assertEquals(coachStateShapeProblems(sound), []);
});

Deno.test("cut-off input (lists missing) is named field by field", () => {
  assertEquals(coachStateShapeProblems({ headline: "x", summary: "y" }), [
    "priorities must be a list",
    "maintain must be a list",
    "deprioritize must be a list",
    "recovery_posture.reasons must be a list",
    "strength_emphasis.reasons must be a list",
  ]);
});

Deno.test("a list emitted as an object is caught", () => {
  assertEquals(coachStateShapeProblems({ ...sound, priorities: { focus: "squat" } }), ["priorities must be a list"]);
});

// ── Reuse only while goal, days, session length, injuries and notes are unchanged (2026-11-23) ──

const INPUTS = {
  goal_text: "Get strong",
  days_per_week: 4,
  session_length_minutes: 60,
  injuries_constraints_text: "Left knee: no running",
  coach_notes: ["more pull-ups", "travelling next week"],
};

/** coach_states + athlete_profiles in memory; filters are really applied. */
function fakeSupa(rows: Any[], opts: { noHashColumn?: boolean } = {}) {
  const db = { rows: rows.map((r) => ({ ...r })), inserts: [] as Any[] };
  const supa = {
    from(table: string) {
      const filters: Array<(r: Any) => boolean> = [];
      let selected = "";
      const chain: Any = {
        select(cols: string) { selected = cols; return chain; },
        eq(col: string, v: Any) { filters.push((r) => r[col] === v); return chain; },
        gt(col: string, v: Any) { filters.push((r) => r[col] > v); return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() {
          if (table === "athlete_profiles") return Promise.resolve({ data: { programs_archived_at: null }, error: null });
          if (opts.noHashColumn && selected.includes("inputs_hash")) {
            return Promise.resolve({ data: null, error: { message: "column coach_states.inputs_hash does not exist" } });
          }
          const hit = db.rows.filter((r) => filters.every((f) => f(r))).sort((a, b) => b.version - a.version)[0] ?? null;
          return Promise.resolve({ data: hit, error: null });
        },
        insert(row: Any) {
          db.inserts.push(row);
          if (opts.noHashColumn && "inputs_hash" in row) {
            return Promise.resolve({ error: { message: "Could not find the 'inputs_hash' column of 'coach_states' in the schema cache" } });
          }
          db.rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  } as Any;
  return { db, supa };
}
const payloadFor = (tc: typeof INPUTS) => ({ athlete_model: { version: 7 }, training_context: tc }) as Any;
const storedRow = (inputs_hash: string | null, version = 3) => ({
  user_id: "u", version, athlete_model_version: 7, coach_state_builder_version: COACH_STATE_BUILDER_VERSION,
  content_hash: "c", inputs_hash, coach_state: { headline: `stored v${version}` }, created_at: "2026-11-01T00:00:00Z",
});
// A miss goes on to call the model. With no key configured that call stops at
// once with a known error, which is how these tests see "not reused" without
// a network. With a key present they are skipped rather than spend a call.
const noKey = !Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") && !Deno.env.get("ANTHROPIC_API_KEY");
const NOT_REUSED = "ANTHROPIC_API_KEY not configured";

Deno.test("the inputs hash changes with each of the five inputs, and with nothing else", async () => {
  const h = await coachStateInputsHash(INPUTS);
  assertEquals(h.length, 64);
  assertEquals(await coachStateInputsHash({ ...INPUTS }), h);
  assertNotEquals(await coachStateInputsHash({ ...INPUTS, goal_text: "Get strong and fix my snatch" }), h);
  assertNotEquals(await coachStateInputsHash({ ...INPUTS, days_per_week: 3 }), h);
  assertNotEquals(await coachStateInputsHash({ ...INPUTS, session_length_minutes: 45 }), h);
  assertNotEquals(await coachStateInputsHash({ ...INPUTS, injuries_constraints_text: "None" }), h);
  assertNotEquals(await coachStateInputsHash({ ...INPUTS, coach_notes: ["more pull-ups"] }), h);
  // Not a change: surrounding whitespace, the order of the notes, any other field.
  assertEquals(await coachStateInputsHash({ ...INPUTS, goal_text: "  Get strong\n", coach_notes: ["travelling next week", " more pull-ups "] }), h);
  assertEquals(await coachStateInputsHash({ ...INPUTS, self_perception_level: "advanced", injuries_structured: { do_not_program: ["Running"] } } as Any), h);
});

Deno.test("a stored state is reused when the model version AND the inputs hash match", async () => {
  const { db, supa } = fakeSupa([storedRow(await coachStateInputsHash(INPUTS))]);
  const r = await generateAndPersistCoachState(supa, "u", payloadFor(INPUTS));
  assertEquals([r.reused, r.version, (r.coach_state as Any).headline], [true, 3, "stored v3"]);
  assertEquals(db.inserts, []);
});

Deno.test({
  name: "a stored state with NO hash (written before the column) is not reused: a fresh judgment is attempted",
  ignore: !noKey,
  fn: async () => {
    const { supa } = fakeSupa([storedRow(null)]);
    await assertRejects(() => generateAndPersistCoachState(supa, "u", payloadFor(INPUTS)), Error, NOT_REUSED);
  },
});

Deno.test({
  name: "a stored state made from an older goal is not reused once the goal changes (same athlete model version)",
  ignore: !noKey,
  fn: async () => {
    const { supa } = fakeSupa([storedRow(await coachStateInputsHash(INPUTS))]);
    const changed = { ...INPUTS, goal_text: "Get strong\n\nNov 2026: first muscle-up" };
    await assertRejects(() => generateAndPersistCoachState(supa, "u", payloadFor(changed)), Error, NOT_REUSED);
    // ...and the inputs it was made from still reuse it.
    assertEquals((await generateAndPersistCoachState(supa, "u", payloadFor(INPUTS))).reused, true);
  },
});

Deno.test({
  name: "each of days, session length, injury text and notes also ends the reuse",
  ignore: !noKey,
  fn: async () => {
    const { supa } = fakeSupa([storedRow(await coachStateInputsHash(INPUTS))]);
    for (const changed of [
      { ...INPUTS, days_per_week: 3 },
      { ...INPUTS, session_length_minutes: 45 },
      { ...INPUTS, injuries_constraints_text: "Left knee: no running. Right shoulder: no overhead." },
      { ...INPUTS, coach_notes: [...INPUTS.coach_notes, "no rower this week"] },
    ]) {
      await assertRejects(() => generateAndPersistCoachState(supa, "u", payloadFor(changed)), Error, NOT_REUSED);
    }
  },
});

Deno.test({
  name: "before the migration (no inputs_hash column) nothing is reused wrongly",
  ignore: !noKey,
  fn: async () => {
    const { supa } = fakeSupa([storedRow(null)], { noHashColumn: true });
    await assertRejects(() => generateAndPersistCoachState(supa, "u", payloadFor(INPUTS)), Error, NOT_REUSED);
  },
});

Deno.test("a new state is stored WITH its inputs hash, and is then the one reused", async () => {
  const { db, supa } = fakeSupa([storedRow(null)]);
  const hash = await coachStateInputsHash(INPUTS);
  const content = { headline: "fresh", coach_state_builder_version: COACH_STATE_BUILDER_VERSION } as Any;
  const p = await persistCoachState(supa, "u", content, 7, null, hash);
  assertEquals([p.persisted, p.version], [true, 4]);
  assertEquals(db.inserts[0].inputs_hash, hash);
  const r = await generateAndPersistCoachState(supa, "u", payloadFor(INPUTS));
  assertEquals([r.reused, r.version], [true, 4]);
});

Deno.test("the same judgment made from changed inputs is a NEW row (so the new inputs have something to reuse)", async () => {
  const { db, supa } = fakeSupa([]);
  const content = { headline: "same words", coach_state_builder_version: COACH_STATE_BUILDER_VERSION } as Any;
  const a = await persistCoachState(supa, "u", content, 7, null, "hash-a");
  const again = await persistCoachState(supa, "u", content, 7, null, "hash-a");
  const b = await persistCoachState(supa, "u", content, 7, null, "hash-b");
  assertEquals([a.version, again.persisted, again.version, b.persisted, b.version], [1, false, 1, true, 2]);
  assertEquals(db.rows.map((r: Any) => r.inputs_hash), ["hash-a", "hash-b"]);
});

Deno.test("a caller that passes no hash stores none", async () => {
  const { db, supa } = fakeSupa([]);
  await persistCoachState(supa, "u", { headline: "x", coach_state_builder_version: "b" } as Any, 7);
  assert(!("inputs_hash" in db.inserts[0]));
});

Deno.test("code running before the migration still saves the judgment (without the hash) instead of failing the build", async () => {
  const { db, supa } = fakeSupa([], { noHashColumn: true });
  const p = await persistCoachState(supa, "u", { headline: "x", coach_state_builder_version: "b" } as Any, 7, null, "hash-a");
  assertEquals(p.persisted, true);
  assertEquals(db.inserts.length, 2);
  assert(!("inputs_hash" in db.rows[0]));
});
