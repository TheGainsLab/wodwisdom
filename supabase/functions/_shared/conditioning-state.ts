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
 * See docs/engine_competency_graph.md.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Competency-graph metadata (taxonomy, not judgment) ──────────────────────

export type EnergySystem = "AB" | "AP" | "LT" | "GL";
export type DayClass = "DEV" | "ASSESS" | "EXPR";

export interface DayTypeMeta {
  tier: number;
  systems: EnergySystem[]; // energy systems trained (phosphagen PH is primer-only → excluded)
  cls: DayClass;
  isRoot: boolean;
}

/** Per day-type tags. PH is intentionally absent: phosphagen is primer-only. */
export const DAY_TYPE_META: Record<string, DayTypeMeta> = {
  time_trial: { tier: 0, systems: [], cls: "ASSESS", isRoot: false },
  endurance: { tier: 1, systems: ["AB"], cls: "DEV", isRoot: true },
  max_aerobic_power: { tier: 1, systems: ["AP"], cls: "DEV", isRoot: true },
  threshold: { tier: 1, systems: ["LT"], cls: "DEV", isRoot: true },
  anaerobic: { tier: 1, systems: ["GL"], cls: "DEV", isRoot: true },
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
  last_4_ratios: unknown; // jsonb array
  learned_max_pace: number | null;
}

export interface TimeTrialRow {
  modality: string;
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
  rolling_avg_ratio: number | null; // mean of last 4 (actual ÷ target); 1.0 = on adaptive target
  last_4_ratios: number[]; // raw recent sequence, oldest→newest
  rolling_count: number; // sessions in the window (confidence)
  learned_max_pace: number | null; // best actual pace ever for this competency
}

/** Per-modality calibration — raw time-trial age; targets derive from it. */
export interface ModalityCalibration {
  modality: string;
  time_trial_age_days: number | null; // null = no current time trial
  baseline_rpm: number | null;
  baseline_delta_pct: number | null; // first→latest current TT, raw % change
}

export interface ConditioningDiagnosis {
  hasData: boolean;
  daysSinceLastSession: number | null;
  competencies: CompetencySignal[];
  calibration: ModalityCalibration[];
}

function computeCalibration(
  modalities: string[],
  timeTrials: TimeTrialRow[],
  now: Date,
): ModalityCalibration[] {
  const byModality = new Map<string, TimeTrialRow[]>();
  for (const tt of timeTrials) {
    const list = byModality.get(tt.modality) ?? [];
    list.push(tt);
    byModality.set(tt.modality, list);
  }
  return modalities.map((m) => {
    const trials = (byModality.get(m) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const current = trials.filter((t) => t.is_current).at(-1) ?? trials.at(-1);
    const first = num(trials[0]?.calculated_rpm);
    const latest = num(current?.calculated_rpm);
    const baseline_delta_pct =
      first && latest && first > 0 && trials.length > 1
        ? Math.round(((latest - first) / first) * 1000) / 10
        : null;
    return {
      modality: m,
      time_trial_age_days: current ? daysBetween(current.date, now) : null,
      baseline_rpm: latest,
      baseline_delta_pct,
    };
  });
}

/** Compute the raw structured diagnosis. Pure, day_type-keyed, no judgments. */
export function computeConditioningDiagnosis(inputs: ConditioningInputs): ConditioningDiagnosis {
  const now = inputs.now ?? new Date();
  const hasData =
    inputs.metrics.length > 0 || inputs.sessions.length > 0 || inputs.timeTrials.length > 0;

  let daysSinceLastSession: number | null = null;
  const dates = inputs.sessions.map((s) => s.date).filter(Boolean).sort();
  if (dates.length) daysSinceLastSession = daysBetween(dates[dates.length - 1], now);

  const competencies: CompetencySignal[] = inputs.metrics.map((m) => {
    const meta = DAY_TYPE_META[m.day_type];
    const last4 = Array.isArray(m.last_4_ratios)
      ? m.last_4_ratios.map(num).filter((x): x is number => x !== null)
      : [];
    return {
      day_type: m.day_type,
      modality: m.modality,
      systems: meta?.systems ?? [],
      is_root: meta?.isRoot ?? false,
      rolling_avg_ratio: num(m.rolling_avg_ratio),
      last_4_ratios: last4,
      rolling_count: m.rolling_count ?? 0,
      learned_max_pace: num(m.learned_max_pace),
    };
  });

  const modalities = Array.from(
    new Set([...inputs.metrics.map((m) => m.modality), ...inputs.timeTrials.map((t) => t.modality)]),
  );

  return {
    hasData,
    daysSinceLastSession,
    competencies,
    calibration: computeCalibration(modalities, inputs.timeTrials, now),
  };
}

// ─── Format (raw signals — no labels) ────────────────────────────────────────

const METRIC_EXPLAINER =
  "rolling_avg_ratio = mean of the athlete's last 4 (actual_pace ÷ target_pace) for that day_type+modality; " +
  "1.0 = exactly on their adaptive target, >1.0 beating it, <1.0 under it. last4 is the raw recent sequence " +
  "(oldest→newest). n = sessions in the window (confidence). max = best pace ever logged (units vary by modality). " +
  "No labels are applied — judge each system's state, its trend, recovery, and any need to recalibrate from the numbers yourself.";

export function formatConditioningState(inputs: ConditioningInputs): string {
  const diag = computeConditioningDiagnosis(inputs);
  if (!diag.hasData) return "";

  const parts: string[] = ["\n\nENGINE CONDITIONING SIGNALS (raw — interpret yourself)", METRIC_EXPLAINER];

  parts.push(
    `\nDays since last completed session: ${diag.daysSinceLastSession ?? "unknown"}`,
  );

  if (diag.competencies.length) {
    parts.push("\nCompetencies (day_type / modality — trains[systems], root?):");
    for (const c of diag.competencies) {
      const dt = c.day_type.replace(/_/g, " ");
      const mod = c.modality.replace(/_/g, " ");
      const sys = c.systems.length ? c.systems.join(",") : "—";
      const root = c.is_root ? " root" : "";
      const ratio = c.rolling_avg_ratio != null ? c.rolling_avg_ratio.toFixed(2) : "—";
      const last4 = c.last_4_ratios.length ? `[${c.last_4_ratios.map((x) => x.toFixed(2)).join(",")}]` : "[]";
      const max = c.learned_max_pace != null ? ` max ${c.learned_max_pace}` : "";
      parts.push(`- ${dt} / ${mod}  trains[${sys}]${root}  ratio ${ratio}  n${c.rolling_count}  last4 ${last4}${max}`);
    }
  }

  if (diag.calibration.length) {
    parts.push("\nCalibration (time-trial age per modality; all targets derive from it):");
    for (const c of diag.calibration) {
      const mod = c.modality.replace(/_/g, " ");
      if (c.time_trial_age_days == null) {
        parts.push(`- ${mod}: no current time trial — its targets are uncalibrated`);
      } else {
        const prog = c.baseline_delta_pct != null
          ? ` (${c.baseline_delta_pct >= 0 ? "+" : ""}${c.baseline_delta_pct}% over history)`
          : "";
        parts.push(`- ${mod}: ${c.time_trial_age_days}d old, baseline ${c.baseline_rpm ?? "?"}${prog}`);
      }
    }
  }

  parts.push("\nNote: the Engine does not train phosphagen/sprint power — do not infer it.");
  return parts.join("\n");
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
  opts?: { recentDays?: number },
): Promise<string> {
  const recentDays = opts?.recentDays ?? 90;
  const cutoff = new Date(Date.now() - recentDays * 86400000).toISOString().slice(0, 10);

  const [{ data: metrics }, { data: timeTrials }, { data: sessions }] = await Promise.all([
    supa
      .from("engine_user_performance_metrics")
      .select("day_type, modality, rolling_avg_ratio, rolling_count, last_4_ratios, learned_max_pace")
      .eq("user_id", userId),
    supa
      .from("engine_time_trials")
      .select("modality, calculated_rpm, date, is_current")
      .eq("user_id", userId)
      .order("date", { ascending: true }),
    supa
      .from("engine_workout_sessions")
      .select("date")
      .eq("user_id", userId)
      .eq("completed", true)
      .gte("date", cutoff)
      .order("date", { ascending: false }),
  ]);

  return formatConditioningState({
    metrics: (metrics as PerfMetricRow[]) ?? [],
    timeTrials: (timeTrials as TimeTrialRow[]) ?? [],
    sessions: (sessions as SessionRow[]) ?? [],
  });
}
