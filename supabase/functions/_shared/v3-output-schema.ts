/**
 * v3-output-schema.ts
 *
 * v3 introduces chained generation: a skeleton call decides the 4-week
 * structure (month_plan + per-day block-type assignments + primary lifts
 * + metcon/skill focus per day), and per-week fill calls populate the
 * actual movement-level prescriptions.
 *
 * This file defines the SKELETON output contract — the lighter, structural
 * intermediate that the skeleton writer emits. The per-week fill calls
 * reuse v2's WriterOutput shape (per week) since the per-day rendered
 * structure is identical between v2 and v3.
 *
 * Locked design rules (per session 2026-05-15 chained-gen discussion):
 *   - The skeleton emits month_plan + 4 weeks × N days, where each day
 *     declares which block types exist plus the strength / metcon / skill
 *     focus when those blocks are present.
 *   - The skeleton does NOT emit set/rep/weight/movement-level data —
 *     that lives in the per-week fill call.
 *   - days array is locked to the athlete's days_per_week (same per-call
 *     parameterization pattern as v2's EMIT_PROGRAM_TOOL).
 */

import { BLOCK_TYPES, MONTH_PLAN_SCHEMA, type BlockType, type MonthPlan } from "./v2-output-schema.ts";

// ============================================================
// TypeScript types
// ============================================================

/**
 * One day's structural skeleton — which block types exist, plus the
 * primary intent for each present-but-structural block. No movement-
 * level data; that's filled by the per-week call later.
 */
export interface DaySkeleton {
  /** 1-based day index within the week (1..days_per_week). */
  day_num: number;
  /**
   * One-line summary of the day's intent — primary stimulus + secondary
   * work. The fill call reads this when deciding movement selection.
   * E.g., "heavy back squat + posterior accessory + medium mixed-modal metcon".
   */
  day_intent: string;
  /** Which of the 8 block types exist on this day, in the order they'll be programmed. */
  block_types: BlockType[];
  /** If a strength block is present: the primary lift's display name. */
  primary_lift?: string;
  /**
   * If a strength block is present: the scheme to use. Free-form description
   * the fill call will translate into concrete sets/reps/weight.
   * E.g., "5x5 @75%", "Build to 90% single", "Snatch complex: 5x (Hang Power Snatch + Snatch)".
   */
  strength_scheme?: string;
  /**
   * If a metcon block is present: the conditioning focus.
   * E.g., "short power couplet (5-8 min)", "long aerobic chipper (20-25 min)",
   * "competition simulation (15 min ascending C&J ladder)".
   */
  metcon_focus?: string;
  /**
   * If a skills block is present: the skill or family being trained.
   * E.g., "Deficit HSPU progression", "Ring MU technique", "Skill maintenance EMOM".
   */
  skill_focus?: string;
}

/**
 * One week of the skeleton — 4 weeks × days_per_week days.
 */
export interface WeekSkeleton {
  /** 1..4 — month is always 4 weeks. */
  week_num: number;
  /**
   * Brief intent label: "build", "build", "build", "deload" or whatever
   * the athlete needs. Matches the order in month_plan.weekly_intent.
   */
  weekly_intent: string;
  /** One entry per training day. Length = athlete's days_per_week. */
  days: DaySkeleton[];
}

/**
 * Top-level v3 skeleton output — what the skeleton writer emits.
 * The per-week fill calls will read this and produce v2-shaped WriterOutput
 * per week.
 */
export interface SkeletonOutput {
  month_plan: MonthPlan;
  weeks: WeekSkeleton[];
}

// ============================================================
// Anthropic tool-use schema
// ============================================================

function buildDaySkeletonSchema(daysPerWeek: number) {
  return {
    type: "object",
    properties: {
      day_num: { type: "integer", minimum: 1, maximum: daysPerWeek },
      day_intent: { type: "string", minLength: 5, maxLength: 400 },
      block_types: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "string", enum: BLOCK_TYPES },
      },
      primary_lift: { type: "string", maxLength: 80 },
      strength_scheme: { type: "string", maxLength: 300 },
      metcon_focus: { type: "string", maxLength: 300 },
      skill_focus: { type: "string", maxLength: 300 },
    },
    required: ["day_num", "day_intent", "block_types"],
    additionalProperties: false,
  };
}

function buildWeekSkeletonSchema(daysPerWeek: number) {
  return {
    type: "object",
    properties: {
      week_num: { type: "integer", minimum: 1, maximum: 4 },
      weekly_intent: { type: "string", minLength: 1, maxLength: 80 },
      days: {
        type: "array",
        minItems: daysPerWeek,
        maxItems: daysPerWeek,
        items: buildDaySkeletonSchema(daysPerWeek),
      },
    },
    required: ["week_num", "weekly_intent", "days"],
    additionalProperties: false,
  };
}

/**
 * Build the tool definition for the v3 skeleton writer call. Pair with
 * `tool_choice: { type: "tool", name: "emit_skeleton" }` to force this
 * shape. The days array is locked per-call to the athlete's days_per_week.
 */
export function buildEmitSkeletonTool(daysPerWeek: number) {
  return {
    name: "emit_skeleton",
    description:
      "Emit the structural skeleton for this athlete's 4-week training cycle. The skeleton declares the 4-week month plan plus, for each training day, which block types exist + the primary lift / metcon focus / skill focus when applicable. Do NOT emit movement-level data (sets, reps, weight) — those are filled by subsequent per-week calls. Keep the skeleton tight and structural; this is the decision layer that constrains the per-week fills.",
    input_schema: {
      type: "object",
      properties: {
        month_plan: MONTH_PLAN_SCHEMA,
        weeks: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: buildWeekSkeletonSchema(daysPerWeek),
        },
      },
      required: ["month_plan", "weeks"],
      additionalProperties: false,
    },
  };
}
