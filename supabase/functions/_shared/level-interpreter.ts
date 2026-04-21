/**
 * Level interpreter — turns raw athlete numbers into relative performance levels
 * across strength, skills, and conditioning domains, then derives a single
 * experience tier.
 *
 * Rule-based (no LLM). Uses rough strength-to-bodyweight ratios and
 * conditioning benchmark thresholds adjusted for age and gender.
 *
 * Thresholds are intentionally approximate — the generator should treat these
 * as coarse buckets, not precise scores. When more accuracy is needed later,
 * swap specific lookups for a finer percentile table or a classifier.
 */

export type PerformanceLevel = "below_average" | "average" | "above_average" | "elite";

export type ExperienceTier = "novice" | "intermediate" | "advanced" | "competitor";

export interface LevelInputs {
  age?: number | null;
  gender?: string | null;
  bodyweight?: number | null;
  units?: string | null; // "lbs" | "kg"
  lifts?: Record<string, number | null | undefined> | null;
  skills?: Record<string, string | null | undefined> | null;
  conditioning?: Record<string, string | number | null | undefined> | null;
}

export interface DomainLevels {
  strength: {
    overall: PerformanceLevel;
    per_lift: Record<string, PerformanceLevel>;
  };
  skills: {
    overall: PerformanceLevel;
    proficient_count: number;
    total_rated: number;
  };
  conditioning: {
    overall: PerformanceLevel;
    benchmarks_present: number;
  };
  experience_tier: ExperienceTier;
}

// Strength standards expressed as multiples of bodyweight for men; women scaled
// at ~0.75. These are rough coach's-eye standards, not elite powerlifting
// federations. Adjust by age band (under 35 baseline, 35-50 -5%, 50+ -15%).
const MALE_BW_MULTIPLIERS: Record<string, { avg: number; above: number; elite: number }> = {
  back_squat: { avg: 1.25, above: 1.75, elite: 2.25 },
  front_squat: { avg: 1.0, above: 1.5, elite: 1.9 },
  deadlift: { avg: 1.5, above: 2.0, elite: 2.5 },
  bench_press: { avg: 1.0, above: 1.5, elite: 2.0 },
  strict_press: { avg: 0.6, above: 0.85, elite: 1.1 },
  snatch: { avg: 0.85, above: 1.15, elite: 1.4 },
  clean_and_jerk: { avg: 1.1, above: 1.5, elite: 1.8 },
};

const FEMALE_ADJUSTMENT = 0.75;

function ageAdjust(multiplier: number, age: number | null | undefined): number {
  if (!age || age < 35) return multiplier;
  if (age < 50) return multiplier * 0.95;
  if (age < 60) return multiplier * 0.85;
  return multiplier * 0.75;
}

function classifyLift(
  lift: string,
  weight: number,
  bodyweight: number,
  gender: string | null | undefined,
  age: number | null | undefined,
): PerformanceLevel {
  const base = MALE_BW_MULTIPLIERS[lift];
  if (!base || !bodyweight || bodyweight <= 0 || weight <= 0) return "average";
  const scale = (gender ?? "").toLowerCase() === "female" ? FEMALE_ADJUSTMENT : 1;
  const thresholds = {
    avg: ageAdjust(base.avg * scale, age),
    above: ageAdjust(base.above * scale, age),
    elite: ageAdjust(base.elite * scale, age),
  };
  const ratio = weight / bodyweight;
  if (ratio >= thresholds.elite) return "elite";
  if (ratio >= thresholds.above) return "above_average";
  if (ratio >= thresholds.avg) return "average";
  return "below_average";
}

function skillToScore(level: string | null | undefined): number {
  // 0 = none, 1 = beginner, 2 = intermediate, 3 = advanced
  switch ((level ?? "").toLowerCase()) {
    case "advanced": return 3;
    case "intermediate": return 2;
    case "beginner": return 1;
    default: return 0;
  }
}

function assessSkills(skills: Record<string, string | null | undefined> | null | undefined): {
  overall: PerformanceLevel;
  proficient_count: number;
  total_rated: number;
} {
  if (!skills) return { overall: "below_average", proficient_count: 0, total_rated: 0 };
  const scores = Object.values(skills).map(skillToScore);
  const total_rated = scores.filter((s) => s > 0).length;
  const proficient_count = scores.filter((s) => s >= 2).length; // intermediate+
  const advanced_count = scores.filter((s) => s === 3).length;
  const totalSkills = scores.length || 1;
  const advancedRatio = advanced_count / totalSkills;
  const proficientRatio = proficient_count / totalSkills;
  let overall: PerformanceLevel;
  if (advancedRatio >= 0.5) overall = "elite";
  else if (proficientRatio >= 0.5 || advancedRatio >= 0.2) overall = "above_average";
  else if (proficientRatio >= 0.2) overall = "average";
  else overall = "below_average";
  return { overall, proficient_count, total_rated };
}

// Conditioning benchmarks — keys match athlete_profiles.conditioning shape.
// Values are interpreted as time in seconds (e.g. "7:45" -> 465) for row/run
// benchmarks, or reps/meters for capacity benchmarks. We just count how many
// are filled and use that as a weak signal; a richer lookup can come later.
function assessConditioning(
  conditioning: Record<string, string | number | null | undefined> | null | undefined,
): { overall: PerformanceLevel; benchmarks_present: number } {
  if (!conditioning) return { overall: "below_average", benchmarks_present: 0 };
  let count = 0;
  for (const v of Object.values(conditioning)) {
    if (v == null) continue;
    if (typeof v === "number" && v > 0) count++;
    else if (typeof v === "string" && v.trim() !== "") count++;
  }
  // Without population-level lookups, infer level from coverage + gross numbers.
  // Placeholder: 0-1 = below_average, 2-3 = average, 4-5 = above_average, 6+ = elite.
  let overall: PerformanceLevel;
  if (count >= 6) overall = "above_average";
  else if (count >= 3) overall = "average";
  else if (count >= 1) overall = "below_average";
  else overall = "below_average";
  return { overall, benchmarks_present: count };
}

function levelRank(level: PerformanceLevel): number {
  switch (level) {
    case "below_average": return 0;
    case "average": return 1;
    case "above_average": return 2;
    case "elite": return 3;
  }
}

function rankToLevel(rank: number): PerformanceLevel {
  if (rank >= 3) return "elite";
  if (rank >= 2) return "above_average";
  if (rank >= 1) return "average";
  return "below_average";
}

function deriveExperienceTier(
  strength: PerformanceLevel,
  skills: PerformanceLevel,
  conditioning: PerformanceLevel,
): ExperienceTier {
  const avg = (levelRank(strength) + levelRank(skills) + levelRank(conditioning)) / 3;
  if (avg >= 2.5) return "competitor";
  if (avg >= 1.5) return "advanced";
  if (avg >= 0.6) return "intermediate";
  return "novice";
}

export function interpretLevels(inputs: LevelInputs): DomainLevels {
  const units = (inputs.units ?? "").toLowerCase();
  const bodyweight = inputs.bodyweight ?? 0;
  const bwInLbs = units === "kg" && bodyweight ? bodyweight * 2.2046 : bodyweight;

  const per_lift: Record<string, PerformanceLevel> = {};
  if (inputs.lifts) {
    for (const [key, rawValue] of Object.entries(inputs.lifts)) {
      if (typeof rawValue !== "number" || rawValue <= 0) continue;
      const weightInLbs = units === "kg" ? rawValue * 2.2046 : rawValue;
      per_lift[key] = classifyLift(key, weightInLbs, bwInLbs, inputs.gender, inputs.age);
    }
  }

  const overallStrength: PerformanceLevel = Object.values(per_lift).length > 0
    ? rankToLevel(
        Math.round(
          Object.values(per_lift).reduce((a, l) => a + levelRank(l), 0) / Object.values(per_lift).length,
        ),
      )
    : "below_average";

  const skills = assessSkills(inputs.skills);
  const conditioning = assessConditioning(inputs.conditioning);
  const experience_tier = deriveExperienceTier(overallStrength, skills.overall, conditioning.overall);

  return {
    strength: { overall: overallStrength, per_lift },
    skills,
    conditioning,
    experience_tier,
  };
}

export function calibrationDelta(
  selfPerception: string | null | undefined,
  evidenceTier: ExperienceTier,
): { delta: number; note: string } {
  const selfMap: Record<string, number> = {
    beginner: 0,
    intermediate: 1,
    advanced: 2,
    competitive: 3,
  };
  const evidenceMap: Record<ExperienceTier, number> = {
    novice: 0,
    intermediate: 1,
    advanced: 2,
    competitor: 3,
  };
  if (!selfPerception || selfPerception === "not_sure") {
    return { delta: 0, note: "Self-perception not provided." };
  }
  const selfVal = selfMap[selfPerception.toLowerCase()] ?? 1;
  const evidenceVal = evidenceMap[evidenceTier];
  const delta = selfVal - evidenceVal;
  if (delta >= 2) {
    return {
      delta,
      note: "User rates themselves significantly higher than measured evidence suggests. Start conservative on loads and complexity; let them prove capability before progressing.",
    };
  }
  if (delta === 1) {
    return {
      delta,
      note: "User rates themselves slightly above measured evidence. Respect their confidence but watch for overreach in the first two weeks.",
    };
  }
  if (delta <= -2) {
    return {
      delta,
      note: "User rates themselves significantly lower than measured evidence suggests. They've been selling themselves short; push progressions a bit harder and expose them to their actual capability.",
    };
  }
  if (delta === -1) {
    return {
      delta,
      note: "User slightly underestimates themselves. Lean progressive on skill and load increments.",
    };
  }
  return { delta: 0, note: "Self-perception aligned with evidence." };
}
