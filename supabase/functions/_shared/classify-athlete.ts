/**
 * Per-lift athlete classification.
 *
 * Strength lifts (squat, bench, deadlift): A / B / C based on lift:bodyweight ratio.
 * Oly lifts (snatch, clean & jerk): A / B based on lift:back_squat ratio.
 */

export interface AthleteLevels {
  squat_level: string;
  bench_level: string;
  deadlift_level: string;
  snatch_level: string;
  clean_jerk_level: string;
}

interface ClassifyInput {
  bodyweight?: number | null;
  gender?: string | null;
  units?: string | null;
  lifts?: Record<string, number> | null;
}

// Male thresholds (lift:BW ratio) — [A/B boundary, B/C boundary]
const MALE_THRESHOLDS = {
  back_squat: [1.25, 1.85],
  bench_press: [0.9, 1.35],
  deadlift: [1.4, 2.1],
} as const;

// Female thresholds = male × 0.72
const FEMALE_FACTOR = 0.72;

// Oly thresholds (lift:back_squat ratio) — [A/B boundary]
const OLY_THRESHOLDS = {
  snatch: 0.61,
  clean_and_jerk: 0.76,
} as const;

function toLbs(value: number, units: string | null | undefined): number {
  return units === "kg" ? value * 2.205 : value;
}

function strengthLevel(
  ratio: number,
  thresholds: readonly [number, number],
): string {
  if (ratio < thresholds[0]) return "A";
  if (ratio < thresholds[1]) return "B";
  return "C";
}

export function classifyAthlete(input: ClassifyInput): AthleteLevels {
  const lifts = input.lifts ?? {};
  const units = input.units ?? "lbs";
  const isFemale = input.gender?.toLowerCase() === "female";
  const factor = isFemale ? FEMALE_FACTOR : 1;

  const bwLbs =
    input.bodyweight && input.bodyweight > 0
      ? toLbs(input.bodyweight, units)
      : null;

  // --- Strength levels ---
  const squat = lifts.back_squat ? toLbs(lifts.back_squat, units) : null;
  const bench = lifts.bench_press ? toLbs(lifts.bench_press, units) : null;
  const dead = lifts.deadlift ? toLbs(lifts.deadlift, units) : null;

  let squat_level = "A"; // default: no squat entered
  let bench_level = "B"; // default: no bench entered
  let deadlift_level = "B"; // default: no deadlift entered

  if (bwLbs) {
    if (squat) {
      const thresholds: [number, number] = [
        MALE_THRESHOLDS.back_squat[0] * factor,
        MALE_THRESHOLDS.back_squat[1] * factor,
      ];
      squat_level = strengthLevel(squat / bwLbs, thresholds);
    }
    if (bench) {
      const thresholds: [number, number] = [
        MALE_THRESHOLDS.bench_press[0] * factor,
        MALE_THRESHOLDS.bench_press[1] * factor,
      ];
      bench_level = strengthLevel(bench / bwLbs, thresholds);
    }
    if (dead) {
      const thresholds: [number, number] = [
        MALE_THRESHOLDS.deadlift[0] * factor,
        MALE_THRESHOLDS.deadlift[1] * factor,
      ];
      deadlift_level = strengthLevel(dead / bwLbs, thresholds);
    }
  }

  // --- Oly levels (based on back squat, not bodyweight) ---
  let snatch_level = "A";
  let clean_jerk_level = "A";

  if (squat && squat > 0) {
    const snatchLbs = lifts.snatch ? toLbs(lifts.snatch, units) : null;
    const cjLbs = lifts.clean_and_jerk
      ? toLbs(lifts.clean_and_jerk, units)
      : null;

    if (snatchLbs) {
      snatch_level = snatchLbs / squat >= OLY_THRESHOLDS.snatch ? "B" : "A";
    }
    if (cjLbs) {
      clean_jerk_level =
        cjLbs / squat >= OLY_THRESHOLDS.clean_and_jerk ? "B" : "A";
    }
  }

  return {
    squat_level,
    bench_level,
    deadlift_level,
    snatch_level,
    clean_jerk_level,
  };
}
