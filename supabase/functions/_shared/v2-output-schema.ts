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
  | "cardio"
  | "active-recovery"
  | "cool-down"
  | "other";

/** Generation block types — what generate-program emits (no cardio/other). */
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
 * Ingestion block types — the generation set plus 'cardio' (ingested cardio
 * pieces) and 'other' (the escape hatch for rest days / unclassifiable
 * blocks). preprocess-program classifies into this wider set.
 */
export const INGEST_BLOCK_TYPES: BlockType[] = [
  ...BLOCK_TYPES,
  "cardio",
  "other",
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
  /**
   * % of 1RM the writer reasoned in (e.g. 72.5 for "@70-75%"). Only emit
   * for strength / accessory prescriptions anchored to a 1RM. Skip for
   * bodyweight, skills, and metcon movements.
   */
  target_pct_1rm?: number;
  /**
   * Cardio machine for a monostructural movement (e.g. an erg inside a
   * metcon). Ingestion only — generated programs leave this null.
   */
  cardio_modality?: string;
  /** Calorie count for calorie-based cardio movements ("30 cal row"). Ingestion only. */
  calories?: number;
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
  /**
   * The block's clock window in seconds — a stated time cap OR a fixed
   * duration. Always set for AMRAP ("AMRAP 12" → 720) and EMOM
   * ("EMOM 10" → 600); their duration IS the clock. For for-time / RFT
   * metcons, set only when a cap is stated.
   */
  time_cap_seconds?: number;
  /** Optional block-level notes for the athlete. */
  block_notes?: string;
  /**
   * Cardio machine for a `cardio` block. Ingestion only — null on
   * generated blocks.
   */
  cardio_modality?: string;
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

/**
 * Top-level structured program. Generation emits it with a `month_plan`
 * (the 4-week-arc outline); ingestion (preprocess-program) emits it WITHOUT
 * one — a coach's pasted program carries no structured arc rationale.
 */
export interface WriterOutput {
  month_plan?: MonthPlan;
  weeks: WeekPrescription[];
}

// ============================================================
// Anthropic tool-use schema (JSON Schema dialect)
// ============================================================

/**
 * Build the per-movement schema with weight_unit locked to the
 * athlete's measurement system. distance_unit is intentionally left
 * open (ft or m) — CrossFit convention picks by movement, not by
 * athlete unit preference (rowing is always meters; running is meters
 * or miles; carries/lunges follow the athlete's units). The system
 * prompt enforces the convention.
 */
function buildMovementSchema(units: "lbs" | "kg") {
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
      distance_unit: { type: "string", enum: ["ft", "m"] },
      scaling_note: { type: "string", maxLength: 500 },
      target_pct_1rm: {
        type: "number",
        minimum: 30,
        maximum: 110,
        description: "Optional % of 1RM for 1RM-anchored prescriptions (e.g. 72.5 for '@70-75%'). Strength + lift-variant accessory only.",
      },
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

export const MONTH_PLAN_SCHEMA = {
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
/**
 * Tool definition for the SURGICAL block-rewrite path. Used when an audit
 * trips a block-local violation and we want to rewrite that single block
 * without regenerating the full program. Same BlockPrescription schema as
 * the writer emits, just wrapped in a different tool.
 *
 * Pair with `tool_choice: { type: "tool", name: "emit_block" }` to force
 * the model to produce a single block.
 */
export function buildEmitBlockTool(units: "lbs" | "kg", sessionLengthMinutes: number | null) {
  return {
    name: "emit_block",
    description:
      "Emit ONE corrected block to replace a block that failed an audit. Use the same schema as blocks in the writer's full program output — block_type from the canonical enum, optional block_label / block_scheme / time_cap_seconds / block_notes, and movements[] with display_name strings from the vocabulary.",
    input_schema: buildBlockSchema(units, sessionLengthMinutes),
  };
}

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
// Ingestion tool — preprocess-program parsing an external program
// ============================================================

/**
 * Tool for INGESTING an externally-authored program (preprocess-program).
 *
 * Unlike buildEmitProgramTool (generation — locked to exactly 4 weeks ×
 * N days, month_plan required, 8 block types), an ingested program is
 * whatever the coach wrote: a variable number of weeks, irregular day
 * counts, no month_plan, and block types that include 'cardio' and
 * 'other'. The output still conforms to WriterOutput, so saveProgramV3
 * persists it with no special-casing.
 */
export function buildIngestProgramTool() {
  const movement = {
    type: "object",
    properties: {
      movement: { type: "string", description: "Movement name (canonical/display name)." },
      sets: { type: "integer", minimum: 1, maximum: 50 },
      reps: { type: "integer", minimum: 1, maximum: 1000 },
      weight: { type: "number", minimum: 0 },
      weight_unit: { type: "string", enum: ["lbs", "kg"] },
      rpe: { type: "integer", minimum: 1, maximum: 10 },
      time_seconds: { type: "integer", minimum: 1, maximum: 14400 },
      distance: { type: "number", minimum: 0 },
      distance_unit: { type: "string", enum: ["ft", "m"] },
      calories: { type: "number", minimum: 0, description: "For calorie-based cardio (e.g. '30 cal row')." },
      cardio_modality: { type: "string", description: "Machine for a monostructural movement; from the modality list in the user message." },
      scaling_note: { type: "string", maxLength: 500 },
    },
    required: ["movement"],
    additionalProperties: false,
  };
  const block = {
    type: "object",
    properties: {
      block_type: { type: "string", enum: INGEST_BLOCK_TYPES },
      block_label: { type: "string", maxLength: 100 },
      block_scheme: { type: "string", maxLength: 200 },
      time_cap_seconds: { type: "integer", minimum: 1, maximum: 14400 },
      block_notes: { type: "string", maxLength: 500 },
      cardio_modality: { type: "string", description: "Machine for a 'cardio' block; from the modality list in the user message." },
      movements: { type: "array", items: movement },
    },
    required: ["block_type", "movements"],
    additionalProperties: false,
  };
  const day = {
    type: "object",
    properties: {
      day_num: { type: "integer", minimum: 1, maximum: 7 },
      blocks: { type: "array", minItems: 1, items: block },
    },
    required: ["day_num", "blocks"],
    additionalProperties: false,
  };
  const week = {
    type: "object",
    properties: {
      week_num: { type: "integer", minimum: 1, maximum: 52 },
      days: { type: "array", minItems: 1, items: day },
    },
    required: ["week_num", "days"],
    additionalProperties: false,
  };
  return {
    name: "emit_ingested_program",
    description:
      "Emit the structured program parsed from the athlete's pasted or uploaded text. weeks[] holds one entry per week present in the source (use the week number as written, or 1 when the source is unlabelled); each week's days[] holds one entry per training day. Preserve the program exactly as written — do not invent, add, drop, or reorder days, blocks, or movements.",
    input_schema: {
      type: "object",
      properties: {
        weeks: {
          type: "array",
          minItems: 1,
          items: week,
        },
      },
      required: ["weeks"],
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
