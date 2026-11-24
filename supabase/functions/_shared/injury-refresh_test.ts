// deno test supabase/functions/_shared/injury-refresh_test.ts --no-check --allow-read
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { INJURY_REFRESH_ATTEMPTS, refreshAvoidListForBuild } from "./injury-refresh.ts";

const deps = (responses: Array<number | "throw">) => {
  const calls: Array<{ url: string; user: string | null }> = [];
  const logs: string[] = [];
  let i = 0;
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, user: (init.headers as Record<string, string>)["x-webhook-user-id"] ?? null });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r === "throw") return Promise.reject(new Error("connection reset"));
    return Promise.resolve(new Response("{}", { status: r }));
  }) as unknown as typeof fetch;
  return { calls, logs, d: { url: "https://x", serviceKey: "k", fetchFn, wait: () => Promise.resolve(), log: (l: string) => { logs.push(l); } } };
};

Deno.test("a re-read that works first time is called once", async () => {
  const t = deps([200]);
  assertEquals(await refreshAvoidListForBuild("u1", "test", t.d), true);
  assertEquals(t.calls.length, 1);
  assertEquals(t.calls[0], { url: "https://x/functions/v1/parse-injuries-constraints", user: "u1" });
  assertEquals(t.logs.length, 0);
});

Deno.test("a failed re-read is tried again, and a later success counts", async () => {
  const t = deps([500, "throw", 200]);
  assertEquals(await refreshAvoidListForBuild("u1", "test", t.d), true);
  assertEquals(t.calls.length, 3);
  assertEquals(t.logs.length, 2); // each failure is logged
});

Deno.test("after three failures it gives up without throwing, so the build carries on", async () => {
  const t = deps([500]);
  assertEquals(await refreshAvoidListForBuild("u1", "test", t.d), false);
  assertEquals(t.calls.length, INJURY_REFRESH_ATTEMPTS);
  assertEquals(INJURY_REFRESH_ATTEMPTS, 3);
});

Deno.test("the generator re-reads the note through the retrying helper before it builds", async () => {
  const gen = await Deno.readTextFile(new URL("../generate-program-v3/index.ts", import.meta.url));
  assertMatch(gen, /await refreshAvoidListForBuild\(userId, "generate-program-v3\.refresh"/);
  // …and before the payload is built from the list.
  const at = gen.indexOf("await refreshAvoidListForBuild(");
  assertEquals(at > 0 && at < gen.indexOf("const payload = await buildWriterPayload(supa, userId, {"), true);
});
