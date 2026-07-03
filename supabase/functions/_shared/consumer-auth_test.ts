// deno test supabase/functions/_shared/consumer-auth_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  constantTimeEq,
  createConsumerAuth,
  parseConsumerKeys,
} from "./consumer-auth.ts";

Deno.test("constantTimeEq: equal / unequal / different-length", () => {
  assertEquals(constantTimeEq("abc", "abc"), true);
  assertEquals(constantTimeEq("abc", "abd"), false);
  assertEquals(constantTimeEq("abc", "abcd"), false);
});

Deno.test("parseConsumerKeys: single, array, missing, invalid", () => {
  assertEquals(parseConsumerKeys('{"k":"t1"}', "t"), { k: ["t1"] });
  assertEquals(parseConsumerKeys('{"k":["t1","t2"]}', "t"), { k: ["t1", "t2"] });
  assertEquals(parseConsumerKeys(undefined, "t"), {});
  assertEquals(parseConsumerKeys("not json", "t"), {}); // logs + fails closed
});

Deno.test("authorizeKey: service key resolves to any-tenant '*'", async () => {
  const auth = createConsumerAuth({ serviceKey: "svc", consumerKeysRaw: undefined, label: "t" });
  assertEquals(await auth.authorizeKey("svc"), "*");
  assertEquals(await auth.authorizeKey("wrong"), null);
});

Deno.test("authorizeKey: consumer key resolves to its bound tenants", async () => {
  const auth = createConsumerAuth({
    serviceKey: "svc",
    consumerKeysRaw: '{"gymkey":["gym_1","gym_2"]}',
    label: "t",
  });
  assertEquals(await auth.authorizeKey("gymkey"), ["gym_1", "gym_2"]);
  assertEquals(await auth.authorizeKey("svc"), "*"); // service still wins
  assertEquals(await auth.authorizeKey("nope"), null);
});

Deno.test("authorizes: admin any-tenant vs bound-list membership", () => {
  const auth = createConsumerAuth({ serviceKey: "svc", consumerKeysRaw: undefined, label: "t" });
  assertEquals(auth.authorizes("*", "anything"), true);
  assertEquals(auth.authorizes(["gym_1"], "gym_1"), true);
  assertEquals(auth.authorizes(["gym_1"], "gym_2"), false);
});

Deno.test("configured: false only when no keys at all", () => {
  assertEquals(createConsumerAuth({ serviceKey: undefined, consumerKeysRaw: undefined, label: "t" }).configured(), false);
  assertEquals(createConsumerAuth({ serviceKey: "svc", consumerKeysRaw: undefined, label: "t" }).configured(), true);
  assertEquals(createConsumerAuth({ serviceKey: undefined, consumerKeysRaw: '{"k":"t1"}', label: "t" }).configured(), true);
});
