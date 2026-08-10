/**
 * frontier-skeleton-prompt.ts — the Stage 3 shadow test's FRONTIER ARM prompt.
 *
 * Experimental design: the ONLY differences between arms are (1) this additive
 * system-prompt section and (2) the COACH STATE DOCUMENT block in the user
 * message. Everything else — base prompt, tool schema, rule recap, TDI block —
 * is byte-identical to the live enum arm, so any outcome difference is
 * attributable to the widened intent channel, not prompt drift.
 *
 * Lives under scripts/ (not _shared/) because it is shadow-only. If Stage 3
 * adopts, this graduates into the live prompt module.
 */

import { V3_SKELETON_SYSTEM_PROMPT } from "../../supabase/functions/_shared/v3-skeleton-prompt.ts";
import type { CoachState } from "../../supabase/functions/_shared/coach-state.ts";

/**
 * The de-prescribing addendum. The typed decisions stay THE LOCKED PLAN; the
 * document widens the execution channel only. Wording mirrors the live
 * prompt's "allocate, do not reinterpret" register.
 */
export const FRONTIER_ADDENDUM = `

THE COACH STATE DOCUMENT (frontier-arm addition)
Alongside the TrainingDesignInput you receive the full COACH STATE document — the coach's complete written judgment: per-priority reasons, evidence, athlete-facing rationale, and recommended_action, plus the summary and recovery/strength reasoning.

THE TYPED DECISIONS REMAIN THE LOCKED PLAN. The document explains the plan; it never overrides it. If the prose ever seems to disagree with the typed priorities / maintain / deprioritize / recovery_stance / strength_emphasis, THE TYPED DECISIONS WIN — allocate to them exactly as the allocation rules above require.

USE THE DOCUMENT TO REFINE EXECUTION ONLY:
  - A priority's recommended_action may shape HOW you train it — scheme character, block style, progression flavor — within that priority's rank-appropriate dose.
  - reasons / evidence may inform selection WITHIN the allowed vocabulary (which lift variant, which skill progression, which metcon shape best serves the stated why).
  - Injury or recovery rationale may shape selection beyond the hard do_not_program ban (e.g. choosing the lower-stress variant of an allowed movement).

NEVER use the document to: re-rank, add, drop, or promote a focus; change the dose a rank earns; give a deprioritized focus a dedicated block; or argue with the plan in day_intent or any emitted field. Emit structure, not advocacy.

SESSION BUDGET: every block on a day must fit session_length_minutes TOGETHER. The non-metcon blocks consume roughly 45 minutes of a standard session — so the metcon's stated duration must fit what remains (a 60-minute athlete gets a ≤15-minute metcon, not a 20-minute chipper). State metcon durations that actually fit.

MAINTAIN PRIMARIES: when the priorities call for fewer dedicated strength days than days_per_week, the spare strength slots MAY carry a maintain focus as primary_lift — but only at submaximal touch intensity (technical doubles, moderate loads). Intensity, not placement, is what separates a touch from development.`;

/** Frontier-arm system prompt = live prompt + addendum, nothing else. */
export function buildFrontierSkeletonSystemPrompt(): string {
  return V3_SKELETON_SYSTEM_PROMPT + FRONTIER_ADDENDUM;
}

/** The verbatim CoachState document block for the frontier user message. */
export function buildCoachStateDocumentBlock(coachState: CoachState): string {
  return `COACH STATE DOCUMENT (JSON — the coach's full written judgment; the TrainingDesignInput above remains the locked plan):\n${JSON.stringify(coachState, null, 2)}`;
}
