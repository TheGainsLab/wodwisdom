import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertKeepsEverything, currentFeatures, featuresLost, planForPrice } from "./plan-change-guard.ts";

const PRICES = {
  programming: { monthly: "price_prog_m", quarterly: "price_prog_q" },
  engine: { monthly: "price_eng_m", quarterly: "price_eng_q" },
  all_access: { monthly: "price_all_m", quarterly: "price_all_q" },
  coach: { monthly: "price_coach_m", quarterly: undefined },
};

Deno.test("a price resolves to its plan on either interval", () => {
  assertEquals(planForPrice(PRICES, "price_prog_q"), "programming");
  assertEquals(planForPrice(PRICES, "price_other"), null);
  assertEquals(planForPrice(PRICES, undefined), null);
});

Deno.test("Programming -> Engine would lose Programming; the reverse loses the Engine", () => {
  assertEquals(featuresLost(currentFeatures(PRICES, { id: "price_prog_m" }), "engine"), ["programming"]);
  assertEquals(featuresLost(currentFeatures(PRICES, { id: "price_eng_q" }), "programming"), ["engine"]);
});

Deno.test("the locked-tile case is refused, with the product named and All Access offered", () => {
  const err = assertThrows(() => assertKeepsEverything(PRICES, { id: "price_prog_m" }, "engine"), Error);
  assertEquals(
    err.message,
    "That change would remove AI Programming from your subscription. Choose All Access to keep everything you have.",
  );
  assertThrows(() => assertKeepsEverything(PRICES, { id: "price_eng_m" }, "programming"), Error, "Year of the Engine");
});

Deno.test("true upgrades and interval switches pass", () => {
  assertKeepsEverything(PRICES, { id: "price_prog_m" }, "all_access");
  assertKeepsEverything(PRICES, { id: "price_eng_m" }, "all_access");
  assertKeepsEverything(PRICES, { id: "price_prog_m" }, "programming"); // monthly -> quarterly
  assertKeepsEverything(PRICES, { id: "price_coach_m" }, "engine"); // coach -> engine keeps the coach
});

Deno.test("All Access cannot be swapped down to a single product", () => {
  assertThrows(() => assertKeepsEverything(PRICES, { id: "price_all_m" }, "engine"), Error, "AI Programming");
  assertThrows(() => assertKeepsEverything(PRICES, { id: "price_all_m" }, "programming"), Error, "Year of the Engine");
});

Deno.test("a price that is not ours is read from its own metadata", () => {
  assertEquals(currentFeatures(PRICES, { id: "price_old", metadata: { plan: "programming" } }).includes("programming"), true);
  assertThrows(() => assertKeepsEverything(PRICES, { id: "price_old", metadata: { entitlements: "engine,ai_chat" } }, "programming"), Error);
  // Nothing known about it: nothing provable to protect, so it is not blocked.
  assertKeepsEverything(PRICES, { id: "price_old" }, "engine");
});
