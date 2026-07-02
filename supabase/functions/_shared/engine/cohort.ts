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
import { ALL_LIFT_KEYS } from "../tier-status.ts";
import type { AthleteInput, ScaledMovement, ScalingResult } from "./contract.ts";

/** Normalize a movement / lift name to a canonical-ish key for matching. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Lift keys longest-first so "clean_and_jerk" wins over "clean" on a substring match.
const LIFT_KEYS_BY_LEN = [...ALL_LIFT_KEYS].sort((a, b) => b.length - a.length);

/** Resolve which member 1RM a movement scales against. Exact normalized match
 *  first, then the longest lift key that appears as a token substring. */
function resolveBasisLift(movement: string): string | null {
  const n = normalize(movement);
  if ((ALL_LIFT_KEYS as readonly string[]).includes(n)) return n;
  for (const key of LIFT_KEYS_BY_LEN) {
    if (n === key || n.includes(key)) return key;
  }
  return null;
}

function roundToIncrement(weight: number, unit: "lbs" | "kg"): number {
  const inc = unit === "kg" ? 2.5 : 5;
  return Math.round(weight / inc) * inc;
}

/**
 * Scale the shared cohort program to one member. Deterministic; no LLM.
 * Movements with a target_pct_1rm and a resolvable member 1RM get an exact
 * resolved_weight; movements in the member's do_not_program are flagged
 * needs_substitution (the only AI-touched path, run separately).
 */
export function computeCohortScaling(
  shared: WriterOutput,
  athlete: AthleteInput,
): ScalingResult {
  const lifts = athlete.payload.lifts ?? {};
  const unit: "lbs" | "kg" = athlete.payload.basics.units ?? "lbs";
  const doNotProgram = (athlete.payload.training_context.injuries_structured?.do_not_program ?? [])
    .map(normalize);
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

          const basis = pct != null ? resolveBasisLift(mv.movement) : null;
          const oneRm = basis != null ? lifts[basis] : null;
          const resolvedWeight = pct != null && typeof oneRm === "number" && oneRm > 0
            ? roundToIncrement((pct / 100) * oneRm, unit)
            : null;

          const n = normalize(mv.movement);
          const needsSub = doNotProgram.some((d) => d.length > 0 && (n === d || n.includes(d) || d.includes(n)));
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
    // leaderboard time), so the member-level tier here is gender only.
    tier: gender,
  };
}
