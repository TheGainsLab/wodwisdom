// deno test supabase/functions/_shared/consumer-auth_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  constantTimeEq,
  createConsumerAuth,
  parseConsumerKeys,
} from "./consumer-auth.ts";

// Keys must be ≥16 chars to be accepted (short entries are misconfig, not creds).
const SVC = "service_key_abcdef123456";
const GYMKEY = "gymkey_abcdef1234567";

Deno.test("constantTimeEq: equal / unequal / different-length", () => {
  assertEquals(constantTimeEq("abc", "abc"), true);
  assertEquals(constantTimeEq("abc", "abd"), false);
  assertEquals(constantTimeEq("abc", "abcd"), false);
});

Deno.test("parseConsumerKeys: object with string / array values", () => {
  assertEquals(parseConsumerKeys(`{"${GYMKEY}":"t1"}`, "t"), { [GYMKEY]: ["t1"] });
  assertEquals(parseConsumerKeys(`{"${GYMKEY}":["t1","t2"]}`, "t"), { [GYMKEY]: ["t1", "t2"] });
  assertEquals(parseConsumerKeys(undefined, "t"), {});
  assertEquals(parseConsumerKeys("not json", "t"), {});
});

Deno.test("parseConsumerKeys: rejects wrong-shaped-but-valid JSON (the misconfig hole)", () => {
  assertEquals(parseConsumerKeys('["gymkey123456789012"]', "t"), {}); // top-level array -> would mint key "0"
  assertEquals(parseConsumerKeys('"gymkey123456789012"', "t"), {});    // top-level string -> per-char keys
  assertEquals(parseConsumerKeys('{"short":"t1"}', "t"), {});          // key < 16 chars
  assertEquals(parseConsumerKeys(`{"${GYMKEY}":123}`, "t"), {});       // non-string tenant
  assertEquals(parseConsumerKeys(`{"${GYMKEY}":[]}`, "t"), {});        // empty tenant list
});

Deno.test("authorize: service key resolves to '*' + a 12-char fingerprint", async () => {
  const auth = createConsumerAuth({ serviceKey: SVC, consumerKeysRaw: undefined, label: "t" });
  const r = await auth.authorize(SVC);
  assertEquals(r?.authz, "*");
  assertEquals(r?.fingerprint.length, 12);
  assertEquals(await auth.authorize("wrong_key_wrong_key1"), null);
});

Deno.test("authorize: consumer key resolves to its bound tenants", async () => {
  const auth = createConsumerAuth({
    serviceKey: SVC,
    consumerKeysRaw: `{"${GYMKEY}":["gym_1","gym_2"]}`,
    label: "t",
  });
  assertEquals((await auth.authorize(GYMKEY))?.authz, ["gym_1", "gym_2"]);
  assertEquals((await auth.authorize(SVC))?.authz, "*"); // service still wins
  assertEquals(await auth.authorize("nope_nope_nope_nope1"), null);
});

Deno.test("authorizes: admin any-tenant vs bound-list membership", () => {
  const auth = createConsumerAuth({ serviceKey: SVC, consumerKeysRaw: undefined, label: "t" });
  assertEquals(auth.authorizes("*", "anything"), true);
  assertEquals(auth.authorizes(["gym_1"], "gym_1"), true);
  assertEquals(auth.authorizes(["gym_1"], "gym_2"), false);
});

Deno.test("configured: false only when no keys at all", () => {
  assertEquals(createConsumerAuth({ serviceKey: undefined, consumerKeysRaw: undefined, label: "t" }).configured(), false);
  assertEquals(createConsumerAuth({ serviceKey: SVC, consumerKeysRaw: undefined, label: "t" }).configured(), true);
  assertEquals(createConsumerAuth({ serviceKey: undefined, consumerKeysRaw: `{"${GYMKEY}":"t1"}`, label: "t" }).configured(), true);
});
