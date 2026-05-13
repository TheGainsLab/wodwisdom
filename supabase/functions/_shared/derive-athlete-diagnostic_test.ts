/**
 * Unit tests for the athlete diagnostic. Run with:
 *   deno test supabase/functions/_shared/derive-athlete-diagnostic_test.ts
 *
 * Pure-function coverage; no I/O, no network. All tests deterministic.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import { classifyPerLiftLevel } from "./level-interpreter.ts";
import {
  classifyBwLifts,
  computeLoading,
  computeMetconAllowList,
  computeRatios,
  computeSkillPriority,
  deriveAthleteDiagnostic,
  deriveSyntheticLevels,
  fireLiftFlags,
  fireSkillFlags,
  mergeAccessoryPools,
} from "./derive-athlete-diagnostic.ts";

// ============================================================
// classifyPerLiftLevel — boundary + gender + age + alias
// ============================================================

Deno.test("classifyPerLiftLevel: male back_squat below intermediate threshold → beginner", () => {
  assertEquals(classifyPerLiftLevel("back_squat", 200, 200, "male", 30), "beginner");
});

Deno.test("classifyPerLiftLevel: male back_squat at intermediate boundary → intermediate", () => {
  assertEquals(classifyPerLiftLevel("back_squat", 250, 200, "male", 30), "intermediate");
});

Deno.test("classifyPerLiftLevel: male back_squat at advanced boundary → advanced", () => {
  // 1.86 × 200 = 372
  assertEquals(classifyPerLiftLevel("back_squat", 372, 200, "male", 30), "advanced");
});

Deno.test("classifyPerLiftLevel: female back_squat — gender-specific bands", () => {
  // Female intermediate_min 0.86, advanced_min 1.36 (BW 150).
  assertEquals(classifyPerLiftLevel("back_squat", 100, 150, "female", 30), "beginner"); // 0.67×
  assertEquals(classifyPerLiftLevel("back_squat", 130, 150, "female", 30), "intermediate"); // 0.87×
  assertEquals(classifyPerLiftLevel("back_squat", 210, 150, "female", 30), "advanced"); // 1.40×
});

Deno.test("classifyPerLiftLevel: age adjustment scales bands down for older athletes", () => {
  // At age 30, BS @ 1.0× BW = beginner. At age 60, intermediate_min drops to 1.25 × 0.85 = 1.0625.
  assertEquals(classifyPerLiftLevel("back_squat", 200, 200, "male", 30), "beginner");
  // At age 70 the threshold drops further (1.25 × 0.75 = 0.9375); 1.0× now reaches intermediate.
  assertEquals(classifyPerLiftLevel("back_squat", 200, 200, "male", 70), "intermediate");
});

Deno.test("classifyPerLiftLevel: press / strict_press alias both work", () => {
  // Male press: intermediate_min 0.60, BW 200 → 120 lb is at boundary.
  assertEquals(classifyPerLiftLevel("press", 120, 200, "male", 30), "intermediate");
  assertEquals(classifyPerLiftLevel("strict_press", 120, 200, "male", 30), "intermediate");
});

Deno.test("classifyPerLiftLevel: missing data returns null", () => {
  assertEquals(classifyPerLiftLevel("back_squat", 0, 200, "male", 30), null);
  assertEquals(classifyPerLiftLevel("back_squat", 200, 0, "male", 30), null);
});

Deno.test("classifyPerLiftLevel: ratio-only lift returns null", () => {
  // snatch is not BW-classified; should return null.
  assertEquals(classifyPerLiftLevel("snatch", 200, 200, "male", 30), null);
});

// ============================================================
// classifyBwLifts — orchestration
// ============================================================

Deno.test("classifyBwLifts: full profile classifies all 4 BW lifts", () => {
  // age 30 — under the 35-50 age-adjustment band so thresholds aren't scaled.
  const result = classifyBwLifts({
    age: 30, gender: "male", bodyweight: 200,
    lifts: { back_squat: 405, deadlift: 455, bench_press: 275, press: 165 },
  });
  assertEquals(result.back_squat, "advanced");
  assertEquals(result.deadlift, "advanced");
  assertEquals(result.bench_press, "intermediate");
  assertEquals(result.press, "intermediate");
});

Deno.test("classifyBwLifts: missing lift entries return null", () => {
  const result = classifyBwLifts({
    age: 35, gender: "male", bodyweight: 200,
    lifts: { back_squat: 405 },
  });
  assertEquals(result.back_squat, "advanced");
  assertEquals(result.deadlift, null);
  assertEquals(result.bench_press, null);
  assertEquals(result.press, null);
});

// ============================================================
// computeRatios — ratio computation + status
// ============================================================

Deno.test("computeRatios: skips ratios with missing lifts", () => {
  const ratios = computeRatios({
    lifts: { back_squat: 400 }, // no other lifts
  });
  assertEquals(ratios.length, 0);
});

Deno.test("computeRatios: in_band when ratio is on the right side of threshold", () => {
  // sn:bs threshold 0.60, direction below. snatch=240, bs=400 → 0.60 (boundary, not below).
  const ratios = computeRatios({ lifts: { snatch: 240, back_squat: 400 } });
  const sn = ratios.find((r) => r.name === "sn_bs")!;
  assert(sn);
  assertEquals(sn.status, "in_band");
});

Deno.test("computeRatios: below_band fires when ratio drops under threshold", () => {
  const ratios = computeRatios({ lifts: { snatch: 200, back_squat: 400 } });
  const sn = ratios.find((r) => r.name === "sn_bs")!;
  assertEquals(sn.ratio, 0.5);
  assertEquals(sn.status, "below_band");
});

Deno.test("computeRatios: above_band fires when above-direction threshold is exceeded", () => {
  // pc:clean threshold 0.85, direction above. power_clean=270, clean=300 → 0.90 → above_band.
  const ratios = computeRatios({ lifts: { power_clean: 270, clean: 300 } });
  const pc = ratios.find((r) => r.name === "pc_clean")!;
  assertEquals(pc.status, "above_band");
});

// ============================================================
// fireLiftFlags
// ============================================================

Deno.test("fireLiftFlags: emits flags for triggered ratios only", () => {
  const ratios = computeRatios({
    lifts: { snatch: 200, back_squat: 400 }, // sn:bs = 0.50 < 0.60 → snatch_technical_gap fires
  });
  const flags = fireLiftFlags(ratios);
  assertEquals(flags.length, 1);
  assertEquals(flags[0].name, "snatch_technical_gap");
  assertEquals(flags[0].category, "technique");
  assertEquals(flags[0].evidence_ratio, "sn_bs");
});

Deno.test("fireLiftFlags: receive_position_weak_snatch fires on high power:full ratio", () => {
  const ratios = computeRatios({ lifts: { power_snatch: 200, snatch: 220 } }); // 0.91 > 0.85
  const flags = fireLiftFlags(ratios);
  assertEquals(flags[0]?.name, "receive_position_weak_snatch");
  assertEquals(flags[0]?.category, "mobility");
});

Deno.test("fireLiftFlags: in-band ratios produce no flags", () => {
  const ratios = computeRatios({ lifts: { snatch: 240, back_squat: 400 } }); // 0.60 not below
  const flags = fireLiftFlags(ratios);
  assertEquals(flags.length, 0);
});

// ============================================================
// deriveSyntheticLevels
// ============================================================

Deno.test("deriveSyntheticLevels: ratio-only lift inherits anchor when no flag affects", () => {
  const result = deriveSyntheticLevels(
    { back_squat: "advanced" },
    [],
  );
  assertEquals(result.snatch, "advanced");
  assertEquals(result.front_squat, "advanced");
});

Deno.test("deriveSyntheticLevels: drops one level when a flag affects the lift", () => {
  const flags = [{ name: "snatch_technical_gap", category: "technique" as const, evidence_ratio: "sn_bs" }];
  const result = deriveSyntheticLevels({ back_squat: "advanced" }, flags);
  assertEquals(result.snatch, "intermediate"); // dropped one
  assertEquals(result.front_squat, "advanced"); // not affected, anchor inherited
});

Deno.test("deriveSyntheticLevels: multiple flags still drop only one level (max)", () => {
  const flags = [
    { name: "snatch_technical_gap", category: "technique" as const, evidence_ratio: "sn_bs" },
    { name: "overhead_position_limiter", category: "mobility" as const, evidence_ratio: "ohs_fs" },
  ];
  const result = deriveSyntheticLevels({ back_squat: "advanced" }, flags);
  // Both flags affect snatch; still only one drop.
  assertEquals(result.snatch, "intermediate");
});

Deno.test("deriveSyntheticLevels: floors at beginner (no negative levels)", () => {
  const flags = [{ name: "snatch_technical_gap", category: "technique" as const, evidence_ratio: "sn_bs" }];
  const result = deriveSyntheticLevels({ back_squat: "beginner" }, flags);
  assertEquals(result.snatch, "beginner");
});

Deno.test("deriveSyntheticLevels: null anchor → null synthetic", () => {
  const result = deriveSyntheticLevels({ back_squat: null }, []);
  assertEquals(result.snatch, null);
  assertEquals(result.front_squat, null);
});

Deno.test("deriveSyntheticLevels: jerk anchored to press, not back_squat", () => {
  const result = deriveSyntheticLevels(
    { back_squat: "advanced", press: "intermediate" },
    [],
  );
  assertEquals(result.jerk, "intermediate");
  assertEquals(result.push_press, "intermediate");
  assertEquals(result.snatch, "advanced");
});

// ============================================================
// computeLoading
// ============================================================

Deno.test("computeLoading: BW-classified lift gets full ceilings", () => {
  const result = computeLoading(
    { back_squat: "advanced" },
    {},
  );
  assertEquals(result.back_squat.cycle_ceiling, 0.92);
  assertEquals(result.back_squat.deload_ceiling, 0.92 * 0.80);
});

Deno.test("computeLoading: ratio-only lift gets schemes only, null ceilings", () => {
  const result = computeLoading(
    {},
    { snatch: "intermediate" },
  );
  assertEquals(result.snatch.cycle_ceiling, null);
  assertEquals(result.snatch.deload_ceiling, null);
  assert(result.snatch.allowed_schemes.length > 0);
});

Deno.test("computeLoading: 1rm_attempt is in advanced scheme menu only", () => {
  const adv = computeLoading({ back_squat: "advanced" }, {});
  const intMed = computeLoading({ back_squat: "intermediate" }, {});
  const beg = computeLoading({ back_squat: "beginner" }, {});
  assertEquals(adv.back_squat.allowed_schemes.includes("1rm_attempt"), true);
  assertEquals(intMed.back_squat.allowed_schemes.includes("1rm_attempt"), false);
  assertEquals(beg.back_squat.allowed_schemes.includes("1rm_attempt"), false);
});

Deno.test("computeLoading: omits lifts with null level", () => {
  const result = computeLoading({ back_squat: null }, {});
  assertEquals(result.back_squat, undefined);
});

// ============================================================
// mergeAccessoryPools
// ============================================================

Deno.test("mergeAccessoryPools: empty flags → empty pool", () => {
  const result = mergeAccessoryPools([], { barbell: true }, {}, { snatch: "intermediate" });
  assertEquals(result.length, 0);
});

Deno.test("mergeAccessoryPools: single flag produces its pool, intermediate athlete gets all drills", () => {
  const flags = [{ name: "front_rack_limiter", category: "mobility" as const, evidence_ratio: "fs_bs" }];
  const result = mergeAccessoryPools(
    flags,
    { barbell: true, bands: true },
    { back_squat: "intermediate" },
    {},
  );
  // front_rack_limiter pool has 5 movements; all should pass equipment + min_tier (intermediate athlete).
  assertEquals(result.length, 5);
});

Deno.test("mergeAccessoryPools: multi-flag overlap ranks shared movements first", () => {
  // jerk_drives appears in 4 different pools.
  const flags = [
    { name: "cj_technical_gap", category: "technique" as const, evidence_ratio: "cj_bs" },
    { name: "jerk_overhead_limiter", category: "technique" as const, evidence_ratio: "jerk_clean" },
    { name: "leg_drive_limiter", category: "technique" as const, evidence_ratio: "pp_press" },
    { name: "jerk_commitment_limiter", category: "technique" as const, evidence_ratio: "pj_pp" },
  ];
  const result = mergeAccessoryPools(
    flags,
    { barbell: true, blocks: true },
    { back_squat: "advanced", press: "advanced" },
    {},
  );
  // jerk_drives should be at index 0 with fired_by.length === 4.
  assertEquals(result[0].movement, "jerk_drives");
  assertEquals(result[0].fired_by.length, 4);
});

Deno.test("mergeAccessoryPools: missing blocks substitutes via fallback", () => {
  const flags = [{ name: "snatch_technical_gap", category: "technique" as const, evidence_ratio: "sn_bs" }];
  const result = mergeAccessoryPools(
    flags,
    { barbell: true }, // no blocks
    { back_squat: "intermediate" },
    {},
  );
  // snatch_from_blocks_knee (requires blocks) should fall back to hang_snatch_knee.
  // Both end up resolving to hang_snatch_knee, which already exists in the pool — they merge.
  const movements = result.map((e) => e.movement);
  assertEquals(movements.includes("hang_snatch_knee"), true);
  assertEquals(movements.includes("snatch_from_blocks_knee"), false);
});

Deno.test("mergeAccessoryPools: beginner athlete filters out intermediate-gated drills", () => {
  const flags = [{ name: "overhead_position_limiter", category: "mobility" as const, evidence_ratio: "ohs_fs" }];
  // Beginner has back_squat at beginner level; intermediate-gated drills (snatch_balance,
  // sots_press, pause_OHS, behind_neck_push_press) get filtered out. Only thoracic_shoulder_mobility
  // (min_tier beginner) survives.
  const result = mergeAccessoryPools(
    flags,
    { barbell: true, bands: true },
    { back_squat: "beginner" },
    {},
  );
  assertEquals(result.length, 1);
  assertEquals(result[0].movement, "thoracic_shoulder_mobility");
});

// ============================================================
// fireSkillFlags
// ============================================================

Deno.test("fireSkillFlags: prerequisite_gap fires when prereq is missing", () => {
  const flags = fireSkillFlags({
    strict_pull_ups: "none",
    kipping_pull_ups: "intermediate",
  });
  assertEquals(flags.length, 1);
  assertEquals(flags[0].name, "prerequisite_gap");
  assertEquals(flags[0].skill, "kipping_pull_ups");
  assertEquals(flags[0].missing_prerequisites, ["strict_pull_ups"]);
});

Deno.test("fireSkillFlags: no flags when prereqs are satisfied", () => {
  const flags = fireSkillFlags({
    strict_pull_ups: "intermediate",
    kipping_pull_ups: "intermediate",
  });
  assertEquals(flags.length, 0);
});

Deno.test("fireSkillFlags: standalone skill at intermediate fires nothing", () => {
  const flags = fireSkillFlags({ toes_to_bar: "advanced" });
  assertEquals(flags.length, 0);
});

// ============================================================
// computeMetconAllowList
// ============================================================

Deno.test("computeMetconAllowList: pull_ups allowed when any variant proficient", () => {
  const allowed = computeMetconAllowList({ strict_pull_ups: "intermediate" }, []);
  assertEquals(allowed.includes("pull_ups"), true);
});

Deno.test("computeMetconAllowList: pull_ups DENIED when only kipping intermediate but flagged", () => {
  const flags = [{
    name: "prerequisite_gap" as const,
    skill: "kipping_pull_ups",
    missing_prerequisites: ["strict_pull_ups"],
  }];
  const allowed = computeMetconAllowList(
    { strict_pull_ups: "none", kipping_pull_ups: "intermediate" },
    flags,
  );
  assertEquals(allowed.includes("pull_ups"), false);
});

Deno.test("computeMetconAllowList: HSPU category allowed when any variant intermediate+", () => {
  const allowed = computeMetconAllowList({ wall_facing_hspu: "intermediate" }, []);
  assertEquals(allowed.includes("hspu"), true);
});

// ============================================================
// computeSkillPriority
// ============================================================

Deno.test("computeSkillPriority: empty profile returns standalone-root skills", () => {
  const result = computeSkillPriority({}, []);
  // Top should be the highest-leverage standalone foundation: strict_pull_ups (blocks 6),
  // wall_facing_hspu (blocks 4), ring_dips (blocks 2).
  assertEquals(result.length, 3);
  assertEquals(result[0], "strict_pull_ups");
  assertEquals(result[1], "wall_facing_hspu");
  assertEquals(result[2], "ring_dips");
});

Deno.test("computeSkillPriority: respects top-3 cap", () => {
  const result = computeSkillPriority({}, []);
  assertEquals(result.length, 3);
});

Deno.test("computeSkillPriority: skill is hidden when prereq is missing (eligibility filter)", () => {
  // butterfly_pull_ups requires kipping at intermediate. Athlete missing kipping →
  // butterfly is not eligible; strict (its grandprereq) is the top priority.
  const result = computeSkillPriority({ butterfly_pull_ups: "none" }, []);
  assertEquals(result.includes("butterfly_pull_ups"), false);
});

Deno.test("computeSkillPriority: demoted skill does not appear in active focus", () => {
  // kipping_pull_ups at intermediate but strict missing → kipping is demoted.
  // Should NOT appear in active focus; strict_pull_ups should rank top.
  const skills = { strict_pull_ups: "none", kipping_pull_ups: "intermediate" };
  const flags = fireSkillFlags(skills);
  const result = computeSkillPriority(skills, flags);
  assertEquals(result.includes("kipping_pull_ups"), false);
  assertEquals(result[0], "strict_pull_ups");
});

// ============================================================
// Integration — full diagnostic
// ============================================================

Deno.test("deriveAthleteDiagnostic: full sample athlete produces complete output", () => {
  const profile = {
    // age 30 — under the 35-50 age-adjustment band so thresholds aren't scaled.
    age: 30,
    gender: "male",
    bodyweight: 200,
    units: "lbs",
    lifts: {
      back_squat: 405,
      front_squat: 290,
      overhead_squat: 195,
      deadlift: 455,
      bench_press: 275,
      press: 165,
      clean: 295,
      power_clean: 245,
      clean_and_jerk: 285,
      jerk: 285,
      snatch: 215,
      power_snatch: 195,
      push_press: 220,
      push_jerk: 245,
    },
    skills: {
      strict_pull_ups: "beginner",
      kipping_pull_ups: "intermediate",
      toes_to_bar: "advanced",
      wall_facing_hspu: "intermediate",
      ring_dips: "intermediate",
    },
    equipment: { barbell: true, blocks: true, bands: true },
  };

  const d = deriveAthleteDiagnostic(profile);

  // Meta
  assertEquals(d.meta.schema_version, 1);
  assertEquals(d.meta.inputs_complete.lifts, true);
  assertEquals(d.meta.inputs_complete.skills, true);

  // Lift levels — 405/200 = 2.03 → advanced; 455/200 = 2.28 → advanced (>= 2.21 male DL boundary)
  assertEquals(d.lifts.per_lift_levels.back_squat, "advanced");
  assertEquals(d.lifts.per_lift_levels.deadlift, "advanced");
  assertEquals(d.lifts.per_lift_levels.bench_press, "intermediate");
  assertEquals(d.lifts.per_lift_levels.press, "intermediate");

  // Some flags should fire (snatch:bs = 215/405 = 0.531 → < 0.60 → snatch_technical_gap)
  const flagNames = d.lifts.flags.map((f) => f.name);
  assert(flagNames.includes("snatch_technical_gap"));

  // Synthetic levels populated for ratio-only lifts
  assert(d.lifts.synthetic_levels.snatch !== undefined);

  // Loading populated
  assertEquals(d.lifts.loading.back_squat.cycle_ceiling, 0.92);

  // Skills: prerequisite_gap should fire on kipping (strict at beginner)
  const skillFlagNames = d.skills.flags.map((f) => f.name);
  assertEquals(skillFlagNames, ["prerequisite_gap"]);
  assertEquals(d.skills.flags[0].skill, "kipping_pull_ups");

  // strict_pull_ups should be top priority
  assertEquals(d.skills.active_focus[0], "strict_pull_ups");

  // pull_ups NOT in metcon allow-list (kipping demoted, strict still beginner)
  assertEquals(d.skills.metcon_allow_list.includes("pull_ups"), false);

  // Augmentation slots are null
  assertEquals(d.competition, null);
  assertEquals(d.cohort, null);
});

Deno.test("deriveAthleteDiagnostic: empty profile produces well-formed output with null levels", () => {
  const d = deriveAthleteDiagnostic({});
  assertEquals(d.meta.inputs_complete.lifts, false);
  assertEquals(d.meta.inputs_complete.skills, false);
  assertEquals(d.lifts.flags.length, 0);
  assertEquals(d.skills.flags.length, 0);
  // Standalone skills with no profile data should still surface as top-3 priorities.
  assertEquals(d.skills.active_focus.length, 3);
});

