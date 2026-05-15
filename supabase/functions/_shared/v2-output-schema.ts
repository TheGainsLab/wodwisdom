/**
 * v2-output-schema.ts
 *
 * The structured output contract for the v2 generate-program writer LLM.
 * Lives in two forms:
 *
 *   1. TypeScript types — what our edge-fn code sees after parsing the
 *      Claude response. Mirrors `workout_log_entries` field semantics so
 *      logging can reuse the same shape on the other side of the loop.
 *
 *   2. Anthropic tool-use schema — the JSON Schema we hand to the
 *      Claude API via the `tools` parameter. Enforces structure at
 *      decode time (block_type enum, required fields, type constraints).
 *      Invalid output is rejected before our code sees it.
 *
 * Locked rules encoded here:
 *   - 8 canonical block_type values (no `other`, no archetype field).
 *   - Movement strings free at the schema level (display_name match
 *     enforced by audit rule #7 against the per-call vocabulary list).
 *   - At least one of {sets, reps, weight, time_seconds, distance}
 *     required per movement (audit rule #4 will reject empty entries).
 *   - 4 weeks × N days exact (audit rule #5).
 */

// ============================================================
// TypeScript types
// ============================================================

export type BlockType =
  | "warm-up"
  | "mobility"
  | "skills"
  | "strength"
  | "accessory"
  | "metcon"
  | "active-recovery"
  | "cool-down";

export const BLOCK_TYPES: BlockType[] = [
  "warm-up",
  "mobility",
  "skills",
  "strength",
  "accessory",
  "metcon",
  "active-recovery",
  "cool-down",
];

/**
 * Single prescribed movement. Field names mirror `workout_log_entries`
 * so the logging side can read the same shape back. Every field except
 * `movement` is optional, but at least one of {sets, reps, weight,
 * time_seconds, distance} must be populated (audit rule #4).
 */
export interface MovementPrescription {
  /** Must match a string in the per-call vocabulary list. */
  movement: string;
  sets?: number;
  reps?: number;
  weight?: number;
  weight_unit?: "lbs" | "kg";
  rpe?: number;
  /** Duration prescription (e.g., "row 5 min" → 300). */
  time_seconds?: number;
  distance?: number;
  distance_unit?: "ft" | "m";
  /** Optional cue for scaling (e.g., "if HSPU unavailable, sub pike push-ups"). */
  scaling_note?: string;
}

/**
 * A block within a day. block_scheme + time_cap let the writer
 * describe metcon shape ("21-15-9 for time", "AMRAP 12") without
 * mangling per-movement reps.
 */
export interface BlockPrescription {
  block_type: BlockType;
  /** Optional human label ("Primary Strength", "Conditioning"). */
  block_label?: string;
  /**
   * Optional scheme description — primarily for metcons + strength
   * complexes ("21-15-9 for time", "AMRAP 12", "5x5 @75%", "EMOM 10",
   * "Every 90s × 8"). Plain text; the writer phrases it naturally.
   */
  block_scheme?: string;
  /** Optional time cap in seconds (metcon-style). */
  time_cap_seconds?: number;
  /** Optional block-level notes for the athlete. */
  block_notes?: string;
  movements: MovementPrescription[];
}

export interface DayPrescription {
  /** 1-based day index within the week (1..days_per_week). */
  day_num: number;
  blocks: BlockPrescription[];
}

export interface WeekPrescription {
  /** 1..4 — month is always 4 weeks. */
  week_num: number;
  days: DayPrescription[];
}

/**
 * The plan-first scaffold the writer emits BEFORE the daily program.
 * Locked design rule: the writer should outline the 4-week arc up
 * front so the daily blocks have a coherent macro shape.
 */
export interface MonthPlan {
  /** Per-week intent — e.g., ["build", "build", "build", "deload"]. Length 4. */
  weekly_intent: string[];
  /** Brief prose describing the progression scheme on foundational lifts. */
  strength_progression: string;
  /** Where deload lands and why (could be week 4, week 1, or other). */
  deload_placement: string;
  /**
   * Optional brief notes on programming priorities — e.g., "athlete
   * has snatch_technical_gap; weekly snatch progression in Skills
   * blocks", "DL/BS ratio low — posterior chain accessory bias".
   */
  programming_priorities?: string;
}

/** Top-level structured program — what the writer emits. */
export interface WriterOutput {
  month_plan: MonthPlan;
  weeks: WeekPrescription[];
}

// ============================================================
// Anthropic tool-use schema (JSON Schema dialect)
// ============================================================

/**
 * Build the per-movement schema with weight_unit and distance_unit
 * locked to the athlete's measurement system. There's no intake field
 * for distance preference, so we infer from units: lbs → ft, kg → m.
 * Without this the writer can mix systems mid-program.
 */
function buildMovementSchema(units: "lbs" | "kg") {
  const distanceUnit = units === "lbs" ? "ft" : "m";
  return {
    type: "object",
    properties: {
      movement: { type: "string", description: "Display name from the vocabulary list provided in the user message." },
      sets: { type: "integer", minimum: 1, maximum: 30 },
      reps: { type: "integer", minimum: 1, maximum: 500 },
      weight: { type: "number", minimum: 0 },
      weight_unit: { type: "string", enum: [units] },
      rpe: { type: "integer", minimum: 1, maximum: 10 },
      time_seconds: { type: "integer", minimum: 1, maximum: 7200 },
      distance: { type: "number", minimum: 0 },
      distance_unit: { type: "string", enum: [distanceUnit] },
      scaling_note: { type: "string", maxLength: 500 },
    },
    required: ["movement"],
    additionalProperties: false,
  };
}

/**
 * Cap a block's time_cap_seconds at 60% of the athlete's session length.
 * Prevents a single block (typically the metcon) from blowing the whole
 * session. When session_length_minutes is null we fall back to the static
 * 7200s ceiling.
 */
function blockTimeCapMax(sessionLengthMinutes: number | null): number {
  if (sessionLengthMinutes == null || sessionLengthMinutes <= 0) return 7200;
  const cap = Math.round(sessionLengthMinutes * 60 * 0.6);
  // Keep above the schema minimum (60s) so we never produce an empty interval.
  return Math.max(60, cap);
}

function buildBlockSchema(units: "lbs" | "kg", sessionLengthMinutes: number | null) {
  return {
    type: "object",
    properties: {
      block_type: { type: "string", enum: BLOCK_TYPES },
      block_label: { type: "string", maxLength: 100 },
      block_scheme: { type: "string", maxLength: 200 },
      time_cap_seconds: { type: "integer", minimum: 60, maximum: blockTimeCapMax(sessionLengthMinutes) },
      block_notes: { type: "string", maxLength: 500 },
      movements: {
        type: "array",
        minItems: 1,
        items: buildMovementSchema(units),
      },
    },
    required: ["block_type", "movements"],
    additionalProperties: false,
  };
}

/**
 * Build the per-day schema with day_num.maximum locked to the
 * athlete's chosen days_per_week. Without this parameterization the
 * schema lets the writer emit day_num up to 7, and the day_count
 * audit (which requires 1..daysPerWeek) rejects the mismatch.
 */
function buildDaySchema(daysPerWeek: number, units: "lbs" | "kg", sessionLengthMinutes: number | null) {
  return {
    type: "object",
    properties: {
      day_num: { type: "integer", minimum: 1, maximum: daysPerWeek },
      blocks: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: buildBlockSchema(units, sessionLengthMinutes),
      },
    },
    required: ["day_num", "blocks"],
    additionalProperties: false,
  };
}

/**
 * Build the per-week schema with `days` array bounds locked to the
 * athlete's chosen days_per_week. Without this parameterization the
 * schema lets the writer emit 3–6 days regardless of intake, and the
 * day_count audit rejects the mismatch.
 */
function buildWeekSchema(daysPerWeek: number, units: "lbs" | "kg", sessionLengthMinutes: number | null) {
  return {
    type: "object",
    properties: {
      week_num: { type: "integer", minimum: 1, maximum: 4 },
      days: {
        type: "array",
        minItems: daysPerWeek,
        maxItems: daysPerWeek,
        items: buildDaySchema(daysPerWeek, units, sessionLengthMinutes),
      },
    },
    required: ["week_num", "days"],
    additionalProperties: false,
  };
}

const MONTH_PLAN_SCHEMA = {
  type: "object",
  properties: {
    weekly_intent: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { type: "string", maxLength: 100 },
      description: "Per-week intent labels for weeks 1-4 (e.g. 'build', 'build', 'build', 'deload').",
    },
    strength_progression: {
      type: "string",
      maxLength: 600,
      description: "Brief description of how foundational lifts progress across the 4 weeks.",
    },
    deload_placement: {
      type: "string",
      maxLength: 400,
      description: "Where the deload lands in the cycle and why.",
    },
    programming_priorities: {
      type: "string",
      maxLength: 800,
      description: "Optional notes on the athlete's biggest closable gaps and how the program addresses them.",
    },
  },
  required: ["weekly_intent", "strength_progression", "deload_placement"],
  additionalProperties: false,
};

/**
 * Build the tool definition we pass to Anthropic via the `tools`
 * parameter on `messages.create`. Pair with `tool_choice: { type:
 * "tool", name: "emit_program" }` to force the writer to produce this
 * structure. The `days` array bounds are locked per-call to the
 * athlete's days_per_week so the schema and the day_count audit agree.
 */
export function buildEmitProgramTool(daysPerWeek: number, units: "lbs" | "kg", sessionLengthMinutes: number | null) {
  return {
    name: "emit_program",
    description:
      "Emit the structured 4-week training program for this athlete. Begin with the month_plan outline (4-week arc, strength progression, deload placement). Then weeks[] with one entry per week (week_num 1..4), each containing days[] (one entry per training day, day_num 1..N). Each day has blocks[] using the canonical block_type enum. Each block has movements[] using display_name strings from the vocabulary provided in the user message.",
    input_schema: {
      type: "object",
      properties: {
        month_plan: MONTH_PLAN_SCHEMA,
        weeks: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: buildWeekSchema(daysPerWeek, units, sessionLengthMinutes),
        },
      },
      required: ["month_plan", "weeks"],
      additionalProperties: false,
    },
  };
}

// ============================================================
// profile-analysis v2 — structured evaluation output
// ============================================================

/**
 * TypeScript shape of what the v2 profile-analysis writer emits.
 * Mirrors the sections in v2-profile-analysis-prompt.ts.
 */
export interface EvaluationOutput {
  /** Single-sentence summary of the athlete's current state. */
  headline_takeaway: string;
  /** 2–4 specific strengths grounded in the athlete's data. */
  strengths: string[];
  /** 3–5 biggest gaps, ordered biggest-first, each with rationale. */
  weaknesses_and_priorities: string[];
  /** 2–4 paragraphs of synthesizing prose. */
  detailed_analysis: string;
  /** 3–6 specific actionable items, ordered by priority. */
  recommendations: string[];
}

export const EMIT_EVALUATION_TOOL = {
  name: "emit_evaluation",
  description:
    "Emit a coaching evaluation of this athlete's profile. Sections: headline_takeaway (one sentence on current state), strengths (2-4 grounded in the data), weaknesses_and_priorities (3-5 ordered biggest-first with one-line rationale each), detailed_analysis (2-4 paragraphs synthesizing the picture), recommendations (3-6 specific actionable items in priority order). Use the athlete's actual numbers and ratios; coach voice, direct but not blunt.",
  input_schema: {
    type: "object",
    properties: {
      headline_takeaway: {
        type: "string",
        minLength: 20,
        maxLength: 400,
        description: "Single sentence capturing the most important thing about this athlete's current state.",
      },
      strengths: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: { type: "string", minLength: 10, maxLength: 400 },
        description: "Specific strengths grounded in the athlete's data (lifts, skills, conditioning, comp finishes).",
      },
      weaknesses_and_priorities: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: { type: "string", minLength: 10, maxLength: 500 },
        description: "Biggest gaps ordered biggest-first, each with a one-line rationale.",
      },
      detailed_analysis: {
        type: "string",
        minLength: 200,
        maxLength: 4000,
        description: "2-4 paragraphs of prose synthesizing the picture for the athlete.",
      },
      recommendations: {
        type: "array",
        minItems: 3,
        maxItems: 6,
        items: { type: "string", minLength: 10, maxLength: 500 },
        description: "Specific actionable items in priority order, each connecting a weakness to a concrete action.",
      },
    },
    required: [
      "headline_takeaway",
      "strengths",
      "weaknesses_and_priorities",
      "detailed_analysis",
      "recommendations",
    ],
    additionalProperties: false,
  },
};
