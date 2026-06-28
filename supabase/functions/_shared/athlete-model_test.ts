/**
 * Unit tests for the deterministic Athlete Model builder (coaching-state
 * Step 1). Run with:
 *   deno test supabase/functions/_shared/athlete-model_test.ts --no-check
 *
 * Pure-function coverage; no IO, no network.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import {
  type AthleteModelCompetitionInput,
  type AthleteProfileStatic,
  athleteModelEvidenceKeys,
  buildAthleteModel,
  MODEL_BUILDER_VERSION,
  normalizeGender,
  normalizeMovementKey,
  NORMATIVE_KEYS,
  profileStaticFromRow,
  recoveryClassForAge,
  THRESHOLDS_VERSION,
} from "./athlete-model.ts";
import {
  FIXTURE_BEGINNER_FITNESS,
  type FixtureProfileRow,
} from "./fixtures/profile-fixtures.ts";

function toStatic(row: FixtureProfileRow): AthleteProfileStatic {
  return {
    age: row.age,
    bodyweight: row.bodyweight,
    gender: row.gender,
    height: row.height,
    units: (row.units as "lbs" | "kg" | null) ?? null,
    lifts: (row.lifts ?? {}) as Record<string, number | null>,
    skills: (row.skills ?? {}) as Record<string, "none" | "beginner" | "intermediate" | "advanced" | null>,
    conditioning: (row.conditioning ?? {}) as Record<string, string | number | null>,
    equipment: (row.equipment ?? {}) as Record<string, boolean>,
  };
}

// ============================================================
// normalizeGender
// ============================================================

Deno.test("normalizeGender maps common variants", () => {
  assertEquals(normalizeGender("male"), "men");
  assertEquals(normalizeGender("Men"), "men");
  assertEquals(normalizeGender("M"), "men");
  assertEquals(normalizeGender("female"), "women");
  assertEquals(normalizeGender("Women"), "women");
  assertEquals(normalizeGender("f"), "women");
  assertEquals(normalizeGender(""), null);
  assertEquals(normalizeGender(null), null);
  assertEquals(normalizeGender("nonbinary"), null);
});

// ============================================================
// recoveryClassForAge — age band boundaries
// ============================================================

Deno.test("recoveryClassForAge bands", () => {
  assertEquals(recoveryClassForAge(null), "open");
  assertEquals(recoveryClassForAge(34), "open");
  assertEquals(recoveryClassForAge(35), "masters_35");
  assertEquals(recoveryClassForAge(39), "masters_35");
  assertEquals(recoveryClassForAge(40), "masters_40");
  assertEquals(recoveryClassForAge(45), "masters_45");
  assertEquals(recoveryClassForAge(50), "masters_50");
  assertEquals(recoveryClassForAge(55), "masters_55");
  assertEquals(recoveryClassForAge(60), "masters_60");
  assertEquals(recoveryClassForAge(99), "masters_60");
});

// ============================================================
// buildAthleteModel — fixture A (beginner male, unlinked)
//   back_squat 225, deadlift 275, bench 185, snatch 95, c&j 135,
//   bodyweight 180, male, age 32 (open).
// ============================================================

Deno.test("buildAthleteModel computes ratios from fixture A", () => {
  const m = buildAthleteModel(toStatic(FIXTURE_BEGINNER_FITNESS.profileRow), null);

  assertEquals(m.thresholds_version, THRESHOLDS_VERSION);
  assertEquals(m.model_builder_version, MODEL_BUILDER_VERSION);
  assertEquals(m.recovery_class, "open");

  assertEquals(m.strength_ratios.snatch_to_back_squat, 0.422); // 95/225
  assertEquals(m.strength_ratios.clean_jerk_to_back_squat, 0.6); // 135/225
  assertEquals(m.strength_ratios.deadlift_to_back_squat, 1.222); // 275/225
  assertEquals(m.strength_ratios.back_squat_to_bodyweight, 1.25); // 225/180
  assertEquals(m.strength_ratios.snatch_to_clean_jerk, 0.704); // 95/135

  // Missing inputs → null ratios (no front squat / overhead squat / press).
  assertEquals(m.strength_ratios.front_squat_to_back_squat, null);
  assertEquals(m.strength_ratios.overhead_squat_to_snatch, null);
  assertEquals(m.strength_ratios.press_to_bodyweight, null);
});

Deno.test("buildAthleteModel capabilities cover all lifts with source", () => {
  const m = buildAthleteModel(toStatic(FIXTURE_BEGINNER_FITNESS.profileRow), null);
  assertEquals(m.capabilities.back_squat.value, 225);
  assertEquals(m.capabilities.back_squat.source, "self_reported");
  assertEquals(m.capabilities.back_squat.confidence, "low");
  // front_squat unfilled → missing.
  assertEquals(m.capabilities.front_squat.value, null);
  assertEquals(m.capabilities.front_squat.source, "missing");
  assertEquals(m.capabilities.front_squat.as_of, null);
});

Deno.test("buildAthleteModel normative positions + factual ranking", () => {
  const m = buildAthleteModel(toStatic(FIXTURE_BEGINNER_FITNESS.profileRow), null);

  // snatch/back_squat 0.422 vs bar 0.60 → well_below.
  assertEquals(m.normative.snatch_to_back_squat.position, "well_below");
  assertEquals(m.normative.snatch_to_back_squat.threshold, 0.6);
  assertEquals(m.normative.snatch_to_back_squat.gap, -0.178);

  // deadlift/back_squat 1.222 vs bar 1.30 → below (~-6%).
  assertEquals(m.normative.deadlift_to_back_squat.position, "below");

  // Relative-strength bar (men back squat 1.90): 1.25 → well_below.
  assertEquals(m.normative.back_squat_to_bodyweight.position, "well_below");

  // press_to_bodyweight has no value → absent from normative.
  assert(!("press_to_bodyweight" in m.normative));

  // ranked_by_position is a permutation of the normative keys, furthest-below
  // first. It is FACTUAL, not a priority.
  const normKeys = Object.keys(m.normative).sort();
  assertEquals([...m.ranked_by_position].sort(), normKeys);
  // The first entry is the most-below metric (here a relative-strength bar).
  const first = m.normative[m.ranked_by_position[0]];
  assertEquals(first.position, "well_below");
});

// ============================================================
// Gender-gated relative strength
// ============================================================

Deno.test("relative-strength normative requires known gender", () => {
  const base = toStatic(FIXTURE_BEGINNER_FITNESS.profileRow);
  const unknownGender = buildAthleteModel({ ...base, gender: "nonbinary" }, null);
  // Lift-to-lift ratios still present; relative-strength bars skipped.
  assert("snatch_to_back_squat" in unknownGender.normative);
  assert(!("back_squat_to_bodyweight" in unknownGender.normative));
});

// ============================================================
// Competition normatives + derived metrics
// ============================================================

// ============================================================
// Step 1.5 — movement-level competition facts
// ============================================================

Deno.test("normalizeMovementKey snake-cases competition movement names", () => {
  assertEquals(normalizeMovementKey("GHD Sit-Up"), "ghd_sit_up");
  assertEquals(normalizeMovementKey("Ring Muscle-Up"), "ring_muscle_up");
  assertEquals(normalizeMovementKey("  Rope Climb  "), "rope_climb");
});

Deno.test("competition_movements flatten from movement_affinity.by_movement", () => {
  const comp: AthleteModelCompetitionInput = {
    movement_affinity: [
      { by_movement: { "GHD Sit-Up": { exposures: 6, avg_percentile: 16.99 }, "Rope Climb": { exposures: 4, avg_percentile: 52.5 } } },
      { by_movement: { "Ring Muscle-Up": { exposures: 10, avg_percentile: 66.87 }, "Pistol": { exposures: 2, avg_percentile: 39.67 } } },
    ],
  };
  const m = buildAthleteModel(toStatic(FIXTURE_BEGINNER_FITNESS.profileRow), comp);
  const cm = m.competition_movements;

  // Keyed by <snake>_competition_percentile — the evidence key CoachState cites.
  assertEquals(cm.ghd_sit_up_competition_percentile.percentile, 16.99);
  assertEquals(cm.ghd_sit_up_competition_percentile.position, "well_below"); // vs p50
  assertEquals(cm.ghd_sit_up_competition_percentile.threshold, 50);
  assertEquals(cm.ghd_sit_up_competition_percentile.gap, -33.01);

  // Confidence from sample_size (exposures): 10→high, 6→medium, 2→low.
  assertEquals(cm.ring_muscle_up_competition_percentile.confidence, "high");
  assertEquals(cm.ghd_sit_up_competition_percentile.confidence, "medium");
  assertEquals(cm.pistol_competition_percentile.confidence, "low");

  // A 66th-pct movement is "well_above" the MEDIAN (fact); the relative-gap
  // judgment for a 90th-pct athlete is CoachState's, not the model's.
  assertEquals(cm.ring_muscle_up_competition_percentile.position, "well_above");
});

Deno.test("competition_movements skips zero-exposure / null-percentile entries", () => {
  const comp: AthleteModelCompetitionInput = {
    movement_affinity: [
      { by_movement: { "Thruster": { exposures: 0, avg_percentile: 80 }, "Snatch": { exposures: 5, avg_percentile: null } } },
    ],
  };
  const m = buildAthleteModel(toStatic(FIXTURE_BEGINNER_FITNESS.profileRow), comp);
  assertEquals(Object.keys(m.competition_movements).length, 0);
});

Deno.test("athleteModelEvidenceKeys = strength normatives + competition movements", () => {
  const comp: AthleteModelCompetitionInput = {
    movement_affinity: [{ by_movement: { "GHD Sit-Up": { exposures: 6, avg_percentile: 17 } } }],
  };
  const m = buildAthleteModel(toStatic(FIXTURE_BEGINNER_FITNESS.profileRow), comp);
  const keys = athleteModelEvidenceKeys(m);
  for (const k of NORMATIVE_KEYS) assert(keys.includes(k));
  assert(keys.includes("ghd_sit_up_competition_percentile"));
});

Deno.test("unlinked athlete has empty competition_movements", () => {
  const m = buildAthleteModel(toStatic(FIXTURE_BEGINNER_FITNESS.profileRow), null);
  assertEquals(Object.keys(m.competition_movements).length, 0);
  assertEquals(athleteModelEvidenceKeys(m).length, NORMATIVE_KEYS.length);
});

Deno.test("competition input yields percentile normatives + derived metrics", () => {
  const comp: AthleteModelCompetitionInput = {
    competition_summary: { overall_competitive_tier: "qualifier", latest_percentile: 30 },
    power_profile: {
      overall: { cohort_percentile: 72 },
      by_time_domain: {
        short: { cohort_percentile: 80 },
        medium: { cohort_percentile: 65 },
        long: { cohort_percentile: 40 },
      },
    },
  };
  const m = buildAthleteModel(toStatic(FIXTURE_BEGINNER_FITNESS.profileRow), comp);

  // latest_percentile 30 vs median 50 → well_below.
  assertEquals(m.normative.competition_latest_percentile.position, "well_below");
  // power overall 72 vs 50 → well_above.
  assertEquals(m.normative.power_overall_percentile.position, "well_above");

  assertEquals(m.derived_metrics.competition_tier, "qualifier");
  assertEquals(m.derived_metrics.power_overall_percentile, 72);
  assertEquals(m.derived_metrics.power_time_domain_percentiles?.long, 40);
});

// ============================================================
// Graceful degradation + determinism
// ============================================================

Deno.test("empty profile degrades gracefully (no throw, all null)", () => {
  const empty: AthleteProfileStatic = {
    age: null, bodyweight: null, gender: null, height: null, units: null,
    lifts: {}, skills: {}, conditioning: {}, equipment: {},
  };
  const m = buildAthleteModel(empty, null);
  assertEquals(m.recovery_class, "open");
  for (const v of Object.values(m.strength_ratios)) assertEquals(v, null);
  assertEquals(Object.keys(m.normative).length, 0);
  assertEquals(m.ranked_by_position.length, 0);
  assertEquals(m.capabilities.snatch.source, "missing");
});

Deno.test("buildAthleteModel is deterministic", () => {
  const p = toStatic(FIXTURE_BEGINNER_FITNESS.profileRow);
  const a = buildAthleteModel(p, null, { asOf: "2026-06-27T00:00:00Z" });
  const b = buildAthleteModel(p, null, { asOf: "2026-06-27T00:00:00Z" });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ============================================================
// profileStaticFromRow — hydration matches build-writer-payload's rules
// ============================================================

Deno.test("profileStaticFromRow hydrates canonical keys with the same coercion", () => {
  const row = FIXTURE_BEGINNER_FITNESS.profileRow;
  const s = profileStaticFromRow(row);

  // Lifts: positive-finite only; all 14 canonical keys present.
  assertEquals(s.lifts.back_squat, 225);
  assertEquals(Object.keys(s.lifts).length, 14);
  assertEquals(s.lifts.front_squat, null); // unfilled

  // Skills: snake-keyed, whitelist coercion.
  assertEquals(s.skills.strict_pull_ups, "beginner");
  assertEquals(s.skills.muscle_ups, "none");

  // Conditioning: time string preserved, bike cals numeric.
  assertEquals(s.conditioning["1_mile_run"], "8:30");
  assertEquals(s.conditioning["1min_bike_cals"], 18);

  // Equipment: boolean, missing = false.
  assertEquals(s.equipment.barbell, true);
  assertEquals(s.equipment.ghd, false);

  // Basics normalized.
  assertEquals(s.units, "lbs");
  assertEquals(s.gender, "male");
  assertEquals(s.bodyweight, 180);
});

Deno.test("profileStaticFromRow tolerates junk / missing JSONB", () => {
  const s = profileStaticFromRow({
    age: null, height: null, bodyweight: null, gender: null, units: "stone",
    lifts: { back_squat: -5, deadlift: "heavy" }, skills: { hspu: "expert" },
    conditioning: { "1k_row": "" }, equipment: { rower: "yes" },
  });
  assertEquals(s.lifts.back_squat, null); // negative rejected
  assertEquals(s.lifts.deadlift, null); // non-number rejected
  assertEquals(s.skills.hspu, null); // not in whitelist
  assertEquals(s.conditioning["1k_row"], null); // empty string rejected
  assertEquals(s.equipment.rower, false); // non-true rejected
  assertEquals(s.units, null); // invalid unit
});

Deno.test("asOf stamped on present capabilities only", () => {
  const p = toStatic(FIXTURE_BEGINNER_FITNESS.profileRow);
  const m = buildAthleteModel(p, null, { asOf: "2026-06-27T00:00:00Z" });
  assertEquals(m.capabilities.back_squat.as_of, "2026-06-27T00:00:00Z");
  assertEquals(m.capabilities.front_squat.as_of, null);
});
