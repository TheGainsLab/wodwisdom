/**
 * buildConditioningState — backend-only prompt-context helper.
 *
 * Rolls the ~20 stored per-competency mastery scores
 * (engine_user_performance_metrics) into a compact, AI-readable summary of
 * the athlete's conditioning, in the program's own vocabulary. See
 * docs/engine_competency_graph.md and docs/conditioning_state_spec.md.
 *
 * Returns "" when the user has no Engine data, so it is a safe no-op for
 * non-Engine users. No UI, no schema change — the only effect is a smarter
 * AI coach.
 *
 * The computation/formatting core is pure (no I/O) and unit-tested in
 * conditioning-state_test.ts; buildConditioningState() is the thin fetch wrapper.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Competency-graph metadata (mirrors docs/engine_competency_graph.md) ─────

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
  // Tier 1 — foundation primitives
  endurance: { tier: 1, systems: ["AB"], cls: "DEV", isRoot: true },
  max_aerobic_power: { tier: 1, systems: ["AP"], cls: "DEV", isRoot: true },
  threshold: { tier: 1, systems: ["LT"], cls: "DEV", isRoot: true },
  anaerobic: { tier: 1, systems: ["GL"], cls: "DEV", isRoot: true },
  interval: { tier: 1, systems: ["AP", "LT", "GL"], cls: "DEV", isRoot: false },
  polarized: { tier: 1, systems: ["AB"], cls: "DEV", isRoot: false },
  // Tier 2 — bridges
  flux: { tier: 2, systems: ["LT", "AB"], cls: "DEV", isRoot: false },
  flux_stages: { tier: 2, systems: ["LT"], cls: "DEV", isRoot: false },
  ascending: { tier: 2, systems: ["AP", "GL"], cls: "DEV", isRoot: false },
  rocket_races_a: { tier: 2, systems: [], cls: "DEV", isRoot: false },
  rocket_races_b: { tier: 2, systems: [], cls: "ASSESS", isRoot: false },
  // Tier 3 — integration / durability
  hybrid_aerobic: { tier: 3, systems: ["AP"], cls: "DEV", isRoot: false },
  hybrid_anaerobic: { tier: 3, systems: ["GL"], cls: "DEV", isRoot: false },
  devour: { tier: 3, systems: ["AB", "LT"], cls: "DEV", isRoot: false },
  ascending_devour: { tier: 3, systems: ["AB", "LT"], cls: "DEV", isRoot: false },
  descending_devour: { tier: 3, systems: ["AB"], cls: "DEV", isRoot: false },
  // Tier 4 — expression / assessment
  atomic: { tier: 4, systems: ["AP"], cls: "DEV", isRoot: false },
  towers: { tier: 4, systems: ["AB", "AP"], cls: "DEV", isRoot: false },
  infinity: { tier: 4, systems: [], cls: "EXPR", isRoot: false },
  afterburner: { tier: 4, systems: ["GL", "AP"], cls: "EXPR", isRoot: false },
  synthesis: { tier: 4, systems: [], cls: "ASSESS", isRoot: false },
};

export const ROOT_BY_SYSTEM: Record<EnergySystem, string> = {
  AB: "endurance",
  AP: "max_aerobic_power",
  LT: "threshold",
  GL: "anaerobic",
};

export const SYSTEM_LABEL: Record<EnergySystem, string> = {
  AB: "Aerobic base",
  AP: "Aerobic power",
  LT: "Lactate threshold",
  GL: "Glycolytic",
};

// Thresholds
const STRONG = 1.04;
const LAGGING = 0.97;
const WEAK_ROOT = 0.95;
const MIN_CONFIDENCE = 2; // rolling_count below this → don't diagnose
const DEFAULT_STALE_DAYS = 40; // TT cadence is ~20 days

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
  day_type: string | null;
  modality: string | null;
  performance_ratio: number | null;
  perceived_exertion: number | null;
}

export interface ConditioningInputs {
  metrics: PerfMetricRow[];
  timeTrials: TimeTrialRow[];
  sessions: SessionRow[];
  now?: Date;
  staleAfterDays?: number;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function daysBetween(a: string, b: Date): number {
  const d = new Date(a + "T00:00:00Z").getTime();
  return Math.round((b.getTime() - d) / 86400000);
}

export function trendOf(last4: unknown): "rising" | "flat" | "falling" | null {
  const arr = Array.isArray(last4)
    ? last4.map(num).filter((x): x is number => x !== null)
    : [];
  if (arr.length < 2) return null;
  const delta = arr[arr.length - 1] - arr[0];
  if (delta > 0.03) return "rising";
  if (delta < -0.03) return "falling";
  return "flat";
}

export type CalStatus = "current" | "stale" | "uncalibrated";

export interface ModalityCalibration {
  modality: string;
  status: CalStatus;
  ageDays: number | null;
  rpm: number | null;
  baselineDeltaPct: number | null; // first → latest current rpm, all trials
}

/** Per-modality calibration gate + baseline progression. */
export function computeCalibration(
  modalities: string[],
  timeTrials: TimeTrialRow[],
  now: Date,
  staleAfterDays: number,
): Map<string, ModalityCalibration> {
  const byModality = new Map<string, TimeTrialRow[]>();
  for (const tt of timeTrials) {
    const list = byModality.get(tt.modality) ?? [];
    list.push(tt);
    byModality.set(tt.modality, list);
  }
  const out = new Map<string, ModalityCalibration>();
  for (const m of modalities) {
    const trials = (byModality.get(m) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const current = trials.filter((t) => t.is_current).at(-1) ?? trials.at(-1);
    if (!current) {
      out.set(m, { modality: m, status: "uncalibrated", ageDays: null, rpm: null, baselineDeltaPct: null });
      continue;
    }
    const ageDays = daysBetween(current.date, now);
    const first = num(trials[0]?.calculated_rpm);
    const latest = num(current.calculated_rpm);
    const baselineDeltaPct =
      first && latest && first > 0 && trials.length > 1
        ? Math.round(((latest - first) / first) * 1000) / 10
        : null;
    out.set(m, {
      modality: m,
      status: ageDays > staleAfterDays ? "stale" : "current",
      ageDays,
      rpm: latest,
      baselineDeltaPct,
    });
  }
  return out;
}

export interface SystemStatus {
  system: EnergySystem;
  label: string;
  score: number | null;
  confidence: number;
  trend: "rising" | "flat" | "falling" | null;
  status: "strong" | "solid" | "lagging" | "low-confidence" | "no-data";
}

/** Confidence-weighted roll-up of DEV competencies into the four energy-system axes. */
export function rollupSystems(
  metrics: PerfMetricRow[],
  cal: Map<string, ModalityCalibration>,
): SystemStatus[] {
  const systems: EnergySystem[] = ["AB", "AP", "LT", "GL"];
  return systems.map((sys) => {
    let weighted = 0;
    let count = 0;
    let rootTrend: SystemStatus["trend"] = null;
    for (const m of metrics) {
      const meta = DAY_TYPE_META[m.day_type];
      if (!meta || meta.cls !== "DEV" || !meta.systems.includes(sys)) continue;
      if (cal.get(m.modality)?.status === "uncalibrated") continue; // can't trust uncalibrated
      const ratio = num(m.rolling_avg_ratio);
      const c = m.rolling_count ?? 0;
      if (ratio === null || c <= 0) continue;
      weighted += ratio * c;
      count += c;
      if (m.day_type === ROOT_BY_SYSTEM[sys]) rootTrend = trendOf(m.last_4_ratios);
    }
    const label = SYSTEM_LABEL[sys];
    if (count === 0) return { system: sys, label, score: null, confidence: 0, trend: null, status: "no-data" };
    const score = Math.round((weighted / count) * 1000) / 1000;
    let status: SystemStatus["status"];
    if (count < MIN_CONFIDENCE) status = "low-confidence";
    else if (score >= STRONG) status = "strong";
    else if (score < LAGGING) status = "lagging";
    else status = "solid";
    return { system: sys, label, score, confidence: count, trend: rootTrend, status };
  });
}

export interface WeakRoot {
  system: EnergySystem;
  dayType: string;
  modality: string;
  score: number;
  count: number;
}

/** A root competency is "weak" only with adequate confidence and a valid time trial. */
export function detectWeakRoots(
  metrics: PerfMetricRow[],
  cal: Map<string, ModalityCalibration>,
): WeakRoot[] {
  const out: WeakRoot[] = [];
  for (const m of metrics) {
    const meta = DAY_TYPE_META[m.day_type];
    if (!meta?.isRoot) continue;
    const ratio = num(m.rolling_avg_ratio);
    const c = m.rolling_count ?? 0;
    const calStatus = cal.get(m.modality)?.status;
    if (ratio === null || c < MIN_CONFIDENCE || calStatus !== "current") continue;
    if (ratio <= WEAK_ROOT) {
      const sys = meta.systems[0];
      out.push({ system: sys, dayType: m.day_type, modality: m.modality, score: ratio, count: c });
    }
  }
  return out;
}

/** Fatigue heuristic: recent high RPE alongside flat/low performance ratios. */
export function detectFatigue(sessions: SessionRow[], now: Date): string[] {
  const flags: string[] = [];
  const recent = sessions
    .filter((s) => s.date)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);
  if (recent.length === 0) return flags;

  const sinceLast = daysBetween(recent[0].date, now);
  if (sinceLast >= 7) flags.push(`${sinceLast}d since last session — possible detraining/layoff.`);

  const rpes = recent.map((s) => num(s.perceived_exertion)).filter((x): x is number => x !== null);
  const ratios = recent.map((s) => num(s.performance_ratio)).filter((x): x is number => x !== null);
  if (rpes.length >= 3 && ratios.length >= 3) {
    const avgRpe = rpes.reduce((a, b) => a + b, 0) / rpes.length;
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    if (avgRpe >= 8 && avgRatio < 1.0) {
      flags.push(
        `Last ${recent.length} sessions: high effort (avg RPE ${avgRpe.toFixed(1)}) but output below target (avg ratio ${avgRatio.toFixed(2)}) — possible fatigue accumulation.`,
      );
    }
  }
  return flags;
}

// ─── Compose + format ────────────────────────────────────────────────────────

export function formatConditioningState(inputs: ConditioningInputs): string {
  const now = inputs.now ?? new Date();
  const staleAfterDays = inputs.staleAfterDays ?? DEFAULT_STALE_DAYS;

  const hasData =
    inputs.metrics.length > 0 || inputs.sessions.length > 0 || inputs.timeTrials.length > 0;
  if (!hasData) return "";

  // Modalities in play = those that appear in metrics or sessions.
  const modalities = Array.from(
    new Set([
      ...inputs.metrics.map((m) => m.modality),
      ...inputs.sessions.map((s) => s.modality).filter((x): x is string => !!x),
    ]),
  );

  const cal = computeCalibration(modalities, inputs.timeTrials, now, staleAfterDays);
  const systems = rollupSystems(inputs.metrics, cal);
  const weakRoots = detectWeakRoots(inputs.metrics, cal);
  const fatigue = detectFatigue(inputs.sessions, now);

  const parts: string[] = ["\n\nENGINE CONDITIONING STATE"];

  // Calibration
  const calLines: string[] = [];
  for (const m of modalities) {
    const c = cal.get(m);
    if (!c) continue;
    const mod = m.replace(/_/g, " ");
    if (c.status === "uncalibrated") {
      calLines.push(`${mod}: no current time trial — scores UNCALIBRATED, treat as unknown.`);
    } else {
      const age = c.ageDays != null ? `${c.ageDays}d` : "?";
      const stale = c.status === "stale" ? " STALE — scores low-confidence" : "";
      const prog = c.baselineDeltaPct != null
        ? `, baseline ${c.baselineDeltaPct >= 0 ? "+" : ""}${c.baselineDeltaPct}%`
        : "";
      calLines.push(`${mod}: TT ${age} old${stale}${prog}.`);
    }
  }
  if (calLines.length) parts.push("Calibration: " + calLines.join(" "));

  // Energy systems
  const sysWithData = systems.filter((s) => s.status !== "no-data");
  if (sysWithData.length) {
    const segs = sysWithData.map((s) => {
      const trend = s.trend ? `, ${s.trend}` : "";
      return `${s.label} ${s.status} (${s.score?.toFixed(2)}${trend})`;
    });
    parts.push("Energy systems: " + segs.join(" · "));
  }

  // Weak roots
  if (weakRoots.length) {
    const segs = weakRoots.map(
      (w) => `${SYSTEM_LABEL[w.system]} (${w.dayType.replace(/_/g, " ")} ${w.score.toFixed(2)}, n=${w.count})`,
    );
    parts.push("Weak root(s): " + segs.join("; ") + ".");
  }

  // Fatigue
  if (fatigue.length) parts.push("Fatigue: " + fatigue.join(" "));

  parts.push(
    "Read the above as conditioning context. Do not infer phosphagen/sprint capacity — the Engine does not train it. Treat stale/uncalibrated modalities as unknown rather than diagnosing them.",
  );

  return parts.join("\n");
}

// ─── Fetch wrapper ───────────────────────────────────────────────────────────

/**
 * Fetches Engine performance metrics, time trials and recent sessions, then
 * formats a conditioning-state block for the AI. Pure day_type-keyed diagnosis
 * — no program position, so it is correct for every program variant and
 * reusable across all AI features. Returns "" for users with no Engine data.
 */
export async function buildConditioningState(
  supa: SupabaseClient,
  userId: string,
  opts?: { recentDays?: number; staleAfterDays?: number },
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
      .select("date, day_type, modality, performance_ratio, perceived_exertion")
      .eq("user_id", userId)
      .eq("completed", true)
      .gte("date", cutoff)
      .order("date", { ascending: false }),
  ]);

  return formatConditioningState({
    metrics: (metrics as PerfMetricRow[]) ?? [],
    timeTrials: (timeTrials as TimeTrialRow[]) ?? [],
    sessions: (sessions as SessionRow[]) ?? [],
    staleAfterDays: opts?.staleAfterDays,
  });
}
