import { SKILL_DISPLAY_NAMES } from "./tier-status.ts";

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
 *   3. Skill volume bands under fatigue — per-round rep ranges and caps by
 *      the athlete's self-reported tier.
 *
 * Band numbers are v0 placeholders (founder-calibrated after the first
 * shadow run) — the RULE STRUCTURE is what's frozen, not the numbers.
 */

// ============================================================
// 1. Time domains — matches the existing audit buckets (metcon-variety-audits
//    TIME_BUCKETS and the skeleton prompt). Kept at 8–15 deliberately: the
//    2026-08-31 review considered 8–16 and rejected it (no functional gain,
//    three files to touch).
// ============================================================

export const TIME_DOMAINS = {
  short: { maxMinutes: 8, label: "short: under 8 min" },
  medium: { minMinutes: 8, maxMinutes: 15, label: "medium: 8-15 min" },
  long: { minMinutes: 15, label: "long: over 15 min (cap ~25)" },
} as const;

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

/** DB/KB defaults by load band (lbs; DB per hand / KB) when no benchmark exists.
 *  The fill may override upward when the athlete's data supports it. */
export const IMPLEMENT_TIER_DEFAULTS = {
  dumbbell: { beginner: 35, intermediate: 50, advanced: 70 },
  kettlebell: { beginner: 20, intermediate: 35, advanced: 50 },
} as const;

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
// 3. Skill volume bands under fatigue (per-round reps by tier)
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

export interface SkillFatigueDef {
  /** The ONE profile skill this band belongs to. Its rating is the only one read. */
  skillKey: string;
  /** Normalized keywords the movement matches by. */
  match: string[];
  /** Per-round rep band by rating. "none" is never under fatigue: progressions only. */
  perRound: Record<SkillTier, [number, number]>;
}

// One band per rated skill (2026-11-26). They used to be grouped by family, and
// one skill's rating set another's volume (the toes-to-bar rating governed
// pull-ups; an HSPU rating governed wall walks). Beginner is allowed in metcons
// in small sets (founder, 2026-11-26); the beginner muscle-up and HSPU bands
// were "not under fatigue" before.
const PULL: Record<SkillTier, [number, number]> = { beginner: [3, 6], intermediate: [6, 12], advanced: [10, 20] };
const MU: Record<SkillTier, [number, number]> = { beginner: [1, 2], intermediate: [2, 5], advanced: [5, 10] };
const HSPU: Record<SkillTier, [number, number]> = { beginner: [1, 3], intermediate: [3, 8], advanced: [8, 15] };
const ROPE: Record<SkillTier, [number, number]> = { beginner: [1, 1], intermediate: [1, 2], advanced: [2, 3] };

export const SKILL_FATIGUE_BANDS: Record<string, SkillFatigueDef> = {
  toes_to_bar: { skillKey: "toes_to_bar", match: ["toes to bar"], perRound: PULL },
  chest_to_bar_pull_ups: { skillKey: "chest_to_bar_pull_ups", match: ["chest to bar"], perRound: PULL },
  kipping_pull_ups: { skillKey: "kipping_pull_ups", match: ["kipping pull up", "pull up"], perRound: PULL },
  strict_pull_ups: { skillKey: "strict_pull_ups", match: ["strict pull up"], perRound: PULL },
  butterfly_pull_ups: { skillKey: "butterfly_pull_ups", match: ["butterfly pull up"], perRound: PULL },
  bar_muscle_ups: { skillKey: "bar_muscle_ups", match: ["bar muscle up"], perRound: MU },
  muscle_ups: { skillKey: "muscle_ups", match: ["ring muscle up", "muscle up"], perRound: MU },
  strict_ring_muscle_ups: { skillKey: "strict_ring_muscle_ups", match: ["strict ring muscle up", "strict muscle up"], perRound: MU },
  hspu: { skillKey: "hspu", match: ["handstand push up", "hspu"], perRound: HSPU },
  strict_hspu: { skillKey: "strict_hspu", match: ["strict handstand push up", "strict hspu"], perRound: HSPU },
  deficit_hspu: { skillKey: "deficit_hspu", match: ["deficit handstand push up", "deficit hspu"], perRound: HSPU },
  wall_facing_hspu: { skillKey: "wall_facing_hspu", match: ["wall facing handstand push up", "wall facing hspu"], perRound: HSPU },
  double_unders: { skillKey: "double_unders", match: ["double under"], perRound: { beginner: [15, 30], intermediate: [30, 50], advanced: [50, 100] } },
  rope_climbs: { skillKey: "rope_climbs", match: ["rope climb"], perRound: ROPE },
  legless_rope_climbs: { skillKey: "legless_rope_climbs", match: ["legless rope climb"], perRound: ROPE },
};

/** Find the skill-fatigue definition a movement falls under (longest keyword
 *  match wins). Null when the movement isn't a banded skill. */
export function skillFatigueDefForMovement(movement: string): SkillFatigueDef | null {
  const n = normalize(movement);
  let best: { def: SkillFatigueDef; len: number } | null = null;
  for (const def of Object.values(SKILL_FATIGUE_BANDS)) {
    for (const kw of def.match) {
      if (n.includes(kw) && (!best || kw.length > best.len)) best = { def, len: kw.length };
    }
  }
  return best?.def ?? null;
}

/**
 * The athlete's own rating of THIS skill, or null when they gave none.
 * Only the def's own skill is read, never another (2026-11-26). The skills map
 * may be keyed by profile key or by display name; both are matched exactly
 * (normalized), never by one name sitting inside another — "hspu" sits inside
 * "strict hspu", and those are two skills. "none" stays "none": it means the
 * athlete can't do it yet (it used to be read as beginner).
 */
export function athleteTierFor(
  def: SkillFatigueDef,
  skills: Record<string, string | null>,
): SkillRating | null {
  const want = new Set([normalize(def.skillKey), normalize(SKILL_DISPLAY_NAMES[def.skillKey] ?? def.skillKey)]);
  for (const [k, v] of Object.entries(skills)) {
    if (!want.has(normalize(k))) continue;
    if (v === "none" || v === "beginner" || v === "intermediate" || v === "advanced") return v;
  }
  return null;
}

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
  // By the piece's load band, not by an athlete "tier": the athlete has no
  // overall tier (2026-11-26). Light / moderate / heavy take the three values.
  `  - dumbbell / kettlebell (no barbell parent), by load band: light ${IMPLEMENT_TIER_DEFAULTS.dumbbell.beginner} · moderate ${IMPLEMENT_TIER_DEFAULTS.dumbbell.intermediate} · heavy ${IMPLEMENT_TIER_DEFAULTS.dumbbell.advanced} lb per dumbbell; light ${IMPLEMENT_TIER_DEFAULTS.kettlebell.beginner} · moderate ${IMPLEMENT_TIER_DEFAULTS.kettlebell.intermediate} · heavy ${IMPLEMENT_TIER_DEFAULTS.kettlebell.advanced} lb kettlebell (convert for kg), overridable when the athlete's data supports more.`,
  `  Rounding: ${ROUNDING_RULE}`,
].join("\n");

/** The skill volume table rendered for prompts. */
export const SKILL_FATIGUE_BANDS_PROMPT = [
  "SKILL VOLUME BANDS UNDER FATIGUE (per-round reps by the athlete's rating of THAT skill — each skill uses only its own rating; volume inside the band is presumptively defensible, above it needs a written justification in the piece's stimulus_note):",
  ...Object.entries(SKILL_FATIGUE_BANDS).map(([key, def]) => {
    const tiers = (Object.entries(def.perRound) as Array<[SkillTier, [number, number]]>)
      .map(([t, r]) => `${t} ${r[0]}-${r[1]}`)
      .join(" · ") + " · none: never the movement itself, progressions only";
    return `  - ${key.replace(/_/g, " ")}: ${tiers}`;
  }),
].join("\n");
