/**
 * engine-analytics — ONE calculation of the Engine analytics (founder ruling
 * 2026-11-11: "the sequencer should see everything analytics sees, and it
 * should be one calculation"). Pure functions over session + time-trial rows,
 * no I/O, no imports. Consumed by:
 *   - src/pages/EngineAnalyticsPage.tsx (what the athlete sees)
 *   - _shared/conditioning-state.ts      (what the sequencer and Coach see)
 * The formulas here were moved verbatim from the analytics page; change them
 * here and both consumers change together.
 *
 * Deliberately NOT here (founder rulings): per-interval scores, and any
 * comparison to other athletes — every number is the athlete vs themselves.
 */

export interface AnalyticsSession {
  date: string;
  day_type: string | null;
  modality: string | null;
  units: string | null;
  actual_pace: number | null;
  target_pace?: number | null;
  total_output: number | null;
  performance_ratio: number | null;
  perceived_exertion?: number | null;
  average_heart_rate?: number | null;
  peak_heart_rate?: number | null;
  workout_data?: Record<string, unknown> | null;
}

export interface AnalyticsTrial {
  modality: string;
  units: string | null;
  date: string;
  calculated_rpm: number | null;
  total_output?: number | null;
}

// ─── Row helpers (moved from the page) ──────────────────────────────────────

/** Pace for a session: the logged pace, else output over total work time. */
export function calculatePace(s: AnalyticsSession): number | null {
  if (s.actual_pace) return s.actual_pace;
  const wd = s.workout_data ?? null;
  const tws = wd?.total_work_seconds;
  if (s.total_output && typeof tws === "number" && tws > 0) {
    return s.total_output / (tws / 60);
  }
  return null;
}

/** Work:rest decimal → the label analytics groups by. */
export function formatWorkRestRatio(decimal: number): string {
  if (decimal >= 2.7) return "3:1";
  if (decimal >= 1.7) return "2:1";
  if (decimal >= 1.3) return "3:2";
  if (decimal >= 0.9) return "1:1";
  if (decimal >= 0.6) return "2:3";
  if (decimal >= 0.4) return "1:2";
  return "1:3";
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const regular = (sessions: AnalyticsSession[]) => sessions.filter((s) => s.day_type !== "time_trial");
const latestTrialPace = (trials: AnalyticsTrial[], modality: string): number | null => {
  const t = trials
    .filter((x) => x.modality === modality && x.calculated_rpm && x.calculated_rpm > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return t?.calculated_rpm ?? null;
};

// ─── Overview ───────────────────────────────────────────────────────────────

export interface Overview {
  sessions: number;            // all completed, time trials included
  workouts: number;            // regular (non time trial)
  time_trials: number;
  avg_performance: number | null; // mean performance_ratio over sessions that have one
  avg_rpe: number | null;
  rpe_count: number;
  by_modality: { modality: string; count: number }[];
  by_day_type: { day_type: string; count: number }[];
}

export function overview(sessions: AnalyticsSession[], trials: AnalyticsTrial[]): Overview {
  const reg = regular(sessions);
  const ratios = reg.filter((s) => s.performance_ratio != null && s.performance_ratio > 0).map((s) => s.performance_ratio as number);
  const rpes = reg.filter((s) => s.perceived_exertion != null && s.perceived_exertion > 0).map((s) => s.perceived_exertion as number);
  const count = (key: (s: AnalyticsSession) => string | null) => {
    const m = new Map<string, number>();
    for (const s of reg) { const k = key(s) ?? "unknown"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  return {
    sessions: sessions.length,
    workouts: reg.length,
    time_trials: trials.length,
    avg_performance: mean(ratios),
    avg_rpe: mean(rpes),
    rpe_count: rpes.length,
    by_modality: count((s) => s.modality).map(([modality, c]) => ({ modality, count: c })),
    by_day_type: count((s) => s.day_type).map(([day_type, c]) => ({ day_type, count: c })),
  };
}

// ─── Energy System Paces (per modality) ─────────────────────────────────────

export interface EnergySystemPaces {
  glycolytic: number | null; // mean anaerobic pace ÷ latest time-trial pace
  aerobic: number | null;    // mean max_aerobic_power pace ÷ latest time-trial pace
  systems: number | null;    // mean anaerobic pace ÷ mean max_aerobic_power pace
  peak: number | null;       // best pace across sessions and trials
  average: number | null;    // mean pace across sessions and trials
  units: string;
}

export function energySystemPaces(sessions: AnalyticsSession[], trials: AnalyticsTrial[], modality: string): EnergySystemPaces {
  const reg = regular(sessions);
  const paces = (dt: string) => reg.filter((s) => s.day_type === dt && s.modality === modality && s.actual_pace && s.actual_pace > 0).map((s) => s.actual_pace as number);
  const anaerobicAvg = mean(paces("anaerobic"));
  const maxAerobicAvg = mean(paces("max_aerobic_power"));
  const ttPace = latestTrialPace(trials, modality);
  const modSessions = reg.filter((s) => s.modality === modality && s.actual_pace && s.actual_pace > 0);
  const modTrials = trials.filter((t) => t.modality === modality && t.calculated_rpm && t.calculated_rpm > 0);
  const all = [...modSessions.map((s) => s.actual_pace as number), ...modTrials.map((t) => t.calculated_rpm as number)].filter((p) => p > 0);
  return {
    glycolytic: anaerobicAvg && ttPace ? anaerobicAvg / ttPace : null,
    aerobic: maxAerobicAvg && ttPace ? maxAerobicAvg / ttPace : null,
    systems: anaerobicAvg && maxAerobicAvg ? anaerobicAvg / maxAerobicAvg : null,
    peak: all.length ? Math.max(...all) : null,
    average: mean(all),
    units: modSessions[0]?.units ?? modTrials[0]?.units ?? "cal",
  };
}

// ─── Personal Records (per modality, best output per day type) ──────────────

export interface PersonalRecord { day_type: string; pace: number; output: number; units: string; date: string }

export function personalRecords(sessions: AnalyticsSession[], modality: string): PersonalRecord[] {
  const best = new Map<string, AnalyticsSession>();
  for (const s of regular(sessions)) {
    if (s.modality !== modality || !s.day_type || !s.total_output) continue;
    const cur = best.get(s.day_type);
    if (!cur || (s.total_output ?? 0) > (cur.total_output ?? 0)) best.set(s.day_type, s);
  }
  return [...best.entries()]
    .map(([day_type, s]) => ({ day_type, pace: calculatePace(s) ?? 0, output: s.total_output ?? 0, units: s.units ?? "", date: s.date }))
    .sort((a, b) => b.pace - a.pace);
}

// ─── Comparisons (per modality: per day type averages) ──────────────────────

export interface DayTypeComparison { day_type: string; count: number; avg_output: number; avg_pace: number; units: string }

export function comparisons(sessions: AnalyticsSession[], modality: string, dayTypes?: string[]): DayTypeComparison[] {
  const reg = regular(sessions).filter((s) => s.modality === modality && s.total_output);
  const types = dayTypes ?? [...new Set(reg.map((s) => s.day_type).filter((d): d is string => !!d))].sort();
  return types.map((dt) => {
    const dtSessions = reg.filter((s) => s.day_type === dt);
    if (dtSessions.length === 0) return null;
    const avgOutput = (mean(dtSessions.map((s) => s.total_output ?? 0)) ?? 0);
    const withPace = dtSessions.filter((s) => s.actual_pace && s.actual_pace > 0).map((s) => s.actual_pace as number);
    return { day_type: dt, count: dtSessions.length, avg_output: avgOutput, avg_pace: mean(withPace) ?? 0, units: dtSessions[0].units ?? "" };
  }).filter((x): x is DayTypeComparison => x !== null);
}

// ─── Targets vs Actual (per modality: per day type mean ratio) ──────────────

export interface TargetSummary { day_type: string; count: number; avg_ratio: number }

export function targetsVsActual(sessions: AnalyticsSession[], modality: string): TargetSummary[] {
  const m = new Map<string, number[]>();
  for (const s of regular(sessions)) {
    if (s.modality !== modality || !s.day_type || s.performance_ratio == null || s.performance_ratio <= 0) continue;
    m.set(s.day_type, [...(m.get(s.day_type) ?? []), s.performance_ratio]);
  }
  return [...m.entries()].map(([day_type, rs]) => ({ day_type, count: rs.length, avg_ratio: mean(rs) as number })).sort((a, b) => a.day_type.localeCompare(b.day_type));
}

// ─── HR analytics (per modality: per day type) ──────────────────────────────

export interface HeartRateStats {
  day_type: string;
  sessions: number;        // sessions on this type with any HR logged
  avg_hr: number | null;
  avg_peak_hr: number | null;
  max_peak_hr: number | null;
  efficiency: number | null;    // mean of (pace ÷ avg HR) × 1000
  training_load: number | null; // mean of intensity³ × avg HR × √(work minutes)
}

/** `modality` empty/null = all machines (the page's unselected state); the baseline is then per session's own machine. */
export function heartRate(sessions: AnalyticsSession[], trials: AnalyticsTrial[], modality: string | null): HeartRateStats[] {
  const reg = regular(sessions).filter((s) => (!modality || s.modality === modality) && (s.average_heart_rate || s.peak_heart_rate));
  const types = [...new Set(reg.map((s) => s.day_type).filter((d): d is string => !!d))].sort();
  return types.map((dt) => {
    const dtSessions = reg.filter((s) => s.day_type === dt);
    const avgHRs = dtSessions.filter((s) => s.average_heart_rate).map((s) => s.average_heart_rate as number);
    const peakHRs = dtSessions.filter((s) => s.peak_heart_rate).map((s) => s.peak_heart_rate as number);
    const efficiencies: number[] = []; const loads: number[] = [];
    for (const s of dtSessions) {
      const pace = calculatePace(s); const avgHR = s.average_heart_rate;
      const tws = s.workout_data?.total_work_seconds;
      const durMin = typeof tws === "number" ? tws / 60 : 0;
      if (pace && avgHR && avgHR > 0) {
        efficiencies.push((pace / avgHR) * 1000);
        const baseline = latestTrialPace(trials, s.modality ?? "");
        const intensity = baseline && baseline > 0 ? pace / baseline : 1;
        loads.push(Math.pow(intensity, 3) * avgHR * Math.sqrt(durMin || 1));
      }
    }
    return {
      day_type: dt, sessions: dtSessions.length,
      avg_hr: mean(avgHRs), avg_peak_hr: mean(peakHRs), max_peak_hr: peakHRs.length ? Math.max(...peakHRs) : null,
      efficiency: mean(efficiencies), training_load: mean(loads),
    };
  });
}

// ─── Work:Rest tolerance (per modality: pace by ratio bucket) ───────────────

export interface WorkRestStat { ratio: string; count: number; avg_pace: number; units: string }

export function workRest(sessions: AnalyticsSession[], modality: string, ratios?: string[]): WorkRestStat[] {
  const groups = new Map<string, AnalyticsSession[]>();
  for (const s of regular(sessions)) {
    const wr = s.workout_data?.avg_work_rest_ratio;
    if (s.modality !== modality || typeof wr !== "number" || !wr || !s.actual_pace) continue;
    const label = formatWorkRestRatio(wr);
    if (ratios && !ratios.includes(label)) continue;
    groups.set(label, [...(groups.get(label) ?? []), s]);
  }
  return [...groups.entries()]
    .map(([ratio, list]) => ({ ratio, count: list.length, avg_pace: mean(list.map((s) => s.actual_pace as number)) as number, units: list[0].units ?? "" }))
    .sort((a, b) => b.avg_pace - a.avg_pace);
}

/** The ratio labels present for a modality (the page's pill list). */
export function availableWorkRestRatios(sessions: AnalyticsSession[], modality: string): string[] {
  const set = new Set<string>();
  for (const s of regular(sessions)) {
    const wr = s.workout_data?.avg_work_rest_ratio;
    if (s.modality === modality && typeof wr === "number" && wr) set.add(formatWorkRestRatio(wr));
  }
  return [...set].sort();
}

// ─── Everything, per modality — what the sequencer receives ─────────────────

export interface ModalityAnalytics {
  modality: string;
  energy: EnergySystemPaces;
  records: PersonalRecord[];
  comparisons: DayTypeComparison[];
  targets: TargetSummary[];
  heart_rate: HeartRateStats[];
  work_rest: WorkRestStat[];
}

export interface EngineAnalyticsSummary {
  overview: Overview;
  modalities: ModalityAnalytics[];
}

export function computeEngineAnalytics(sessions: AnalyticsSession[], trials: AnalyticsTrial[]): EngineAnalyticsSummary {
  const mods = [...new Set(regular(sessions).map((s) => s.modality).filter((m): m is string => !!m))].sort();
  return {
    overview: overview(sessions, trials),
    modalities: mods.map((modality) => ({
      modality,
      energy: energySystemPaces(sessions, trials, modality),
      records: personalRecords(sessions, modality),
      comparisons: comparisons(sessions, modality),
      targets: targetsVsActual(sessions, modality),
      heart_rate: heartRate(sessions, trials, modality),
      work_rest: workRest(sessions, modality),
    })),
  };
}

const f2 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
const f1 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));
const f0 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(0));
const label = (s: string) => s.replace(/_/g, " ");

/** The analytics as prompt text: the same numbers the athlete sees, per machine. Empty string when there is nothing. */
export function formatEngineAnalytics(a: EngineAnalyticsSummary): string {
  if (a.overview.workouts === 0 && a.overview.time_trials === 0) return "";
  const o = a.overview;
  const parts: string[] = [
    "\n\nENGINE ANALYTICS (the same numbers the athlete sees on their Analytics page; every figure is the athlete vs themselves)",
    `Overview: ${o.workouts} workouts, ${o.time_trials} time trials; avg performance ratio ${f2(o.avg_performance)}; avg RPE ${f1(o.avg_rpe)} (n${o.rpe_count}).`,
    `Sessions by day type: ${o.by_day_type.map((x) => `${label(x.day_type)} ${x.count}`).join(", ") || "—"}.`,
    `Sessions by equipment: ${o.by_modality.map((x) => `${label(x.modality)} ${x.count}`).join(", ") || "—"}.`,
  ];
  for (const m of a.modalities) {
    parts.push(`\n${label(m.modality)}:`);
    const e = m.energy;
    parts.push(`- energy system paces (${e.units}/min): anaerobic÷trial ${f2(e.glycolytic)}, max aerobic÷trial ${f2(e.aerobic)}, anaerobic÷max aerobic ${f2(e.systems)}; peak ${f1(e.peak)}, avg ${f1(e.average)}`);
    if (m.comparisons.length) parts.push(`- by day type (n, avg output, avg pace): ${m.comparisons.map((c) => `${label(c.day_type)} n${c.count} ${f1(c.avg_output)} ${c.units} ${f1(c.avg_pace)}/min`).join("; ")}`);
    if (m.targets.length) parts.push(`- targets vs actual (all-time avg ratio): ${m.targets.map((t) => `${label(t.day_type)} ${f2(t.avg_ratio)} n${t.count}`).join("; ")}`);
    if (m.records.length) parts.push(`- personal records (best output): ${m.records.map((r) => `${label(r.day_type)} ${f1(r.output)} ${r.units} (${f1(r.pace)}/min, ${r.date})`).join("; ")}`);
    if (m.work_rest.length) parts.push(`- pace by work:rest (density tolerance): ${m.work_rest.map((w) => `${w.ratio} ${f1(w.avg_pace)}/min n${w.count}`).join("; ")}`);
    if (m.heart_rate.length) parts.push(`- heart rate (when logged): ${m.heart_rate.map((h) => `${label(h.day_type)} n${h.sessions} avg ${f0(h.avg_hr)} peak ${f0(h.avg_peak_hr)} max ${f0(h.max_peak_hr)} eff ${f1(h.efficiency)} load ${f0(h.training_load)}`).join("; ")}`);
  }
  return parts.join("\n");
}
