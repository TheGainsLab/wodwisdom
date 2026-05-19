/**
 * computeBenchmarksClient — calls the compute-benchmarks edge function for
 * data-grounded median/excellent benchmarks. Replaces the hardcoded
 * PERFORMANCE_FACTORS multipliers in metconScoring.ts as the PRIMARY path;
 * PERFORMANCE_FACTORS stays in metconScoring.ts as a silent fallback for
 * resilience (network/upstream failures, unknown movements, etc.).
 *
 * Returns null on any failure so callers can fall back cleanly. The
 * edge function itself has its own auth + validation; this is a thin
 * client-side wrapper that handles the MetconEntry → WorkCalcMovement
 * conversion and surfaces a BenchmarkResult-compatible shape.
 *
 * Gender: read server-side from athlete_profiles inside the edge function;
 * client doesn't pass it.
 */

import { supabase } from "./supabase";
import type { BenchmarkResult, MetconEntry } from "./metconScoring";

/** Mirror of WorkCalcMovement in supabase/functions/_shared/compute-benchmarks.ts.
 *  Volume specifiers are mutually exclusive — caller picks one per movement. */
interface WorkCalcMovement {
  movement_name: string;
  reps_total?: number;
  reps_per_round?: number;
  distance_value?: number;
  distance_unit?: "meters" | "feet" | "miles" | "kilometers";
  calories?: number;
  rounds?: number;
  load_lbs_men?: number;
  load_lbs_women?: number;
}

interface ComputeBenchmarksResponseData {
  median_score: string;
  excellent_score: string | null;
  median_watts: number;
  excellent_watts: number | null;
  joules: number;
  basis: string;
  time_domain: "short" | "medium" | "long";
}

interface ComputeBenchmarksResponseEnvelope {
  data?: ComputeBenchmarksResponseData | null;
  reason?: string;
  error?: string;
}

/** Convert a MetconEntry's distance_unit (often "m" / "ft" / "mi" / "km")
 *  into the work-calc canonical unit string. Returns null if not parseable. */
function normalizeDistanceUnit(
  unit: string | null | undefined,
): WorkCalcMovement["distance_unit"] | null {
  if (!unit) return null;
  const u = unit.toLowerCase();
  if (u === "m" || u === "meter" || u === "meters") return "meters";
  if (u === "ft" || u === "feet" || u === "foot") return "feet";
  if (u === "mi" || u === "mile" || u === "miles") return "miles";
  if (u === "km" || u === "kilometer" || u === "kilometers") return "kilometers";
  return null;
}

/** Build a WorkCalcMovement from a MetconEntry given the workout type.
 *  For-Time → reps_total. AMRAP → reps_per_round. Distance/calorie entries
 *  use those fields. Returns null if the entry doesn't carry enough info
 *  for upstream to compute work (no volume specifier resolvable). */
function entryToWorkCalcMovement(
  entry: MetconEntry,
  workoutType: string,
): WorkCalcMovement | null {
  const name = (entry.movement ?? "").trim();
  if (!name) return null;

  const reps = typeof entry.reps === "number" && entry.reps > 0 ? entry.reps : null;
  const distance = typeof entry.distance === "number" && entry.distance > 0
    ? entry.distance
    : null;
  const distUnit = normalizeDistanceUnit(entry.distance_unit ?? null);

  const m: WorkCalcMovement = { movement_name: name };

  // Volume specifier — exactly one must be set for upstream to compute joules.
  if (distance !== null && distUnit !== null) {
    m.distance_value = distance;
    m.distance_unit = distUnit;
  } else if (reps !== null) {
    if (workoutType === "amrap") {
      m.reps_per_round = reps;
    } else {
      // for_time + everything else with rep counts
      m.reps_total = reps;
    }
  } else {
    // No usable volume specifier — upstream will reject; bail early.
    return null;
  }

  // Load — we don't know gender on the client. Send weight on both fields;
  // upstream picks the right one based on athlete_profiles.gender server-side.
  if (typeof entry.weight === "number" && entry.weight > 0) {
    m.load_lbs_men = entry.weight;
    m.load_lbs_women = entry.weight;
  }

  return m;
}

/** Extract time-cap minutes from block text. Mirrors the parser used in
 *  metconScoring.ts:extractTimeCap but inline-defined to avoid a dependency
 *  cycle. Handles AMRAP, EMOM, "M:SS cap", and "N min" patterns. */
function extractTimeCapSeconds(blockText: string): number | null {
  const t = blockText.toLowerCase();
  const amrap = t.match(/amrap\s*-?\s*(\d+)/);
  if (amrap) return parseInt(amrap[1], 10) * 60;
  const emom = t.match(/emom\s*-?\s*(\d+)/);
  if (emom) return parseInt(emom[1], 10) * 60;
  // "M:SS cap" — v3 chips render the cap in this format ("8:00 cap")
  const mmss = t.match(/(\d+):(\d{2})\s*cap/);
  if (mmss) return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
  const cap = t.match(/(\d+)\s*min\b/);
  if (cap) return parseInt(cap[1], 10) * 60;
  return null;
}

/** Extract rounds count from block text. Mirrors extractRoundCount in
 *  metconScoring.ts. Returns 1 when no explicit rounds pattern is found
 *  (chipper / single-round / AMRAP). */
function extractRoundCount(blockText: string): number {
  const m = blockText.match(
    /(\d+)\s+(?:RFT|rounds?\s+for\s+time|rounds?\s+of\b|rounds?\s*[:\n])/i,
  );
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n < 50) return n;
  }
  return 1;
}

/** Primary entry point. Returns BenchmarkResult-compatible shape on success,
 *  null on any failure (network error, edge fn returns reason !== null,
 *  validation error, anything else). Caller falls back to local math. */
export async function computeBenchmarksClient(
  entries: MetconEntry[],
  workoutType: string,
  blockText: string,
): Promise<BenchmarkResult | null> {
  if (entries.length === 0) return null;
  if (workoutType !== "for_time" && workoutType !== "amrap") return null;

  // Convert each entry — any unconvertible entry kills the call (we can't
  // partially benchmark a workout where some movements are missing volume).
  const movements: WorkCalcMovement[] = [];
  for (const entry of entries) {
    const m = entryToWorkCalcMovement(entry, workoutType);
    if (m === null) return null;
    movements.push(m);
  }

  // Extract time cap for both AMRAP and For-Time. AMRAPs REQUIRE the cap
  // (it's the workout duration). For-Time can have a cap (max completion);
  // useful for time-domain bucketing on the server side.
  const timeCapSeconds = extractTimeCapSeconds(blockText);
  if (workoutType === "amrap" && !timeCapSeconds) {
    return null; // AMRAP without an extractable cap — upstream will reject. Bail.
  }
  // Rounds — multi-round For-Time workouts ("4 rounds for time: ...") emit
  // per-round reps in entries, so we MUST pass rounds for correct work calc.
  // For AMRAPs the per-round reps are correct as-is; rounds is ignored.
  const rounds = workoutType === "for_time" ? extractRoundCount(blockText) : 1;

  try {
    const { data, error } = await supabase.functions.invoke<ComputeBenchmarksResponseEnvelope>(
      "compute-benchmarks",
      {
        body: {
          movements,
          workout_type: workoutType,
          ...(timeCapSeconds ? { time_cap_seconds: timeCapSeconds } : {}),
          ...(rounds > 1 ? { rounds } : {}),
          block_scheme_hint: blockText.slice(0, 300),
        },
      },
    );
    if (error) {
      console.warn("[computeBenchmarksClient] edge fn error:", error.message);
      return null;
    }
    if (!data || !data.data) {
      // 200 envelope with `data: null` (upstream unavailable) — silent fallback.
      return null;
    }
    return {
      medianScore: data.data.median_score,
      excellentScore: data.data.excellent_score ?? "--",
    };
  } catch (e) {
    console.warn("[computeBenchmarksClient] unexpected error:", (e as Error).message);
    return null;
  }
}
