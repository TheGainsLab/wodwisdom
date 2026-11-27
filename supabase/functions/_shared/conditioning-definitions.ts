/**
 * conditioning-definitions.ts
 *
 * The SHARED conditioning vocabulary (2026-08-31 athlete-match package) —
 * one importable table that the metcon composer prompt, the week-fill prompt,
 * and the deterministic audits all read. Nothing downstream redefines these
 * terms: "moderate" meaning 39% of 1RM to one prompt and something else to
 * the audit is how the generic-conditioning failure shipped.
 *
 * Three tables:
 *   1. Time domains (short / medium / long) — the slot buckets.
 *   2. Cycling load bands — what light/moderate/heavy mean as a fraction of
 *      THIS athlete's 1RM in the parent lift, per movement class, with the
 *      parent-lift proxy chain for missing 1RMs and DB/KB defaults by load band.
 *   3. Skill ratings — what each of the athlete's own ratings means (the
 *      per-round rep ranges that used to sit here were removed 2026-11-26).
 *
 * Band numbers are v0 placeholders (founder-calibrated after the first
 * shadow run) — the RULE STRUCTURE is what's frozen, not the numbers.
 */

// ============================================================
// 1. Time domains — THE definition (founder, 2026-11-27): short under 7
//    minutes, medium 7 to 14, long 14 to 22 and never over 22. Every prompt
//    and check in the generator reads these numbers from here.
// ============================================================

export const TIME_DOMAINS = {
  short: { maxMinutes: 7, label: "short: under 7 min" },
  medium: { minMinutes: 7, maxMinutes: 14, label: "medium: 7-14 min" },
  long: { minMinutes: 14, maxMinutes: 22, label: "long: 14-22 min, never over 22" },
} as const;

/** The three definitions as one line, for prompts. */
export const TIME_DOMAINS_LINE = `${TIME_DOMAINS.short.label} · ${TIME_DOMAINS.medium.label} · ${TIME_DOMAINS.long.label}`;

/** Which domain a number of minutes falls in (a boundary belongs to the longer one). */
export function timeDomainForMinutes(minutes: number): "short" | "medium" | "long" {
  if (minutes < TIME_DOMAINS.short.maxMinutes) return "short";
  if (minutes < TIME_DOMAINS.medium.maxMinutes) return "medium";
  return "long";
}

// ============================================================
// 2. Cycling load bands (% of the athlete's 1RM in the parent lift)
// ============================================================

export type LoadBand = "light" | "moderate" | "heavy";

export interface LoadClassDef {
  /** Parent-lift 1RM keys, first non-null wins (canonical payload.lifts keys). */
  parents: string[];
  /** [low, high] as % of parent 1RM. null = this class has no heavy band. */
  bands: Record<LoadBand, [number, number] | null>;
  /** Display names / keywords a movement matches this class by (normalized substring). */
  match: string[];
}

/** Movement classes for barbell cycling loads inside metcons. Deliberately
 *  coarse: the class answers "what fraction of capacity is repeatable under
 *  fatigue", not "what lift is this". */
export const CYCLING_LOAD_CLASSES: Record<string, LoadClassDef> = {
  deadlift: {
    parents: ["deadlift"],
    bands: { light: [35, 45], moderate: [45, 55], heavy: [55, 65] },
    match: ["deadlift", "sumo deadlift"],
  },
  clean: {
    parents: ["power_clean", "clean", "clean_and_jerk"],
    bands: { light: [40, 50], moderate: [50, 60], heavy: [60, 70] },
    match: ["power clean", "hang power clean", "squat clean", "clean and jerk", "clean"],
  },
  snatch: {
    parents: ["power_snatch", "snatch"],
    bands: { light: [40, 50], moderate: [50, 60], heavy: [60, 68] },
    match: ["power snatch", "hang power snatch", "snatch"],
  },
  thruster: {
    parents: ["front_squat", "clean"],
    bands: { light: [30, 40], moderate: [40, 50], heavy: [50, 60] },
    match: ["thruster", "cluster", "front squat", "front rack walking lunge"],
  },
  shoulder_to_overhead: {
    parents: ["jerk", "push_jerk", "push_press", "press"],
    bands: { light: [35, 45], moderate: [45, 55], heavy: [55, 65] },
    match: [
      "push press", "push jerk", "shoulder to overhead", "ground to overhead",
      "overhead squat", "overhead walking lunge",
    ],
  },
  back_squat: {
    parents: ["back_squat"],
    bands: { light: [40, 50], moderate: [50, 60], heavy: null },
    match: ["back squat"],
  },
};

/** The medicine ball is one fixed weight per sex (founder, 2026-11-27). */
export const MEDICINE_BALL_WEIGHTS = { men: "20 lb / 9 kg", women: "14 lb / 6 kg" } as const;

const normalize = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Resolve a barbell movement's load class by keyword match (longest match
 *  wins so "clean and jerk" beats "clean"). Null for non-barbell movements. */
export function loadClassForMovement(movement: string): string | null {
  const n = normalize(movement);
  let best: { cls: string; len: number } | null = null;
  for (const [cls, def] of Object.entries(CYCLING_LOAD_CLASSES)) {
    for (const kw of def.match) {
      if (n.includes(kw) && (!best || kw.length > best.len)) best = { cls, len: kw.length };
    }
  }
  return best?.cls ?? null;
}

/** The band's % window for a class, or null when the class lacks that band. */
export function bandRange(cls: string, band: LoadBand): [number, number] | null {
  return CYCLING_LOAD_CLASSES[cls]?.bands[band] ?? null;
}

// ============================================================
// 3. Skill ratings — what the athlete's own rating of each skill means
// ============================================================

export type SkillTier = "beginner" | "intermediate" | "advanced";
/** The athlete's own rating of one skill. */
export type SkillRating = "none" | SkillTier;

/**
 * What each rating means: the founder's definitions, word for word, as shown
 * to the athlete on the profile page (AthletePage.tsx SKILL_LEVEL_LEGEND).
 * A rating belongs to ONE skill and never says anything about another
 * (founder, 2026-11-26: "Skills never affect each other").
 */
export const SKILL_RATING_MEANINGS: Record<SkillRating, string> = {
  none: "can't do it yet",
  beginner: "small sets only, not consistent",
  intermediate: "can do it comfortably in workouts",
  advanced: "big unbroken sets even under fatigue",
};

/** The four ratings and what they mean for programming, for the composer and
 *  the writer. Rules only: no example athlete, no movement named. */
export const SKILL_RATINGS_PROMPT = [
  "SKILL RATINGS — the athlete rated each skill in the payload's skills map. A rating belongs to THAT ONE SKILL and says nothing about any other skill: never use one skill's rating for another. What each rating means, in the athlete's own profile wording:",
  `  - none: ${SKILL_RATING_MEANINGS.none}. Never program the movement itself — progressions toward it only.`,
  `  - beginner: ${SKILL_RATING_MEANINGS.beginner}. Program it in small sets, metcons included; build volume gradually across the weeks and do not add harder variations while the base is being built.`,
  `  - intermediate: ${SKILL_RATING_MEANINGS.intermediate}. Program it normally in workouts, with moderate volume and progression.`,
  `  - advanced: ${SKILL_RATING_MEANINGS.advanced}. Full volume and progression.`,
  "  - not rated: use your judgment from the rest of the athlete's data.",
  "A LOW rating means the skill is worth developing — program it often with quality reps — not that it gets the most volume.",
].join("\n");

// ============================================================
// Rounding + prompt renders
// ============================================================

export const ROUNDING_RULE =
  "Take the band midpoint of the athlete's parent-lift 1RM, round DOWN to the nearest plate-math step (5 lbs / 2.5 kg); round down on ties or equipment limits.";

/** The load table rendered for prompts (composer + fill read the SAME text). */
export const CYCLING_LOAD_BANDS_PROMPT = [
  "CYCLING LOAD BANDS (% of THIS athlete's 1RM in the parent lift — the shared definition; adjectives without a band are a defect):",
  ...Object.entries(CYCLING_LOAD_CLASSES).map(([cls, def]) => {
    const bands = (Object.entries(def.bands) as Array<[LoadBand, [number, number] | null]>)
      .filter(([, r]) => r != null)
      .map(([b, r]) => `${b} ${r![0]}-${r![1]}%`)
      .join(" · ");
    return `  - ${cls} (parent 1RM: ${def.parents.join(" else ")}): ${bands}`;
  }),
  // Founder, 2026-11-27: the composer chooses dumbbell and kettlebell weights
  // from the athlete's lifts (the fixed 35/50/70 and 20/35/50 table is gone);
  // the medicine ball is always one weight per sex.
  "  - dumbbell / kettlebell: no band and no default. The composer chooses the weight for THIS athlete from their lifts and states it on the movement (weight, per implement); the writer uses it as given.",
  `  - medicine ball: always ${MEDICINE_BALL_WEIGHTS.men} for men and ${MEDICINE_BALL_WEIGHTS.women} for women.`,
  `  Rounding: ${ROUNDING_RULE}`,
].join("\n");

