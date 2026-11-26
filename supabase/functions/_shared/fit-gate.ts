/**
 * fit-gate.ts — a written week fits the athlete it was written for.
 *
 * The restriction gate (restriction-gate.ts) holds one promise: nothing the
 * athlete's body rules out. This gate holds the others (founder, 2026-11-23):
 *   LOADS      each lift's weight suits the athlete's max and level;
 *   NO MAX     a lift with no max on file is prescribed by effort, no number;
 *   EQUIPMENT  nothing needs equipment the athlete has unticked;
 *   TIME       the session fits their limit, with at most 10% over;
 *   SKILL      nothing above the level they rated;
 *   PACE       with no conditioning benchmarks, pace by effort, no number.
 *
 * Same order of authority as the restriction gate. An AI reads the week
 * against the athlete's file and says what does not fit and how to fix it.
 * Code applies the fix and enforces only the SAFE DIRECTION: a weight can only
 * go down, a session can only get shorter, a movement can only be swapped for
 * one the athlete can do. Code never judges training.
 *
 * Two things code does by arithmetic alone, because they need no judgment:
 * a named barbell lift above its ceiling is lowered to the ceiling, and a
 * named barbell lift with no max loses its number.
 *
 * If the AI cannot be reached the week still ships on time with the
 * arithmetic rules applied; equipment, time and skill are not enforced for
 * that week. Never throws.
 */

import type { MovementPrescription, WriterOutput } from "./v2-output-schema.ts";
import { DELOAD_MODIFIER, LOADING_CEILINGS, SYNTHETIC_LEVEL_ANCHOR } from "./diagnostic-constants.ts";
import { classifyPerLiftLevel, type PerLiftLevel } from "./level-interpreter.ts";
import { DISPLAY_TO_LIFT_KEY, liftKeyOf } from "./lift-key.ts";
import { COUNTS_TOWARD_INSTRUCTION, COUNTS_TOWARD_VALUES } from "./counts-toward.ts";
import { MODELS } from "./model-profiles.ts";
import { applyFindings, type Finding, isRuledOutByName, removeByRule } from "./restriction-gate.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY");

/** A session may run this far over the athlete's limit, no further. */
export const TIME_TOLERANCE = 1.10;
/** Under this many minutes the accessory block may be dropped to fit. */
export const SHORT_SESSION_MINUTES = 45;
/** What an effort prescription says in place of a number. */
export const EFFORT_NOTE = "No max on file for this lift: choose a weight you could do for 2 more reps.";

export interface FitProfile {
  units: "lbs" | "kg";
  /** One-rep maxes by canonical key; null = not on file. */
  lifts: Record<string, number | null>;
  /** Level per lift key (the four classified lifts, and the lifts that take theirs). */
  liftLevels: Record<string, PerLiftLevel | null>;
  /** true = has it, false = unticked. */
  equipment: Record<string, boolean>;
  skills: Record<string, string | null>;
  /** The athlete's time limit per session; null = unknown (time not checked). */
  sessionMinutes: number | null;
  /** week_nums planned as deload. */
  deloadWeeks: number[];
  conditioning: Record<string, string | number | null>;
  /** Every movement name the writer may use. */
  vocabulary: string[];
  /** Names the restriction gate rules out — a replacement may never be one. */
  avoidNames: string[];
}

export interface FitReport {
  actions: string[];
  reviews: number;
  judgeUnavailable: boolean;
}

// ── The athlete's file ─────────────────────────────────────────────────────

export function liftLevelsFor(p: {
  lifts: Record<string, number | null | undefined>;
  bodyweight: number | null | undefined;
  gender: string | null | undefined;
  age: number | null | undefined;
}): Record<string, PerLiftLevel | null> {
  const out: Record<string, PerLiftLevel | null> = {};
  for (const lift of Object.keys(LOADING_CEILINGS)) {
    const w = p.lifts[lift];
    out[lift] = typeof w === "number" && w > 0 ? classifyPerLiftLevel(lift, w, p.bodyweight ?? 0, p.gender, p.age) : null;
  }
  for (const [lift, anchor] of Object.entries(SYNTHETIC_LEVEL_ANCHOR)) out[lift] = out[anchor] ?? null;
  return out;
}

// deno-lint-ignore no-explicit-any
export function fitProfileFromPayload(payload: any, skeleton: any, avoidNames: string[]): FitProfile {
  const lifts = (payload?.lifts ?? {}) as Record<string, number | null>;
  const b = payload?.basics ?? {};
  return {
    units: b.units === "kg" ? "kg" : "lbs",
    lifts,
    liftLevels: liftLevelsFor({ lifts, bodyweight: b.bodyweight, gender: b.gender, age: b.age }),
    equipment: payload?.equipment ?? {},
    skills: payload?.skills ?? {},
    sessionMinutes: typeof payload?.training_context?.session_length_minutes === "number" ? payload.training_context.session_length_minutes : null,
    deloadWeeks: ((skeleton?.weeks ?? []) as Array<{ week_num: number; weekly_intent?: string }>)
      .filter((w) => /deload/i.test(w.weekly_intent ?? "")).map((w) => w.week_num),
    conditioning: payload?.conditioning ?? {},
    vocabulary: payload?.vocabulary ?? [],
    avoidNames,
  };
}

/** The ceiling (fraction of the max) for a lift this week; null = no rule for it. */
export function ceilingFor(liftKey: string, profile: FitProfile, weekNum: number): number | null {
  const table = LOADING_CEILINGS[liftKey] ?? LOADING_CEILINGS[SYNTHETIC_LEVEL_ANCHOR[liftKey] ?? ""];
  if (!table) return null;
  // Level unknown (no bodyweight, or the lift it takes its level from is not
  // on file): the careful end of the table.
  const level = profile.liftLevels[liftKey] ?? "beginner";
  const base = table[level];
  return profile.deloadWeeks.includes(weekNum) ? base * DELOAD_MODIFIER : base;
}

const step = (units: "lbs" | "kg") => (units === "kg" ? 2.5 : 5);
/** Down to the nearest loadable weight, never below one step. */
export function roundDownToPlate(weight: number, units: "lbs" | "kg"): number {
  const s = step(units);
  return Math.max(s, Math.floor(weight / s + 1e-9) * s);
}

function isMaxAttempt(block: { block_scheme?: string; block_notes?: string }): boolean {
  const t = `${block.block_scheme ?? ""} ${block.block_notes ?? ""}`.toLowerCase();
  return t.includes("1rm attempt") || t.includes("1rm_attempt") || t.includes("max attempt") || t.includes("new 1rm");
}

/**
 * What the writer is told BEFORE it writes, so the gate has less to correct:
 * this week's heaviest allowed weight for each lift with a max on file, the
 * lifts with no max (by effort), and pacing when there are no benchmarks.
 */
export function fitRulesForWriter(profile: FitProfile, weekNum: number): string {
  const caps: string[] = []; const noMax: string[] = [];
  for (const [name, key] of Object.entries(DISPLAY_TO_LIFT_KEY)) {
    if (name === "Clean & Jerk" || name === "Strict Press") continue; // second spellings of the same lift
    const max = profile.lifts[key];
    if (typeof max !== "number" || max <= 0) { noMax.push(name); continue; }
    const c = ceilingFor(key, profile, weekNum);
    if (c != null) caps.push(`${name} ${roundDownToPlate(max * c, profile.units)}`);
  }
  const hasBenchmarks = Object.values(profile.conditioning ?? {}).some((v) => v != null && String(v).trim() !== "");
  const lines = ["FIT RULES for this athlete (a check after you enforces every one):"];
  if (caps.length) lines.push(`  - Heaviest working weight this week${profile.deloadWeeks.includes(weekNum) ? " (a DELOAD week)" : ""}, in ${profile.units} — never above: ${caps.join("; ")}. Variations of a lift (hang, pause, tempo, pulls) stay under the same number. A planned 1RM attempt is the only exception.`);
  if (noMax.length) lines.push(`  - NO MAX ON FILE for: ${noMax.join(", ")}. If you program one, give NO weight and NO percentage: set rpe 8 and the note "${EFFORT_NOTE}"`);
  if (!hasBenchmarks) lines.push("  - No conditioning benchmarks on file: do not invent a pace, split or RPM. Prescribe machine and running work by effort.");
  if (profile.sessionMinutes) lines.push(`  - The whole session, warm-up to cool-down with rest and transitions, must fit ${profile.sessionMinutes} minutes (${Math.floor(profile.sessionMinutes * TIME_TOLERANCE)} at the very most).`);
  const lack = Object.entries(profile.equipment).filter(([, v]) => v === false).map(([k]) => k.replace(/_/g, " "));
  if (lack.length) lines.push(`  - They do NOT have: ${lack.join(", ")}. Nothing that needs these, in any block.`);
  return lines.join("\n");
}

// ── Arithmetic rules (no AI) ───────────────────────────────────────────────

type AnyBlock = {
  block_type?: string; block_scheme?: string; block_notes?: string; time_cap_seconds?: number;
  movements?: MovementPrescription[];
  scheme_format?: { format?: string; minutes?: number; rounds?: number; rest_seconds?: number; stations?: number[][] } | null;
};
const at = (l: { week_num: number; day_num: number; block_index: number }) => `W${l.week_num}D${l.day_num} block ${l.block_index}`;

function eachMovement(
  output: WriterOutput,
  fn: (m: MovementPrescription, loc: { week_num: number; day_num: number; block_index: number; movement_index: number }, block: AnyBlock) => void,
): void {
  for (const week of output.weeks ?? []) {
    for (const day of week.days ?? []) {
      (day.blocks ?? []).forEach((b, bi) => {
        ((b as AnyBlock).movements ?? []).forEach((m, mi) =>
          fn(m, { week_num: week.week_num, day_num: day.day_num, block_index: bi, movement_index: mi }, b as AnyBlock));
      });
    }
  }
}

/** Turn a numbered load into an effort prescription. */
function toEffort(m: MovementPrescription): void {
  delete m.weight; delete m.weight_women; delete m.weight_unit; delete m.target_pct_1rm;
  if (m.rpe == null) m.rpe = 8;
  m.scaling_note = EFFORT_NOTE;
}

/**
 * The two rules that need no judgment, for the barbell lifts the system can
 * name exactly. Pure apart from mutating `output`.
 *   - no max on file → effort, no number;
 *   - above the written percentage, or above the ceiling → lowered.
 */
export function applyLoadArithmetic(output: WriterOutput, profile: FitProfile): string[] {
  const actions: string[] = [];
  eachMovement(output, (m, loc, block) => {
    if (m.weight == null || m.weight <= 0) return;
    const key = liftKeyOf(m);
    if (!key) return; // not a lift the system can name: the AI's to judge
    const max = profile.lifts[key];
    if (typeof max !== "number" || max <= 0) {
      const was = m.weight;
      toEffort(m);
      actions.push(`${at(loc)}: "${m.movement}" ${was} ${profile.units} → by effort (no max on file)`);
      return;
    }
    if (isMaxAttempt(block)) return; // a planned max attempt is meant to go heavy
    // An empty bar is the lightest a barbell lift can be: an athlete whose max
    // is barely above it (a 50 lb overhead squat) is not "over the ceiling"
    // for doing technique work with the bar.
    if (m.weight <= (profile.units === "kg" ? 20 : 45)) return;
    let limit = Infinity; let why = "";
    const ceiling = ceilingFor(key, profile, loc.week_num);
    if (ceiling != null) { limit = max * ceiling; why = `${Math.round(ceiling * 100)}% ceiling for a ${profile.liftLevels[key] ?? "beginner"} lifter${profile.deloadWeeks.includes(loc.week_num) ? " in a deload week" : ""}`; }
    // A weight well above the percentage written beside it: the percentage is the plan.
    if (typeof m.target_pct_1rm === "number" && m.target_pct_1rm > 0 && m.target_pct_1rm <= 100) {
      const planned = max * (m.target_pct_1rm / 100);
      if (m.weight > planned + step(profile.units) && planned < limit) { limit = planned; why = `the ${m.target_pct_1rm}% written beside it`; }
    }
    if (m.weight > limit + 1e-6) {
      const was = m.weight;
      m.weight = roundDownToPlate(limit, profile.units);
      m.target_pct_1rm = Math.round((m.weight / max) * 100);
      actions.push(`${at(loc)}: "${m.movement}" ${was} → ${m.weight} ${profile.units} (${why}; max ${max})`);
    }
  });
  return actions;
}

// ── The judge ──────────────────────────────────────────────────────────────

export interface LoadFix {
  week_num: number; day_num: number; block_index: number; movement_index: number; movement: string;
  reason: string;
  /** A lower weight in the athlete's units, OR by_effort to drop the number. */
  new_weight?: number;
  by_effort?: boolean;
  /** Pace by effort: replaces the movement's note. */
  effort_note?: string;
}
export interface TimeTrim {
  week_num: number; day_num: number; block_index: number;
  op: "drop_block" | "drop_movement" | "set_sets" | "set_minutes" | "set_rounds" | "set_rest";
  movement_index?: number;
  value?: number;
  reason: string;
}
export interface FitVerdict {
  /** Equipment and skill conflicts, each with a replacement (same shape the restriction gate applies). */
  swaps: Array<Finding & { kind?: "equipment" | "skill" }>;
  loads: LoadFix[];
  /** The judge's estimate per day, and what to trim when it is over the limit. */
  days: Array<{ week_num: number; day_num: number; estimated_minutes: number }>;
  trims: TimeTrim[];
}
export type FitJudge = (output: WriterOutput, profile: FitProfile, opts: { checkTime: boolean }) => Promise<FitVerdict | null>;

const SYSTEM = `You check AI-written training against ONE athlete's file. You are not asked whether it is good programming, only whether it FITS this athlete on five points. Report every miss with its fix.

1. LOADS. For each weighted barbell or loaded movement, decide which of the athlete's one-rep maxes it should be judged against (a Hang Power Clean against the power clean or clean; a Thruster against the front squat or push press; a Romanian Deadlift against the deadlift). The weight must not exceed that max times the ceiling for the athlete's level on that lift (table given), and must be consistent with any percentage written beside it. If it is too heavy, give a lower weight in the athlete's units. Lifts already judged by name are marked "checked": leave those alone.
2. NO MAX. If the lift it should be judged against has no max on file, or the number on file is plainly not a real max, the movement must be prescribed by effort with no number: set by_effort.
3. EQUIPMENT. The athlete's equipment list says what they have (true) and what they have unticked (false). A movement that needs something unticked must be replaced with one they can do that keeps the block's purpose, chosen from the replacement names.
4. SKILL. The athlete rated each skill (none, beginner, intermediate, advanced). A skill movement above their rated level, or one rated "none", must be replaced with an easier version or progression of it from the replacement names. A skill they did not rate is not a miss.
5. PACE. If the athlete has no conditioning benchmarks on file, a machine or running piece must not carry a specific pace or split it could not know: give an effort_note that prescribes by effort instead (for example "Hard but repeatable: you could say a few words"). Leave distances, calories and times as written.

TIME (only when asked). Estimate each day's real length in minutes: warm-up, every block including rest between sets and rounds, transitions of about two minutes between blocks, cool-down. If a day is over the athlete's limit by more than the stated allowance, give trims that bring it inside: fewer sets, fewer rounds, fewer minutes, shorter rest, or a movement dropped. When the athlete's limit is under 45 minutes the accessory block may be dropped whole; otherwise never drop a block. Trims may only make a day shorter. Protect the day's main strength lift and its metcon; trim accessory, skills volume and rest first.

Locations use the JSON's own week_num and day_num; block_index and movement_index count from 0 in the order given; movement is the name exactly as written. Report nothing that fits. The five points above are the ONLY reasons to report anything: a movement being absent from the replacement names is never one of them.`;

const TOOL = {
  name: "report_fit_check",
  description: "Report every way the written training fails to fit this athlete, with its fix.",
  input_schema: {
    type: "object",
    properties: {
      swaps: {
        type: "array",
        description: "Equipment and skill misses, each with a replacement from the replacement names.",
        items: {
          type: "object",
          properties: {
            week_num: { type: "integer" }, day_num: { type: "integer" },
            block_index: { type: "integer", minimum: 0 }, movement_index: { type: "integer", minimum: 0 },
            movement: { type: "string" }, reason: { type: "string", maxLength: 240 },
            kind: { type: "string", enum: ["equipment", "skill"], description: "equipment = needs something they have unticked; skill = above their rated level." },
            replacement: {
              type: "object",
              properties: {
                movement: { type: "string" }, sets: { type: "integer", minimum: 1 }, reps: { type: "integer", minimum: 1 },
                time_seconds: { type: "integer", minimum: 1 }, distance: { type: "number", minimum: 1 },
                distance_unit: { type: "string", enum: ["ft", "m"] }, calories: { type: "integer", minimum: 1 },
                scaling_note: { type: "string", maxLength: 200 },
                counts_toward: { type: "string", enum: [...COUNTS_TOWARD_VALUES], description: "For the REPLACEMENT movement. " + COUNTS_TOWARD_INSTRUCTION },
              },
              required: ["movement"], additionalProperties: false,
            },
          },
          required: ["week_num", "day_num", "block_index", "movement_index", "movement", "reason", "kind", "replacement"],
          additionalProperties: false,
        },
      },
      loads: {
        type: "array",
        items: {
          type: "object",
          properties: {
            week_num: { type: "integer" }, day_num: { type: "integer" },
            block_index: { type: "integer", minimum: 0 }, movement_index: { type: "integer", minimum: 0 },
            movement: { type: "string" }, reason: { type: "string", maxLength: 240 },
            new_weight: { type: "number", minimum: 0 }, by_effort: { type: "boolean" },
            effort_note: { type: "string", maxLength: 200 },
          },
          required: ["week_num", "day_num", "block_index", "movement_index", "movement", "reason"],
          additionalProperties: false,
        },
      },
      days: {
        type: "array",
        items: {
          type: "object",
          properties: { week_num: { type: "integer" }, day_num: { type: "integer" }, estimated_minutes: { type: "number", minimum: 0 } },
          required: ["week_num", "day_num", "estimated_minutes"], additionalProperties: false,
        },
      },
      trims: {
        type: "array",
        items: {
          type: "object",
          properties: {
            week_num: { type: "integer" }, day_num: { type: "integer" }, block_index: { type: "integer", minimum: 0 },
            op: { type: "string", enum: ["drop_block", "drop_movement", "set_sets", "set_minutes", "set_rounds", "set_rest"] },
            movement_index: { type: "integer", minimum: 0 }, value: { type: "number", minimum: 0 },
            reason: { type: "string", maxLength: 240 },
          },
          required: ["week_num", "day_num", "block_index", "op", "reason"], additionalProperties: false,
        },
      },
    },
    required: ["swaps", "loads", "days", "trims"],
    additionalProperties: false,
  },
};

/** The week as the judge reads it; named lifts already settled by arithmetic are marked. */
export function compactForFit(output: WriterOutput): unknown {
  return {
    weeks: (output.weeks ?? []).map((w) => ({
      week_num: w.week_num,
      days: (w.days ?? []).map((d) => ({
        day_num: d.day_num,
        blocks: (d.blocks ?? []).map((b, bi) => {
          const blk = b as AnyBlock & { block_label?: string };
          return {
            block_index: bi, block_type: blk.block_type,
            ...(blk.block_scheme ? { scheme: blk.block_scheme } : {}),
            ...(blk.scheme_format ? { format: blk.scheme_format } : {}),
            ...(blk.time_cap_seconds ? { time_cap_seconds: blk.time_cap_seconds } : {}),
            ...(blk.block_notes ? { notes: String(blk.block_notes).slice(0, 200) } : {}),
            movements: (blk.movements ?? []).map((m, mi) => ({
              movement_index: mi, movement: m.movement,
              ...(liftKeyOf(m) ? { load: "checked" } : {}),
              ...(m.sets != null ? { sets: m.sets } : {}), ...(m.reps != null ? { reps: m.reps } : {}),
              ...(m.rep_scheme ? { rep_scheme: m.rep_scheme } : {}),
              ...(m.weight != null ? { weight: m.weight, unit: m.weight_unit } : {}),
              ...(m.target_pct_1rm != null ? { pct_of_max: m.target_pct_1rm } : {}),
              ...(m.rpe != null ? { rpe: m.rpe } : {}),
              ...(m.time_seconds != null ? { time_seconds: m.time_seconds } : {}),
              ...(m.distance != null ? { distance: m.distance, distance_unit: m.distance_unit } : {}),
              ...(m.calories != null ? { calories: m.calories } : {}),
              ...(m.scaling_note ? { note: m.scaling_note } : {}),
            })),
          };
        }),
      })),
    })),
  };
}

export function fitJudgeMessage(output: WriterOutput, profile: FitProfile, opts: { checkTime: boolean }): string {
  const have = Object.entries(profile.equipment).filter(([, v]) => v !== false).map(([k]) => k.replace(/_/g, " "));
  const lack = Object.entries(profile.equipment).filter(([, v]) => v === false).map(([k]) => k.replace(/_/g, " "));
  const allowed = (profile.vocabulary ?? []).filter((v) => !isRuledOutByName(v, profile.avoidNames));
  const benchmarks = Object.entries(profile.conditioning ?? {}).filter(([, v]) => v != null && String(v).trim() !== "");
  const ceilings = Object.entries(LOADING_CEILINGS).map(([lift, t]) =>
    `${lift.replace(/_/g, " ")}: beginner ${Math.round(t.beginner * 100)}%, intermediate ${Math.round(t.intermediate * 100)}%, advanced ${Math.round(t.advanced * 100)}%`).join("; ");
  const lines = [
    `ATHLETE'S FILE`,
    `Units: ${profile.units}.`,
    `One-rep maxes (${profile.units}; null = none on file): ${JSON.stringify(profile.lifts)}`,
    `Level per lift (worked out from the lift against bodyweight; null = unknown, treat as beginner): ${JSON.stringify(profile.liftLevels)}`,
    `Load ceilings, as a share of the max, by level: ${ceilings}. Front squat, overhead squat and the Olympic lifts take the back squat's row at the athlete's level; jerk, push press and push jerk take the press's row. In a deload week the ceiling is ${Math.round(DELOAD_MODIFIER * 100)}% of the row.`,
    `Deload weeks: ${profile.deloadWeeks.length ? profile.deloadWeeks.join(", ") : "none"}.`,
    `Equipment they HAVE: ${have.join(", ") || "(none listed)"}.`,
    `Equipment they have UNTICKED (do not use): ${lack.join(", ") || "none"}.`,
    `Skills as they rated them (null = not rated): ${JSON.stringify(profile.skills)}`,
    benchmarks.length
      ? `Conditioning benchmarks on file: ${JSON.stringify(Object.fromEntries(benchmarks))}`
      : `Conditioning benchmarks on file: NONE — pace by effort (point 5).`,
    opts.checkTime && profile.sessionMinutes
      ? `TIME: the athlete's limit is ${profile.sessionMinutes} minutes a session. A day may run to ${Math.floor(profile.sessionMinutes * TIME_TOLERANCE)} minutes, no further.${profile.sessionMinutes < SHORT_SESSION_MINUTES ? " Their limit is under 45 minutes, so an accessory block may be dropped whole." : " Never drop a whole block."} Give days and trims.`
      : `TIME: not checked on this request. Return days and trims as empty lists.`,
    ``,
    // The list is for REPLACEMENTS only (2026-11-26): the judge once swapped
    // "Good Morning" out because it "is not in the allowed movements list".
    // It is a set of names to replace with, never a rule about what was written.
    `REPLACEMENT NAMES (when you replace a movement, choose the replacement from these): ${allowed.join(", ")}`,
    `This list is ONLY for choosing a replacement. A movement in the written training that is not on it is NOT a miss: never report, replace or remove a movement because it is missing from this list.`,
    ``,
    `WRITTEN TRAINING (JSON):`,
    JSON.stringify(compactForFit(output)),
    ``,
    `Check it against the file and report through the tool.`,
  ];
  return lines.join("\n");
}

const isLoc = (x: unknown): boolean => {
  const f = x as { week_num?: unknown; day_num?: unknown; block_index?: unknown };
  return !!x && typeof x === "object" && Number.isInteger(f.week_num) && Number.isInteger(f.day_num) && Number.isInteger(f.block_index);
};

export const askFitJudge: FitJudge = async (output, profile, opts) => {
  if (!ANTHROPIC_API_KEY) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODELS.sonnet, max_tokens: 8192, stream: false, system: SYSTEM,
          tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name },
          messages: [{ role: "user", content: fitJudgeMessage(output, profile, opts) }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) { console.error(`[fit-gate] judge HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`); continue; }
      const data = await resp.json();
      const tool = (data.content ?? []).find((b: { type?: string; name?: string }) => b.type === "tool_use" && b.name === TOOL.name);
      const v = tool?.input as Partial<FitVerdict> | undefined;
      if (!v || !Array.isArray(v.swaps) || !Array.isArray(v.loads) || !Array.isArray(v.days) || !Array.isArray(v.trims)) {
        console.error("[fit-gate] judge answer unreadable:", JSON.stringify(data).slice(0, 300));
        continue;
      }
      return {
        swaps: v.swaps.filter((s) => isLoc(s) && Number.isInteger((s as Finding).movement_index) && typeof (s as Finding).movement === "string"),
        loads: v.loads.filter((s) => isLoc(s) && Number.isInteger((s as LoadFix).movement_index) && typeof (s as LoadFix).movement === "string"),
        days: v.days.filter((d) => !!d && Number.isInteger(d.week_num) && Number.isInteger(d.day_num) && typeof d.estimated_minutes === "number"),
        trims: v.trims.filter((t) => isLoc(t) && typeof (t as TimeTrim).op === "string"),
      };
    } catch (e) {
      console.error("[fit-gate] judge call failed:", e instanceof Error ? e.message : String(e));
    }
  }
  return null;
};

// ── Applying the verdict: only ever the safe direction ─────────────────────

function blockAt(output: WriterOutput, l: { week_num: number; day_num: number; block_index: number }): AnyBlock | null {
  const day = (output.weeks ?? []).find((w) => w.week_num === l.week_num)?.days?.find((d) => d.day_num === l.day_num);
  return ((day?.blocks ?? [])[l.block_index] as AnyBlock | undefined) ?? null;
}
const sameName = (a: string | undefined, b: string | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** Lower a weight, drop a number, or reword a pace. Never raises anything. Pure apart from mutating `output`. */
export function applyLoadFixes(output: WriterOutput, fixes: LoadFix[], profile: FitProfile): string[] {
  const actions: string[] = [];
  for (const f of fixes) {
    const row = blockAt(output, f)?.movements?.[f.movement_index];
    if (!row || !sameName(row.movement, f.movement)) continue;
    if (f.by_effort) {
      if (row.weight == null) continue;
      const was = row.weight;
      toEffort(row);
      actions.push(`${at(f)}: "${row.movement}" ${was} ${profile.units} → by effort — ${f.reason}`);
      continue;
    }
    if (typeof f.new_weight === "number" && f.new_weight > 0 && typeof row.weight === "number" && f.new_weight < row.weight) {
      const was = row.weight;
      row.weight = roundDownToPlate(f.new_weight, profile.units);
      if (row.weight >= was) { row.weight = was; continue; } // rounding must not undo the lowering
      delete row.target_pct_1rm; // the written percentage belonged to the old weight
      actions.push(`${at(f)}: "${row.movement}" ${was} → ${row.weight} ${profile.units} — ${f.reason}`);
      continue;
    }
    if (typeof f.effort_note === "string" && f.effort_note.trim() && row.weight == null) {
      row.scaling_note = f.effort_note.trim().slice(0, 200);
      actions.push(`${at(f)}: "${row.movement}" paced by effort — ${f.reason}`);
    }
  }
  return actions;
}

/** Shorten a day. Every trim is checked to be a reduction; anything else is ignored. */
export function applyTimeTrims(output: WriterOutput, trims: TimeTrim[], profile: FitProfile): string[] {
  const actions: string[] = [];
  // Whole-block and movement drops last-to-first so earlier indexes stay valid.
  const ordered = [...trims].sort((a, b) =>
    (b.week_num - a.week_num) || (b.day_num - a.day_num) || (b.block_index - a.block_index) || ((b.movement_index ?? -1) - (a.movement_index ?? -1)));
  for (const t of ordered) {
    const day = (output.weeks ?? []).find((w) => w.week_num === t.week_num)?.days?.find((d) => d.day_num === t.day_num);
    const block = (day?.blocks ?? [])[t.block_index] as AnyBlock | undefined;
    if (!day || !block) continue;
    const where = `${at(t)} (${block.block_type})`;
    if (t.op === "drop_block") {
      const short = profile.sessionMinutes != null && profile.sessionMinutes < SHORT_SESSION_MINUTES;
      if (!short || block.block_type !== "accessory") continue; // the only block that may be dropped, and only for short sessions
      day.blocks.splice(t.block_index, 1);
      actions.push(`${where}: accessory block dropped to fit ${profile.sessionMinutes} minutes — ${t.reason}`);
      continue;
    }
    if (t.op === "drop_movement") {
      const ms = block.movements ?? [];
      if (t.movement_index == null || !ms[t.movement_index] || ms.length <= 1) continue;
      if (block.block_type === "strength" && t.movement_index === 0) continue; // the day's main lift stays
      if (block.scheme_format?.stations) continue; // an EMOM's stations are its structure
      const [gone] = ms.splice(t.movement_index, 1);
      actions.push(`${where}: "${gone.movement}" dropped to fit the time — ${t.reason}`);
      continue;
    }
    const v = t.value;
    if (typeof v !== "number" || !(v > 0)) continue;
    if (t.op === "set_sets") {
      const row = t.movement_index != null ? block.movements?.[t.movement_index] : undefined;
      if (!row || typeof row.sets !== "number" || !(Math.round(v) < row.sets) || Math.round(v) < 1) continue;
      const was = row.sets; row.sets = Math.round(v);
      if (Array.isArray(row.rep_scheme) && row.rep_scheme.length === was) row.rep_scheme = row.rep_scheme.slice(0, row.sets);
      actions.push(`${where}: "${row.movement}" ${was} → ${row.sets} sets — ${t.reason}`);
    } else if (t.op === "set_minutes") {
      const sf = block.scheme_format;
      if (!sf || typeof sf.minutes !== "number" || !(v < sf.minutes)) continue;
      const slots = sf.stations?.length ?? 1;
      const next = Math.max(slots, Math.floor(v / slots) * slots);
      if (!(next < sf.minutes)) continue;
      const was = sf.minutes; sf.minutes = next;
      if (typeof block.time_cap_seconds === "number") block.time_cap_seconds = Math.min(block.time_cap_seconds, next * 60);
      actions.push(`${where}: ${was} → ${next} minutes — ${t.reason}`);
    } else if (t.op === "set_rounds") {
      const sf = block.scheme_format;
      if (!sf || typeof sf.rounds !== "number" || !(Math.round(v) < sf.rounds) || Math.round(v) < 1) continue;
      const was = sf.rounds; sf.rounds = Math.round(v);
      actions.push(`${where}: ${was} → ${sf.rounds} rounds — ${t.reason}`);
    } else if (t.op === "set_rest") {
      const sf = block.scheme_format;
      if (!sf || typeof sf.rest_seconds !== "number" || !(v < sf.rest_seconds) || v < 30) continue;
      const was = sf.rest_seconds; sf.rest_seconds = Math.round(v);
      actions.push(`${where}: rest ${was}s → ${sf.rest_seconds}s — ${t.reason}`);
    }
  }
  return actions;
}

// ── The gate ───────────────────────────────────────────────────────────────

/**
 * Run the fit gate over a written output, mutating it in place. Always
 * returns; never throws. `checkTime` is false for a single-block change (one
 * block cannot be judged against a whole session's limit).
 */
export async function runFitGate(
  output: WriterOutput,
  profile: FitProfile,
  opts: { judge?: FitJudge; checkTime?: boolean; maxReviews?: number } = {},
): Promise<FitReport> {
  const report: FitReport = { actions: [], reviews: 0, judgeUnavailable: false };
  const judge = opts.judge ?? askFitJudge;
  const checkTime = opts.checkTime !== false && profile.sessionMinutes != null && profile.sessionMinutes > 0;
  const maxReviews = Math.max(1, opts.maxReviews ?? 2);

  // Arithmetic first: it needs no AI and settles the named lifts.
  try { report.actions.push(...applyLoadArithmetic(output, profile)); }
  catch (e) { console.error("[fit-gate] load arithmetic failed:", e instanceof Error ? e.message : String(e)); }

  try {
    for (let round = 1; round <= maxReviews; round++) {
      const verdict = await judge(output, profile, { checkTime });
      if (verdict == null) { report.judgeUnavailable = true; break; }
      report.reviews++;
      const before = report.actions.length;

      // Equipment and skill swaps: a replacement must be a real movement the
      // restriction gate does not rule out.
      const restr = { injuriesText: null, doNotProgram: profile.avoidNames, suggestedSubs: [], vocabulary: profile.vocabulary };
      const { applied, unresolved } = applyFindings(output, verdict.swaps, restr);
      report.actions.push(...applied);
      // Unticked equipment with no usable replacement cannot be done at all: remove it.
      // (A skill with no usable easier version is left as written.)
      const noKit = unresolved.filter((f) => (f as { kind?: string }).kind === "equipment");

      report.actions.push(...applyLoadFixes(output, verdict.loads, profile));
      if (checkTime) {
        const limit = profile.sessionMinutes! * TIME_TOLERANCE;
        const over = new Set(verdict.days.filter((d) => d.estimated_minutes > limit).map((d) => `${d.week_num}-${d.day_num}`));
        report.actions.push(...applyTimeTrims(output, verdict.trims.filter((t) => over.has(`${t.week_num}-${t.day_num}`)), profile));
      }
      // The judge offered nothing usable for it, on the last reading or with
      // nothing else left to change: take it out.
      if (noKit.length > 0 && (round === maxReviews || report.actions.length === before)) {
        report.actions.push(...removeByRule(output, noKit));
      }
      if (report.actions.length === before) break; // nothing changed: it fits, or nothing more can safely be done
    }
  } catch (e) {
    report.judgeUnavailable = true;
    console.error("[fit-gate] judge path failed:", e instanceof Error ? e.message : String(e));
  }

  // The judge's own lowering may have been applied to a named lift: settle it again.
  try { report.actions.push(...applyLoadArithmetic(output, profile)); }
  catch (e) { console.error("[fit-gate] load arithmetic failed:", e instanceof Error ? e.message : String(e)); }
  return report;
}

/** The gate for ONE block (a change the coach proposes): loads, equipment and skill; never time. */
export async function fitBlock<B extends { movements?: MovementPrescription[] }>(
  block: B,
  profile: FitProfile,
  opts: { judge?: FitJudge; deloadWeek?: boolean } = {},
): Promise<{ block: B | null; actions: string[]; judgeUnavailable: boolean }> {
  const copy = JSON.parse(JSON.stringify(block)) as B;
  // deno-lint-ignore no-explicit-any
  const wrapped = { weeks: [{ week_num: 1, days: [{ day_num: 1, blocks: [copy] }] }] } as any as WriterOutput;
  const rep = await runFitGate(wrapped, { ...profile, deloadWeeks: opts.deloadWeek ? [1] : [] }, { judge: opts.judge, checkTime: false });
  const left = wrapped.weeks?.[0]?.days?.[0]?.blocks ?? [];
  return {
    block: left.length > 0 ? (left[0] as unknown as B) : null,
    actions: rep.actions.map((a) => a.replace(/^W1D1 block 0(?: \([a-z-]+\))?: /, "")),
    judgeUnavailable: rep.judgeUnavailable,
  };
}
