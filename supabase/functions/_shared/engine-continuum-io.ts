/**
 * engine-continuum-io — load an athlete's data, compute their continuum with
 * the pure module (engine-continuum.ts), and write it back.
 *
 * One code path, two callers:
 *   - engine-continuum-backfill   every athlete (daily tick / admin button / deploy rerun)
 *   - the sequencer + the Coach   this athlete, inline, so the curve they read
 *                                 includes a session logged this morning (Phase 1,
 *                                 docs/conditioning_continuum_phase1_plan.md)
 *
 * Writes only what changed: the curve when any node/flag differs, and only the
 * sessions whose continuum values differ from what is stored.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type CatalogEngineDay } from "./engine-block-resolve.ts";
import { prescriptionFromCatalog } from "./engine-continuum-prescription.ts";
import {
  type ContinuumSessionInput,
  CURVE_VERSION,
  type EngineCurve,
  type PdCurvePoint,
  type RegionSummary,
  replayCurve,
  type ReplayResult,
  summarizeCurve,
  type TrialInput,
} from "./engine-continuum.ts";

export type PdCurves = Record<string, PdCurvePoint[]>;

export interface StoredCurve extends EngineCurve {
  computed_at?: string;
  module_version?: number;
}

export interface AthleteContinuum {
  user_id: string;
  sessions: number;
  curve: EngineCurve;
  regions: RegionSummary[];
  trials: TrialInput[];
  results: ReplayResult["sessions"];
  evidence: Record<string, number>;
  wrote: { curve: boolean; sessions: number };
}

interface SessionRow {
  id: string;
  user_id: string;
  date: string;
  day_type: string | null;
  modality: string | null;
  units: string | null;
  actual_pace: number | null;
  target_pace: number | null;
  workout_data: Record<string, unknown> | null;
  program_version: string | null;
  program_day: number | null;
  sequence_position: number | null;
  created_at: string;
  continuum_r: number | null;
  continuum_effort_s: number | null;
  continuum_bout_s: number | null;
  continuum_sustain: number | null;
  continuum_evidence: string | null;
}

export async function loadCurves(supa: SupabaseClient): Promise<PdCurves> {
  const { data, error } = await supa.from("engine_pd_curves").select("modality, units, r, seconds");
  if (error) throw new Error(`engine_pd_curves read failed: ${error.message}`);
  const out: PdCurves = {};
  for (const row of (data ?? []) as Array<{ modality: string; units: string; r: number; seconds: number }>) {
    const k = `${row.modality}|${row.units}`;
    (out[k] ??= []).push({ r: Number(row.r), seconds: Number(row.seconds) });
  }
  return out;
}

const SESSION_SEL =
  "id, user_id, date, day_type, modality, units, actual_pace, target_pace, workout_data, program_version, program_day, sequence_position, created_at, " +
  "continuum_r, continuum_effort_s, continuum_bout_s, continuum_sustain, continuum_evidence";
/** The program_type every catalogue day is stored under; variant programs map onto its day numbers. */
export const CATALOG_PROGRAM = "main_5day";
const CATALOG_SEL = "id, program_type, day_number, day_type, phase, month, block_count, set_rest_seconds, block_1_params, block_2_params, block_3_params, block_4_params, total_duration_minutes";

/**
 * Compute (and by default write) one athlete's continuum. Returns null when
 * the athlete has no completed Engine sessions.
 */
export async function computeAthleteContinuum(
  supa: SupabaseClient,
  userId: string,
  curves: PdCurves,
  opts: { write: boolean },
): Promise<AthleteContinuum | null> {
  const [sessRes, trialRes, ovRes, profRes] = await Promise.all([
    supa.from("engine_workout_sessions").select(SESSION_SEL).eq("user_id", userId).eq("completed", true).order("date").order("created_at"),
    supa.from("engine_time_trials").select("modality, units, calculated_rpm, date").eq("user_id", userId).not("calculated_rpm", "is", null),
    supa.from("engine_user_day_overrides").select("sequence_position, program_version, engine_workout_id").eq("user_id", userId),
    supa.from("athlete_profiles").select("user_id, engine_program_version, engine_curve").eq("user_id", userId).maybeSingle(),
  ]);
  for (const [name, res] of [["sessions", sessRes], ["time_trials", trialRes], ["overrides", ovRes], ["profile", profRes]] as const) {
    if (res.error) throw new Error(`[engine-continuum-io] ${name} read failed for ${userId}: ${res.error.message}`);
  }
  const sessions = (sessRes.data ?? []) as unknown as SessionRow[];
  if (sessions.length === 0) return null;
  const profile = profRes.data as { engine_program_version?: string | null; engine_curve?: StoredCurve | null } | null;

  const trials: TrialInput[] = ((trialRes.data ?? []) as Array<{ modality: string; units: string | null; calculated_rpm: number; date: string }>)
    .map((t) => ({ modality: t.modality, units: t.units, pace: Number(t.calculated_rpm), date: t.date }));

  // Prescriptions: the sequencer's override at that position wins; else the
  // catalog day for the session's program. One batched read per kind.
  const overrideByKey = new Map<string, string>();
  for (const o of (ovRes.data ?? []) as Array<{ sequence_position: number; program_version: string; engine_workout_id: string }>) {
    overrideByKey.set(`${o.program_version}|${o.sequence_position}`, o.engine_workout_id);
  }
  const fallbackVersion = profile?.engine_program_version ?? "main_5day";
  const overrideIds = new Set<string>();
  const catalogDays = new Set<number>();
  for (const s of sessions) {
    const version = s.program_version ?? fallbackVersion;
    const ov = s.sequence_position != null ? overrideByKey.get(`${version}|${s.sequence_position}`) : undefined;
    if (ov) overrideIds.add(ov);
    else if (s.program_day != null) catalogDays.add(s.program_day);
  }
  // Catalogue content lives under CATALOG_PROGRAM for EVERY program: a variant
  // program's mapping points at main_5day day numbers (fixed 2026-11-17 —
  // variant athletes' prescriptions were not being found).
  const catalogByDay = new Map<number, CatalogEngineDay>();
  if (catalogDays.size) {
    const { data } = await supa.from("engine_workouts").select(CATALOG_SEL).eq("program_type", CATALOG_PROGRAM).in("day_number", [...catalogDays]);
    for (const w of (data ?? []) as Array<CatalogEngineDay & { id: string }>) catalogByDay.set(w.day_number, w);
  }
  const catalogById = new Map<string, CatalogEngineDay>();
  if (overrideIds.size) {
    const { data } = await supa.from("engine_workouts").select(CATALOG_SEL).in("id", [...overrideIds]);
    for (const w of (data ?? []) as Array<CatalogEngineDay & { id: string }>) catalogById.set(w.id, w);
  }

  const inputs: Array<ContinuumSessionInput & { id: string }> = sessions.map((s) => {
    const version = s.program_version ?? fallbackVersion;
    const ov = s.sequence_position != null ? overrideByKey.get(`${version}|${s.sequence_position}`) : undefined;
    const day = ov ? catalogById.get(ov) ?? null : s.program_day != null ? catalogByDay.get(s.program_day) ?? null : null;
    const wd = s.workout_data ?? {};
    const n = (k: string) => (typeof wd[k] === "number" ? (wd[k] as number) : null);
    return {
      id: s.id,
      date: s.date,
      day_type: s.day_type ?? "unknown",
      modality: s.modality ?? "unknown",
      units: s.units,
      actual_pace: s.actual_pace != null ? Number(s.actual_pace) : null,
      target_pace: s.target_pace != null ? Number(s.target_pace) : null,
      total_work_seconds: n("total_work_time"),
      total_rest_seconds: n("total_rest_time"),
      intervals: n("total_intervals"),
      prescription: prescriptionFromCatalog(day),
    };
  });

  const { curve, sessions: results } = replayCurve(inputs, trials, curves);
  const regions = summarizeCurve(curve, results);
  // replayCurve returns results in date order (stable), so pair them with the
  // inputs sorted the same way.
  const ordered = [...inputs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byId = new Map(ordered.map((inp, idx) => [inp.id, results[idx]]));

  const evidence: Record<string, number> = {};
  for (const r of results) evidence[r.evidence] = (evidence[r.evidence] ?? 0) + 1;

  const wrote = { curve: false, sessions: 0 };
  if (opts.write) {
    const changed = sessions.flatMap((s) => {
      const r = byId.get(s.id)!;
      const row = {
        id: s.id,
        user_id: s.user_id,
        date: s.date,
        continuum_r: r.r != null ? Number(r.r.toFixed(4)) : null,
        continuum_effort_s: r.effort_seconds != null ? Math.round(r.effort_seconds) : null,
        continuum_bout_s: r.bout_seconds != null ? Math.round(r.bout_seconds) : null,
        continuum_sustain: r.sustain != null ? Number(r.sustain.toFixed(4)) : null,
        continuum_evidence: r.evidence,
      };
      const same = num(s.continuum_r) === row.continuum_r && num(s.continuum_effort_s) === row.continuum_effort_s &&
        num(s.continuum_bout_s) === row.continuum_bout_s && num(s.continuum_sustain) === row.continuum_sustain &&
        (s.continuum_evidence ?? null) === row.continuum_evidence;
      return same ? [] : [row];
    });
    for (let i = 0; i < changed.length; i += 200) {
      const { error } = await supa.from("engine_workout_sessions").upsert(changed.slice(i, i + 200), { onConflict: "id" });
      if (error) throw new Error(`session write failed for ${userId}: ${error.message}`);
    }
    wrote.sessions = changed.length;
    if (profile) {
      const stored = profile.engine_curve ?? null;
      const unchanged = stored && stored.module_version === CURVE_VERSION && sameCurve(stored, curve);
      if (!unchanged) {
        const { error } = await supa.from("athlete_profiles")
          .update({ engine_curve: { ...curve, computed_at: new Date().toISOString(), module_version: CURVE_VERSION } })
          .eq("user_id", userId);
        if (error) throw new Error(`curve write failed for ${userId}: ${error.message}`);
        wrote.curve = true;
      }
    }
  }

  return { user_id: userId, sessions: sessions.length, curve, regions, trials, results, evidence, wrote };
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sameCurve(a: EngineCurve, b: EngineCurve): boolean {
  if (a.as_of !== b.as_of || a.awaiting_right_anchor !== b.awaiting_right_anchor) return false;
  if (a.flags.length !== b.flags.length || a.flags.some((f, i) => f !== b.flags[i])) return false;
  if (a.nodes.length !== b.nodes.length) return false;
  return a.nodes.every((n, i) => {
    const o = b.nodes[i];
    return Number(n.seconds) === Number(o.seconds) && Number(n.m) === Number(o.m) && Number(n.conf) === Number(o.conf) && n.state === o.state;
  });
}

/** True when the stored curve is current: same module version and no completed session newer than it. */
export async function curveIsFresh(supa: SupabaseClient, userId: string): Promise<boolean> {
  const [{ data: prof }, { data: latest }] = await Promise.all([
    supa.from("athlete_profiles").select("engine_curve").eq("user_id", userId).maybeSingle(),
    supa.from("engine_workout_sessions").select("created_at").eq("user_id", userId).eq("completed", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const curve = (prof as { engine_curve?: StoredCurve | null } | null)?.engine_curve;
  return !!(curve?.computed_at && curve.module_version === CURVE_VERSION && latest?.created_at && latest.created_at <= curve.computed_at);
}
