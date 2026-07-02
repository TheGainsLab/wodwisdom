/**
 * engine/cohort.ts — cohort-mode scaling.
 *
 * Cohort mode (GYM_SKU_SPEC §1, GYM_PORTAL_FLOWS F2/F3): the whole class runs ONE
 * shared program (the "path"); each member gets it scaled to their numbers. The
 * scaling is DETERMINISTIC — round(target_pct_1rm × member 1RM) — so it costs zero
 * LLM: the AI only ever fires for substitutions/injury adaptations (flagged here as
 * needs_substitution, resolved by a separate AI pass — see the phase report). This
 * is what makes per-member COGS cents, not the ~$1 of full individual generation.
 */

import type { WriterOutput } from "../v2-output-schema.ts";
import { normalizeGender } from "../athlete-model.ts";
import type { DomainPack } from "../domain-packs/types.ts";
import type { AthleteInput, ScaledMovement, ScalingResult } from "./contract.ts";

/**
 * Scale the shared cohort program to one member. Deterministic; no LLM.
 * Movements with a target_pct_1rm and a resolvable member 1RM get an exact
 * resolved_weight; movements in the member's do_not_program are flagged
 * needs_substitution (the only AI-touched path, run separately).
 *
 * The 1RM basis and load increments come from the domain pack (sport-coupled) —
 * the Engine core stays movement-agnostic. Basis matching is EXACT (the pack's
 * display-name → lift-key map): an unmapped movement gets no basis and no
 * resolved_weight, never a substring-guessed wrong lift that could overload a
 * member. do_not_program matching mirrors the v3 auditDoNotProgram rule exactly
 * (canonical name, trim + lowercase, whole-string equality).
 */
export function computeCohortScaling(
  shared: WriterOutput,
  athlete: AthleteInput,
  pack: DomainPack,
): ScalingResult {
  const lifts = athlete.payload.lifts ?? {};
  const unit: "lbs" | "kg" = athlete.payload.basics.units ?? "lbs";
  const displayToLiftKey = pack.scaling.displayToLiftKey;
  const inc = pack.scaling.loadIncrement(unit);
  const banned = new Set(
    (athlete.payload.training_context.injuries_structured?.do_not_program ?? [])
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean),
  );
  const gender = athlete.payload.basics.gender ?? null;

  const scaled: ScaledMovement[] = [];
  let substitutionsPending = 0;

  const weeks = shared.weeks ?? [];
  for (const week of weeks) {
    for (const day of week.days ?? []) {
      for (let blockIdx = 0; blockIdx < (day.blocks ?? []).length; blockIdx++) {
        const block = day.blocks![blockIdx];
        const movements = block.movements ?? [];
        for (let movementIdx = 0; movementIdx < movements.length; movementIdx++) {
          const mv = movements[movementIdx];
          const pct = typeof mv.target_pct_1rm === "number" ? mv.target_pct_1rm : null;

          // Exact display-name match only — no substring guessing.
          const basis = pct != null ? (displayToLiftKey[mv.movement] ?? null) : null;
          const oneRm = basis != null ? lifts[basis] : null;
          const resolvedWeight = pct != null && typeof oneRm === "number" && oneRm > 0
            ? Math.round(((pct / 100) * oneRm) / inc) * inc
            : null;

          const needsSub = banned.has(mv.movement.trim().toLowerCase());
          if (needsSub) substitutionsPending++;

          scaled.push({
            week: week.week_num,
            day: day.day_num,
            block_idx: blockIdx,
            movement_idx: movementIdx,
            movement: mv.movement,
            target_pct_1rm: pct,
            resolved_weight: resolvedWeight,
            weight_unit: unit,
            basis_lift: basis,
            needs_substitution: needsSub,
            substitution_reason: needsSub ? "movement in member do_not_program" : undefined,
          });
        }
      }
    }
  }

  return {
    athlete_ref: athlete.athlete_ref,
    weight_unit: unit,
    scaled_movements: scaled,
    substitutions_pending: substitutionsPending,
    // v1 leaderboard grouping is gender + modality; modality is per-workout (set at
    // leaderboard time), so the member-level tier here is gender only. Normalized
    // ("men"/"women") so "male"/"Men"/"M" don't split a leaderboard bucket.
    tier: normalizeGender(gender),
  };
}
