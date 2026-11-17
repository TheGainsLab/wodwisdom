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
import { balancedBout, effortBandOf, judgedBlock, type PdCurvePoint, REGIONS, ZONE2_BAND_LABEL } from "./engine-continuum.ts";
import type { EngineDayTypeRow } from "./engine-catalogue.ts";

export const ZONE2_LABEL = ZONE2_BAND_LABEL;

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
  // flux family: total time derived as the sequencer's fill does (engine-sequence.ts)
  const prog = out.workProgression;
  if ((prog === "alternating_paces" || prog === "progressive_flux_intensity") && typeof out.workDuration !== "number") {
    const rounds = typeof out.rounds === "number" ? out.rounds : 1;
    if (typeof out.baseDuration === "number" && typeof out.fluxDuration === "number") out.workDuration = rounds * (out.baseDuration + out.fluxDuration);
  }
  return out;
}

const bandOf = effortBandOf;

/** The concrete day at one extreme of the envelope. */
function dayAtExtreme(row: EngineDayTypeRow, which: Extreme): CatalogEngineDay {
  return {
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
}

/** The envelope of the block a session on this type is judged on (the longest
 *  work block at the envelope's long extreme), or null when it cannot be
 *  resolved (e.g. rocket_races_b, which inherits; flux, no workDuration). */
function judgedEnvelope(row: EngineDayTypeRow): { env: Record<string, unknown>; maxEffort: boolean; continuous: boolean } | null {
  const day = dayAtExtreme(row, "max");
  const p = prescriptionFromCatalog(day);
  if (!p) return null;
  const judged = judgedBlock({ date: "", day_type: row.id, modality: "", units: null, actual_pace: null, target_pace: null, total_work_seconds: null, total_rest_seconds: null, intervals: null, prescription: p });
  if (!judged) return null;
  const idx = p.blocks.findIndex((b) => b.work_seconds === judged.work_seconds);
  // p.blocks is in block order, skipping blocks the resolver dropped (no work);
  // map back to the envelope by counting resolvable blocks.
  const envs = [row.block_1_params, row.block_2_params, row.block_3_params, row.block_4_params].slice(0, row.block_count);
  const resolvable = envs.filter((e) => e && (e.workDuration != null || (Array.isArray(e.workDurationOptions) && e.workDurationOptions.length) || (e.baseDuration != null && e.fluxDuration != null)));
  const env = resolvable[idx] ?? null;
  if (!env) return null;
  return { env, maxEffort: judged.max_effort, continuous: p.blocks[idx]?.continuous === true };
}

function numRange(v: unknown): [number, number] | null {
  if (typeof v === "number") return [v, v];
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === "number")) return [Math.min(...(v as number[])), Math.max(...(v as number[]))];
  return null;
}

export interface Reach {
  band: string;
  /** "0.95–1.05×" for a paced block, "30–60 s work" for a max effort */
  at: string;
}

const fmtX = (x: number) => x.toFixed(2).replace(/0$/, "");

/**
 * Which effort bands the day type can land in and WHAT puts it there — the
 * pace fraction for a paced block, the work length for a max effort. Chart
 * order (long → short). Empty when the envelope cannot be resolved.
 */
export function reachMap(row: EngineDayTypeRow, curve: PdCurvePoint[]): Reach[] {
  const j = judgedEnvelope(row);
  if (!j) return [];
  const out = new Map<string, { lo: number; hi: number }>();
  const put = (band: string, x: number) => {
    const cur = out.get(band);
    if (!cur) out.set(band, { lo: x, hi: x });
    else { cur.lo = Math.min(cur.lo, x); cur.hi = Math.max(cur.hi, x); }
  };
  if (j.maxEffort) {
    // a max effort's band follows its work length (a balanced athlete's max of that length)
    const w = numRange(j.env.workDuration) ?? numRange(j.env.workDurationOptions);
    if (!w) return [];
    const [lo, hi] = w;
    for (let s = lo; s <= hi; s += Math.max(1, Math.round((hi - lo) / 200))) put(bandOf(s), s);
    put(bandOf(hi), hi);
    return BAND_LABELS.filter((b) => out.has(b)).map((band) => {
      const r = out.get(band)!;
      return { band, at: r.lo === r.hi ? `${r.lo} s work` : `${r.lo}–${r.hi} s work` };
    });
  }
  // a paced block's band follows its pace: the longest bout a balanced athlete holds at that pace
  // a continuous block is judged on the pace actually delivered — its
  // average — which the base segments dominate (flux at 0.95× for 60 s inside
  // 300 s of 0.7× averages ≈ 0.74×): read it at its base pace
  const prog = String(j.env.workProgression ?? "");
  const paceKey = ["continuous_with_bursts", "alternating_paces", "progressive_flux_intensity"].includes(prog) ? "basePace" : j.env.paceRange != null ? "paceRange" : "basePace";
  const pr = numRange(j.env[paceKey]);
  if (!pr) return [];
  const [lo, hi] = pr;
  for (let x = lo; x <= hi + 1e-9; x = Math.round((x + 0.01) * 100) / 100) put(bandOf(Math.round(balancedBout(curve, x))), x);
  return BAND_LABELS.filter((b) => out.has(b)).map((band) => {
    const r = out.get(band)!;
    return { band, at: r.lo === r.hi ? `${fmtX(r.lo)}×` : `${fmtX(r.lo)}–${fmtX(r.hi)}×` };
  });
}

/** Bands only (chart order). */
export function reachableBands(row: EngineDayTypeRow, curve: PdCurvePoint[]): string[] {
  return reachMap(row, curve).map((r) => r.band);
}

/** One line for the catalogue entry, or null when nothing can be said. */
export function formatReaches(row: EngineDayTypeRow, curve: PdCurvePoint[]): string | null {
  if (row.id === "rocket_races_b") return null;
  const reaches = reachMap(row, curve);
  if (reaches.length === 0) return null;
  const j = judgedEnvelope(row);
  const note = j?.maxEffort ? " (max effort — the band follows the work length)" : " (the band follows the pace you set, not the clock)";
  return `can reach: ${reaches.map((r) => `${r.band} at ${r.at}`).join(", ")}${note}`;
}
