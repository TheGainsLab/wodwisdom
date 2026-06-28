/**
 * training-summary.ts
 *
 * Step 4 — the deterministic "what are the observable facts?" layer. Raw
 * Evidence (workout_log_entries, append-only) → a typed, versioned summary of
 * what the athlete ACTUALLY did. States facts INCLUDING absence; makes NO
 * judgments (no "weak", no "should"). The Athlete Inference Engine decides
 * whether these facts change belief; this layer only reports them.
 *
 * Single-writer: this module produces the TrainingSummary and nothing else;
 * it never touches the Athlete Model.
 *
 * Pure core (summarizeTrainingEntries) is DB-free + golden-testable; the DB
 * fetch (buildTrainingSummary) wraps it.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ALL_LIFT_KEYS } from "./tier-status.ts";
import { normalizeMovementKey } from "./athlete-model.ts";

export const TRAINING_SUMMARY_VERSION = "v1";

/** Recency window for "current" training evidence. Older logs are excluded
 *  from the capability picture (a 1RM from 6 months ago isn't "current"). */
export const TRAINING_WINDOW_DAYS = 56; // 8 weeks

const LIFT_KEY_SET = new Set<string>(ALL_LIFT_KEYS as readonly string[]);

/** One logged set, as read from workout_log_entries (joined to its log's date). */
export interface RawLogEntry {
  movement: string;
  reps: number | null;
  weight: number | null;
  weight_unit: string | null;
  rpe: number | null;
  sets: number | null;
  workout_date: string; // YYYY-MM-DD
}

/** Per-lift observed evidence — facts only, no belief. */
export interface LiftEvidence {
  lift: string; // canonical lift key
  /** Best single-set estimated 1RM in the window (Epley+RIR), in lbs.
   *  This is a FACT (a computed estimate from a real set), not a belief. */
  best_est_1rm: number;
  best_set: { weight: number; reps: number; rpe: number | null; date: string };
  /** Distinct calendar days this lift was logged in the window. */
  sessions: number;
  total_sets: number;
  avg_rpe: number | null;
  last_performed: string; // YYYY-MM-DD
}

export interface TrainingSummary {
  training_summary_version: string;
  window_days: number;
  as_of: string;
  /** Total distinct logged training days in the window (the consistency signal). */
  sessions_logged: number;
  /** Per canonical lift that has qualifying evidence. Absent lift = no evidence
   *  (NOT weakness — the engine treats absence as neutral). */
  lifts: Record<string, LiftEvidence>;
  /** Per-movement logged volume (any movement, canonical-normalized) — reps
   *  the athlete actually did. Positive signal only. */
  movement_volume: Record<string, { reps: number; sessions: number }>;
}

// ── e1RM estimate (Epley + reps-in-reserve from RPE) ─────────────────
// effective_reps = reps + RIR, where RIR = max(0, 10 - rpe). A set of
// 5 @ RPE 8 (2 in reserve) implies ~a 7-rep capacity → a higher 1RM than
// 5 @ RPE 10. No RPE → no RIR bonus (conservative). The Inference Engine,
// not this function, decides whether the estimate moves a belief.
export function estimateOneRepMax(weight: number, reps: number, rpe: number | null): number {
  const rir = rpe != null && rpe >= 1 && rpe <= 10 ? Math.max(0, 10 - rpe) : 0;
  const effReps = Math.max(1, reps + rir);
  // Epley; clamp effective reps so a 20-rep set doesn't produce a wild 1RM.
  const capped = Math.min(effReps, 12);
  return Math.round(weight * (1 + capped / 30));
}

function isQualifyingStrengthSet(e: RawLogEntry): boolean {
  return (
    typeof e.weight === "number" && e.weight > 0 &&
    typeof e.reps === "number" && e.reps > 0
  );
}

/**
 * Pure summarizer — raw log entries → TrainingSummary. DB-free + deterministic
 * (golden-testable). asOf is the reference date for the window + stamp.
 */
export function summarizeTrainingEntries(entries: RawLogEntry[], asOf: string): TrainingSummary {
  const cutoffMs = Date.parse(asOf) - TRAINING_WINDOW_DAYS * 86400_000;
  const inWindow = entries.filter((e) => {
    const t = Date.parse(e.workout_date);
    return Number.isFinite(t) && t >= cutoffMs && t <= Date.parse(asOf);
  });

  const allDays = new Set(inWindow.map((e) => e.workout_date));

  // Per-lift accumulation.
  const liftAcc = new Map<string, {
    bestE1rm: number;
    bestSet: LiftEvidence["best_set"];
    days: Set<string>;
    sets: number;
    rpeSum: number;
    rpeN: number;
    last: string;
  }>();
  const volume = new Map<string, { reps: number; days: Set<string> }>();

  for (const e of inWindow) {
    const key = normalizeMovementKey(e.movement);
    // movement_volume: any movement with positive reps.
    if (typeof e.reps === "number" && e.reps > 0) {
      const v = volume.get(key) ?? { reps: 0, days: new Set<string>() };
      v.reps += e.reps * (e.sets && e.sets > 0 ? e.sets : 1);
      v.days.add(e.workout_date);
      volume.set(key, v);
    }
    // lift evidence: only canonical lifts with a qualifying weighted set.
    if (LIFT_KEY_SET.has(key) && isQualifyingStrengthSet(e)) {
      const est = estimateOneRepMax(e.weight!, e.reps!, e.rpe);
      const acc = liftAcc.get(key) ?? {
        bestE1rm: 0,
        bestSet: { weight: 0, reps: 0, rpe: null, date: e.workout_date },
        days: new Set<string>(),
        sets: 0,
        rpeSum: 0,
        rpeN: 0,
        last: e.workout_date,
      };
      acc.days.add(e.workout_date);
      acc.sets += 1;
      if (typeof e.rpe === "number") { acc.rpeSum += e.rpe; acc.rpeN += 1; }
      if (e.workout_date > acc.last) acc.last = e.workout_date;
      if (est > acc.bestE1rm) {
        acc.bestE1rm = est;
        acc.bestSet = { weight: e.weight!, reps: e.reps!, rpe: e.rpe ?? null, date: e.workout_date };
      }
      liftAcc.set(key, acc);
    }
  }

  const lifts: Record<string, LiftEvidence> = {};
  for (const [key, acc] of liftAcc) {
    lifts[key] = {
      lift: key,
      best_est_1rm: acc.bestE1rm,
      best_set: acc.bestSet,
      sessions: acc.days.size,
      total_sets: acc.sets,
      avg_rpe: acc.rpeN > 0 ? Math.round((acc.rpeSum / acc.rpeN) * 10) / 10 : null,
      last_performed: acc.last,
    };
  }

  const movement_volume: Record<string, { reps: number; sessions: number }> = {};
  for (const [key, v] of volume) {
    movement_volume[key] = { reps: v.reps, sessions: v.days.size };
  }

  return {
    training_summary_version: TRAINING_SUMMARY_VERSION,
    window_days: TRAINING_WINDOW_DAYS,
    as_of: asOf,
    sessions_logged: allDays.size,
    lifts,
    movement_volume,
  };
}

/**
 * DB fetch + summarize. Reads the athlete's logged sets in the window and
 * returns the TrainingSummary. Soft-fails to an EMPTY summary (never throws):
 * no logs = no evidence = the Model stays intake-based (no-penalty).
 */
export async function buildTrainingSummary(
  supa: SupabaseClient,
  userId: string,
  asOf: string,
): Promise<TrainingSummary> {
  const cutoff = new Date(Date.parse(asOf) - TRAINING_WINDOW_DAYS * 86400_000)
    .toISOString().slice(0, 10);
  try {
    const { data, error } = await supa
      .from("workout_log_entries")
      .select("movement, reps, weight, weight_unit, rpe, sets, workout_logs!inner(user_id, workout_date)")
      .eq("workout_logs.user_id", userId)
      .gte("workout_logs.workout_date", cutoff);
    if (error) throw error;
    const entries: RawLogEntry[] = (data ?? []).map((raw) => {
      const r = raw as Record<string, unknown>;
      // The embedded relation can deserialize as an object (1:1) or an array;
      // normalize either to a single workout_date.
      const wl = r.workout_logs as { workout_date?: string } | Array<{ workout_date?: string }> | null;
      const workout_date = Array.isArray(wl) ? (wl[0]?.workout_date ?? "") : (wl?.workout_date ?? "");
      return {
        movement: String(r.movement ?? ""),
        reps: (r.reps as number | null) ?? null,
        weight: (r.weight as number | null) ?? null,
        weight_unit: (r.weight_unit as string | null) ?? null,
        rpe: (r.rpe as number | null) ?? null,
        sets: (r.sets as number | null) ?? null,
        workout_date,
      };
    }).filter((e) => e.workout_date);
    return summarizeTrainingEntries(entries, asOf);
  } catch (err) {
    console.warn(`[training-summary] fetch failed for ${userId} (empty summary, no-penalty):`, err);
    return summarizeTrainingEntries([], asOf);
  }
}
