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
 *      parent-lift proxy chain for missing 1RMs and DB/KB tier defaults.
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

/** DB/KB tier defaults (lbs; DB per hand / KB) when no benchmark exists.
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

export interface SkillFatigueDef {
  /** Normalized keywords the movement matches by. */
  match: string[];
  /** payload.skills keys consulted for the athlete's tier, first non-null wins. */
  skillKeys: string[];
  /** Per-round rep band by tier. null = not under fatigue at that tier. */
  perRound: Record<SkillTier, [number, number] | null>;
}

export const SKILL_FATIGUE_BANDS: Record<string, SkillFatigueDef> = {
  toes_to_bar: {
    match: ["toes to bar", "chest to bar", "kipping pull up", "pull up", "knee raise"],
    skillKeys: ["toes_to_bar", "chest_to_bar_pull_ups", "kipping_pull_ups", "strict_pull_ups"],
    perRound: { beginner: [3, 6], intermediate: [6, 12], advanced: [10, 20] },
  },
  muscle_up: {
    match: ["bar muscle up", "ring muscle up", "muscle up"],
    skillKeys: ["bar_muscle_ups", "muscle_ups", "strict_ring_muscle_ups"],
    perRound: { beginner: null, intermediate: [2, 5], advanced: [5, 10] },
  },
  hspu: {
    match: ["handstand push up", "hspu"],
    skillKeys: ["hspu", "strict_hspu", "deficit_hspu", "wall_facing_hspu"],
    perRound: { beginner: null, intermediate: [3, 8], advanced: [8, 15] },
  },
  double_under: {
    match: ["double under"],
    skillKeys: ["double_unders"],
    perRound: { beginner: [15, 30], intermediate: [30, 50], advanced: [50, 100] },
  },
  rope_climb: {
    match: ["rope climb"],
    skillKeys: ["rope_climbs", "legless_rope_climbs"],
    perRound: { beginner: [1, 1], intermediate: [1, 2], advanced: [2, 3] },
  },
  wall_walk: {
    match: ["wall walk"],
    skillKeys: ["wall_facing_hspu", "hspu", "strict_hspu"],
    perRound: { beginner: [1, 2], intermediate: [2, 4], advanced: [4, 6] },
  },
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

/** The athlete's tier for a banded skill from their skills map — first
 *  non-null skillKey wins; "none" reads as beginner-with-caution (legality /
 *  vocabulary gates handle true inability). NULL when the athlete's map holds
 *  no value for any of the skill's keys — absence is NEUTRAL: the audit skips
 *  rather than assuming a tier. */
export function athleteTierFor(
  def: SkillFatigueDef,
  skills: Record<string, string | null>,
): SkillTier | null {
  for (const k of def.skillKeys) {
    const v = skills[k];
    if (v === "advanced" || v === "intermediate" || v === "beginner") return v;
    if (v === "none") return "beginner";
  }
  return null;
}

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
  `  - dumbbell / kettlebell (no barbell parent): tier defaults ${IMPLEMENT_TIER_DEFAULTS.dumbbell.beginner}/${IMPLEMENT_TIER_DEFAULTS.dumbbell.intermediate}/${IMPLEMENT_TIER_DEFAULTS.dumbbell.advanced} lb DB · ${IMPLEMENT_TIER_DEFAULTS.kettlebell.beginner}/${IMPLEMENT_TIER_DEFAULTS.kettlebell.intermediate}/${IMPLEMENT_TIER_DEFAULTS.kettlebell.advanced} lb KB (beginner/intermediate/advanced), overridable when a benchmark exists.`,
  `  Rounding: ${ROUNDING_RULE}`,
].join("\n");

/** The skill volume table rendered for prompts. */
export const SKILL_FATIGUE_BANDS_PROMPT = [
  "SKILL VOLUME BANDS UNDER FATIGUE (per-round reps by the athlete's tier; volume inside the band is presumptively defensible, above it needs a written justification in the piece's stimulus_note):",
  ...Object.entries(SKILL_FATIGUE_BANDS).map(([key, def]) => {
    const tiers = (Object.entries(def.perRound) as Array<[SkillTier, [number, number] | null]>)
      .map(([t, r]) => `${t} ${r ? `${r[0]}-${r[1]}` : "not under fatigue"}`)
      .join(" · ");
    return `  - ${key.replace(/_/g, " ")}: ${tiers}`;
  }),
].join("\n");
