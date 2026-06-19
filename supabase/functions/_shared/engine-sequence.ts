/**
 * Engine self-sequencer — the AI output contract + deterministic validator.
 *
 * The sequencer feeds the AI the conditioning diagnosis + day-type catalogue
 * and asks it to propose the upcoming Engine sequence. The AI returns a
 * SequenceProposal; this module validates it against the catalogue and the
 * guardrails BEFORE anything is written to training_schedule, so the AI can
 * never push the athlete outside the authored taxonomy or a locked phase.
 *
 * v1 scope = Lever B (which day-types, in what order). Lever C (tuning params
 * within a day-type's block_N_params envelope) is a deliberate follow-up;
 * proposals may carry param overrides but they are not yet trusted/applied.
 *
 * See docs/engine_self_sequencing_plan.md and engine-catalogue.ts.
 */

import type { EngineDayTypeRow } from "./engine-catalogue.ts";

// ─── The contract the AI must return ─────────────────────────────────────────

export interface ProposedDay {
  /** Must be a real engine_day_types.id. */
  day_type: string;
  /** Short, athlete-facing justification for explainability. */
  reason: string;
}

export interface SequenceProposal {
  /** One-line overall rationale (e.g. "LT lagging — added threshold exposures"). */
  summary: string;
  /** The proposed upcoming sequence, in order. */
  days: ProposedDay[];
}

export interface SequenceContext {
  /** Current phase the athlete has unlocked (1-12). Gates which day-types are legal. */
  currentPhase: number;
  /** Optional cap on how many days a single proposal may schedule. */
  maxDays?: number;
}

export interface ValidationResult {
  ok: boolean;
  /** Days that passed every guardrail, in order — safe to schedule. */
  accepted: ProposedDay[];
  /** Per-rejection reasons (day_type + why), for logging/explainability. */
  errors: string[];
}

// ─── Parse + validate ────────────────────────────────────────────────────────

/** Tolerant parse of the AI's raw text/JSON into a SequenceProposal, or null. */
export function parseProposal(raw: string): SequenceProposal | null {
  let text = raw.trim();
  // strip ```json fences if present
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
        days.push({ day_type: dd.day_type, reason: typeof dd.reason === "string" ? dd.reason : "" });
      }
    }
  }
  return { summary: typeof o.summary === "string" ? o.summary : "", days };
}

/**
 * Validate a proposal against the catalogue + guardrails. Rejects, day by day:
 *  - unknown day_type (not in the catalogue)
 *  - day_type whose phase_requirement exceeds the athlete's current phase (locked)
 *  - missing reason
 * Returns the accepted subset (in order) plus per-rejection errors. A proposal
 * is ok=true only if at least one day survives and none were rejected.
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
      errors.push(
        `"${day.day_type}": locked — requires phase ${dt.phase_requirement}, athlete at phase ${ctx.currentPhase}.`,
      );
      continue;
    }
    if (!day.reason || !day.reason.trim()) {
      errors.push(`"${day.day_type}": missing reason.`);
      continue;
    }
    accepted.push(day);
  }

  return { ok: accepted.length > 0 && errors.length === 0, accepted, errors };
}
