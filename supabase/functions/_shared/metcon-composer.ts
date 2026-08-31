/**
 * metcon-composer.ts
 *
 * The MONTH-SIGHTED metcon composition call (2026-08). Metcon quality was
 * capped by architecture: composition happened inside four per-week fill calls
 * steering by one-sentence relays, so no author ever saw the whole month —
 * variety across the set was unenforceable by construction, and both writer
 * models converged to a safe attractor (row + wall ball, machines-only, cloned
 * weeks). Every good block in the pipeline (strength, skills) already has a
 * month-sighted author; this call extends that principle to conditioning.
 *
 * One call per month. Inputs (the COMPLETE contract — scattered requirements
 * are how payload.rag got silently dropped for three months):
 *   - every metcon slot in the month (time domain + intensity + focus, from
 *     the skeleton — the part the skeleton is actually competent at)
 *   - each slot's day context (primary lift / skill focus / accessory intents)
 *     for interference management
 *   - the letter's conditioning judgment (CoachState.metcon_guidance, v1.7 —
 *     terminates HERE, not at the skeleton)
 *   - athlete data: vocabulary, equipment, do_not_program, skills tier,
 *     1RMs, pacing benchmarks, age/recovery context
 *   - previous cycle's metcons (never re-serve)
 *   - stratified example workouts (metcon-examples.ts — frozen queries)
 *
 * Output: one distinct workout per slot. The deterministic set-level fence is
 * metcon-variety-audits.ts (one retry). The fill DOES NOT compose metcons —
 * it places the composed pieces with exact loads.
 *
 * FROZEN SPEC (2026-08-11 rulings): every piece distinct — no repeated
 * movement-combination, no day-slot template, no test-piece repeats (athletes
 * test on their own; evaluation leans on the bigger data set). Monostructural:
 * 1 fine, 2 max, always reasoned. Named WODs allowed but infrequent. No
 * movement in more than ~1/3 of pieces; ≥3 formats, none over half; barbell
 * floor 2–3 pieces for capable athletes.
 */

import { MODELS } from "./model-profiles.ts";
import { METCON_COMPOSER_SYSTEM_PROMPT } from "./metcon-composer-prompt.ts";

// ============================================================
// Types
// ============================================================

export type MetconTimeDomain = "short" | "medium" | "long";

/** Frozen format taxonomy — the variety audit counts distinct formats against
 *  this set, so the composer must label every piece with exactly one. */
export const METCON_FORMATS = [
  "amrap",
  "rft", // rounds for time
  "for_time", // single pass for time (non-chipper)
  "chipper",
  "emom",
  "intervals", // work/rest structures incl. machine intervals
  "rep_scheme", // descending/ladder schemes (21-15-9, 10-to-1...)
  "named", // a known benchmark programmed by name (infrequent)
] as const;
export type MetconFormat = typeof METCON_FORMATS[number];

/** One conditioning slot from the skeleton — the skeleton's ENTIRE metcon
 *  contribution (time domain + intensity + focus), plus the day's other
 *  blocks as required interference context. */
export interface MetconSlot {
  week_num: number;
  day_num: number;
  time_domain: MetconTimeDomain;
  /** Week/intensity character, e.g. "build — sustained threshold", "deload — easy". */
  intensity: string;
  /** Conditioning focus (adaptation, never a movement menu): aerobic_capacity |
   *  anaerobic_capacity | mixed_modal_conditioning. */
  focus: string;
  /** The skeleton's exact time allocation for this metcon block (block_minutes,
   *  session-budget phase). Null when the athlete never stated a budget. When
   *  present, the piece's stated_duration_minutes must land near it — a large
   *  allocation is a deliberate design decision, not a suggestion. */
  allocated_minutes?: number | null;
  day_context: {
    primary_lift?: string;
    strength_scheme?: string;
    skill_focus?: string;
    /** Focus areas the day's accessory block carries (e.g. ["midline"]). */
    accessory_focuses?: string[];
  };
}

export interface ComposedMetconMovement {
  /** Display name from the athlete's vocabulary. */
  movement: string;
  /** Human prescription for this movement within the piece — reps ("15"),
   *  calories ("12 cal"), distance ("400m"). Exact weights are the fill's job. */
  prescription: string;
  /** TYPED load (athlete-match package): the movement class from the shared
   *  cycling-load table (conditioning-definitions.ts) — REQUIRED on every
   *  loaded movement (barbell / DB / KB / ball); omit for bodyweight,
   *  gymnastics, and monostructural work. The fill computes the exact weight
   *  from the athlete's parent-lift 1RM; the audit checks presence. Adjectives
   *  in prose without these fields are a defect. */
  load_class?: string | null;
  load_band?: "light" | "moderate" | "heavy" | null;
}

export interface ComposedMetcon {
  week_num: number;
  day_num: number;
  format: MetconFormat;
  /** The athlete-readable header: "AMRAP 12", "21-15-9 for time", "5 rounds:
   *  3 min on / 90 sec off", "'DT' — 5 rounds for time". */
  block_scheme: string;
  /** Expected completion / clock minutes — must land in the slot's bucket. */
  stated_duration_minutes: number;
  movements: ComposedMetconMovement[];
  /** One line of pace/intent the athlete reads ("sustained — conversational
   *  through round 3, push the last two"). For a monostructural piece this
   *  MUST state the deliberate reason. */
  stimulus_note: string;
  /** True when the piece is monostructural cardio only (max 2 per month,
   *  always deliberate). */
  monostructural: boolean;
}

export interface MetconComposerOutput {
  metcons: ComposedMetcon[];
}

/** Everything the composer call needs — the complete contract, one object. */
export interface MetconComposerInputs {
  slots: MetconSlot[];
  /** CoachState.metcon_guidance (v1.7). Empty string when unavailable. */
  metcon_guidance: string;
  /** Allowed movement display names (the athlete's full legal vocabulary). */
  vocabulary: string[];
  equipment: Record<string, boolean>;
  do_not_program: string[];
  /** Skill tiers by key (e.g. { muscle_ups: "advanced" }) — null values fine. */
  skills: Record<string, string | null>;
  /** 1RMs by canonical key — null when unknown. */
  lifts: Record<string, number | null>;
  /** Conditioning benchmarks (mile time, 2k row, bike cals...) — null fine. */
  conditioning_benchmarks: Record<string, string | number | null>;
  /** Age / recovery context line, e.g. "masters 52, conservative stance". */
  athlete_context: string;
  /** Last cycle's metcons as one-line summaries — never re-serve these. */
  previous_cycle_metcons: string[];
  /** Stratified example block from metcon-examples.ts. Empty string = none. */
  examples: string;
  /** TYPED coaching decisions (athlete-match package) — the authoritative
   *  channel for axis roles. The prose metcon_guidance informs character and
   *  flavor ONLY; where the two appear to conflict, these fields win.
   *  development_axes = the plan's ranked development focuses (strength +
   *  gymnastics axes; conditioning axes express as time domains, not here). */
  development_axes: string[];
  maintain_axes: string[];
  /** CoachState.loading_deemphasis (typed) — true ONLY when the letter
   *  explicitly de-emphasizes loading under fatigue. Gates the barbell target. */
  loading_deemphasis: boolean;
  /** Skill axes the letter keeps OUT of conditioning under fatigue. */
  fatigue_skill_exclusions: string[];
}

// ============================================================
// Slot derivation — skeleton → composer slots (shared by the pipeline stage
// and the shadow harness so they can never drift).
// ============================================================

interface SkeletonLikeDay {
  day_num: number;
  block_types?: string[];
  metcon_focus?: string;
  primary_lift?: string;
  strength_scheme?: string;
  skill_focus?: string;
  block_intents?: Array<{ block_type: string; focus: string }>;
  block_minutes?: Array<{ block_type: string; minutes: number }>;
}
interface SkeletonLike {
  weeks?: Array<{ week_num: number; weekly_intent?: string; days?: SkeletonLikeDay[] }>;
}

/** Parse the slot's time domain from a metcon_focus line. Handles BOTH the
 *  demoted slot format ("medium · build, sustained · aerobic_capacity") and
 *  legacy prose ("long aerobic chipper (18-22 min)") so old skeletons stay
 *  composable in the harness. */
export function parseSlotTimeDomain(focus: string): MetconTimeDomain {
  const f = focus.toLowerCase();
  const m = focus.match(/\((\d+)(?:\s*[-–—]\s*(\d+))?\s*min/i);
  if (m) {
    const upper = parseInt(m[2] ?? m[1], 10);
    if (upper <= 8) return "short";
    if (upper <= 15) return "medium";
    return "long";
  }
  if (/\bshort\b/.test(f)) return "short";
  if (/\blong\b/.test(f)) return "long";
  return "medium";
}

/** Derive the month's conditioning slots from a skeleton — one slot per day
 *  that declares a metcon block. Days without one (active recovery) are
 *  correctly skipped. */
export function deriveMetconSlots(skeleton: SkeletonLike): MetconSlot[] {
  const slots: MetconSlot[] = [];
  for (const wk of skeleton.weeks ?? []) {
    for (const day of wk.days ?? []) {
      if (!(day.block_types ?? []).includes("metcon")) continue;
      const metconIntent = (day.block_intents ?? []).find((b) => b.block_type === "metcon");
      const accessory = (day.block_intents ?? [])
        .filter((b) => b.block_type === "accessory")
        .map((b) => b.focus);
      const allocated = (day.block_minutes ?? []).find((b) => b.block_type === "metcon")?.minutes ?? null;
      slots.push({
        week_num: wk.week_num,
        day_num: day.day_num,
        time_domain: parseSlotTimeDomain(day.metcon_focus ?? ""),
        intensity: `${wk.weekly_intent ?? ""} · ${day.metcon_focus ?? ""}`.trim(),
        focus: metconIntent?.focus ?? "aerobic_capacity",
        allocated_minutes: allocated,
        day_context: {
          primary_lift: day.primary_lift,
          strength_scheme: day.strength_scheme,
          skill_focus: day.skill_focus,
          accessory_focuses: accessory,
        },
      });
    }
  }
  return slots;
}

// ============================================================
// EMIT tool
// ============================================================

export const EMIT_METCON_MONTH_TOOL = {
  name: "emit_metcon_month",
  description:
    "Emit the complete month of conditioning: exactly one composed metcon per slot, " +
    "every piece a distinct workout, honoring each slot's time domain / intensity / focus " +
    "and the set-level variety rules in the system prompt.",
  input_schema: {
    type: "object",
    properties: {
      metcons: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            week_num: { type: "integer", minimum: 1, maximum: 4 },
            day_num: { type: "integer", minimum: 1, maximum: 7 },
            format: { type: "string", enum: [...METCON_FORMATS] },
            block_scheme: { type: "string", minLength: 4, maxLength: 200 },
            stated_duration_minutes: { type: "integer", minimum: 3, maximum: 40 },
            movements: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: {
                type: "object",
                properties: {
                  movement: { type: "string", minLength: 2, maxLength: 60 },
                  prescription: { type: "string", minLength: 1, maxLength: 80 },
                  load_class: {
                    type: "string",
                    description:
                      "REQUIRED for every loaded movement (barbell/DB/KB/ball): the movement class from the shared cycling-load table. Omit for bodyweight, gymnastics, and machine work.",
                    enum: [
                      "deadlift",
                      "clean",
                      "snatch",
                      "thruster",
                      "shoulder_to_overhead",
                      "back_squat",
                      "dumbbell",
                      "kettlebell",
                      "medicine_ball",
                    ],
                  },
                  load_band: {
                    type: "string",
                    description:
                      "REQUIRED alongside load_class: the band from the shared table. The fill computes the exact weight from the athlete's parent-lift 1RM — an adjective in prose without this field is a defect.",
                    enum: ["light", "moderate", "heavy"],
                  },
                },
                required: ["movement", "prescription"],
                additionalProperties: false,
              },
            },
            stimulus_note: { type: "string", minLength: 10, maxLength: 300 },
            monostructural: { type: "boolean" },
          },
          required: [
            "week_num",
            "day_num",
            "format",
            "block_scheme",
            "stated_duration_minutes",
            "movements",
            "stimulus_note",
            "monostructural",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["metcons"],
    additionalProperties: false,
  },
};

// ============================================================
// User-message assembly + the call
// ============================================================

export function buildComposerUserMessage(inputs: MetconComposerInputs): string {
  const parts: string[] = [];
  parts.push(
    `CONDITIONING SLOTS (${inputs.slots.length} — compose exactly one distinct metcon per slot):\n` +
      JSON.stringify(inputs.slots, null, 2),
  );
  parts.push(
    [
      `TYPED COACHING DECISIONS (AUTHORITATIVE — these govern axis roles, loading, and modality; the guidance paragraph below informs character and flavor only; where they appear to conflict, these fields win):`,
      `  development axes (each must be EXPRESSED under fatigue — see the system prompt): ${inputs.development_axes.length ? inputs.development_axes.join(", ") : "(none)"}`,
      `  maintain axes: ${inputs.maintain_axes.length ? inputs.maintain_axes.join(", ") : "(none)"}`,
      `  loading_deemphasis: ${inputs.loading_deemphasis} ${inputs.loading_deemphasis ? "(the letter explicitly de-emphasizes loading under fatigue — the barbell target relaxes)" : "(normal barbell + skill presence assumed)"}`,
      `  fatigue_skill_exclusions: ${inputs.fatigue_skill_exclusions.length ? inputs.fatigue_skill_exclusions.join(", ") : "(none)"}`,
    ].join("\n"),
  );
  parts.push(
    `COACH'S CONDITIONING GUIDANCE (the letter's judgment — honor its intent):\n` +
      (inputs.metcon_guidance.trim() || "(none provided — compose from the slots and athlete data)"),
  );
  parts.push(`ATHLETE CONTEXT: ${inputs.athlete_context || "(none)"}`);
  parts.push(`EQUIPMENT (true = available):\n${JSON.stringify(inputs.equipment)}`);
  parts.push(`DO NOT PROGRAM (hard bans):\n${JSON.stringify(inputs.do_not_program)}`);
  parts.push(`SKILL TIERS:\n${JSON.stringify(inputs.skills)}`);
  parts.push(`1RM LIFTS (lbs; null = unknown):\n${JSON.stringify(inputs.lifts)}`);
  parts.push(`CONDITIONING BENCHMARKS:\n${JSON.stringify(inputs.conditioning_benchmarks)}`);
  parts.push(
    `PREVIOUS CYCLE'S METCONS (NEVER re-serve any of these):\n` +
      (inputs.previous_cycle_metcons.length
        ? inputs.previous_cycle_metcons.map((m) => `  - ${m}`).join("\n")
        : "  (first cycle — none)"),
  );
  if (inputs.examples.trim()) parts.push(inputs.examples.trim());
  parts.push(`ALLOWED MOVEMENTS (compose ONLY from these display names):\n${inputs.vocabulary.join(" · ")}`);
  return parts.join("\n\n");
}

interface ClaudeResponse {
  content?: Array<{ type?: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

// The composer emits one metcon per slot — a 24-slot (6-day) month can run
// 10k+ tokens, several minutes of Fable generation. The stage makes at most
// TWO calls (initial + one variety retry — the only multiplier), so per the
// house rule keep calls × timeout under the ~400s edge wall-clock
// (2 × 195s = 390s). A timeout here THROWS, and metcons is a writer stage
// (no retry on throw → job fails) — the deadline must outlast the biggest
// legal month, not the average one. Sized 2026-08-12 after 130s proved thin.
const COMPOSER_TIMEOUT_MS = 195_000;

/** One composer call. `model` defaults to the fill's model (Sonnet) pending the
 *  side-by-side; retryViolations prepends a failed variety audit for the single
 *  retry. */
export async function callMetconComposer(
  inputs: MetconComposerInputs,
  opts: { model?: string; apiKey?: string; retryViolations?: string } = {},
): Promise<MetconComposerOutput> {
  const apiKey = opts.apiKey ?? Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const model = opts.model ?? MODELS.sonnet;

  const base = buildComposerUserMessage(inputs);
  const userMessage = opts.retryViolations ? `${opts.retryViolations}\n\n---\n\n${base}` : base;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      // 16k matches the skeleton's budget: a hit cap truncates the tool JSON
      // mid-object and fails the job, so the ceiling must fit a verbose
      // 24-slot month with margin. Unused headroom costs nothing.
      max_tokens: 16000,
      stream: false,
      system: METCON_COMPOSER_SYSTEM_PROMPT,
      tools: [EMIT_METCON_MONTH_TOOL],
      tool_choice: { type: "tool", name: "emit_metcon_month" },
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(COMPOSER_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }
  const data = (await resp.json()) as ClaudeResponse;
  const toolUse = (data.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === "emit_metcon_month",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    throw new Error(`Composer response missing emit_metcon_month tool_use. stop_reason=${data.stop_reason}`);
  }
  console.log(
    `[metcon-composer] ${model} usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens}`,
  );
  return toolUse.input as MetconComposerOutput;
}
