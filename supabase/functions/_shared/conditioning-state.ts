/**
 * buildConditioningState — backend-only prompt-context helper.
 *
 * Emits the athlete's Engine conditioning as RAW SIGNALS — the numbers the
 * adaptive engine already maintains, with no judgments baked in. No "strong /
 * lagging" labels, no thresholds, no RPE/HR (both unreliably logged). The AI
 * consuming this decides what's strong, lagging, fatigued, or needs
 * recalibration. The only non-numeric context is authored taxonomy (which
 * energy systems a day_type trains; whether it's a root) and a one-line
 * definition of the metric so the numbers are interpretable.
 *
 * Returns "" when the user has no Engine data (safe no-op). The compute core is
 * pure and unit-tested in conditioning-state_test.ts.
 *
 * Two audiences (Phase 1 of the continuum, 2026-11-17):
 *   - the Coach / workout review: this block + the analytics + the athlete's
 *     CONDITIONING CURVE (buildConditioningState);
 *   - the sequencer: the curve + days-since + adherence ONLY — the per-type
 *     ratio table and the analytics dump were dropped from its prompt
 *     (buildSequencerConditioning). See docs/conditioning_continuum_phase1_plan.md.
 *
 * See docs/engine_competency_graph.md.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type AnalyticsSession, type AnalyticsTrial, computeEngineAnalytics, formatEngineAnalytics } from "./engine-analytics.ts";
import { computeAthleteContinuum, loadCurves, type PdCurves, type StoredCurve } from "./engine-continuum-io.ts";
import { resetCutoff, sinceReset } from "./engine-reset.ts";
import { CURVE_GUIDE_FOR_COACH, ECHO_BIKE_CAL_CURVE_V1, type EngineCurve, formatCurveForPrompt, type PdCurvePoint, type ReplayResult, summarizeCurve, type TrialInput } from "./engine-continuum.ts";

// ─── Competency-graph metadata (taxonomy, not judgment) ──────────────────────

export type EnergySystem = "AB" | "AP" | "LT" | "GL";
export type DayClass = "DEV" | "ASSESS" | "EXPR";

export interface DayTypeMeta {
  tier: number;
  systems: EnergySystem[]; // energy systems trained (phosphagen PH is primer-only → excluded)
  cls: DayClass;
  isRoot: boolean;
  /** No pace target (max effort): the session ratio is actual pace ÷ the
   *  modality's time-trial baseline pace, not ÷ a target (2026-11-11). */
  maxEffort?: boolean;
}

/** Per day-type tags. PH is intentionally absent: phosphagen is primer-only. */
export const DAY_TYPE_META: Record<string, DayTypeMeta> = {
  time_trial: { tier: 0, systems: [], cls: "ASSESS", isRoot: false },
  endurance: { tier: 1, systems: ["AB"], cls: "DEV", isRoot: true },
  max_aerobic_power: { tier: 1, systems: ["AP"], cls: "DEV", isRoot: true },
  threshold: { tier: 1, systems: ["LT"], cls: "DEV", isRoot: true },
  anaerobic: { tier: 1, systems: ["GL"], cls: "DEV", isRoot: true, maxEffort: true },
  interval: { tier: 1, systems: ["AP", "LT", "GL"], cls: "DEV", isRoot: false },
  polarized: { tier: 1, systems: ["AB"], cls: "DEV", isRoot: false },
  flux: { tier: 2, systems: ["LT", "AB"], cls: "DEV", isRoot: false },
  flux_stages: { tier: 2, systems: ["LT"], cls: "DEV", isRoot: false },
  ascending: { tier: 2, systems: ["AP", "GL"], cls: "DEV", isRoot: false },
  rocket_races_a: { tier: 2, systems: [], cls: "DEV", isRoot: false },
  rocket_races_b: { tier: 2, systems: [], cls: "ASSESS", isRoot: false },
  hybrid_aerobic: { tier: 3, systems: ["AP"], cls: "DEV", isRoot: false },
  hybrid_anaerobic: { tier: 3, systems: ["GL"], cls: "DEV", isRoot: false },
  devour: { tier: 3, systems: ["AB", "LT"], cls: "DEV", isRoot: false },
  ascending_devour: { tier: 3, systems: ["AB", "LT"], cls: "DEV", isRoot: false },
  descending_devour: { tier: 3, systems: ["AB"], cls: "DEV", isRoot: false },
  atomic: { tier: 4, systems: ["AP"], cls: "DEV", isRoot: false },
  towers: { tier: 4, systems: ["AB", "AP"], cls: "DEV", isRoot: false },
  infinity: { tier: 4, systems: [], cls: "EXPR", isRoot: false },
  afterburner: { tier: 4, systems: ["GL", "AP"], cls: "EXPR", isRoot: false },
  synthesis: { tier: 4, systems: [], cls: "ASSESS", isRoot: false },
};

// ─── Input row shapes ────────────────────────────────────────────────────────

export interface PerfMetricRow {
  day_type: string;
  modality: string;
  rolling_avg_ratio: number | null;
  rolling_count: number;
  last_5_ratios: unknown; // jsonb array
  learned_max_pace: number | null;
}

export interface TimeTrialRow {
  modality: string;
  units: string | null;
  calculated_rpm: number | null;
  date: string;
  is_current: boolean;
}

export interface SessionRow {
  date: string;
}

export interface ConditioningInputs {
  metrics: PerfMetricRow[];
  timeTrials: TimeTrialRow[];
  sessions: SessionRow[];
  now?: Date;
  /** The program's cadence, for the adherence line (sessions done vs the
   *  cadence implies). Omitted → the count is reported without an expectation. */
  daysPerWeek?: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function daysBetween(a: string, b: Date): number {
  const d = new Date(a + "T00:00:00Z").getTime();
  return Math.round((b.getTime() - d) / 86400000);
}

// ─── Raw structured diagnosis (single source) ────────────────────────────────

/** One (day_type × modality) competency, raw — tags are taxonomy, not judgment. */
export interface CompetencySignal {
  day_type: string;
  modality: string;
  systems: EnergySystem[]; // which energy systems this day_type trains
  is_root: boolean; // a load-bearing energy-system primitive
  rolling_avg_ratio: number | null; // mean of last up-to-5 (actual ÷ target); 1.0 = on adaptive target
  last_5_ratios: number[]; // raw recent sequence, oldest→newest
  rolling_count: number; // sessions in the window (confidence)
  learned_max_pace: number | null; // best actual pace ever for this competency
}

/**
 * Per-(modality, units) calibration — raw time-trial age + baseline. Keyed by
 * units because calculated_rpm is an absolute pace and units (watts vs cals) put
 * a modality on different scales — they must never be compared.
 */
export interface ModalityCalibration {
  modality: string;
  units: string | null;
  time_trial_age_days: number | null; // null = no current time trial
  baseline_rpm: number | null;
  /** The last up-to-6 trials for this (modality, units), oldest→newest —
   *  whether the ruler itself has moved (founder, 2026-11-11; 3 → 6 on 2026-11-17). */
  history: { date: string; rpm: number }[];
}

export interface Adherence {
  sessions_last_28_days: number;
  sessions_last_90_days: number;
  /** cadence × 4, when the cadence is known */
  expected_last_28_days: number | null;
}

export interface ConditioningDiagnosis {
  hasData: boolean;
  daysSinceLastSession: number | null;
  adherence: Adherence;
  competencies: CompetencySignal[];
  calibration: ModalityCalibration[];
}

function computeCalibration(
  metricModalities: string[],
  timeTrials: TimeTrialRow[],
  now: Date,
): ModalityCalibration[] {
  // Key by (modality, units): calculated_rpm is an absolute pace, so a modality
  // logged in different units (echo bike watts vs calories) is a different scale —
  // never compare across units. Each unit gets its own baseline.
  const byKey = new Map<string, TimeTrialRow[]>();
  for (const tt of timeTrials) {
    const key = `${tt.modality}|${tt.units ?? ""}`;
    const list = byKey.get(key) ?? [];
    list.push(tt);
    byKey.set(key, list);
  }

  const out: ModalityCalibration[] = [];
  const modalitiesWithTrials = new Set<string>();
  for (const [key, trials] of byKey) {
    const [modality, units] = key.split("|");
    modalitiesWithTrials.add(modality);
    const sorted = trials.slice().sort((a, b) => a.date.localeCompare(b.date));
    // Only the active baseline. A retired trial (is_current=false, superseded by a
    // newer one — often after a unit switch) is NOT a live baseline; the runner
    // (loadTimeTrialBaselines) ignores it, so the diagnosis must too. No fallback:
    // if nothing is current for this (modality, units), report no baseline.
    const current = sorted.filter((t) => t.is_current).at(-1);
    const history = sorted
      .filter((t) => num(t.calculated_rpm) != null && (num(t.calculated_rpm) as number) > 0)
      .slice(-6)
      .map((t) => ({ date: t.date, rpm: num(t.calculated_rpm) as number }));
    out.push({
      modality,
      units: units || null,
      time_trial_age_days: current ? daysBetween(current.date, now) : null,
      baseline_rpm: num(current?.calculated_rpm),
      history,
    });
  }

  // Modalities trained (have metrics) but with no time trial at all → uncalibrated.
  for (const m of metricModalities) {
    if (!modalitiesWithTrials.has(m)) {
      out.push({ modality: m, units: null, time_trial_age_days: null, baseline_rpm: null, history: [] });
    }
  }
  return out;
}

/** Compute the raw structured diagnosis. Pure, day_type-keyed, no judgments. */
export function computeConditioningDiagnosis(inputs: ConditioningInputs): ConditioningDiagnosis {
  const now = inputs.now ?? new Date();
  const hasData =
    inputs.metrics.length > 0 || inputs.sessions.length > 0 || inputs.timeTrials.length > 0;

  let daysSinceLastSession: number | null = null;
  const dates = inputs.sessions.map((s) => s.date).filter(Boolean).sort();
  if (dates.length) daysSinceLastSession = daysBetween(dates[dates.length - 1], now);

  // Adherence (founder, 2026-11-11): sessions actually done vs what the
  // cadence implies. Raw counts; the model decides what eight-of-twelve means.
  const within = (days: number) => dates.filter((d) => daysBetween(d, now) <= days && daysBetween(d, now) >= 0).length;
  const adherence: Adherence = {
    sessions_last_28_days: within(28),
    sessions_last_90_days: within(90),
    expected_last_28_days: inputs.daysPerWeek && inputs.daysPerWeek > 0 ? inputs.daysPerWeek * 4 : null,
  };

  const competencies: CompetencySignal[] = inputs.metrics.map((m) => {
    const meta = DAY_TYPE_META[m.day_type];
    const recent = Array.isArray(m.last_5_ratios)
      ? m.last_5_ratios.map(num).filter((x): x is number => x !== null)
      : [];
    return {
      day_type: m.day_type,
      modality: m.modality,
      systems: meta?.systems ?? [],
      is_root: meta?.isRoot ?? false,
      rolling_avg_ratio: num(m.rolling_avg_ratio),
      last_5_ratios: recent,
      rolling_count: m.rolling_count ?? 0,
      learned_max_pace: num(m.learned_max_pace),
    };
  });

  const metricModalities = Array.from(new Set(inputs.metrics.map((m) => m.modality)));

  return {
    hasData,
    daysSinceLastSession,
    adherence,
    competencies,
    calibration: computeCalibration(metricModalities, inputs.timeTrials, now),
  };
}

// ─── Format (raw signals — no labels) ────────────────────────────────────────

const METRIC_EXPLAINER =
  "rolling_avg_ratio = mean of the athlete's last up-to-5 (actual_pace ÷ target_pace) for that day_type+modality; " +
  "1.0 = exactly on their adaptive target, >1.0 beating it, <1.0 under it. recent is the raw sequence " +
  "(oldest→newest). n = sessions in the window (confidence). max = best pace ever logged (units vary by modality). " +
  "MAX-EFFORT day types (marked 'vs baseline') have no target: their ratio is actual_pace ÷ the modality's " +
  "time-trial baseline pace — the athlete's all-out output relative to their own aerobic baseline (a trained athlete " +
  "sits well above 1.0; the trend across sessions is the signal). Each session's ratio uses the baseline in force " +
  "when it was logged, so a retest moves the scale and the series steps at that date — read the trend BETWEEN " +
  "retests, and use the trial history dates to place the steps. " +
  "No labels are applied — judge each system's state, its trend, recovery, and any need to recalibrate from the numbers yourself.";

export function formatConditioningState(inputs: ConditioningInputs): string {
  const diag = computeConditioningDiagnosis(inputs);
  if (!diag.hasData) return "";

  const parts: string[] = ["\n\nENGINE CONDITIONING SIGNALS (raw — interpret yourself)", METRIC_EXPLAINER];

  parts.push(
    `\nDays since last completed session: ${diag.daysSinceLastSession ?? "none in the lookback window (90 days)"}`,
  );
  const a = diag.adherence;
  parts.push(
    `Adherence: ${a.sessions_last_28_days} sessions in the last 28 days` +
      (a.expected_last_28_days != null ? ` (the program's cadence implies ${a.expected_last_28_days})` : "") +
      `; ${a.sessions_last_90_days} in the last 90.`,
  );

  if (diag.competencies.length) {
    parts.push("\nCompetencies (day_type / modality — trains[systems], root?):");
    for (const c of diag.competencies) {
      const dt = c.day_type.replace(/_/g, " ");
      const mod = c.modality.replace(/_/g, " ");
      const sys = c.systems.length ? c.systems.join(",") : "—";
      const root = c.is_root ? " root" : "";
      const vsBase = DAY_TYPE_META[c.day_type]?.maxEffort ? " vs baseline" : "";
      const ratio = (c.rolling_avg_ratio != null ? c.rolling_avg_ratio.toFixed(2) : "—") + vsBase;
      const recent = c.last_5_ratios.length ? `[${c.last_5_ratios.map((x) => x.toFixed(2)).join(",")}]` : "[]";
      const max = c.learned_max_pace != null ? ` max ${c.learned_max_pace}` : "";
      parts.push(`- ${dt} / ${mod}  trains[${sys}]${root}  ratio ${ratio}  n${c.rolling_count}  recent ${recent}${max}`);
    }
  }

  if (diag.calibration.length) {
    parts.push("\nCalibration (time-trial age per modality+units; all targets derive from it; 'trials' = the ruler's own history, oldest→newest):");
    for (const c of diag.calibration) {
      const mod = c.modality.replace(/_/g, " ") + (c.units ? ` (${c.units})` : "");
      if (c.time_trial_age_days == null) {
        parts.push(`- ${mod}: no current time trial — its targets are uncalibrated`);
      } else {
        const hist = c.history.length > 1
          ? ` · trials ${c.history.map((h) => `${h.rpm} (${h.date})`).join(" → ")}`
          : "";
        parts.push(`- ${mod}: ${c.time_trial_age_days}d old, baseline ${c.baseline_rpm ?? "?"}${hist}`);
      }
    }
  }

  parts.push("\nNote: the Engine does not train phosphagen/sprint power — do not infer it.");
  return parts.join("\n");
}

/** The sequencer's non-curve signals: days since the last session and
 *  adherence. No ratio table, no analytics (decided 2026-11-17). */
export function formatSequencerSignals(inputs: ConditioningInputs): string {
  const diag = computeConditioningDiagnosis(inputs);
  if (!diag.hasData) return "";
  const a = diag.adherence;
  return [
    `Days since last completed session: ${diag.daysSinceLastSession ?? "none in the lookback window (90 days)"}.`,
    `Adherence: ${a.sessions_last_28_days} sessions in the last 28 days` +
      (a.expected_last_28_days != null ? ` (the program's cadence implies ${a.expected_last_28_days})` : "") +
      `; ${a.sessions_last_90_days} in the last 90.`,
  ].join("\n");
}

// ─── The athlete's conditioning curve ────────────────────────────────────────

export interface ContinuumBlock {
  /** "" when the athlete has no Engine sessions */
  text: string;
  /** The reference curve of the athlete's primary machine (for the catalogue's "can reach" lines). */
  primaryCurve: PdCurvePoint[];
  primaryMachine: string | null;
}

const EMPTY_CONTINUUM: ContinuumBlock = { text: "", primaryCurve: ECHO_BIKE_CAL_CURVE_V1, primaryMachine: null };

/**
 * The athlete's conditioning curve as the prompt block (band table, trials,
 * flags). `refresh: true` (the sequencer) recomputes the athlete's curve inline
 * first — a session logged this morning is folded in — and writes it, so the
 * admin page agrees; if that fails it falls back to the stored curve (logged
 * loudly), never to "". `refresh: false` (the Coach, latency-sensitive) reads
 * what the daily tick stored.
 */
export async function buildContinuumBlock(supa: SupabaseClient, userId: string, opts: { refresh: boolean; write?: boolean; positions?: boolean }): Promise<ContinuumBlock> {
  let curves: PdCurves | null = null;
  let refreshFailed = false;
  if (opts.refresh) {
    try {
      curves = await loadCurves(supa);
      // write:false computes the same fresh curve and stores nothing (a dry run).
      const r = await computeAthleteContinuum(supa, userId, curves, { write: opts.write !== false });
      if (!r) return EMPTY_CONTINUUM;
      const primary = primaryMachine(r.trials, r.results.map((x) => `${x.modality}|${x.units ?? ""}`), curves);
      return { text: formatCurveForPrompt(r.curve, r.regions, r.trials, { positions: opts.positions }), ...primary };
    } catch (err) {
      refreshFailed = true;
      console.error(JSON.stringify({ tag: "continuum_refresh_failed", user: userId, error: err instanceof Error ? err.message : String(err) }));
    }
  }
  // The stored curve (daily tick / admin button / a successful earlier refresh).
  const [{ data: prof }, { data: sess }, { data: tts }, loaded] = await Promise.all([
    supa.from("athlete_profiles").select("engine_curve, engine_reset_at").eq("user_id", userId).maybeSingle(),
    supa.from("engine_workout_sessions").select("date, modality, units, continuum_effort_s, continuum_sustain, continuum_evidence, created_at").eq("user_id", userId).eq("completed", true),
    supa.from("engine_time_trials").select("modality, units, calculated_rpm, date, created_at").eq("user_id", userId).not("calculated_rpm", "is", null),
    curves ? Promise.resolve(curves) : loadCurves(supa).catch(() => ({} as PdCurves)),
  ]);
  const stored = (prof as { engine_curve?: StoredCurve | null } | null)?.engine_curve ?? null;
  if (!stored?.nodes) return EMPTY_CONTINUUM;
  // Engine reset (2026-11-21): the stored curve of a reset athlete is built
  // from sessions and trials since the reset only; describe it with the same.
  const resetAt = resetCutoff((prof as { engine_reset_at?: unknown } | null)?.engine_reset_at);
  const rows = sinceReset((sess ?? []) as Array<{ date: string; modality: string | null; units: string | null; continuum_effort_s: number | null; continuum_sustain: number | null; continuum_evidence: string | null; created_at: string | null }>, resetAt);
  // summarizeCurve reads date / evidence / effort_seconds / sustain only
  const results = rows.map((x) => ({
    date: x.date,
    effort_seconds: x.continuum_effort_s,
    sustain: x.continuum_sustain != null ? Number(x.continuum_sustain) : null,
    evidence: (x.continuum_evidence ?? "no_curve") as ReplayResult["sessions"][number]["evidence"],
  })) as unknown as ReplayResult["sessions"];
  const machines = rows.map((x) => `${x.modality ?? "unknown"}|${x.units ?? ""}`);
  const trials: TrialInput[] = sinceReset((tts ?? []) as Array<{ modality: string; units: string | null; calculated_rpm: number; date: string; created_at: string | null }>, resetAt)
    .map((t) => ({ modality: t.modality, units: t.units, pace: Number(t.calculated_rpm), date: t.date }));
  // A stored curve can carry an UNCALIBRATED flag for a machine that HAS a
  // time trial: curves computed before 2026-11-26 raised it for any session
  // logged ahead of the first trial, and a stored curve is only recomputed
  // when the athlete next trains. The trials are loaded right here, so a flag
  // they contradict is never passed on (2026-11-26: bad information from the
  // coach costs the member's trust).
  const storedFlags = currentUncalibratedOnly(stored.flags ?? [], trials);
  const curve: EngineCurve = { version: stored.version, nodes: stored.nodes, flags: storedFlags, as_of: stored.as_of ?? null, awaiting_right_anchor: stored.awaiting_right_anchor ?? false };
  const regions = summarizeCurve(curve, results);
  const primary = primaryMachine(trials, machines, loaded);
  const text = formatCurveForPrompt(curve, regions, trials, { positions: opts.positions }) + (refreshFailed ? "\n(stored curve — inline refresh failed; see the function log)" : "");
  return { text, ...primary };
}

/** Stored flags with any UNCALIBRATED:<machine|unit> removed when that machine
 *  and unit has a time trial. Every other flag is passed through untouched. */
export function currentUncalibratedOnly(flags: string[], trials: Array<{ modality: string; units: string | null }>): string[] {
  const withTrial = new Set(trials.map((t) => `${t.modality}|${t.units ?? ""}`));
  return flags.filter((f) => !(f.startsWith("UNCALIBRATED:") && withTrial.has(f.slice("UNCALIBRATED:".length))));
}

/** The machine the athlete is sequenced on: the most recent trial's machine
 *  that has a reference curve; else the most-trained machine with one; else
 *  the Echo. */
function primaryMachine(trials: TrialInput[], sessionMachines: string[], curves: PdCurves): { primaryCurve: PdCurvePoint[]; primaryMachine: string | null } {
  const latestTrial = [...trials].sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => `${t.modality}|${t.units ?? ""}`).find((k) => curves[k]);
  if (latestTrial) return { primaryCurve: curves[latestTrial], primaryMachine: latestTrial };
  const counts = new Map<string, number>();
  for (const m of sessionMachines) if (curves[m]) counts.set(m, (counts.get(m) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (top) return { primaryCurve: curves[top], primaryMachine: top };
  return { primaryCurve: ECHO_BIKE_CAL_CURVE_V1, primaryMachine: null };
}

// ─── Fetch wrapper ───────────────────────────────────────────────────────────

/**
 * Fetches Engine performance metrics, time trials and recent session dates, then
 * formats the raw conditioning-signal block. Pure day_type-keyed — correct for
 * every program variant and reusable across AI features. "" for users with no data.
 */
export async function buildConditioningState(
  supa: SupabaseClient,
  userId: string,
  opts?: { recentDays?: number; daysPerWeek?: number | null; curve?: "stored" | "fresh" | "fresh_unsaved"; forAssessment?: boolean },
): Promise<string> {
  // recentDays bounds the days-since / adherence windows only; the analytics
  // block (below) and the session list use every completed session, as the
  // athlete's Analytics page does.
  const recentDays = opts?.recentDays ?? 90;
  const cutoff = new Date(Date.now() - recentDays * 86400000).toISOString().slice(0, 10);

  const [metricsRes, ttRes, sessRes] = await Promise.all([
    supa
      .from("engine_user_performance_metrics")
      .select("day_type, modality, rolling_avg_ratio, rolling_count, last_5_ratios, learned_max_pace")
      .eq("user_id", userId),
    supa
      .from("engine_time_trials")
      .select("modality, units, calculated_rpm, date, is_current")
      .eq("user_id", userId)
      .order("date", { ascending: true }),
    supa
      .from("engine_workout_sessions")
      .select("date, day_type, modality, units, actual_pace, target_pace, total_output, performance_ratio, perceived_exertion, average_heart_rate, peak_heart_rate, workout_data")
      .eq("user_id", userId)
      .eq("completed", true)
      .order("date", { ascending: false }),
  ]);

  // LOUD on fetch failure — never an empty diagnosis. A schema drift on this
  // exact query (a stale 4-window column name vs production's last_5_ratios)
  // once blinded the sequencer's primary signal for every athlete, silently,
  // because errors were swallowed into `data: null`. Throw; soft-fail
  // consumers (chat, workout-review) catch at their call sites, hard
  // consumers (resequence) surface it as a real error.
  for (const [name, res] of [["performance_metrics", metricsRes], ["time_trials", ttRes], ["sessions", sessRes]] as const) {
    if (res.error) {
      throw new Error(`[conditioning-state] ${name} fetch failed: ${res.error.message}`);
    }
  }
  const metrics = metricsRes.data;
  const timeTrials = ttRes.data;
  const sessions = sessRes.data;

  const allSessions = (sessions as AnalyticsSession[]) ?? [];
  const signals = formatConditioningState({
    metrics: (metrics as PerfMetricRow[]) ?? [],
    timeTrials: (timeTrials as TimeTrialRow[]) ?? [],
    sessions: allSessions.filter((s) => s.date >= cutoff),
    daysPerWeek: opts?.daysPerWeek ?? null,
  });
  // ONE CALCULATION (founder, 2026-11-11): the sequencer and the Coach see
  // exactly the analytics the athlete sees, computed by the same module as
  // the Analytics page (engine-analytics.ts).
  const analytics = formatEngineAnalytics(
    computeEngineAnalytics(allSessions, ((timeTrials as AnalyticsTrial[]) ?? [])),
  );
  // The Coach reads the athlete's conditioning curve too (founder, 2026-11-17);
  // the stored one — chat is latency-sensitive and the daily tick keeps it fresh.
  // A caller that is not latency-sensitive (the Engine assessment) asks for
  // the curve recomputed now, stored or not.
  const curveMode = opts?.curve ?? "stored";
  const continuum = await buildContinuumBlock(supa, userId, { refresh: curveMode !== "stored", write: curveMode === "fresh", positions: true });
  // Every reader gets the position labels. A coach talking to the athlete also
  // gets the guide to the curve and its flags; the assessment's own
  // instructions carry it, so it is not repeated there.
  const guide = continuum.text && !opts?.forAssessment ? "\n" + CURVE_GUIDE_FOR_COACH : "";
  return signals + analytics + (continuum.text ? "\n\n" + continuum.text + guide : "");
}

/**
 * What the SEQUENCER reads (Phase 1): the athlete's conditioning curve, then
 * days since the last session and adherence. Nothing else — the per-type ratio
 * table and the analytics dump are gone from its prompt. `text` is "" when the
 * athlete has no Engine data.
 */
export async function buildSequencerConditioning(
  supa: SupabaseClient,
  userId: string,
  opts?: { recentDays?: number; daysPerWeek?: number | null },
): Promise<ContinuumBlock> {
  const recentDays = opts?.recentDays ?? 90;
  const cutoff = new Date(Date.now() - recentDays * 86400000).toISOString().slice(0, 10);
  const [continuum, sessRes] = await Promise.all([
    buildContinuumBlock(supa, userId, { refresh: true }),
    supa.from("engine_workout_sessions").select("date").eq("user_id", userId).eq("completed", true).gte("date", cutoff),
  ]);
  if (sessRes.error) throw new Error(`[conditioning-state] sessions fetch failed: ${sessRes.error.message}`);
  const signals = formatSequencerSignals({ metrics: [], timeTrials: [], sessions: (sessRes.data ?? []) as SessionRow[], daysPerWeek: opts?.daysPerWeek ?? null });
  if (!continuum.text && !signals) return continuum;
  const text = [continuum.text, signals].filter(Boolean).join("\n");
  return { ...continuum, text };
}
