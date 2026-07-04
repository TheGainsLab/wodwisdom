/**
 * engine-class/physics.ts — turn the scored block of a cohort workout + the member's
 * result into a data-service work-calc call, yielding avg power (watts) for the W·kg
 * leaderboard. Failure-soft: null → the entry ranks on raw score only.
 *
 * v1: a direct (non-AI) mapping of MovementPrescription → WorkCalcMovement. The
 * member's own logged load is passed (their scaled effort); watts are computed at the
 * member's bodyweight. The W·kg DIVISOR is re-applied at read time from the live
 * profile (ONE PROFILE corollary a) — this stores only the numerator work/power.
 */

import type { BlockPrescription, MovementPrescription } from "../v2-output-schema.ts";
import type { WorkCalcMovement, Gender } from "../compute-benchmarks.ts";
import { computeWork, type WorkCalcResult } from "../work-calc.ts";

const LBS_PER_KG = 2.2046226218;

function toLbs(weight: number | undefined, unit: string | undefined): number | undefined {
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) return undefined;
  return unit === "kg" ? weight * LBS_PER_KG : weight;
}

function repsTotal(m: MovementPrescription): number | undefined {
  if (typeof m.reps === "number" && m.reps > 0) return m.reps;
  if (Array.isArray(m.rep_scheme) && m.rep_scheme.length > 0) {
    const sum = m.rep_scheme.reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
    return sum > 0 ? sum : undefined;
  }
  return undefined;
}

function toWorkCalcMovement(m: MovementPrescription): WorkCalcMovement {
  const loadLbs = toLbs(m.weight, m.weight_unit);
  const mv: WorkCalcMovement = { movement_name: m.movement };
  const reps = repsTotal(m);
  if (reps != null) mv.reps_total = reps;
  if (typeof m.distance === "number" && m.distance > 0) {
    mv.distance_value = m.distance;
    mv.distance_unit = m.distance_unit === "ft" ? "ft" : "m";
  }
  if (typeof m.calories === "number" && m.calories > 0) mv.calories = m.calories;
  if (loadLbs != null) { mv.load_lbs_men = loadLbs; mv.load_lbs_women = loadLbs; }
  return mv;
}

export interface EntryPowerParams {
  gender: Gender;
  bodyMassKg?: number;
  timeSeconds?: number; // for_time
  scoreReps?: number;   // amrap
}

/** Compute avg power for a member's scored-block result, or null when unavailable. */
export async function computeEntryPower(
  scoredBlock: BlockPrescription,
  params: EntryPowerParams,
): Promise<WorkCalcResult | null> {
  const movements = (scoredBlock.movements ?? []).map(toWorkCalcMovement);
  if (movements.length === 0) return null;
  return await computeWork(
    { movements },
    {
      gender: params.gender,
      body_mass_kg: params.bodyMassKg,
      time_seconds: params.timeSeconds,
      score_reps: params.scoreReps,
    },
  );
}
