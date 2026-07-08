// deno test supabase/functions/_shared/gym-cohort-config-validate_test.ts --allow-env --no-check
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildConfigPatch } from "./gym-cohort-config-validate.ts";

Deno.test("buildConfigPatch: partial — only provided keys land in the patch", () => {
  const r = buildConfigPatch({ days_per_week: 6 });
  assertEquals(r.error, undefined);
  assertEquals(r.patch, { days_per_week: 6 });
});

Deno.test("buildConfigPatch: empty input is rejected (no writable fields)", () => {
  assert(buildConfigPatch({}).error);
});

Deno.test("buildConfigPatch: days_per_week bounds + integer", () => {
  assert(buildConfigPatch({ days_per_week: 2 }).error);
  assert(buildConfigPatch({ days_per_week: 7 }).error);
  assert(buildConfigPatch({ days_per_week: 5.5 }).error);
  assertEquals(buildConfigPatch({ days_per_week: 3 }).patch, { days_per_week: 3 });
});

Deno.test("buildConfigPatch: session_length_minutes null ok, out-of-range rejected", () => {
  assertEquals(buildConfigPatch({ session_length_minutes: null }).patch, { session_length_minutes: null });
  assertEquals(buildConfigPatch({ session_length_minutes: 60 }).patch, { session_length_minutes: 60 });
  assert(buildConfigPatch({ session_length_minutes: 10 }).error);
  assert(buildConfigPatch({ session_length_minutes: 240 }).error);
});

Deno.test("buildConfigPatch: equipment rejects non-canonical keys (the seed-row lesson)", () => {
  // The 2026-07-07 typos: dumbbell/kettlebell/pullup_bar/jump_rope/bike_erg.
  const bad = buildConfigPatch({ equipment: ["barbell", "dumbbell", "bike_erg"] });
  assert(bad.error, "typo'd keys must be rejected, not silently dropped");
  assert(bad.error!.includes("dumbbell"));
  assert(bad.error!.includes("bike_erg"));
  // Canonical keys pass and are trimmed.
  const good = buildConfigPatch({ equipment: [" barbell ", "dumbbells", "assault_bike"] });
  assertEquals(good.patch, { equipment: ["barbell", "dumbbells", "assault_bike"] });
});

Deno.test("buildConfigPatch: target_level + units enums", () => {
  assert(buildConfigPatch({ target_level: "elite" }).error);
  assertEquals(buildConfigPatch({ target_level: "advanced" }).patch, { target_level: "advanced" });
  assert(buildConfigPatch({ units: "stone" }).error);
  assertEquals(buildConfigPatch({ units: "kg" }).patch, { units: "kg" });
});

Deno.test("buildConfigPatch: do_not_program trims + drops blanks", () => {
  assertEquals(
    buildConfigPatch({ do_not_program: [" GHD Sit Up ", "", "Box Jump"] }).patch,
    { do_not_program: ["GHD Sit Up", "Box Jump"] },
  );
  assert(buildConfigPatch({ do_not_program: "GHD" }).error);
});

Deno.test("buildConfigPatch: goal_text null ok, truncates at 4k, rejects non-string", () => {
  assertEquals(buildConfigPatch({ goal_text: null }).patch, { goal_text: null });
  const long = "x".repeat(5000);
  const r = buildConfigPatch({ goal_text: long });
  assertEquals((r.patch!.goal_text as string).length, 4000);
  assert(buildConfigPatch({ goal_text: 42 }).error);
});

Deno.test("buildConfigPatch: strategy must be an object (not a stringified-JSON jsonb-string mistake)", () => {
  assert(buildConfigPatch({ strategy: '{"sliders":{}}' }).error, "stringified JSON must be rejected");
  assert(buildConfigPatch({ strategy: [1, 2] }).error);
  assertEquals(buildConfigPatch({ strategy: null }).patch, { strategy: null });
  const obj = { sliders: { powerlifting_strength: 8 } };
  assertEquals(buildConfigPatch({ strategy: obj }).patch, { strategy: obj });
});

Deno.test("buildConfigPatch: active must be boolean", () => {
  assert(buildConfigPatch({ active: "true" }).error);
  assertEquals(buildConfigPatch({ active: false }).patch, { active: false });
});

Deno.test("buildConfigPatch: a full brief upsert", () => {
  const r = buildConfigPatch({
    days_per_week: 6,
    session_length_minutes: 60,
    equipment: ["barbell", "rower", "ghd"],
    target_level: "intermediate",
    do_not_program: ["Box Jump"],
    units: "lbs",
    goal_text: "Rebuild squat strength after the Open.",
    strategy: { sliders: { powerlifting_strength: 8 }, focus_split: { skills_days: 2 } },
    active: true,
  });
  assertEquals(r.error, undefined);
  assertEquals(Object.keys(r.patch!).sort(), [
    "active", "days_per_week", "do_not_program", "equipment", "goal_text",
    "session_length_minutes", "strategy", "target_level", "units",
  ]);
});
