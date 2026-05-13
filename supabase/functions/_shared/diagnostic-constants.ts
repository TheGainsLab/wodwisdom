/**
 * Diagnostic constants — locked content tables for the strength + skills
 * diagnostic. Pure data, no logic. Consumed by derive-athlete-diagnostic.ts.
 *
 * All values come from product-spec decisions captured during planning.
 * Changes here require coordinated updates to expectations and tests.
 */

import type { PerLiftLevel } from "./level-interpreter.ts";

// ============================================================
// LIFT DIAGNOSTIC — ratio definitions and flag triggers
// ============================================================

export type FlagDirection = "below" | "above";
export type FlagCategory = "technique" | "mobility";

export interface LiftRatioDefinition {
  ratio_name: string;        // identifier, used in diagnostic output
  lift_a: string;            // numerator lift (canonical key)
  lift_b: string;            // denominator lift (canonical key)
  threshold: number;
  direction: FlagDirection;  // fires when ratio is below or above threshold
  flag: string;              // name of flag fired
}

export const LIFT_RATIO_DEFINITIONS: LiftRatioDefinition[] = [
  { ratio_name: "fs_bs",      lift_a: "front_squat",    lift_b: "back_squat", threshold: 0.80, direction: "below", flag: "front_rack_limiter" },
  { ratio_name: "ohs_fs",     lift_a: "overhead_squat", lift_b: "front_squat", threshold: 0.70, direction: "below", flag: "overhead_position_limiter" },
  { ratio_name: "sn_bs",      lift_a: "snatch",         lift_b: "back_squat", threshold: 0.60, direction: "below", flag: "snatch_technical_gap" },
  { ratio_name: "cj_bs",      lift_a: "clean_and_jerk", lift_b: "back_squat", threshold: 0.75, direction: "below", flag: "cj_technical_gap" },
  { ratio_name: "clean_bs",   lift_a: "clean",          lift_b: "back_squat", threshold: 0.80, direction: "below", flag: "clean_technical_gap" },
  { ratio_name: "pc_clean",   lift_a: "power_clean",    lift_b: "clean",      threshold: 0.85, direction: "above", flag: "receive_position_weak_clean" },
  { ratio_name: "jerk_clean", lift_a: "jerk",           lift_b: "clean",      threshold: 0.95, direction: "below", flag: "jerk_overhead_limiter" },
  { ratio_name: "ps_sn",      lift_a: "power_snatch",   lift_b: "snatch",     threshold: 0.85, direction: "above", flag: "receive_position_weak_snatch" },
  { ratio_name: "pp_press",   lift_a: "push_press",     lift_b: "press",      threshold: 1.25, direction: "below", flag: "leg_drive_limiter" },
  { ratio_name: "pj_pp",      lift_a: "push_jerk",      lift_b: "push_press", threshold: 1.05, direction: "below", flag: "jerk_commitment_limiter" },
];

export const LIFT_FLAG_CATEGORIES: Record<string, FlagCategory> = {
  snatch_technical_gap:         "technique",
  cj_technical_gap:             "technique",
  clean_technical_gap:          "technique",
  front_rack_limiter:           "mobility",
  overhead_position_limiter:    "mobility",
  receive_position_weak_clean:  "mobility",
  jerk_overhead_limiter:        "technique",
  receive_position_weak_snatch: "mobility",
  leg_drive_limiter:            "technique",
  jerk_commitment_limiter:      "technique",
};

// Flag → list of lifts whose synthetic level drops one when this flag is active.
// Used by deriveSyntheticLevels: any ratio-only lift in this list, when the
// flag is active, drops one level from its anchor (floor: beginner).
export const FLAG_AFFECTED_LIFTS: Record<string, string[]> = {
  front_rack_limiter:           ["front_squat", "clean", "clean_and_jerk", "power_clean"],
  overhead_position_limiter:    ["overhead_squat", "snatch", "power_snatch"],
  snatch_technical_gap:         ["snatch"],
  clean_technical_gap:          ["clean", "clean_and_jerk"],
  cj_technical_gap:             ["clean_and_jerk"],
  jerk_overhead_limiter:        ["jerk", "clean_and_jerk"],
  receive_position_weak_clean:  ["power_clean", "clean", "clean_and_jerk"],
  receive_position_weak_snatch: ["power_snatch", "snatch"],
  leg_drive_limiter:            ["push_press"],
  jerk_commitment_limiter:      ["push_jerk"],
};

// Anchor map: 10 ratio-only lifts → anchor lift whose per-lift level they
// inherit (subject to one-level drop if any flag affects them).
export const SYNTHETIC_LEVEL_ANCHOR: Record<string, string> = {
  front_squat:    "back_squat",
  overhead_squat: "back_squat",
  snatch:         "back_squat",
  power_snatch:   "back_squat",
  clean:          "back_squat",
  power_clean:    "back_squat",
  clean_and_jerk: "back_squat",
  jerk:           "press",
  push_press:     "press",
  push_jerk:      "press",
};

// ============================================================
// LIFT DIAGNOSTIC — loading ceilings + scheme menu
// ============================================================

// Cycle ceiling % per lift × per-lift level (max % during weeks 1-3).
// Defined here for the 4 BW-classified lifts; ratio-only lifts inherit
// via their synthetic level (consumer applies the table at runtime).
export const LOADING_CEILINGS: Record<string, Record<PerLiftLevel, number>> = {
  back_squat:  { beginner: 0.75, intermediate: 0.85, advanced: 0.92 },
  deadlift:    { beginner: 0.78, intermediate: 0.85, advanced: 0.90 },
  bench_press: { beginner: 0.75, intermediate: 0.85, advanced: 0.90 },
  press:       { beginner: 0.75, intermediate: 0.85, advanced: 0.90 },
};

// Week 4 deload ceiling = cycle ceiling × DELOAD_MODIFIER.
export const DELOAD_MODIFIER = 0.80;

// Permissible schemes by per-lift level. AI picks among these — no scheme
// outside the level's list may appear for that lift.
export const ALLOWED_SCHEMES: Record<PerLiftLevel, string[]> = {
  beginner: [
    "3x8",
    "4x6",
    "5x5",
    "5x3",
    "3x3",
  ],
  intermediate: [
    "3x8",
    "4x6",
    "5x5",
    "5x3",
    "3x3",
    "3x2_olympic",
    "tempo_5x3",
    "cluster_3x3",
    "wave_3_2_1",
    "heavy_double",
  ],
  advanced: [
    "3x8",
    "4x6",
    "5x5",
    "5x3",
    "3x3",
    "3x2_olympic",
    "tempo_5x3",
    "cluster_3x3",
    "wave_3_2_1",
    "heavy_double",
    "heavy_single",
    "1rm_attempt",
  ],
};

// ============================================================
// LIFT DIAGNOSTIC — movement metadata + accessory pools
// ============================================================

export type MovementCategory = "mobility" | "position" | "technique" | "strength";

export interface MovementMetadata {
  name: string;
  category: MovementCategory;
  equipment: string[];          // canonical equipment IDs
  min_tier: PerLiftLevel;       // minimum per-lift level required to program
  fallback?: string;            // canonical name to substitute when equipment missing
}

// 32 unique movements referenced across the 10 accessory pools.
export const MOVEMENTS: Record<string, MovementMetadata> = {
  behind_neck_jerk:           { name: "behind_neck_jerk",           category: "technique", equipment: ["barbell"],            min_tier: "intermediate" },
  behind_neck_push_press:     { name: "behind_neck_push_press",     category: "position",  equipment: ["barbell"],            min_tier: "intermediate" },
  bottom_OHS_hold:            { name: "bottom_OHS_hold",            category: "position",  equipment: ["barbell"],            min_tier: "intermediate" },
  clean_deadlift_slow_pull:   { name: "clean_deadlift_slow_pull",   category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  clean_from_blocks_knee:     { name: "clean_from_blocks_knee",     category: "technique", equipment: ["barbell", "blocks"],  min_tier: "beginner", fallback: "hang_clean_knee" },
  clean_high_pull:            { name: "clean_high_pull",            category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  drop_clean:                 { name: "drop_clean",                 category: "technique", equipment: ["barbell"],            min_tier: "intermediate" },
  drop_jerk:                  { name: "drop_jerk",                  category: "technique", equipment: ["barbell"],            min_tier: "intermediate" },
  drop_snatch:                { name: "drop_snatch",                category: "technique", equipment: ["barbell"],            min_tier: "intermediate" },
  front_rack_carry:           { name: "front_rack_carry",           category: "position",  equipment: ["barbell"],            min_tier: "beginner" },
  front_rack_mobility:        { name: "front_rack_mobility",        category: "mobility",  equipment: ["bodyweight"],         min_tier: "beginner" },
  hang_clean_knee:            { name: "hang_clean_knee",            category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  hang_snatch_knee:           { name: "hang_snatch_knee",           category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  jerk_balance:               { name: "jerk_balance",               category: "technique", equipment: ["barbell"],            min_tier: "intermediate" },
  jerk_drives:                { name: "jerk_drives",                category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  pause_front_squat:          { name: "pause_front_squat",          category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  pause_OHS:                  { name: "pause_OHS",                  category: "position",  equipment: ["barbell"],            min_tier: "intermediate" },
  push_press_from_blocks:     { name: "push_press_from_blocks",     category: "technique", equipment: ["barbell", "blocks"],  min_tier: "beginner", fallback: "push_press_paused_dip" },
  push_press_paused_dip:      { name: "push_press_paused_dip",      category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  push_press_strict:          { name: "push_press_strict",          category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  snatch_balance:             { name: "snatch_balance",             category: "position",  equipment: ["barbell"],            min_tier: "intermediate" },
  snatch_deadlift_slow_pull:  { name: "snatch_deadlift_slow_pull",  category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  snatch_from_blocks_knee:    { name: "snatch_from_blocks_knee",    category: "technique", equipment: ["barbell", "blocks"],  min_tier: "beginner", fallback: "hang_snatch_knee" },
  snatch_high_pull:           { name: "snatch_high_pull",           category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  sots_press:                 { name: "sots_press",                 category: "position",  equipment: ["barbell"],            min_tier: "intermediate" },
  split_jerk_holds:           { name: "split_jerk_holds",           category: "position",  equipment: ["barbell"],            min_tier: "intermediate" },
  split_jerk_recovery_hold:   { name: "split_jerk_recovery_hold",   category: "position",  equipment: ["barbell"],            min_tier: "intermediate" },
  tall_clean:                 { name: "tall_clean",                 category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  tall_snatch:                { name: "tall_snatch",                category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  tempo_front_squat:          { name: "tempo_front_squat",          category: "technique", equipment: ["barbell"],            min_tier: "beginner" },
  thoracic_shoulder_mobility: { name: "thoracic_shoulder_mobility", category: "mobility",  equipment: ["bodyweight"],         min_tier: "beginner" },
  zombie_front_squat:         { name: "zombie_front_squat",         category: "position",  equipment: ["barbell"],            min_tier: "intermediate" },
};

// Accessory pool: flag → ordered list of movement names.
// Order = priority (consumer pulls from front first).
export const ACCESSORY_POOLS: Record<string, string[]> = {
  snatch_technical_gap: [
    "snatch_high_pull",
    "snatch_from_blocks_knee",
    "hang_snatch_knee",
    "snatch_deadlift_slow_pull",
    "tall_snatch",
  ],
  cj_technical_gap: [
    "clean_high_pull",
    "clean_from_blocks_knee",
    "hang_clean_knee",
    "clean_deadlift_slow_pull",
    "jerk_drives",
  ],
  clean_technical_gap: [
    "clean_high_pull",
    "clean_from_blocks_knee",
    "hang_clean_knee",
    "tall_clean",
    "clean_deadlift_slow_pull",
  ],
  front_rack_limiter: [
    "tempo_front_squat",
    "pause_front_squat",
    "zombie_front_squat",
    "front_rack_carry",
    "front_rack_mobility",
  ],
  overhead_position_limiter: [
    "snatch_balance",
    "sots_press",
    "pause_OHS",
    "behind_neck_push_press",
    "thoracic_shoulder_mobility",
  ],
  receive_position_weak_clean: [
    "pause_front_squat",
    "drop_clean",
    "tall_clean",
    "clean_from_blocks_knee",
    "front_rack_carry",
  ],
  jerk_overhead_limiter: [
    "jerk_drives",
    "jerk_balance",
    "behind_neck_jerk",
    "split_jerk_recovery_hold",
    "push_press_strict",
  ],
  receive_position_weak_snatch: [
    "snatch_balance",
    "drop_snatch",
    "sots_press",
    "pause_OHS",
    "bottom_OHS_hold",
  ],
  leg_drive_limiter: [
    "push_press_paused_dip",
    "jerk_drives",
    "push_press_from_blocks",
    "snatch_high_pull",
    "clean_high_pull",
  ],
  jerk_commitment_limiter: [
    "drop_jerk",
    "jerk_drives",
    "jerk_balance",
    "split_jerk_holds",
    "behind_neck_jerk",
  ],
};

// ============================================================
// LIFT DIAGNOSTIC — mobility sequences (named, enumerated)
// ============================================================

export interface MobilityStep {
  exercise: string;
  reps_or_time: string;
  equipment: string[];
}

export interface MobilitySequence {
  name: string;
  steps: MobilityStep[];
}

export const MOBILITY_SEQUENCES: Record<string, MobilitySequence> = {
  front_rack_mobility: {
    name: "front_rack_mobility",
    steps: [
      { exercise: "wrist_circles",                  reps_or_time: "10 each direction", equipment: ["bodyweight"] },
      { exercise: "kneeling_wrist_flexor_stretch",  reps_or_time: "30s each side",     equipment: ["bodyweight"] },
      { exercise: "lat_opener_band",                reps_or_time: "30s each side",     equipment: ["bands"] },
      { exercise: "thread_the_needle",              reps_or_time: "10 each side",      equipment: ["bodyweight"] },
      { exercise: "empty_bar_front_rack_hold",      reps_or_time: "2 x 30s",           equipment: ["barbell"] },
    ],
  },
  thoracic_shoulder_mobility: {
    name: "thoracic_shoulder_mobility",
    steps: [
      { exercise: "foam_roller_t_spine_extensions", reps_or_time: "8-10 reps",         equipment: ["bodyweight"] },
      { exercise: "thread_the_needle",              reps_or_time: "10 each side",      equipment: ["bodyweight"] },
      { exercise: "shoulder_dislocates_band_or_pvc", reps_or_time: "10 reps",          equipment: ["bands"] },
      { exercise: "wall_slides",                    reps_or_time: "10 reps",           equipment: ["bodyweight"] },
      { exercise: "doorway_pec_stretch",            reps_or_time: "30s each side",     equipment: ["bodyweight"] },
    ],
  },
};

// ============================================================
// LIFT DIAGNOSTIC — flag-conditional rule blocks (system prompt)
// ============================================================

// Injected into the system prompt only for flags that are active for this
// athlete. Each rule is short, action-oriented, references the curated pool.
export const LIFT_FLAG_RULE_BLOCKS: Record<string, string> = {
  snatch_technical_gap:
    "Snatch work biases toward technique. Reduce heavy full snatches; use positions and complexes. Pull from the snatch_technical_gap pool.",
  cj_technical_gap:
    "C&J work biases toward technique. Reduce heavy full C&Js; use positions and complexes. Pull from the cj_technical_gap pool.",
  clean_technical_gap:
    "Clean work biases toward technique. Reduce heavy full cleans; use positions and complexes. Pull from the clean_technical_gap pool.",
  front_rack_limiter:
    "Front rack mobility work weekly. Front squat work biases toward tempo and pause variants. Pull from the front_rack_limiter pool.",
  overhead_position_limiter:
    "Loaded overhead-position work weekly. Snatch and OHS work biases toward positions, not heavy full lifts. Pull from the overhead_position_limiter pool.",
  receive_position_weak_clean:
    "Front squat volume increased with tempo/pause emphasis. Catch-position drills weekly. Pull from the receive_position_weak_clean pool.",
  jerk_overhead_limiter:
    "Jerk technique work weekly. Build overhead strength via push press. Pull from the jerk_overhead_limiter pool.",
  receive_position_weak_snatch:
    "OHS receive work weekly. Snatch work biases toward positions, not heavy full lifts. Pull from the receive_position_weak_snatch pool.",
  leg_drive_limiter:
    "Push press technique work weekly. Bias push press training toward leg-drive habit. Pull from the leg_drive_limiter pool.",
  jerk_commitment_limiter:
    "Push jerk technique work weekly. Bias push jerk training toward catch confidence. Pull from the jerk_commitment_limiter pool.",
};

// ============================================================
// SKILLS DIAGNOSTIC — prerequisite chains
// ============================================================

// Each skill maps to the list of skills that must be at intermediate+ before
// this one is considered eligible (priority filter). Empty array = standalone.
export const SKILL_PREREQUISITES: Record<string, string[]> = {
  strict_pull_ups:        [],
  kipping_pull_ups:       ["strict_pull_ups"],
  butterfly_pull_ups:     ["kipping_pull_ups"],
  chest_to_bar_pull_ups:  ["kipping_pull_ups"],
  muscle_ups:             ["kipping_pull_ups", "ring_dips"],
  strict_ring_muscle_ups: ["strict_pull_ups", "ring_dips"],
  bar_muscle_ups:         ["chest_to_bar_pull_ups"],
  wall_facing_hspu:       [],
  strict_hspu:            ["wall_facing_hspu"],
  hspu:                   ["strict_hspu"],
  deficit_hspu:           ["hspu"],
  handstand_walk:         ["wall_facing_hspu"],
  ring_dips:              [],
  rope_climbs:            [],
  legless_rope_climbs:    ["rope_climbs"],
  toes_to_bar:            [],
  double_unders:          [],
  pistols:                [],
  l_sit:                  [],
};

// ============================================================
// SKILLS DIAGNOSTIC — metcon category mapping
// ============================================================

// Metcon "movement category" → constituent skill variants.
// A category is allowed in metcons when at least one variant is at
// intermediate+ AND has no prerequisite_gap flag.
export const METCON_CATEGORIES: Record<string, string[]> = {
  pull_ups:            ["strict_pull_ups", "kipping_pull_ups", "butterfly_pull_ups"],
  chest_to_bar:        ["chest_to_bar_pull_ups"],
  bar_muscle_ups:      ["bar_muscle_ups"],
  ring_muscle_ups:     ["muscle_ups", "strict_ring_muscle_ups"],
  toes_to_bar:         ["toes_to_bar"],
  hspu:                ["wall_facing_hspu", "strict_hspu", "hspu", "deficit_hspu"],
  rope_climbs:         ["rope_climbs"],
  legless_rope_climbs: ["legless_rope_climbs"],
  ring_dips:           ["ring_dips"],
  pistols:             ["pistols"],
  double_unders:       ["double_unders"],
  handstand_walk:      ["handstand_walk"],
  l_sit:               ["l_sit"],
};

// ============================================================
// SKILLS DIAGNOSTIC — rule blocks (system prompt)
// ============================================================

export type SkillLevel = "none" | "beginner" | "intermediate" | "advanced";

// Skill-block guidance per level. Injected only when the active top-3 contains
// at least one skill at that level. Levels "none" and "beginner" share the
// same block (treat as developing).
export const SKILL_LEVEL_RULE_BLOCKS: Record<"beginner" | "intermediate" | "advanced", string> = {
  beginner:
    "Foundational variants only (eccentrics, negatives, banded, active holds). Sub-failure rep volume. No max-rep tests until reaching intermediate.",
  intermediate:
    "Standard progression cadence. Volume + tempo work, occasional max-rep tests every 4 weeks. Push toward advanced variations gradually.",
  advanced:
    "Loaded / tempo / paused variations. Max-rep tests every 2-3 weeks. Rotate variation focus across cycles.",
};

export const PREREQUISITE_GAP_RULE_BLOCK =
  "When an athlete claims a skill at intermediate+ but is missing its prerequisite, treat the higher skill as developing — exclude it from metcons and don't program weighted or advanced variants. The claim may be overestimated. Prioritize building the prerequisite until it reaches intermediate.";

// ============================================================
// SKILLS DIAGNOSTIC — focus cap
// ============================================================

// Top-N eligible skills get active development volume; remaining eligible
// skills get baseline exposure only.
export const SKILLS_TOP_N_ACTIVE = 3;
