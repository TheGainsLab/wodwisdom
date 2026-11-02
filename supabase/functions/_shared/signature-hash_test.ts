/**
 * Unit tests for signature-hash. Run with:
 *   deno test supabase/functions/_shared/signature-hash_test.ts --no-check
 */

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";

import {
  hashWorkoutStructure,
  hashWorkoutText,
  normalizeWorkoutText,
} from "./signature-hash.ts";

Deno.test("text normalization collapses whiteboard variance", () => {
  assertEquals(
    normalizeWorkoutText("21-15-9:\n  Thrusters (95/65)\n  Pull-Ups!!"),
    normalizeWorkoutText("21-15-9: thrusters 95/65, pull-ups"),
  );
});

Deno.test("same whiteboard text from two gym-mates lands on one hash", async () => {
  const a = await hashWorkoutText(
    "AMRAP 12:\n10 Wall Balls (20/14)\n8 Toes-to-Bar\n6 Burpees",
    "amrap",
    720,
  );
  const b = await hashWorkoutText(
    "amrap 12: 10 wall balls 20/14, 8 toes-to-bar, 6 burpees",
    "AMRAP",
    720,
  );
  assertEquals(a, b);
  assert(a.startsWith("wsh1_"));
  assertEquals(a.length, "wsh1_".length + 32);
});

Deno.test("different cap or scheme is a different workout", async () => {
  const base = await hashWorkoutText("21-15-9 thrusters pull-ups", "for_time", 720);
  const cap = await hashWorkoutText("21-15-9 thrusters pull-ups", "for_time", 900);
  const scheme = await hashWorkoutText("21-15-9 thrusters pull-ups", "amrap", 720);
  assertNotEquals(base, cap);
  assertNotEquals(base, scheme);
});

Deno.test("structure hash is order-sensitive and edit-sensitive", async () => {
  const fran = {
    block_scheme: "21-15-9 for time",
    time_cap_seconds: 600,
    movements: [
      { movement: "Thruster", reps: [21, 15, 9], load_lbs_men: 95, load_lbs_women: 65 },
      { movement: "Pull-Up", reps: [21, 15, 9] },
    ],
  };
  const same = await hashWorkoutStructure(fran);
  assertEquals(await hashWorkoutStructure({ ...fran }), same);

  // heavier bar = different identity (provenance rule)
  const heavy = await hashWorkoutStructure({
    ...fran,
    movements: [
      { ...fran.movements[0], load_lbs_men: 115 },
      fran.movements[1],
    ],
  });
  assertNotEquals(heavy, same);

  // reversed movement order = different workout
  const reversed = await hashWorkoutStructure({
    ...fran,
    movements: [fran.movements[1], fran.movements[0]],
  });
  assertNotEquals(reversed, same);
});
