/**
 * engine-continuum-reaches — which effort bands a day type CAN land in.
 *
 * A reading aid for the sequencer's probe instruction (Phase 1): "the 1–2 min
 * band is blank, probe it" needs the model to know that an interval day with
 * 60–120 s of work gets there and an endurance day does not. Nothing is
 * authored here — the line follows the catalogue's envelope. The two extremes
 * of every ranged parameter are resolved through the SAME expansion the day
 * page and the continuum use (resolveSegments → prescriptionFromCatalog), the
 * judged (longest) block's effort is placed on the machine's balanced curve,
 * and the bands between the two extremes are reported.
 *
 * "Can reach", never "must": the model still chooses type and shape; the
 * system reads where the day actually landed.
 */

import type { CatalogEngineDay } from "./engine-block-resolve.ts";
import { prescriptionFromCatalog } from "./engine-continuum-prescription.ts";
import { balancedBout, judgedBlock, type PdCurvePoint, REGIONS, ZONE2_MIN_EFFORT_SECONDS } from "./engine-continuum.ts";
import type { EngineDayTypeRow } from "./engine-catalogue.ts";

export const ZONE2_LABEL = "zone 2 (40 min+)";

/** Band labels in chart order (long → short), zone 2 first. */
export const BAND_LABELS: string[] = [ZONE2_LABEL, ...REGIONS.map((r) => r[2])];

/** Keys whose [min,max] the sequencer chooses a scalar within. */
const SCALAR_RANGE_KEYS = new Set(["rounds", "workDuration", "baseDuration", "fluxDuration"]);
/** Keys holding a [lo,hi] pace pair. */
const PACE_PAIR_KEYS = new Set(["paceRange", "basePace", "fluxPaceRange"]);
/** Option lists: the sequencer picks one value per round. */
const OPTION_KEYS: Record<string, string> = { workDurationOptions: "workDuration", restDurationOptions: "restDuration" };

type Extreme = "min" | "max";

/** A concrete block at one extreme of its envelope. */
function concreteBlock(env: Record<string, unknown> | null, which: Extreme): Record<string, unknown> | null {
  if (!env) return null;
  const pick = (xs: number[]) => (which === "min" ? Math.min(...xs) : Math.max(...xs));
  const out: Record<string, unknown> = { ...env };
  for (const [k, v] of Object.entries(env)) {
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number")) {
      const nums = v as number[];
      if (SCALAR_RANGE_KEYS.has(k)) out[k] = pick(nums);
      else if (PACE_PAIR_KEYS.has(k)) out[k] = [pick(nums), pick(nums)];
      // reversed [start,end] progression endpoints (restDuration) are left to the resolver
    } else if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number") && OPTION_KEYS[k]) {
      out[OPTION_KEYS[k]] = pick(v as number[]);
    }
  }
  return out;
}

function bandOf(effortSeconds: number): string {
  if (effortSeconds >= ZONE2_MIN_EFFORT_SECONDS) return ZONE2_LABEL;
  for (const [lo, hi, label] of REGIONS) {
    if (effortSeconds >= lo && (hi == null || effortSeconds < hi)) return label;
  }
  return REGIONS[REGIONS.length - 1][2]; // shorter than the shortest band → ≤30 s
}

/** The judged block's effort duration at one extreme of the envelope, or null when it cannot be resolved. */
function effortAtExtreme(row: EngineDayTypeRow, curve: PdCurvePoint[], which: Extreme): number | null {
  const day: CatalogEngineDay = {
    day_number: 0,
    day_type: row.id,
    phase: null,
    month: null,
    block_count: row.block_count,
    set_rest_seconds: row.set_rest_seconds,
    block_1_params: concreteBlock(row.block_1_params, which),
    block_2_params: concreteBlock(row.block_2_params, which),
    block_3_params: concreteBlock(row.block_3_params, which),
    block_4_params: concreteBlock(row.block_4_params, which),
    total_duration_minutes: row.max_duration_minutes,
  };
  const p = prescriptionFromCatalog(day);
  if (!p) return null;
  // the judged block is the longest work block (decided 2026-11-16) — the same
  // rule the continuum applies to the logged session
  const judged = judgedBlock({ date: "", day_type: row.id, modality: "", units: null, actual_pace: null, target_pace: null, total_work_seconds: null, total_rest_seconds: null, intervals: null, prescription: p });
  if (!judged) return null;
  if (judged.max_effort) return judged.work_seconds; // a balanced athlete's max effort of that length
  const block = p.blocks.find((b) => (b.continuous ? b.work_seconds : b.work_seconds) === judged.work_seconds);
  if (block?.pace_multiple == null) return null;
  return balancedBout(curve, block.pace_multiple);
}

/**
 * Bands the day type can land in, chart order (long → short). Empty when the
 * envelope cannot be resolved (e.g. rocket_races_b, which inherits from A).
 */
export function reachableBands(row: EngineDayTypeRow, curve: PdCurvePoint[]): string[] {
  const efforts = (["min", "max"] as Extreme[]).map((w) => effortAtExtreme(row, curve, w)).filter((x): x is number => x != null);
  if (efforts.length === 0) return [];
  const idx = efforts.map((e) => BAND_LABELS.indexOf(bandOf(e)));
  const lo = Math.min(...idx), hi = Math.max(...idx);
  return BAND_LABELS.slice(lo, hi + 1);
}

/** One line for the catalogue entry, or null when nothing can be said. */
export function formatReaches(row: EngineDayTypeRow, curve: PdCurvePoint[]): string | null {
  const bands = reachableBands(row, curve);
  if (bands.length === 0) return null;
  if (row.id === "rocket_races_b") return null;
  return `can reach: ${bands.join(", ")}`;
}
