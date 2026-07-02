/**
 * engine/contract.ts — the Engine API contract shapes.
 *
 * Implements docs/portfolio/ENGINE_API_CONTRACT.md. These types are the wire
 * contract for the standalone Engine entrypoint (engine-generate) and the shared
 * shape the gym channel (F2/F3/F7) builds on. Four things are load-bearing:
 *   - `athletes` is ALWAYS an array (1 = retail, N = gym roster; batch is free).
 *   - `tenant_id` + `corpus_scope` ride every request (white-label corpus).
 *   - `domain_pack` is versioned (a new sport is a new pack, no Engine change).
 *   - `mode` is explicit: adaptive (per-athlete generation) vs. cohort (one shared
 *     path + per-athlete deterministic scaling — F2/F3 leaderboard product).
 *
 * NOTE (v1 divergence, flagged in the phase report): the coaching-strategy layer
 * (coach-state → TrainingDesignInput) is DB-coupled (reuse-cache + persist to
 * coach_states) and stays surface-side, so each athlete carries a
 * `training_design_input` the surface computed. The Engine executes it. This
 * matches the locked coaching-state architecture (strategy is a persisted object;
 * the Engine is the Training-Design/execution layer).
 */

import type { WriterPayload } from "../build-writer-payload.ts";
import type { TrainingDesignInput } from "../training-design-input.ts";
import type { WriterOutput } from "../v2-output-schema.ts";
import type { SkeletonOutput } from "../v3-output-schema.ts";
import type { ModelProfile } from "../model-profiles.ts";

export type EngineMode = "adaptive" | "cohort";

/** White-label corpus scope. Omit = baseline only. */
export interface CorpusScope {
  /** Tenant ids whose private methodology corpus to include ALONGSIDE baseline. */
  tenants?: string[];
  /** Default true; false = pure white-label (no shared baseline — future). */
  include_baseline?: boolean;
}

export interface ContinuationRef {
  program_ref?: string | null;
  month_number: number;
}

/** One athlete in the request. `payload` + `training_design_input` are the
 *  execution inputs the surface built (payload) + the coaching strategy (tdi). */
export interface AthleteInput {
  athlete_ref: string;
  payload: WriterPayload;
  training_design_input: TrainingDesignInput;
  continuation?: ContinuationRef;
}

/** Cohort spec — required when mode === "cohort". The shared class program is
 *  generated once from this; each roster athlete is then scaled to it. */
export interface CohortSpec {
  /** The shared "path" the class runs. v1: an explicit payload + tdi for the
   *  class target (e.g. a nominated reference level or the gym's own programming). */
  shared_payload: WriterPayload;
  shared_training_design_input: TrainingDesignInput;
}

export interface EngineGenerateRequest {
  tenant_id: string;
  mode: EngineMode;
  domain_pack: string;
  model_profile?: ModelProfile;
  corpus_scope?: CorpusScope;
  /** Adaptive: each gets an independent program. Cohort: the roster to scale. */
  athletes: AthleteInput[];
  cohort?: CohortSpec;
}

// ── Results ────────────────────────────────────────────────────────────────

/** The audited artifact for one athlete (adaptive) or the shared program (cohort). */
export interface EngineProgramResult {
  athlete_ref: string | null;
  output: WriterOutput;
  skeleton: SkeletonOutput;
  /** Block-local audit failures surgical could not resolve; empty on a clean run. */
  residual_audit_failures: unknown[];
  safety: { safe: boolean; reasoning: string; errored: boolean };
}

/** One movement of the shared cohort program, resolved to a member's numbers.
 *  Field names mirror MovementPrescription / workout_log_entries. */
export interface ScaledMovement {
  week: number;
  day: number;
  block_idx: number;
  movement_idx: number;
  movement: string;
  target_pct_1rm: number | null;
  /** Deterministic: round(target_pct_1rm × member 1RM). null when not resolvable. */
  resolved_weight: number | null;
  weight_unit: "lbs" | "kg";
  /** Which member 1RM the weight was derived from (canonical lift key). */
  basis_lift: string | null;
  /** Movement is contraindicated for this member (in their do_not_program). */
  needs_substitution: boolean;
  substitution_reason?: string;
}

/** Per-member scaling of the shared cohort program (F2/F3). Deterministic core;
 *  substitutions (needs_substitution) are the only AI-touched part. */
export interface ScalingResult {
  athlete_ref: string;
  weight_unit: "lbs" | "kg";
  scaled_movements: ScaledMovement[];
  /** Count of movements flagged for substitution (AI adaptation pass). */
  substitutions_pending: number;
  /** Leaderboard grouping key (gender + modality only, per GYM_SKU_SPEC). */
  tier: string | null;
}

/** Adaptive: one program per athlete. Cohort: one shared program + N scalings. */
export interface EngineGenerateResult {
  mode: EngineMode;
  tenant_id: string;
  domain_pack: string;
  /** Adaptive: one entry per athlete. Cohort: exactly one (the shared program). */
  programs: EngineProgramResult[];
  /** Cohort only: one ScalingResult per roster athlete. */
  scalings?: ScalingResult[];
}
