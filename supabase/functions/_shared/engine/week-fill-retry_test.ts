// deno test supabase/functions/_shared/engine/week-fill-retry_test.ts --no-check --allow-env
//
// A passing AI error is retried instead of failing the build (2026-11-23).
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ClaudeHttpError,
  isTransientFillError,
  WEEK_FILL_BUDGET_MS,
  WEEK_FILL_MIN_RETRY_WINDOW_MS,
  WEEK_FILL_RETRY_PAUSE_MS,
  withOneTransientRetry,
} from "./pipeline.ts";

const named = (name: string, message: string) => Object.assign(new Error(message), { name });
const timeout = () => named("TimeoutError", "Signal timed out.");
const network = () => new TypeError("error sending request for url (https://api.anthropic.com/v1/messages): connection reset");

/** A clock the test moves by hand; each attempt "takes" the time it is given. */
function harness(outcomes: Array<{ takesMs: number; result: unknown }>) {
  let t = 1_000_000;
  const seen: Array<{ attempt: number; windowMs: number }> = [];
  const slept: number[] = [];
  const run = () =>
    withOneTransientRetry((deadlineMs, n) => {
      seen.push({ attempt: n, windowMs: deadlineMs - t });
      const o = outcomes[n - 1];
      t += o.takesMs;
      return o.result instanceof Error ? Promise.reject(o.result) : Promise.resolve(o.result);
    }, {
      budgetMs: WEEK_FILL_BUDGET_MS, attemptTimeoutMs: 330_000, pauseMs: WEEK_FILL_RETRY_PAUSE_MS, minRetryWindowMs: WEEK_FILL_MIN_RETRY_WINDOW_MS,
      now: () => t, sleep: (ms) => { slept.push(ms); t += ms; return Promise.resolve(); },
    });
  return { run, seen, slept, elapsed: () => t - 1_000_000 };
}

Deno.test("429, 500, 502, 503, 504 and 529 are passing errors; 400, 401, 403 and 404 are not", () => {
  assertEquals([429, 500, 502, 503, 504, 529].map((s) => isTransientFillError(new ClaudeHttpError(s, ""))), [true, true, true, true, true, true]);
  assertEquals([400, 401, 403, 404].map((s) => isTransientFillError(new ClaudeHttpError(s, ""))), [false, false, false, false]);
});

Deno.test("a network error and a timeout are passing errors; a malformed reply is not, whatever words it quotes", () => {
  assertEquals(isTransientFillError(network()), true);
  assertEquals(isTransientFillError(new TypeError("fetch failed")), true);
  assertEquals(isTransientFillError(timeout()), true);
  assertEquals(isTransientFillError(named("AbortError", "The operation was aborted.")), true);
  assertEquals(isTransientFillError(new Error('week 2: missing emit_week tool_use. content=[{"text":"the network timed out"}]')), false);
  assertEquals(isTransientFillError(new Error("week 2: emit_week input malformed: expected 5 days, got 4")), false);
  assertEquals(isTransientFillError(new TypeError("Cannot read properties of undefined (reading 'days')")), false);
  assertEquals(isTransientFillError("529"), false);
});

Deno.test("a 529 is retried once after a short pause and the week is written", async () => {
  const h = harness([{ takesMs: 2_000, result: new ClaudeHttpError(529, "overloaded") }, { takesMs: 150_000, result: "the week" }]);
  assertEquals(await h.run(), "the week");
  assertEquals(h.seen.map((s) => s.attempt), [1, 2]);
  assertEquals(h.slept, [WEEK_FILL_RETRY_PAUSE_MS]);
});

Deno.test("a network error is retried once", async () => {
  const h = harness([{ takesMs: 500, result: network() }, { takesMs: 90_000, result: "the week" }]);
  assertEquals(await h.run(), "the week");
  assertEquals(h.seen.length, 2);
});

Deno.test("it is retried ONCE: a second passing error fails the stage", async () => {
  const h = harness([{ takesMs: 1_000, result: new ClaudeHttpError(503, "") }, { takesMs: 1_000, result: new ClaudeHttpError(503, "again") }, { takesMs: 1, result: "never reached" }]);
  await assertRejects(h.run, ClaudeHttpError, "Claude HTTP 503: again");
  assertEquals(h.seen.length, 2);
});

Deno.test("400, 401, 403 and 404 are not retried", async () => {
  for (const status of [400, 401, 403, 404]) {
    const h = harness([{ takesMs: 300, result: new ClaudeHttpError(status, "no") }, { takesMs: 1, result: "never reached" }]);
    await assertRejects(h.run, ClaudeHttpError, `Claude HTTP ${status}`);
    assertEquals(h.seen.length, 1, String(status));
    assertEquals(h.slept, []);
  }
});

Deno.test("a malformed reply is not retried", async () => {
  const h = harness([{ takesMs: 120_000, result: new Error("week 2: emit_week input malformed: day 3 has no blocks") }, { takesMs: 1, result: "never reached" }]);
  await assertRejects(h.run, Error, "malformed");
  assertEquals(h.seen.length, 1);
});

Deno.test("total time stays inside the stage's budget: the retry gets only what is left", async () => {
  const h = harness([{ takesMs: 200_000, result: timeout() }, { takesMs: 100_000, result: "the week" }]);
  assertEquals(await h.run(), "the week");
  assertEquals(h.seen[0].windowMs, 330_000);
  assertEquals(h.seen[1].windowMs, WEEK_FILL_BUDGET_MS - 200_000 - WEEK_FILL_RETRY_PAUSE_MS); // 155s, not a fresh 330s
  assertEquals(h.elapsed() <= WEEK_FILL_BUDGET_MS, true);
});

Deno.test("a timeout that used up the whole first window is not retried: there is no room left", async () => {
  const h = harness([{ takesMs: 330_000, result: timeout() }, { takesMs: 1, result: "never reached" }]);
  await assertRejects(h.run, Error, "timed out");
  assertEquals(h.seen.length, 1);
  assertEquals(h.slept, []);
});

Deno.test("the worst case, two attempts and the pause, fits under the 400-second limit of one invocation", () => {
  assertEquals(WEEK_FILL_BUDGET_MS < 400_000, true);
  assertEquals(WEEK_FILL_MIN_RETRY_WINDOW_MS + WEEK_FILL_RETRY_PAUSE_MS < WEEK_FILL_BUDGET_MS, true);
});
