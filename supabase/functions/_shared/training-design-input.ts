/**
 * training-design-input.ts
 *
 * Step 3 — the CONTRACT between the judgment layer (CoachState) and the
 * execution layer (Training Design = skeleton + week-fill).
 *
 * GOVERNING PRINCIPLE: Training Design may ALLOCATE coaching intent but may
 * NEVER reinterpret it. This contract is how that's enforced STRUCTURALLY:
 * Training Design never receives the CoachState object or the Athlete Model
 * facts — only this purpose-built projection. It therefore CANNOT re-rank
 * priorities or re-derive a ratio, because the data needed to do so isn't in
 * front of it.
 *
 * It is a STABLE PUBLIC API. CoachState's internals can grow (confidence,
 * assumptions, unknowns, projections) or be rewritten entirely without touching
 * Training Design, as long as this contract holds. `buildTrainingDesignInput`
 * is the ONLY place downstream that reads CoachState internals.
 *
 * Deliberately ABSENT (so nothing can be reinterpreted): the competition
 * bundle, normatives, competition_movements, ranked_by_position, and
 * CoachState's reasons / evidence / athlete_facing_rationale / summary /
 * headline (narrative an LLM could re-litigate). Only allocation inputs remain.
 */

import type {
  CoachState,
  DecisionConfidence,
  FocusArea,
  RecoveryStance,
  StrengthEmphasis,
} from "./coach-state.ts";
import type { PreviousCycleSummary } from "./build-writer-payload.ts";

/** Execution constraints Training Design needs to ALLOCATE / EXECUTE — none of
 *  these are decision-data (no facts it could use to re-rank intent). */
export interface TrainingDesignExecutionInputs {
  days_per_week: number;
  session_length_minutes: number | null;
  equipment: Record<string, boolean>;
  /** The HARD ban — injuries + equipment-blocked movements, merged. */
  do_not_program: string[];
  /** Allowed-movement set for the week-fill. */
  vocabulary: string[];
  /** 1RMs — threaded for the week-fill's load math (% × 1RM). */
  lifts: Record<string, number | null>;
  previous_cycle: PreviousCycleSummary | null;
}

export interface TrainingDesignInput {
  // ── Intent (projected from CoachState — allocation-relevant only) ──
  /** Develop, ranked (rank 1 = highest). Dose by rank; confidence may modulate. */
  priorities: Array<{ focus: FocusArea; rank: number; confidence: DecisionConfidence }>;
  /** Minimum effective dose — keep alive, don't develop. */
  maintain: FocusArea[];
  /** No dedicated dose; incidental exposure OK (NOT a hard ban — that's do_not_program). */
  deprioritize: FocusArea[];
  recovery_stance: RecoveryStance;
  strength_emphasis: StrengthEmphasis;

  // ── Execution constraints ──
  days_per_week: number;
  session_length_minutes: number | null;
  equipment: Record<string, boolean>;
  do_not_program: string[];
  vocabulary: string[];
  lifts: Record<string, number | null>;
  previous_cycle: PreviousCycleSummary | null;
  /** GROUP-CLASS ONLY (crossfit_class pack): the owner's weekly focus split —
   *  how many days carry a strength vs a skills focus block. Optional +
   *  additive: no retail path sets it, and packs other than crossfit_class
   *  ignore it. */
  class_focus_split?: { strength_days: number; skills_days: number } | null;

  // ── Provenance pins (what this design was built on) ──
  coach_state_version: number;
  athlete_model_version: number;
}

/**
 * The ONE projection from the judgment layer into the execution contract. Pure.
 * Sorts priorities by rank and strips everything that isn't an allocation input.
 */
export function buildTrainingDesignInput(
  coachState: CoachState,
  exec: TrainingDesignExecutionInputs,
): TrainingDesignInput {
  return {
    priorities: [...coachState.priorities]
      .sort((a, b) => a.rank - b.rank)
      .map((p) => ({ focus: p.focus, rank: p.rank, confidence: p.confidence })),
    maintain: coachState.maintain.map((m) => m.focus),
    deprioritize: coachState.deprioritize.map((d) => d.focus),
    recovery_stance: coachState.recovery_posture.stance,
    strength_emphasis: coachState.strength_emphasis.value,

    days_per_week: exec.days_per_week,
    session_length_minutes: exec.session_length_minutes,
    equipment: exec.equipment,
    do_not_program: exec.do_not_program,
    vocabulary: exec.vocabulary,
    lifts: exec.lifts,
    previous_cycle: exec.previous_cycle,

    coach_state_version: coachState.version,
    athlete_model_version: coachState.athlete_model_version,
  };
}
