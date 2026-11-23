// deno test supabase/functions/_shared/engine/week-fill-call_test.ts --no-check --allow-env
//
// callWeekFill itself, against a stand-in for the model API (2026-11-23): a
// passing HTTP error is retried once; a 400 is not. No network is used.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
// deno-lint-ignore no-explicit-any
type Any = any;

// The key is read once when pipeline.ts loads; give that load a dummy and
// put the environment back so no other test sees it.
const KEYS = ["ANTHROPIC_API_KEY_PIPELINE", "WEEK_FILL_MODEL"];
const before = KEYS.map((k) => Deno.env.get(k));
Deno.env.set("ANTHROPIC_API_KEY_PIPELINE", "test-key-not-real");
Deno.env.delete("WEEK_FILL_MODEL");
const { callWeekFill } = await import("./pipeline.ts");
KEYS.forEach((k, i) => (before[i] == null ? Deno.env.delete(k) : Deno.env.set(k, before[i]!)));

const PAYLOAD: Any = {
  basics: { units: "kg" }, lifts: {}, skills: {}, conditioning: {}, equipment: {}, vocabulary: ["Back Squat"],
  training_context: { days_per_week: 3, session_length_minutes: 60, coach_notes: [], injuries_constraints_text: null, injuries_structured: null },
};
const SKELETON: Any = { month_plan: {}, weeks: [{ week_num: 2, weekly_intent: "build", days: [1, 2, 3].map((d) => ({ day_num: d, block_types: ["strength"] })) }] };
const PACK: Any = { writer: { weekFillSystemPrompt: "system", buildWeekTool: () => ({ name: "emit_week", input_schema: { type: "object" } }) } };
const WEEK = { week_num: 9, days: [1, 2, 3].map((d) => ({ day_num: d, blocks: [{ block_type: "strength", movements: [{ movement: "Back Squat", sets: 5, reps: 5 }] }] })) };
const ok = () => new Response(JSON.stringify({ stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: "emit_week", input: WEEK }] }), { status: 200 });
const fail = (status: number) => new Response(JSON.stringify({ error: { type: "overloaded_error" } }), { status });

/** Replace fetch and the pause for one call; returns how many requests were made. */
async function withApi<T>(replies: Array<() => Response | Promise<Response>>, run: () => Promise<T>): Promise<{ result?: T; error?: unknown; requests: number }> {
  const realFetch = globalThis.fetch; const realSetTimeout = globalThis.setTimeout;
  let requests = 0;
  globalThis.fetch = ((_url: Any, _init: Any) => Promise.resolve().then(() => replies[requests++]())) as Any;
  globalThis.setTimeout = ((fn: Any, _ms?: number, ...args: Any[]) => realSetTimeout(fn, 0, ...args)) as Any; // skip the 5-second pause
  try { return { result: await run(), requests }; }
  catch (error) { return { error, requests }; }
  finally { globalThis.fetch = realFetch; globalThis.setTimeout = realSetTimeout; }
}
const fill = () => callWeekFill(PAYLOAD, SKELETON, 2, [], "", PACK);
const opts = { sanitizeOps: false, sanitizeResources: false }; // AbortSignal.timeout leaves its timer behind

Deno.test("the week fill survives one overloaded (529) reply: it asks again and returns the week", opts, async () => {
  const r = await withApi([() => fail(529), ok], fill);
  assertEquals(r.requests, 2);
  assertEquals(r.result!.week_num, 2);
  assertEquals(r.result!.days.length, 3);
});

Deno.test("the week fill survives one network failure", opts, async () => {
  const r = await withApi([() => Promise.reject(new TypeError("error sending request: connection reset")), ok], fill);
  assertEquals([r.requests, r.result!.days.length], [2, 3]);
});

Deno.test("the week fill is retried once only: two 503s in a row fail it", opts, async () => {
  const r = await withApi([() => fail(503), () => fail(503), ok], fill);
  assertEquals(r.requests, 2);
  await assertRejects(() => Promise.reject(r.error), Error, "Claude HTTP 503");
});

Deno.test("the week fill does not retry a 400, 401, 403 or 404", opts, async () => {
  for (const status of [400, 401, 403, 404]) {
    const r = await withApi([() => fail(status), ok], fill);
    assertEquals(r.requests, 1, String(status));
    await assertRejects(() => Promise.reject(r.error), Error, `Claude HTTP ${status}`);
  }
});
