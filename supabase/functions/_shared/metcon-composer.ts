/**
 * metcon-composer.ts — the call that writes the metcons.
 *
 * REBUILT 2026-11-27 (founder's decisions, after the metcons had drifted to
 * long, many-movement pieces). What the composer is given, and nothing else:
 *
 *   - each slot: week and day, its TIME DOMAIN (the planner's one decision),
 *     the week's role, and the rest of that day (main lift, skill focus,
 *     accessory focus) so the metcon does not fight it
 *   - the athlete's own profile as they entered it: goal in their words,
 *     lifts, skills, conditioning numbers, equipment, what they said about
 *     injuries, the avoid list, notes to the coach, age / sex / bodyweight /
 *     units, and their Engine training when they have it
 *   - 100 real main site metcons drawn at random, as examples of what a
 *     well-written workout looks like (metcon-library.ts)
 *   - three CrossFit Journal articles (metcon-library.ts)
 *   - the metcons already written this month, and last month's
 *   - the movement list, as a guide to spelling
 *
 * What it is NO LONGER given: the coach state's conditioning paragraph, the
 * ranked priorities, the maintain / set-aside lists, the recovery stance, a
 * pace word, a focus label, or minutes from the planner. Those were steering
 * the metcons ("longer sustained efforts") and are gone.
 *
 * Output: one workout per slot. metcon-variety-audits.ts counts the few
 * things code counts (one send-back). The writer transcribes the pieces.
 */

import { timeDomainForMinutes } from "./conditioning-definitions.ts";
import { MODELS } from "./model-profiles.ts";
import {
  METCON_COMPOSER_ENGINE_ADDENDUM,
  METCON_COMPOSER_SYSTEM_PROMPT,
  TWO_DAY_COMPOSER_ADDENDUM,
} from "./metcon-composer-prompt.ts";
import type { EngineTrainingPayload } from "./build-writer-payload.ts";
import { restrictionsForPrompt } from "./athlete-file-text.ts";

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

/** One metcon slot. From the planner: the time domain and the week's role.
 *  The rest is that day's other work, so the metcon does not fight it. */
export interface MetconSlot {
  week_num: number;
  day_num: number;
  time_domain: MetconTimeDomain;
  /** The week's role, from the planner's weekly_intent ("build", "deload"). */
  week_role: string;
  day_context: {
    primary_lift?: string;
    strength_scheme?: string;
    skill_focus?: string;
    /** Focus areas the day's accessory block carries (e.g. ["midline"]). */
    accessory_focuses?: string[];
  };
}

export const METCON_MACHINES = ["row", "bike", "ski", "run", "swim"] as const;
export type MetconMachine = typeof METCON_MACHINES[number];

export interface ComposedMetconMovement {
  /** The movement's name only. */
  movement: string;
  /** Reps ("15"), calories ("12 cal"), distance ("400m"). */
  prescription: string;
  /** BARBELL movements: the class from the shared cycling-load table, with
   *  load_band. The writer works out the weight from the athlete's 1RM.
   *  Also "dumbbell" / "kettlebell" / "medicine_ball" to name the implement. */
  load_class?: string | null;
  /** Barbell only. */
  load_band?: "light" | "moderate" | "heavy" | null;
  /** DUMBBELL and KETTLEBELL: the weight the composer chose for this athlete,
   *  per implement, in the athlete's units. The writer uses it as given. */
  weight?: number | null;
  /** Set by the composer when the movement is done on a machine, or is a run
   *  or swim. The one-machine count reads THIS, never the movement's name. */
  machine?: MetconMachine | null;
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

/** Everything the composer is given: the complete list, one object. */
export interface MetconComposerInputs {
  slots: MetconSlot[];
  /** The athlete's goal, in their own words. Null when they gave none. */
  goal_text: string | null;
  basics: { age: number | null; sex: string | null; bodyweight: number | null };
  /** The unit the lifts and bodyweight are in. */
  units?: "lbs" | "kg";
  /** 1RMs by lift; null when not entered. */
  lifts: Record<string, number | null>;
  /** The athlete's own rating of each skill; null when not rated. */
  skills: Record<string, string | null>;
  /** Mile, 5k, row and bike numbers; null when not entered. */
  conditioning_benchmarks: Record<string, string | number | null>;
  equipment: Record<string, boolean>;
  /** What the athlete wrote under injuries, as written. */
  injuries_text: string | null;
  /** The avoid list. */
  do_not_program: string[];
  /** What the athlete said elsewhere that can carry a physical limit
   *  (athleteWordsElsewhere), in their words. */
  athlete_words?: string[];
  /** The athlete's notes for their coach, in their words. */
  coach_notes?: string[];
  /** Last month's metcons, one line each. */
  previous_cycle_metcons: string[];
  /** The metcons already written this month, one line each. */
  already_composed_this_month?: string[];
  /** The movement list: spellings to use. Guidance, not a fence. */
  vocabulary: string[];
  /** 100 real main site metcons (metcon-library.ts). "" = none loaded. */
  examples: string;
  /** The reference articles (metcon-library.ts). "" = none loaded. */
  articles: string;
  /** The athlete's completed Engine sessions, or null for everyone without
   *  Engine. Non-null adds the Engine section and the Engine add-on. */
  engine_training: EngineTrainingPayload | null;
}

// ============================================================
// Slot derivation — skeleton → composer slots (shared by the pipeline stage
// and the shadow harness so they can never drift).
// ============================================================

interface SkeletonLikeDay {
  day_num: number;
  block_types?: string[];
  metcon_time_domain?: MetconTimeDomain;
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

/** The time domain in an old metcon_focus line. Months planned before
 *  2026-11-27 have no typed field: their line reads "medium · build,
 *  sustained · aerobic_capacity" or, older still, "long aerobic chipper
 *  (18-22 min)". Gym classes write minutes here too. */
export function parseSlotTimeDomain(focus: string): MetconTimeDomain {
  const f = focus.toLowerCase();
  const m = focus.match(/\((\d+)(?:\s*[-–—]\s*(\d+))?\s*min/i);
  if (m) {
    const upper = parseInt(m[2] ?? m[1], 10);
    return timeDomainForMinutes(upper);
  }
  if (/\bshort\b/.test(f)) return "short";
  if (/\blong\b/.test(f)) return "long";
  return "medium";
}

const isDomain = (v: unknown): v is MetconTimeDomain => v === "short" || v === "medium" || v === "long";

/** A metcon day's time domain: the planner's typed field; for a month planned
 *  before the field existed, read from its text line. Null when the day says
 *  neither. THE one reader: every check and screen goes through it. */
export function metconTimeDomainOfDay(
  day: { metcon_time_domain?: unknown; metcon_focus?: string | null } | null | undefined,
): MetconTimeDomain | null {
  if (!day) return null;
  if (isDomain(day.metcon_time_domain)) return day.metcon_time_domain;
  const focus = (day.metcon_focus ?? "").trim();
  return focus ? parseSlotTimeDomain(focus) : null;
}

/** Run on every plan as it arrives from the planner. Sets the typed field on
 *  each metcon day that has one to read, and writes the text line from it when
 *  the planner left the line out (individual programs do), so the screens and
 *  checks that read the line keep working. Changes nothing the planner
 *  decided. Mutates and returns the plan. */
export function normalizeMetconTimeDomains<T extends SkeletonLike>(skeleton: T): T {
  for (const wk of skeleton?.weeks ?? []) {
    for (const day of wk.days ?? []) {
      if (!(day.block_types ?? []).includes("metcon")) continue;
      const td = metconTimeDomainOfDay(day);
      if (!td) continue;
      day.metcon_time_domain = td;
      if (!(day.metcon_focus ?? "").trim()) day.metcon_focus = td;
    }
  }
  return skeleton;
}

/** The week's role, from the planner's weekly_intent. */
export function weekRoleOf(weeklyIntent: string | null | undefined): string {
  return (weeklyIntent ?? "").trim() || "build";
}

/** The month's metcon slots from the plan: one per day that has a metcon
 *  block. What the planner tells the composer is the time domain and the
 *  week's role, plus the rest of that day so the metcon does not fight it. */
export function deriveMetconSlots(skeleton: SkeletonLike): MetconSlot[] {
  const slots: MetconSlot[] = [];
  for (const wk of skeleton.weeks ?? []) {
    for (const day of wk.days ?? []) {
      if (!(day.block_types ?? []).includes("metcon")) continue;
      const accessory = (day.block_intents ?? [])
        .filter((b) => b.block_type === "accessory")
        .map((b) => b.focus);
      slots.push({
        week_num: wk.week_num,
        day_num: day.day_num,
        time_domain: metconTimeDomainOfDay(day) ?? "medium",
        week_role: weekRoleOf(wk.weekly_intent),
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
    "Emit exactly one composed metcon per slot, each inside its slot's time domain, " +
    "following the rules in the system prompt.",
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
            stated_duration_minutes: { type: "integer", minimum: 1, maximum: 22 },
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
                      "The implement. A barbell movement: its class from the shared cycling-load table, with load_band. A dumbbell or kettlebell movement: \"dumbbell\" or \"kettlebell\", with weight. A medicine ball movement: \"medicine_ball\" (its weight is fixed). Omit for bodyweight, gymnastics, and machine work.",
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
                      "BARBELL movements only, alongside load_class: the band from the shared table. The writer works out the exact weight from the athlete's 1RM.",
                    enum: ["light", "moderate", "heavy"],
                  },
                  weight: {
                    type: "number",
                    description:
                      "DUMBBELL and KETTLEBELL movements only, in the athlete's units. Dumbbell: one of the fixed weights in the shared table, per dumbbell. Kettlebell: the weight you chose for this athlete from their lifts.",
                  },
                  machine: {
                    type: "string",
                    description:
                      "Set on every movement done on a machine, and on a run or a swim. Omit on every other movement.",
                    enum: [...METCON_MACHINES],
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

/** One composed piece on one line, as the composer is shown the month so far
 *  and last month: where it sat, its header, and its movements as written. */
export function describeComposedPiece(m: ComposedMetcon): string {
  const moves = (m.movements ?? [])
    .map((x) => `${(x.prescription ?? "").trim()} ${(x.movement ?? "").trim()}`.trim())
    .filter(Boolean)
    .join(", ");
  return `W${m.week_num}D${m.day_num} · ${(m.block_scheme ?? "").trim() || m.format} (${m.stated_duration_minutes} min): ${moves}`;
}

export function buildComposerUserMessage(inputs: MetconComposerInputs): string {
  const unit = inputs.units === "kg" ? "kg" : "lbs";
  const parts: string[] = [];
  // Reference material first, then the athlete, then the work to do.
  if (inputs.articles.trim()) parts.push(inputs.articles.trim());
  if (inputs.examples.trim()) parts.push(inputs.examples.trim());

  parts.push(
    `THE ATHLETE'S GOAL, in their own words: ${
      (inputs.goal_text ?? "").trim() ? `"${(inputs.goal_text ?? "").trim()}"` : "(none given)"
    }`,
  );
  parts.push(
    `THE ATHLETE: age ${inputs.basics.age ?? "not given"} · sex ${inputs.basics.sex ?? "not given"} · ` +
      `bodyweight ${inputs.basics.bodyweight != null ? `${inputs.basics.bodyweight} ${unit}` : "not given"} · units ${unit}`,
  );
  const restrictions = restrictionsForPrompt(inputs.injuries_text, inputs.do_not_program, inputs.athlete_words ?? []);
  parts.push(restrictions || "INJURIES AND AVOID LIST: the athlete has stated none.");
  if ((inputs.coach_notes ?? []).length > 0) {
    parts.push(
      `THE ATHLETE'S NOTES FOR THEIR COACH (what they asked for, in their words; honour them inside each slot's time domain, never over an injury):\n` +
        (inputs.coach_notes ?? []).map((n) => `  - "${n}"`).join("\n"),
    );
  }
  parts.push(`1RM LIFTS (${unit}; null = not entered). Give every weight in ${unit}:\n${JSON.stringify(inputs.lifts)}`);
  parts.push(`SKILL RATINGS (the athlete's own rating of each skill; null = not rated):\n${JSON.stringify(inputs.skills)}`);
  parts.push(`CONDITIONING NUMBERS (null = not entered):\n${JSON.stringify(inputs.conditioning_benchmarks)}`);
  parts.push(`EQUIPMENT (true = they have it):\n${JSON.stringify(inputs.equipment)}`);
  if (inputs.engine_training) {
    const et = inputs.engine_training;
    const z = (m: Record<string, number>) =>
      `base ${m.base} · tempo ${m.tempo} · aerobic power ${m.aerobic_power} · anaerobic ${m.anaerobic}`;
    parts.push(
      [
        `ENGINE WEEK CONTEXT (completed-session evidence from the athlete's separate daily conditioning program — see ENGINE-AWARE COMPOSITION in the system prompt):`,
        `  trailing 28 days: ${et.trailing_28_days.sessions} completed sessions (~${et.trailing_28_days.cadence_per_week}/week, ${et.trailing_28_days.minutes_counted} min counted) — minutes in zone: ${z(et.trailing_28_days.time_in_zone_minutes)}`,
        et.upcoming_4_weeks.sequenced
          ? `  upcoming: the Engine is SEQUENCED — only its current generated block is known (${et.upcoming_4_weeks.projected_sessions} sessions; it fits around this program's week from there) — known minutes in zone: ${z(et.upcoming_4_weeks.time_in_zone_minutes)}`
          : `  upcoming 4 weeks (fixed catalog at observed cadence, ${et.upcoming_4_weeks.projected_sessions} sessions) — planned minutes in zone: ${z(et.upcoming_4_weeks.time_in_zone_minutes)}`,
        `  upcoming day types: ${
          et.upcoming_4_weeks.days.length
            ? et.upcoming_4_weeks.days.map((d) => `${d.day_type} (${d.zones.join("/") || "?"})`).join(", ")
            : "(none resolved)"
        }`,
      ].join("\n"),
    );
  }
  // Guidance, not a fence (founder, 2026-11-26): the composer names movements
  // itself and uses these spellings when a movement is on the list.
  parts.push(`MOVEMENT LIST (the movements we use in metcons, and how each is spelled. Your guide: use these spellings when a movement is on it; you may use a movement that is not):\n${inputs.vocabulary.join(" · ")}`);
  parts.push(
    `LAST MONTH'S METCONS (do not serve any of these again):\n` +
      (inputs.previous_cycle_metcons.length
        ? inputs.previous_cycle_metcons.map((m) => `  - ${m}`).join("\n")
        : "  (none: this is the first month)"),
  );
  parts.push(
    `THIS MONTH SO FAR (already written; the rules for the month count these together with what you write now):\n` +
      ((inputs.already_composed_this_month ?? []).length
        ? (inputs.already_composed_this_month ?? []).map((m) => `  - ${m}`).join("\n")
        : "  (nothing yet)"),
  );
  parts.push(
    `SLOTS TO WRITE NOW (${inputs.slots.length}; exactly one metcon per slot):\n` +
      JSON.stringify(inputs.slots, null, 2),
  );
  return parts.join("\n\n");
}

interface ClaudeResponse {
  content?: Array<{ type?: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

// The stage makes at most TWO calls (the first and one send-back), so calls ×
// timeout stays under the ~400s edge limit (2 × 195s). A timeout here throws
// and the job fails, so the deadline must outlast the biggest month.
const COMPOSER_TIMEOUT_MS = 195_000;

/** One composer call. retryViolations puts a failed count at the top of the
 *  message for the single send-back. */
export async function callMetconComposer(
  inputs: MetconComposerInputs,
  opts: { model?: string; apiKey?: string; retryViolations?: string } = {},
): Promise<MetconComposerOutput> {
  // Pipeline-family key for spend attribution; falls back to the shared key.
  const apiKey = opts.apiKey ?? Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const model = opts.model ?? MODELS.sonnet;

  // Max conditioning slots in any one week — 2 means a two-day athlete.
  const weekCounts = new Map<number, number>();
  for (const sl of inputs.slots) weekCounts.set(sl.week_num, (weekCounts.get(sl.week_num) ?? 0) + 1);
  const slotsPerWeekMax = Math.max(0, ...weekCounts.values());

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
      // Add-ons: Engine only with completed Engine sessions; two-day only
      // on 2-slot weeks.
      system: METCON_COMPOSER_SYSTEM_PROMPT +
        (inputs.engine_training ? METCON_COMPOSER_ENGINE_ADDENDUM : "") +
        (slotsPerWeekMax <= 2 ? TWO_DAY_COMPOSER_ADDENDUM : ""),
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
