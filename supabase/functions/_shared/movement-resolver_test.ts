/**
 * Tests for movement-resolver.ts (pure function — no env, no fetch stubs).
 *
 * Run with:
 *   deno test supabase/functions/_shared/movement-resolver_test.ts --no-check
 */

import { assertEquals } from "jsr:@std/assert";
import { resolveMovementName, trigramSimilarity } from "./movement-resolver.ts";
import type { MovementInfo } from "./work-calc-movements-cache.ts";

function catalog(): MovementInfo[] {
  return [
    { display_name: "Thruster", canonical_name: "thruster", modeled: true },
    { display_name: "Pull-up", canonical_name: "pull-up", modeled: true },
    { display_name: "Push-up", canonical_name: "push-up", modeled: true },
    { display_name: "Air Squat", canonical_name: "air-squat", modeled: true },
    { display_name: "Burpee", canonical_name: "burpee", modeled: true },
    { display_name: "Snatch", canonical_name: "snatch", modeled: true },
    { display_name: "Clean", canonical_name: "clean", modeled: true },
    { display_name: "Jerk", canonical_name: "jerk", modeled: true },
    { display_name: "Back Squat", canonical_name: "back-squat", modeled: true },
    { display_name: "Front Squat", canonical_name: "front-squat", modeled: true },
    { display_name: "Overhead Squat", canonical_name: "overhead-squat", modeled: true },
    { display_name: "Push Press", canonical_name: "push-press", modeled: true },
    { display_name: "Shoulder Press", canonical_name: "shoulder-press", modeled: true },
    { display_name: "Bench Press", canonical_name: "bench-press", modeled: true },
    { display_name: "Wall-Ball Shot", canonical_name: "wall-ball-shot", modeled: true },
    // An un-modeled entry to confirm resolver skips it.
    { display_name: "Pegboard", canonical_name: "pegboard", modeled: false },
  ];
}

// ============================================================
// Exact match (stage 1)
// ============================================================

Deno.test("resolver: exact display_name match", () => {
  const r = resolveMovementName("Thruster", catalog());
  assertEquals(r?.canonical, "Thruster");
  assertEquals(r?.via, "exact");
  assertEquals(r?.similarity, 1.0);
});

Deno.test("resolver: case-insensitive exact match", () => {
  const r = resolveMovementName("thruster", catalog());
  assertEquals(r?.canonical, "Thruster");
  assertEquals(r?.via, "exact");
});

Deno.test("resolver: canonical_name match (snake-case)", () => {
  const r = resolveMovementName("air-squat", catalog());
  assertEquals(r?.canonical, "Air Squat");
  assertEquals(r?.via, "exact");
});

// ============================================================
// Olympic-variant aliases (stage 2)
// ============================================================

Deno.test("resolver: Power Snatch → Snatch (alias)", () => {
  const r = resolveMovementName("Power Snatch", catalog());
  assertEquals(r?.canonical, "Snatch");
  assertEquals(r?.via, "alias");
});

Deno.test("resolver: Squat Clean → Clean (alias)", () => {
  const r = resolveMovementName("Squat Clean", catalog());
  assertEquals(r?.canonical, "Clean");
  assertEquals(r?.via, "alias");
});

Deno.test("resolver: Hang Power Snatch → Snatch (alias)", () => {
  const r = resolveMovementName("Hang Power Snatch", catalog());
  assertEquals(r?.canonical, "Snatch");
  assertEquals(r?.via, "alias");
});

Deno.test("resolver: Push Jerk → Jerk (alias)", () => {
  const r = resolveMovementName("Push Jerk", catalog());
  assertEquals(r?.canonical, "Jerk");
  assertEquals(r?.via, "alias");
});

Deno.test("resolver: Back Squat stays distinct (NOT aliased to Squat)", () => {
  const r = resolveMovementName("Back Squat", catalog());
  assertEquals(r?.canonical, "Back Squat");
  assertEquals(r?.via, "exact");
});

Deno.test("resolver: Bench Press stays distinct (NOT aliased to Press)", () => {
  const r = resolveMovementName("Bench Press", catalog());
  assertEquals(r?.canonical, "Bench Press");
  assertEquals(r?.via, "exact");
});

// ============================================================
// Fuzzy (stage 3)
// ============================================================

Deno.test("resolver: 'Pushup' → 'Push-up' via stripped-exact", () => {
  // Stage 1b: alphanumeric-only normalization catches hyphen/space variations
  // cheaply, before the fuzzy threshold gets involved.
  const r = resolveMovementName("Pushup", catalog());
  assertEquals(r?.canonical, "Push-up");
  assertEquals(r?.via, "exact");
});

Deno.test("resolver: 'Wall Ball Shot' (no hyphen) → 'Wall-Ball Shot' via stripped-exact", () => {
  const r = resolveMovementName("Wall Ball Shot", catalog());
  assertEquals(r?.canonical, "Wall-Ball Shot");
  assertEquals(r?.via, "exact");
});

// ============================================================
// Below-threshold + missing
// ============================================================

Deno.test("resolver: garbage input returns null (below 0.85 threshold)", () => {
  const r = resolveMovementName("xyzqwerty", catalog());
  assertEquals(r, null);
});

Deno.test("resolver: empty input returns null", () => {
  const r = resolveMovementName("", catalog());
  assertEquals(r, null);
});

Deno.test("resolver: skips un-modeled catalog entries (Pegboard not returned)", () => {
  const r = resolveMovementName("Pegboard", catalog());
  // Pegboard is in the catalog but modeled: false — resolver should skip it.
  assertEquals(r, null);
});

// ============================================================
// trigramSimilarity smoke
// ============================================================

Deno.test("trigramSimilarity: identical strings → 1.0", () => {
  assertEquals(trigramSimilarity("thruster", "thruster"), 1.0);
});

Deno.test("trigramSimilarity: completely different strings → low", () => {
  const sim = trigramSimilarity("thruster", "xyzabc");
  if (sim >= 0.2) throw new Error(`expected low sim, got ${sim}`);
});

Deno.test("trigramSimilarity: minor typo gives high similarity", () => {
  const sim = trigramSimilarity("pushup", "push-up");
  if (sim < 0.5) throw new Error(`expected sim >= 0.5 for typo case, got ${sim}`);
});
