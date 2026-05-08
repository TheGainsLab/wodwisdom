/**
 * derive-athlete-diagnostic — pure function over an athlete profile that
 * produces the structured diagnostic findings consumed by both
 * profile-analysis (eval) and generate-program.
 *
 * Findings, not prescriptions. Code computes the deterministic stuff
 * (per-lift levels, ratios, flags, loading ceilings, scheme menus,
 * accessory pools, skill priority); the AI does the coaching.
 *
 * Augmentation slots (cohort, Tier 4) are reserved on the output but
 * unused until those data sources are wired.
 */

import { classifyPerLiftLevel, type PerLiftLevel } from "./level-interpreter.ts";
import {
  ACCESSORY_POOLS,
  ALLOWED_SCHEMES,
  COMPETITOR_BONUS,
  DELOAD_MODIFIER,
  FLAG_AFFECTED_LIFTS,
  LIFT_FLAG_CATEGORIES,
  LIFT_RATIO_DEFINITIONS,
  LOADING_CEILINGS,
  METCON_CATEGORIES,
  MOVEMENTS,
  SCHEMES_REQUIRING_COMPETITOR_BONUS,
  SKILL_PREREQUISITES,
  SKILLS_TOP_N_ACTIVE,
  SYNTHETIC_LEVEL_ANCHOR,
  type FlagCategory,
  type MovementCategory,
  type SkillLevel,
} from "./diagnostic-constants.ts";

/** Lifts that get a per-lift level directly from BW × age × gender bands.
 *  All other lifts derive a synthetic level via the anchor rule (Step 5). */
const BW_CLASSIFIED_LIFTS = ["back_squat", "deadlift", "bench_press", "press"] as const;

// ============================================================
// Input types
// ============================================================

export interface AthleteProfileInput {
  age?: number | null;
  gender?: string | null;
  bodyweight?: number | null;
  units?: string | null; // "lbs" | "kg"
  lifts?: Record<string, number | null | undefined> | null;
  skills?: Record<string, string | null | undefined> | null;
  equipment?: Record<string, boolean> | null;
}

export interface DiagnosticContext {
  // Reserved for future augmentation layers. The current Step 1-10 logic
  // ignores everything in here; consumers can pass an empty object.
  cohort?: unknown;
  tier4?: {
    /**
     * True when the athlete's linked competition record indicates
     * games-tier or 10+ seasons competed. Drives the +3% loading
     * ceiling bonus (COMPETITOR_BONUS) when active.
     */
    competitor_bonus_active?: boolean;
  };
}

// ============================================================
// Lift output types
// ============================================================

export type RatioStatus = "in_band" | "below_band" | "above_band";

export interface LiftRatio {
  name: string;        // identifier from LIFT_RATIO_DEFINITIONS.ratio_name
  lift_a: string;      // numerator lift (canonical key)
  lift_b: string;      // denominator lift (canonical key)
  ratio: number;       // computed value of lift_a / lift_b
  threshold: number;
  direction: "below" | "above";
  status: RatioStatus;
}

export interface LiftFlag {
  name: string;             // e.g. "front_rack_limiter"
  category: FlagCategory;   // technique | mobility
  evidence_ratio: string;   // ratio_name that triggered the flag
}

export interface LiftLoading {
  /**
   * Max % of 1RM during weeks 1-3 (cycle ceiling, after any competitor
   * bonus). Null for ratio-only lifts — those have no explicit ceiling
   * defined; the AI works within the scheme menu and synthetic level.
   */
  cycle_ceiling: number | null;
  /** Max % of 1RM during week 4 (deload). Null when cycle_ceiling is null. */
  deload_ceiling: number | null;
  /** Schemes the AI may pick from for this lift. Always populated when level is non-null. */
  allowed_schemes: string[];
}

export interface AccessoryPoolEntry {
  movement: string;          // canonical name from MOVEMENTS
  category: MovementCategory;
  equipment: string[];       // for prompt transparency; pool is already filtered
  fired_by: string[];        // flag names that caused this movement to enter
}

export interface LiftDiagnostic {
  /** Raw 1RMs as entered, canonicalized to the form keys (e.g. strict_press → press). */
  one_rms: Record<string, number>;

  /** Per-lift levels for the 4 BW-classified lifts. null when input missing. */
  per_lift_levels: Record<string, PerLiftLevel | null>;

  /** Synthetic levels for the 10 ratio-only lifts (after anchor + flag drop). */
  synthetic_levels: Record<string, PerLiftLevel | null>;

  /** All defined ratios computed against the athlete's data. */
  ratios: LiftRatio[];

  /** Active flags (only the ones whose trigger condition fired). */
  flags: LiftFlag[];

  /** Loading + scheme menu per lift (BW-classified + ratio-only). */
  loading: Record<string, LiftLoading>;

  /** Curated accessory pool, ordered by flag severity, equipment-filtered. */
  accessory_pool: AccessoryPoolEntry[];
}

// ============================================================
// Skills output types
// ============================================================

export interface SkillFlag {
  name: "prerequisite_gap";
  skill: string;                     // skill the flag applies to
  missing_prerequisites: string[];   // which prereq skills are not at intermediate+
}

export interface SkillsDiagnostic {
  /** Per-skill levels as provided by the athlete (none/beginner/intermediate/advanced). */
  per_skill_levels: Record<string, SkillLevel>;

  /** Active skill flags. Currently just prerequisite_gap. */
  flags: SkillFlag[];

  /** Top-N eligible skills to actively develop (priority-ranked). */
  active_focus: string[];

  /** Metcon movement categories the athlete can have programmed. */
  metcon_allow_list: string[];
}

// ============================================================
// Top-level diagnostic
// ============================================================

export interface DiagnosticMeta {
  schema_version: number;
  computed_at: string; // ISO timestamp
  inputs_complete: {
    lifts: boolean;  // at least one of the 4 BW-classified lifts present
    skills: boolean; // at least one skill rated
  };
  competitor_bonus_active: boolean;
}

export interface AthleteDiagnostic {
  meta: DiagnosticMeta;
  lifts: LiftDiagnostic;
  skills: SkillsDiagnostic;

  /** Reserved for Tier 4 augmentation. null until that layer ships. */
  competition: null;

  /** Reserved for cohort augmentation. null until that layer ships. */
  cohort: null;
}

export const DIAGNOSTIC_SCHEMA_VERSION = 1;

// ============================================================
// Step 4 — lift classification, ratios, flags
// ============================================================

/**
 * Classify the 4 BW-classified lifts into per-lift levels.
 * Lifts not in the profile (or missing weight/bodyweight) get null.
 */
export function classifyBwLifts(
  profile: AthleteProfileInput,
): Record<string, PerLiftLevel | null> {
  const result: Record<string, PerLiftLevel | null> = {};
  const bw = profile.bodyweight ?? 0;
  const lifts = profile.lifts ?? {};

  for (const lift of BW_CLASSIFIED_LIFTS) {
    const weight = lifts[lift];
    if (typeof weight !== "number" || weight <= 0) {
      result[lift] = null;
      continue;
    }
    result[lift] = classifyPerLiftLevel(lift, weight, bw, profile.gender, profile.age);
  }
  return result;
}

/**
 * Compute every defined lift-to-lift ratio from the athlete's 1RMs.
 * Skips ratios where either lift is missing or zero.
 */
export function computeRatios(profile: AthleteProfileInput): LiftRatio[] {
  const lifts = profile.lifts ?? {};
  const out: LiftRatio[] = [];

  for (const def of LIFT_RATIO_DEFINITIONS) {
    const a = lifts[def.lift_a];
    const b = lifts[def.lift_b];
    if (typeof a !== "number" || a <= 0 || typeof b !== "number" || b <= 0) continue;

    const ratio = a / b;
    let status: RatioStatus = "in_band";
    if (def.direction === "below" && ratio < def.threshold) status = "below_band";
    else if (def.direction === "above" && ratio > def.threshold) status = "above_band";

    out.push({
      name: def.ratio_name,
      lift_a: def.lift_a,
      lift_b: def.lift_b,
      ratio,
      threshold: def.threshold,
      direction: def.direction,
      status,
    });
  }
  return out;
}

/**
 * Emit a LiftFlag for every ratio whose status indicates a fired condition.
 * - direction "below" + status "below_band" → flag fires
 * - direction "above" + status "above_band" → flag fires
 */
export function fireLiftFlags(ratios: LiftRatio[]): LiftFlag[] {
  const out: LiftFlag[] = [];
  for (const r of ratios) {
    const fired =
      (r.direction === "below" && r.status === "below_band") ||
      (r.direction === "above" && r.status === "above_band");
    if (!fired) continue;

    // Find the flag name from the matching ratio definition.
    const def = LIFT_RATIO_DEFINITIONS.find((d) => d.ratio_name === r.name);
    if (!def) continue;

    const category = LIFT_FLAG_CATEGORIES[def.flag];
    if (!category) continue; // shouldn't happen; defensive

    out.push({
      name: def.flag,
      category,
      evidence_ratio: r.name,
    });
  }
  return out;
}

// ============================================================
// Step 5 — synthetic levels for ratio-only lifts
// ============================================================

/** Drop a per-lift level by one step, floored at beginner. */
function dropLevel(level: PerLiftLevel): PerLiftLevel {
  if (level === "advanced") return "intermediate";
  if (level === "intermediate") return "beginner";
  return "beginner";
}

/**
 * Derive synthetic per-lift levels for the 10 ratio-only lifts.
 *
 * Rule: each ratio-only lift inherits its anchor lift's level. If any active
 * flag affects this lift (per FLAG_AFFECTED_LIFTS), the level drops by one
 * (max one drop regardless of how many flags fire), floored at beginner.
 *
 * Returns null for a ratio-only lift when its anchor lift is unclassified
 * (i.e., the user didn't enter the anchor lift's 1RM).
 */
export function deriveSyntheticLevels(
  bwLifts: Record<string, PerLiftLevel | null>,
  activeFlags: LiftFlag[],
): Record<string, PerLiftLevel | null> {
  // Lifts touched by at least one active flag → one-level drop.
  const affected = new Set<string>();
  for (const flag of activeFlags) {
    const lifts = FLAG_AFFECTED_LIFTS[flag.name];
    if (!lifts) continue;
    for (const l of lifts) affected.add(l);
  }

  const result: Record<string, PerLiftLevel | null> = {};
  for (const [ratioOnlyLift, anchorLift] of Object.entries(SYNTHETIC_LEVEL_ANCHOR)) {
    const anchorLevel = bwLifts[anchorLift];
    if (!anchorLevel) {
      result[ratioOnlyLift] = null;
      continue;
    }
    result[ratioOnlyLift] = affected.has(ratioOnlyLift)
      ? dropLevel(anchorLevel)
      : anchorLevel;
  }
  return result;
}

// ============================================================
// Step 6 — loading ceilings + scheme menus
// ============================================================

/**
 * Resolve the scheme menu for a per-lift level. The competitor bonus only
 * unlocks the very-top schemes (1RM attempt) and only at advanced level.
 */
function selectAllowedSchemes(
  level: PerLiftLevel,
  competitorBonusActive: boolean,
): string[] {
  const base = [...ALLOWED_SCHEMES[level]];
  if (competitorBonusActive && level === "advanced") {
    base.push(...SCHEMES_REQUIRING_COMPETITOR_BONUS);
  }
  return base;
}

/**
 * Compute per-lift loading info: cycle ceiling, deload ceiling, allowed
 * schemes. BW-classified lifts get full numeric ceilings; ratio-only lifts
 * get scheme menu only (ceilings null).
 *
 * Lifts without a level (input not provided) are omitted from the result.
 */
export function computeLoading(
  bwLevels: Record<string, PerLiftLevel | null>,
  syntheticLevels: Record<string, PerLiftLevel | null>,
  competitorBonusActive: boolean,
): Record<string, LiftLoading> {
  const result: Record<string, LiftLoading> = {};

  // BW-classified lifts: full loading info from the LOADING_CEILINGS table.
  for (const [lift, level] of Object.entries(bwLevels)) {
    if (!level) continue;
    const baseCeiling = LOADING_CEILINGS[lift]?.[level];
    if (typeof baseCeiling !== "number") continue;

    const cycleCeiling = competitorBonusActive
      ? baseCeiling + COMPETITOR_BONUS
      : baseCeiling;

    result[lift] = {
      cycle_ceiling: cycleCeiling,
      deload_ceiling: cycleCeiling * DELOAD_MODIFIER,
      allowed_schemes: selectAllowedSchemes(level, competitorBonusActive),
    };
  }

  // Ratio-only lifts: scheme menu only.
  for (const [lift, level] of Object.entries(syntheticLevels)) {
    if (!level) continue;
    result[lift] = {
      cycle_ceiling: null,
      deload_ceiling: null,
      allowed_schemes: selectAllowedSchemes(level, competitorBonusActive),
    };
  }

  return result;
}

// ============================================================
// Step 7 — accessory pool merger
// ============================================================

/** Compute the highest per-lift level across all classified lifts.
 *  null when no lift has a level (athlete entered no lifts). */
function computeMaxLevel(levels: (PerLiftLevel | null)[]): PerLiftLevel | null {
  const order = { beginner: 0, intermediate: 1, advanced: 2 } as const;
  let max: PerLiftLevel | null = null;
  for (const l of levels) {
    if (!l) continue;
    if (!max || order[l] > order[max]) max = l;
  }
  return max;
}

/** True when actual level is at or above the required level. */
function levelAtLeast(
  actual: PerLiftLevel | null,
  required: PerLiftLevel,
): boolean {
  if (!actual) return false;
  const order = { beginner: 0, intermediate: 1, advanced: 2 } as const;
  return order[actual] >= order[required];
}

/**
 * Resolve a pool movement against the athlete's available equipment.
 * Returns the canonical movement name to actually program, or null if even
 * the fallback can't be satisfied.
 */
function resolveMovementForEquipment(
  movementName: string,
  available: Set<string>,
): string | null {
  const meta = MOVEMENTS[movementName];
  if (!meta) return null;
  if (meta.equipment.every((e) => available.has(e))) return movementName;
  if (meta.fallback) {
    const fb = MOVEMENTS[meta.fallback];
    if (fb && fb.equipment.every((e) => available.has(e))) return meta.fallback;
  }
  return null;
}

/**
 * Merge accessory pools across all active flags into a single curated,
 * ordered, equipment-filtered list.
 *
 * Steps:
 *   1. Walk each active flag's pool; resolve each movement against the
 *      athlete's equipment (substitute fallback when the original isn't
 *      satisfied; drop when neither works).
 *   2. Group by resolved movement name; aggregate the set of flags that
 *      caused each movement to enter.
 *   3. Apply min_tier gate against the athlete's max per-lift level.
 *   4. Sort by appearance count (descending) so high-leverage movements
 *      addressing multiple flags rise to the top; tie-break alphabetically
 *      for determinism.
 */
export function mergeAccessoryPools(
  activeFlags: LiftFlag[],
  equipment: Record<string, boolean> | null | undefined,
  bwLevels: Record<string, PerLiftLevel | null>,
  syntheticLevels: Record<string, PerLiftLevel | null>,
): AccessoryPoolEntry[] {
  // Available equipment: truthy keys plus implicit bodyweight.
  const available = new Set<string>(["bodyweight"]);
  if (equipment) {
    for (const [k, v] of Object.entries(equipment)) {
      if (v) available.add(k);
    }
  }

  const maxLevel = computeMaxLevel([
    ...Object.values(bwLevels),
    ...Object.values(syntheticLevels),
  ]);

  // Group resolved movements by canonical name; aggregate fired_by flags.
  const grouped = new Map<string, Set<string>>();
  for (const flag of activeFlags) {
    const pool = ACCESSORY_POOLS[flag.name];
    if (!pool) continue;
    for (const original of pool) {
      const resolved = resolveMovementForEquipment(original, available);
      if (!resolved) continue;
      let firedBy = grouped.get(resolved);
      if (!firedBy) {
        firedBy = new Set();
        grouped.set(resolved, firedBy);
      }
      firedBy.add(flag.name);
    }
  }

  // Apply min_tier gate.
  const gated: { movement: string; firedBy: Set<string> }[] = [];
  for (const [movement, firedBy] of grouped) {
    const meta = MOVEMENTS[movement];
    if (!meta) continue;
    if (!levelAtLeast(maxLevel, meta.min_tier)) continue;
    gated.push({ movement, firedBy });
  }

  // Sort: appearance count desc, then alphabetical.
  gated.sort((a, b) => {
    const diff = b.firedBy.size - a.firedBy.size;
    if (diff !== 0) return diff;
    return a.movement.localeCompare(b.movement);
  });

  return gated.map(({ movement, firedBy }) => {
    const meta = MOVEMENTS[movement];
    return {
      movement,
      category: meta.category,
      equipment: meta.equipment,
      fired_by: [...firedBy].sort(),
    };
  });
}

// ============================================================
// Step 8 — skills logic
// ============================================================

/** True for "intermediate" or "advanced" (case-insensitive). */
function isProficient(level: string | null | undefined): boolean {
  const l = (level ?? "").toLowerCase();
  return l === "intermediate" || l === "advanced";
}

/**
 * Effective proficiency: claimed at intermediate+ AND not demoted by a
 * prerequisite_gap flag. Used for prereq satisfaction and metcon gating.
 */
function isProficientEffective(
  skill: string,
  skills: Record<string, string>,
  demoted: Set<string>,
): boolean {
  return isProficient(skills[skill]) && !demoted.has(skill);
}

/** Reverse the prerequisite map: skill → list of skills that depend on it. */
function buildDependentMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [skill, prereqs] of Object.entries(SKILL_PREREQUISITES)) {
    for (const p of prereqs) {
      (map[p] ??= []).push(skill);
    }
  }
  return map;
}

/** Normalize the input skills object to a plain Record<string, string>. */
function normalizeSkills(
  skills: Record<string, string | null | undefined> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!skills) return out;
  for (const [k, v] of Object.entries(skills)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Emit a prerequisite_gap flag for each skill claimed at intermediate+ that
 * has at least one prerequisite at none/beginner.
 */
export function fireSkillFlags(
  skills: Record<string, string | null | undefined> | null | undefined,
): SkillFlag[] {
  const map = normalizeSkills(skills);
  const out: SkillFlag[] = [];
  for (const [skill, prereqs] of Object.entries(SKILL_PREREQUISITES)) {
    if (!isProficient(map[skill])) continue;
    if (prereqs.length === 0) continue;
    const missing = prereqs.filter((p) => !isProficient(map[p]));
    if (missing.length === 0) continue;
    out.push({
      name: "prerequisite_gap",
      skill,
      missing_prerequisites: missing,
    });
  }
  return out;
}

/**
 * Determine which metcon categories the athlete can have programmed.
 *
 * A category is allowed when at least one of its variants is effectively
 * proficient (intermediate+ AND not demoted by prerequisite_gap).
 */
export function computeMetconAllowList(
  skills: Record<string, string | null | undefined> | null | undefined,
  gapFlags: SkillFlag[],
): string[] {
  const map = normalizeSkills(skills);
  const demoted = new Set(gapFlags.map((f) => f.skill));
  const allowed: string[] = [];
  for (const [category, variants] of Object.entries(METCON_CATEGORIES)) {
    for (const variant of variants) {
      if (isProficientEffective(variant, map, demoted)) {
        allowed.push(category);
        break;
      }
    }
  }
  return allowed;
}

/**
 * Top-N eligible skills (Needs Attention) ranked by transitive missing-
 * dependent count.
 *
 * Eligibility: skill is not effectively proficient AND every prerequisite
 * IS effectively proficient. Demoted skills do not enter Needs Attention
 * directly — their missing prerequisite does (which then ranks high because
 * the demoted skill is one of its blocked dependents).
 */
export function computeSkillPriority(
  skills: Record<string, string | null | undefined> | null | undefined,
  gapFlags: SkillFlag[],
): string[] {
  const map = normalizeSkills(skills);
  const demoted = new Set(gapFlags.map((f) => f.skill));
  const dependentMap = buildDependentMap();

  const eligible: { skill: string; priority: number }[] = [];
  for (const [skill, prereqs] of Object.entries(SKILL_PREREQUISITES)) {
    // Already effectively proficient → not in Needs Attention.
    if (isProficientEffective(skill, map, demoted)) continue;
    // Prereqs not all met → not eligible yet (will surface later).
    if (!prereqs.every((p) => isProficientEffective(p, map, demoted))) continue;
    eligible.push({
      skill,
      priority: countMissingTransitiveDependents(skill, map, demoted, dependentMap),
    });
  }

  eligible.sort((a, b) => {
    const diff = b.priority - a.priority;
    if (diff !== 0) return diff;
    return a.skill.localeCompare(b.skill);
  });

  return eligible.slice(0, SKILLS_TOP_N_ACTIVE).map((e) => e.skill);
}

/** BFS from a root skill: count distinct downstream skills not yet effectively proficient. */
function countMissingTransitiveDependents(
  root: string,
  skills: Record<string, string>,
  demoted: Set<string>,
  dependentMap: Record<string, string[]>,
): number {
  const visited = new Set<string>([root]);
  const queue = [root];
  let count = 0;
  while (queue.length > 0) {
    const s = queue.shift()!;
    const dependents = dependentMap[s] ?? [];
    for (const d of dependents) {
      if (visited.has(d)) continue;
      visited.add(d);
      if (!isProficientEffective(d, skills, demoted)) {
        count++;
        queue.push(d);
      }
    }
  }
  return count;
}

// ============================================================
// Entry point
// ============================================================

/**
 * Compute the full athlete diagnostic from the profile and optional
 * augmentation context. Pure function — same inputs always produce the
 * same output. Safe to call on every read; cheap (microseconds).
 *
 * Returns an AthleteDiagnostic with `competition` and `cohort` set to null
 * until those augmentation layers are wired.
 */
export function deriveAthleteDiagnostic(
  profile: AthleteProfileInput,
  ctx: DiagnosticContext = {},
): AthleteDiagnostic {
  // 1RMs: keep numeric, positive entries only.
  const oneRms: Record<string, number> = {};
  if (profile.lifts) {
    for (const [k, v] of Object.entries(profile.lifts)) {
      if (typeof v === "number" && v > 0) oneRms[k] = v;
    }
  }

  // Step 4 — classify, compute ratios, fire lift flags.
  const bwLevels = classifyBwLifts(profile);
  const ratios = computeRatios(profile);
  const liftFlags = fireLiftFlags(ratios);

  // Step 5 — synthetic levels for the 10 ratio-only lifts.
  const syntheticLevels = deriveSyntheticLevels(bwLevels, liftFlags);

  // Step 6 — loading ceilings + scheme menus per lift.
  const competitorBonusActive = ctx.tier4?.competitor_bonus_active === true;
  const loading = computeLoading(bwLevels, syntheticLevels, competitorBonusActive);

  // Step 7 — accessory pool merger.
  const accessoryPool = mergeAccessoryPools(
    liftFlags,
    profile.equipment ?? null,
    bwLevels,
    syntheticLevels,
  );

  // Step 8 — skills logic.
  const skillFlags = fireSkillFlags(profile.skills);
  const metconAllowList = computeMetconAllowList(profile.skills, skillFlags);
  const activeFocus = computeSkillPriority(profile.skills, skillFlags);

  // Normalize per-skill levels for the output (lowercased, validated).
  const perSkillLevels: Record<string, SkillLevel> = {};
  if (profile.skills) {
    for (const [k, v] of Object.entries(profile.skills)) {
      if (typeof v !== "string") continue;
      const lvl = v.toLowerCase();
      if (lvl === "none" || lvl === "beginner" || lvl === "intermediate" || lvl === "advanced") {
        perSkillLevels[k] = lvl as SkillLevel;
      }
    }
  }

  const liftsComplete = Object.values(bwLevels).some((l) => l !== null);
  const skillsComplete = Object.keys(perSkillLevels).length > 0;

  return {
    meta: {
      schema_version: DIAGNOSTIC_SCHEMA_VERSION,
      computed_at: new Date().toISOString(),
      inputs_complete: {
        lifts: liftsComplete,
        skills: skillsComplete,
      },
      competitor_bonus_active: competitorBonusActive,
    },
    lifts: {
      one_rms: oneRms,
      per_lift_levels: bwLevels,
      synthetic_levels: syntheticLevels,
      ratios,
      flags: liftFlags,
      loading,
      accessory_pool: accessoryPool,
    },
    skills: {
      per_skill_levels: perSkillLevels,
      flags: skillFlags,
      active_focus: activeFocus,
      metcon_allow_list: metconAllowList,
    },
    competition: null,
    cohort: null,
  };
}
