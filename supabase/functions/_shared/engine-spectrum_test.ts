/**
 * Unit tests for the Engine spectrum → minutes-in-zone reduction. Run with:
 *   deno test supabase/functions/_shared/engine-spectrum_test.ts
 *
 * Pure-function coverage; no IO, no network.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import {
  computeTimeInZone,
  dayTypeZoneMinutes,
  zonesTouched,
} from "./engine-spectrum.ts";

Deno.test("endurance (8–16) sits entirely in base", () => {
  const z = dayTypeZoneMinutes("endurance", 60)!;
  assertEquals(z, { base: 60, tempo: 0, aerobic_power: 0, anaerobic: 0 });
});

Deno.test("threshold (42–50) sits entirely in tempo", () => {
  const z = dayTypeZoneMinutes("threshold", 30)!;
  assertEquals(z, { base: 0, tempo: 30, aerobic_power: 0, anaerobic: 0 });
});

Deno.test("rocket_races_a (56–68) sits entirely in aerobic_power", () => {
  const z = dayTypeZoneMinutes("rocket_races_a", 40)!;
  assertEquals(z, { base: 0, tempo: 0, aerobic_power: 40, anaerobic: 0 });
});

Deno.test("anaerobic (86–96) sits entirely in anaerobic", () => {
  const z = dayTypeZoneMinutes("anaerobic", 20)!;
  assertEquals(z, { base: 0, tempo: 0, aerobic_power: 0, anaerobic: 20 });
});

Deno.test("interval (40–80) splits across tempo / aerobic_power / anaerobic by overlap", () => {
  // Span width 40: tempo [40,53)=13, aerobic_power [53,70)=17, anaerobic [70,80]=10.
  const z = dayTypeZoneMinutes("interval", 40)!;
  assertEquals(z.base, 0);
  assert(Math.abs(z.tempo - 13) < 1e-9);
  assert(Math.abs(z.aerobic_power - 17) < 1e-9);
  assert(Math.abs(z.anaerobic - 10) < 1e-9);
});

Deno.test("polarized (8–92, gradient) is bimodal: base + anaerobic, NO middle minutes", () => {
  // 70% into [8,18] (base), 30% into [82,92] (anaerobic) — the uniform
  // spread this replaces would have invented tempo/aerobic_power minutes.
  const z = dayTypeZoneMinutes("polarized", 60)!;
  assertEquals(z, { base: 42, tempo: 0, aerobic_power: 0, anaerobic: 18 });
});

Deno.test("unknown day type → null; zero/negative minutes → null", () => {
  assertEquals(dayTypeZoneMinutes("not_a_day_type", 60), null);
  assertEquals(dayTypeZoneMinutes("endurance", 0), null);
});

Deno.test("computeTimeInZone sums known days and tallies skipped ones", () => {
  const { zones, minutesCounted, daysSkipped } = computeTimeInZone([
    { dayType: "endurance", minutes: 40 },
    { dayType: "threshold", minutes: 20 },
    { dayType: "mystery_day", minutes: 30 },
    { dayType: null, minutes: 25 },
    { dayType: "anaerobic", minutes: null },
  ]);
  assertEquals(zones, { base: 40, tempo: 20, aerobic_power: 0, anaerobic: 0 });
  assertEquals(minutesCounted, 60);
  assertEquals(daysSkipped, 3);
});

Deno.test("zonesTouched reflects the (gradient-aware) mass, not the raw span", () => {
  assertEquals(zonesTouched("endurance"), ["base"]);
  // Polarized's raw span crosses every zone, but its mass only lands at the ends.
  assertEquals(zonesTouched("polarized"), ["base", "anaerobic"]);
  assertEquals(zonesTouched("interval"), ["tempo", "aerobic_power", "anaerobic"]);
  assertEquals(zonesTouched("nope"), []);
});
