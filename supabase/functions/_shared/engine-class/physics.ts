/**
 * engine-class/physics.ts — turn the scored block of a cohort workout + the member's
 * result into a data-service work-calc call, yielding avg power (watts) for the W·kg
 * leaderboard. Failure-soft: null → the entry ranks on raw score only.
 *
 * v1 honesty rule (PR #560 review): watts are computed from the **Rx prescription**,
 * which only describes the member's actual work when they did it Rx — so the caller
 * computes power ONLY for `rx: true` entries; a scaled (`rx: false`) member ranks on
 * raw score with their scaled badge, never Rx power credit. Capturing real member
 * loads at log time is the proper fix (new UX), deferred deliberately.
 *
 * Mirrors the proven `metcon-workcalc.ts` converter: exactly ONE specifier per movement
 * (calories | distance | reps), distances normalized to metres, and the upstream
 * `watts: null` derived as `total_joules / divisor_seconds` (finish time for-time; the
 * block time-cap for AMRAP). Stores only when `fully_computed` — a partial figure is
 * worse than none. The W·kg DIVISOR (bodyweight) is re-applied at read time from the
 * live profile (ONE PROFILE corollary a); this stores only the numerator work/power.
 */

import type { BlockPrescription, MovementPrescription } from "../v2-output-schema.ts";
import type { WorkCalcMovement, Gender } from "../compute-benchmarks.ts";
import { computeWork } from "../work-calc.ts";

const LB_PER_KG = 2.2046226218; // kg → lb (named for its direction, unlike the inverse in metcon-workcalc)

export type PhysicsScoreType = "for_time" | "amrap";

function toLbs(weight: number | undefined, unit: string | undefined): number | undefined {
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) return undefined;
  return unit === "kg" ? weight * LB_PER_KG : weight;
}

function toMeters(value: number, unit: string | undefined): number {
  const u = (unit ?? "").trim().toLowerCase();
  return (u === "ft" || u === "feet" || u === "foot") ? value * 0.3048 : value;
}

function repsSum(m: MovementPrescription): number | undefined {
  if (typeof m.reps === "number" && m.reps > 0) return m.reps;
  if (Array.isArray(m.rep_scheme) && m.rep_scheme.length > 0) {
    const sum = m.rep_scheme.reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
    return sum > 0 ? sum : undefined;
  }
  return undefined;
}

function repsPerRound(m: MovementPrescription): number | undefined {
  // AMRAP: the per-round volume (rep_scheme's single structural unit) drives the
  // server-side decomposition of score_reps.
  if (Array.isArray(m.rep_scheme) && m.rep_scheme.length > 0 && typeof m.rep_scheme[0] === "number") {
    return m.rep_scheme[0] > 0 ? m.rep_scheme[0] : undefined;
  }
  if (typeof m.reps === "number" && m.reps > 0) return m.reps;
  return undefined;
}

/** Map a prescribed movement → WorkCalcMovement with EXACTLY one specifier
 *  (calories | distance | reps). `amrap` chooses per-round vs total reps. */
function toWorkCalcMovement(m: MovementPrescription, scoreType: PhysicsScoreType): WorkCalcMovement | null {
  const mv: WorkCalcMovement = { movement_name: m.movement };
  const loadLbs = toLbs(m.weight, m.weight_unit);
  if (loadLbs != null) { mv.load_lbs_men = loadLbs; mv.load_lbs_women = loadLbs; }

  // One specifier, in priority order (matches metcon-workcalc): calories, else
  // distance, else reps. Never set more than one.
  if (typeof m.calories === "number" && m.calories > 0) {
    mv.calories = m.calories;
  } else if (typeof m.distance === "number" && m.distance > 0) {
    mv.distance_value = toMeters(m.distance, m.distance_unit);
    mv.distance_unit = "m";
  } else {
    const reps = scoreType === "amrap" ? repsPerRound(m) : repsSum(m);
    if (reps == null) return null; // no usable work unit for this movement
    if (scoreType === "amrap") mv.reps_per_round = reps;
    else mv.reps_total = reps;
  }
  return mv;
}

export interface EntryPowerParams {
  gender: Gender;
  bodyMassKg?: number;
  scoreType: PhysicsScoreType;
  /** for_time: the athlete's finish time (the watts divisor). */
  timeSeconds?: number;
  /** amrap: the block's time cap (the watts divisor) + the raw total rep count. */
  capSeconds?: number;
  scoreReps?: number;
}

export interface EntryPower {
  avg_power_watts: number | null;
  total_joules: number | null;
  body_mass_kg: number | null;
}

/** Compute avg power for a member's scored-block result, or null when unavailable /
 *  not fully computed. Only meaningful for Rx efforts (caller enforces). */
export async function computeEntryPower(
  scoredBlock: BlockPrescription,
  params: EntryPowerParams,
): Promise<EntryPower | null> {
  const movements = (scoredBlock.movements ?? [])
    .map((m) => toWorkCalcMovement(m, params.scoreType))
    .filter((x): x is WorkCalcMovement => x !== null);
  if (movements.length === 0) return null;

  const divisorSeconds = params.scoreType === "amrap" ? params.capSeconds : params.timeSeconds;
  const result = await computeWork(
    { movements },
    {
      gender: params.gender,
      body_mass_kg: params.bodyMassKg,
      time_seconds: divisorSeconds,
      score_reps: params.scoreType === "amrap" ? params.scoreReps : undefined,
    },
  );
  // Store only a COMPLETE effort — a partial joules figure is worse than none.
  if (!result || !result.fully_computed) return null;

  const rawWatts = result.watts ??
    (typeof divisorSeconds === "number" && divisorSeconds > 0 ? result.total_joules / divisorSeconds : null);
  const watts = rawWatts != null ? Math.round(rawWatts * 10) / 10 : null;

  return {
    avg_power_watts: watts,
    total_joules: result.total_joules,
    body_mass_kg: result.body_mass_kg_used > 0 ? result.body_mass_kg_used : (params.bodyMassKg ?? null),
  };
}
