/**
 * Engine self-sequencer — the AI output contract + deterministic envelope validator.
 *
 * The day-types are a GENERATIVE GRAMMAR, not a fixed 720-day list: each
 * day_type's block_N_params is an envelope, and the AI generates a concrete day
 * by choosing values inside it. That is the reason to use AI — picking from the
 * static catalog is deterministic and needs none. A generated day has the exact
 * same block_params shape as a catalog day, so the Engine runner executes it
 * unchanged; we persist it as an engine_workout row and schedule it.
 *
 * This module defines what the AI returns (generated blocks per day) and
 * validateProposal(), which checks every generated value against the day_type's
 * authored envelope BEFORE anything is persisted — so the AI can generate freely
 * but never outside the taxonomy or a day-type's parameters.
 *
 * See docs/engine_self_sequencing_plan.md and engine-catalogue.ts.
 */

import type { EngineDayTypeRow } from "./engine-catalogue.ts";

// ─── The contract the AI must return ─────────────────────────────────────────

/** A generated block: same shape as block_N_params, concrete values within envelope. */
export type GeneratedBlock = Record<string, unknown>;

export interface ProposedDay {
  /** Must be a real engine_day_types.id. */
  day_type: string;
  /** Short, athlete-facing justification for explainability. */
  reason: string;
  /** One generated block per the day_type's block_count, same keys as block_N_params. */
  blocks: GeneratedBlock[];
}

export interface SequenceProposal {
  summary: string;
  days: ProposedDay[];
}

export interface SequenceContext {
  /** Phase the athlete has unlocked (1-12); gates which day-types are legal. */
  currentPhase: number;
  maxDays?: number;
}

export interface ValidationResult {
  ok: boolean;
  accepted: ProposedDay[];
  errors: string[];
}

// ─── Envelope checks ─────────────────────────────────────────────────────────

/** Pace-type keys hold a [lo,hi] pair that must sit inside the envelope's [min,max]. */
const PACE_KEYS = new Set(["paceRange", "basePace", "fluxPaceRange"]);
/** Keys whose generated value is a scalar that must sit inside the envelope's range / equal a fixed value. */
const SCALAR_KEYS = new Set([
  "rounds", "workDuration", "baseDuration", "fluxDuration", "burstDuration",
  "paceIncrement", "fluxIncrement", "workDurationIncrement", "fluxStartIntensity",
]);
/** Progression / mode keys: the generated value must equal the authored one (can't change the mode). */
const MODE_KEYS = new Set([
  "workProgression", "paceProgression", "restProgression", "fluxProgression",
  "burstTiming", "burstIntensity",
]);

function isNumPair(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number";
}

/** Validate one generated block against its authored envelope. Returns error strings. */
export function validateBlock(
  gen: GeneratedBlock,
  envelope: Record<string, unknown>,
  label: string,
): string[] {
  const errs: string[] = [];

  for (const [key, env] of Object.entries(envelope)) {
    // restDurationOptions / workDurationOptions → generated base key must be one of the options
    if (key.endsWith("Options")) {
      const baseKey = key.slice(0, -"Options".length);
      const g = gen[baseKey];
      if (!(Array.isArray(env) && env.includes(g as never))) {
        errs.push(`${label}: ${baseKey}=${JSON.stringify(g)} must be one of ${JSON.stringify(env)}`);
      }
      continue;
    }

    const g = gen[key];

    // Fixed string envelope (e.g. "max_effort", "equal_to_work", "inherit_from_part_a", a mode)
    if (typeof env === "string") {
      if (g !== env) errs.push(`${label}: ${key}=${JSON.stringify(g)} must equal "${env}"`);
      continue;
    }

    // Fixed numeric envelope
    if (typeof env === "number") {
      if (g !== env) errs.push(`${label}: ${key}=${JSON.stringify(g)} must equal ${env}`);
      continue;
    }

    // Pace pair: generated [lo,hi] must sit inside envelope [min,max]
    if (PACE_KEYS.has(key) && isNumPair(env)) {
      if (!(isNumPair(g) && g[0] >= env[0] && g[1] <= env[1] && g[0] <= g[1])) {
        errs.push(`${label}: ${key}=${JSON.stringify(g)} must be a [lo,hi] within [${env[0]}, ${env[1]}]`);
      }
      continue;
    }

    // Scalar within range. Skip reversed [start,end] envelopes (progression endpoints,
    // e.g. restDuration [75,15]) — those are validated best-effort, not hard-failed.
    if (SCALAR_KEYS.has(key) && isNumPair(env)) {
      const [a, b] = env[0] <= env[1] ? [env[0], env[1]] : [env[1], env[0]];
      if (env[0] <= env[1] && !(typeof g === "number" && g >= a && g <= b)) {
        errs.push(`${label}: ${key}=${JSON.stringify(g)} must be within [${a}, ${b}]`);
      }
      continue;
    }

    if (MODE_KEYS.has(key)) {
      if (g !== env) errs.push(`${label}: ${key}=${JSON.stringify(g)} must equal ${JSON.stringify(env)}`);
      continue;
    }
    // Other envelope keys (objects like fluxIntensityByDuration, reversed ranges) → best-effort, not failed.
  }

  return errs;
}

/** Loose lower-bound on a block's total seconds (work only; ignores keyword rest). */
function blockWorkSeconds(gen: GeneratedBlock): number {
  const rounds = typeof gen.rounds === "number" ? gen.rounds : 1;
  const work = typeof gen.workDuration === "number" ? gen.workDuration : 0;
  return rounds * work;
}

// ─── Parse + validate the whole proposal ─────────────────────────────────────

/** Tolerant parse of the AI's raw text/JSON into a SequenceProposal, or null. */
export function parseProposal(raw: string): SequenceProposal | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.days)) return null;
  const days: ProposedDay[] = [];
  for (const d of o.days) {
    if (d && typeof d === "object") {
      const dd = d as Record<string, unknown>;
      if (typeof dd.day_type === "string") {
        days.push({
          day_type: dd.day_type,
          reason: typeof dd.reason === "string" ? dd.reason : "",
          blocks: Array.isArray(dd.blocks) ? (dd.blocks as GeneratedBlock[]) : [],
        });
      }
    }
  }
  return { summary: typeof o.summary === "string" ? o.summary : "", days };
}

/**
 * Validate a proposal against the catalogue + guardrails. Per day, rejects:
 *  - unknown day_type / phase-locked day_type / missing reason
 *  - wrong number of blocks for the day_type
 *  - any generated block value outside its authored envelope
 *  - total work exceeding the day_type's max_duration_minutes
 * Returns the accepted subset (in order) + per-rejection errors. ok=true only
 * when at least one day is accepted and nothing was rejected.
 */
export function validateProposal(
  proposal: SequenceProposal,
  catalogue: EngineDayTypeRow[],
  ctx: SequenceContext,
): ValidationResult {
  const byId = new Map(catalogue.map((d) => [d.id, d]));
  const accepted: ProposedDay[] = [];
  const errors: string[] = [];
  const maxDays = ctx.maxDays ?? Infinity;

  for (const day of proposal.days) {
    if (accepted.length >= maxDays) {
      errors.push(`"${day.day_type}": dropped — exceeds maxDays (${ctx.maxDays}).`);
      continue;
    }
    const dt = byId.get(day.day_type);
    if (!dt) {
      errors.push(`"${day.day_type}": unknown day_type — not in catalogue.`);
      continue;
    }
    if (dt.phase_requirement > ctx.currentPhase) {
      errors.push(`"${day.day_type}": locked — needs phase ${dt.phase_requirement}, athlete at ${ctx.currentPhase}.`);
      continue;
    }
    if (!day.reason?.trim()) {
      errors.push(`"${day.day_type}": missing reason.`);
      continue;
    }
    if (day.blocks.length !== dt.block_count) {
      errors.push(`"${day.day_type}": ${day.blocks.length} blocks, expected ${dt.block_count}.`);
      continue;
    }

    const envelopes = [dt.block_1_params, dt.block_2_params, dt.block_3_params, dt.block_4_params];
    const blockErrs: string[] = [];
    let totalWork = 0;
    for (let i = 0; i < dt.block_count; i++) {
      const env = envelopes[i];
      if (!env) continue;
      blockErrs.push(...validateBlock(day.blocks[i], env, `"${day.day_type}" block ${i + 1}`));
      totalWork += blockWorkSeconds(day.blocks[i]);
    }
    if (dt.max_duration_minutes != null && totalWork > dt.max_duration_minutes * 60) {
      blockErrs.push(`"${day.day_type}": work ${Math.round(totalWork / 60)}min exceeds cap ${dt.max_duration_minutes}min.`);
    }

    if (blockErrs.length) {
      errors.push(...blockErrs);
      continue;
    }
    accepted.push(day);
  }

  return { ok: accepted.length > 0 && errors.length === 0, accepted, errors };
}
