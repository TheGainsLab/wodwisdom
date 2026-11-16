/**
 * engine-continuum — the conditioning continuum, pure compute.
 *
 * Spec: docs/conditioning_continuum_spec.md (v2, 2026-11-16). Phase 0 plan:
 * docs/conditioning_continuum_phase0_plan.md.
 *
 * The idea: an athlete's conditioning is a curve over one axis — pace as a
 * multiple of their own 10-minute time trial (log scale). Two anchors place
 * everything: the trial (1.0×) sets the level; the max-effort anaerobic day
 * (~2.6× for a balanced athlete on Echo-bike calories) sets the ceiling. A
 * session lands at the pace the athlete actually delivered; its height is how
 * long they sustained a bout at that pace against what a balanced athlete
 * sustains there (the power-duration curve, D(r)). Max efforts pin the
 * ceiling; sub-max days prove floors; misses lower. The ratchet replays those
 * into the athlete's multiplier curve M(r), which is what the sequencer reads.
 *
 * Everything here is pure (no I/O) and unit-tested in engine-continuum_test.ts
 * against a real athlete's history (fixtures/continuum_athlete.json).
 */

// ─── Reference curve ─────────────────────────────────────────────────────────

/** One row of engine_pd_curves: at pace r × trial, a balanced athlete sustains
 *  a single bout of `seconds`. */
export interface PdCurvePoint {
  r: number;
  seconds: number;
}

/** v1 Echo-bike calories curve (founder anchors 2.6× @ 30 s and 1.0× @ 600 s,
 *  envelope midpoints between). The database seed; kept here so the module
 *  and its tests do not depend on the table. Other machines: see
 *  conversions below — the C2 machines use this curve in watt-multiples as a
 *  first pass until their own max-effort data refits them. */
export const ECHO_BIKE_CAL_CURVE_V1: PdCurvePoint[] = [
  { r: 3.2, seconds: 10 },
  { r: 2.9, seconds: 20 },
  { r: 2.6, seconds: 30 },
  { r: 2.2, seconds: 45 },
  { r: 1.8, seconds: 60 },
  { r: 1.35, seconds: 120 },
  { r: 1.2, seconds: 180 },
  { r: 1.12, seconds: 240 },
  { r: 1.0, seconds: 600 },
  { r: 0.95, seconds: 900 },
  { r: 0.92, seconds: 1200 },
  { r: 0.88, seconds: 1800 },
  { r: 0.82, seconds: 3600 },
];

/** The balanced 30-s ceiling for this curve: the r at 30 s (2.6 on Echo cal). */
export function balancedCeiling(curve: PdCurvePoint[]): number {
  return balancedPaceMultiple(curve, 30);
}

function sortedByR(curve: PdCurvePoint[]): PdCurvePoint[] {
  return [...curve].sort((a, b) => b.r - a.r); // descending r = ascending seconds
}

/** D(r): the longest single bout a balanced athlete sustains at r × trial.
 *  Log-linear interpolation on duration between the curve's points; clamped
 *  to the curve's ends. */
export function balancedBout(curve: PdCurvePoint[], r: number): number {
  const pts = sortedByR(curve);
  if (pts.length === 0) return NaN;
  if (r >= pts[0].r) return pts[0].seconds;
  if (r <= pts[pts.length - 1].r) return pts[pts.length - 1].seconds;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (b.r <= r && r <= a.r) {
      const t = (a.r - r) / (a.r - b.r);
      return Math.pow(10, Math.log10(a.seconds) + t * (Math.log10(b.seconds) - Math.log10(a.seconds)));
    }
  }
  return pts[pts.length - 1].seconds;
}

/** R(d): the inverse — the pace multiple a balanced athlete holds for a single
 *  bout of `seconds`. Interpolates r linearly on log-duration. */
export function balancedPaceMultiple(curve: PdCurvePoint[], seconds: number): number {
  const pts = sortedByR(curve);
  if (pts.length === 0) return NaN;
  if (seconds <= pts[0].seconds) return pts[0].r;
  if (seconds >= pts[pts.length - 1].seconds) return pts[pts.length - 1].r;
  const x = Math.log10(seconds);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const xa = Math.log10(a.seconds), xb = Math.log10(b.seconds);
    if (xa <= x && x <= xb) return a.r + ((x - xa) / (xb - xa)) * (b.r - a.r);
  }
  return pts[pts.length - 1].r;
}

// ─── Units → a comparable currency ───────────────────────────────────────────

/** Machines whose pace converts to watts by a published relation. Echo bike
 *  calories stay on their own per-calorie curve (decided 2026-11-16: Rogue
 *  publishes no formula). */
const C2_MACHINES = new Set(["c2_row_erg", "c2_ski_erg", "c2_bike_erg", "rogue_row_erg"]);

/** A pace (units per minute) in the currency the curve for that machine/unit
 *  is expressed in. For C2 machines that is watts (meters: W = 2.80 / (s/m)^3;
 *  cal: W = (cal/hr − 300) / 4; watts: identity). For everything else it is
 *  the pace itself. Only RATIOS of this value are ever used, so the absolute
 *  scale does not matter — what matters is that a 5 % step means the same
 *  physical demand on every machine that shares a curve. */
export function comparablePace(modality: string, units: string | null, pacePerMin: number): number | null {
  if (!Number.isFinite(pacePerMin) || pacePerMin <= 0) return null;
  if (!C2_MACHINES.has(modality)) return pacePerMin;
  switch (units) {
    case "meters": {
      const secondsPerMeter = 60 / pacePerMin;
      return 2.80 / Math.pow(secondsPerMeter, 3);
    }
    case "cal": {
      const calPerHour = pacePerMin * 60;
      return Math.max(0, (calPerHour - 300) / 4);
    }
    case "watts":
      return pacePerMin;
    default:
      return pacePerMin;
  }
}

// ─── Per session ─────────────────────────────────────────────────────────────

export type ContinuumEvidence =
  | "ceiling" // reached the balanced curve at the delivered pace — pins the ceiling
  | "floor" // completed as asked or faster, well short of the curve — proves a lower bound only
  | "miss" // delivered below the asked pace
  | "record" // assess day: recorded, never ratchets
  | "zone2" // r below the zone-2 cutoff: dose, not capacity
  | "no_trial" // no current trial on this machine/unit — not computable
  | "no_curve"; // no reference curve for this machine/unit — not computable

export interface PrescriptionBlock {
  work_seconds: number | null;
  rest_seconds?: number | null;
  /** asked pace as a multiple of the trial; null for max effort */
  pace_multiple?: number | null;
  max_effort?: boolean;
  /** continuous work (endurance, polarized, flux base): the bout is the whole block */
  continuous?: boolean;
}

export interface ContinuumSessionInput {
  date: string; // YYYY-MM-DD
  day_type: string;
  modality: string;
  units: string | null;
  actual_pace: number | null; // units per minute
  target_pace?: number | null; // units per minute, as the day page computed it
  total_work_seconds?: number | null;
  total_rest_seconds?: number | null;
  intervals?: number | null;
  prescription?: { blocks: PrescriptionBlock[] } | null;
}

export interface ContinuumSession {
  r: number | null;
  bout_seconds: number | null;
  rest_ratio: number | null;
  sustain: number | null;
  evidence: ContinuumEvidence;
  /** the asked pace as a multiple of the trial, when known */
  asked_r: number | null;
}

/** Day types that are readouts, never ratchet evidence (decided 2026-11-16). */
export const ASSESS_DAY_TYPES = new Set(["time_trial", "rocket_races_b", "infinity", "afterburner", "synthesis"]);
/** Day types whose envelope is max effort: ceiling evidence by construction. */
export const MAX_EFFORT_DAY_TYPES = new Set(["anaerobic"]);

export const ZONE2_CUTOFF_R = 0.85; // fixed (decided 2026-11-16)
export const CEILING_SUSTAIN = 0.85; // "reached the curve" — open threshold (spec §11)
const MISS_TOLERANCE = 0.98; // delivered below 98 % of asked = a miss

/** The bout a session is judged on: the LONGEST work block of the prescription
 *  (decided 2026-11-16 — what the athlete had to sustain); a continuous block
 *  is the whole block; fallback is the logged average interval. */
export function sessionBout(s: ContinuumSessionInput): number | null {
  const blocks = s.prescription?.blocks ?? [];
  const works = blocks.map((b) => (b.continuous ? (b.work_seconds ?? s.total_work_seconds ?? null) : (b.work_seconds ?? null)))
    .filter((w): w is number => typeof w === "number" && w > 0);
  if (works.length) return Math.max(...works);
  if (s.total_work_seconds && s.total_work_seconds > 0) {
    const n = s.intervals && s.intervals > 0 ? s.intervals : 1;
    return s.total_work_seconds / n;
  }
  return null;
}

export function sessionContinuum(
  s: ContinuumSessionInput,
  trialPaceInForce: number | null,
  curve: PdCurvePoint[] | null,
): ContinuumSession {
  const none = (evidence: ContinuumEvidence): ContinuumSession => ({ r: null, bout_seconds: null, rest_ratio: null, sustain: null, evidence, asked_r: null });
  if (!trialPaceInForce || trialPaceInForce <= 0) return none("no_trial");
  if (!curve || curve.length === 0) return none("no_curve");
  const delivered = s.actual_pace != null ? comparablePace(s.modality, s.units, s.actual_pace) : null;
  const trial = comparablePace(s.modality, s.units, trialPaceInForce);
  if (delivered == null || trial == null || trial <= 0) return none("no_trial");

  const isTrial = s.day_type === "time_trial";
  const r = isTrial ? 1.0 : delivered / trial;
  const bout = isTrial ? 600 : sessionBout(s);
  const restRatio = s.total_work_seconds && s.total_work_seconds > 0 && s.total_rest_seconds != null
    ? s.total_rest_seconds / s.total_work_seconds
    : null;
  const sustain = bout != null ? bout / balancedBout(curve, r) : null;
  const askedComparable = s.target_pace != null ? comparablePace(s.modality, s.units, s.target_pace) : null;
  const askedR = askedComparable != null ? askedComparable / trial : null;

  let evidence: ContinuumEvidence;
  const maxEffortDay = MAX_EFFORT_DAY_TYPES.has(s.day_type) || (s.prescription?.blocks ?? []).some((b) => b.max_effort);
  if (ASSESS_DAY_TYPES.has(s.day_type)) evidence = "record";
  else if (r < ZONE2_CUTOFF_R) evidence = "zone2";
  else if (maxEffortDay || (sustain != null && sustain >= CEILING_SUSTAIN)) evidence = "ceiling";
  else if (askedR != null && r < askedR * MISS_TOLERANCE && bout != null && bout / balancedBout(curve, askedR) < CEILING_SUSTAIN) {
    // A miss lowers the curve only when the ASK was comfortably sub-max for a
    // balanced athlete. Missing an ask that was itself near the curve (e.g.
    // 4 min at 1.12× — a balanced max) says nothing new: it is a floor.
    evidence = "miss";
  } else evidence = "floor";

  return { r, bout_seconds: bout, rest_ratio: restRatio, sustain, evidence, asked_r: askedR };
}

// ─── The athlete's curve M(r) ────────────────────────────────────────────────

export type NodeState = "measured" | "floor" | "blank";

export interface CurveNode {
  r: number;
  m: number;
  conf: number;
  state: NodeState;
}

export interface EngineCurve {
  version: number;
  nodes: CurveNode[];
  flags: string[];
  /** YYYY-MM-DD of the last session folded in */
  as_of: string | null;
  /** set at a retest; cleared by the next ceiling-evidence anaerobic session */
  awaiting_right_anchor: boolean;
}

export const CURVE_VERSION = 1;
const NODE_STEP_LOG10 = 0.05; // nodes every 0.05 in log10 r
const SIGMA_LOG10 = 0.1; // a session touches roughly r/1.25 … r×1.25
const K = 0.6; // how far a ceiling session pulls the node toward its sustain
const STATE_W = 0.75; // a session marks a node measured/floor only within ~13 % of its pace (w ≥ 0.75)
const STEP_CLAMP = 0.15;
const M_MIN = 0.7, M_MAX = 1.5;
const CONF_HALF_LIFE_DAYS = 60;
const RIGHT_ANCHOR_R = 1.8; // retest hold-back applies above this
const DAMP_BETA = 0.5;

export function newCurve(): EngineCurve {
  const nodes: CurveNode[] = [];
  for (let x = Math.log10(ZONE2_CUTOFF_R); x <= Math.log10(3.5) + 1e-9; x += NODE_STEP_LOG10) {
    nodes.push({ r: Number(Math.pow(10, x).toFixed(4)), m: 1.0, conf: 0, state: "blank" });
  }
  return { version: CURVE_VERSION, nodes, flags: [], as_of: null, awaiting_right_anchor: false };
}

function weight(nodeR: number, r: number): number {
  const d = (Math.log10(nodeR) - Math.log10(r)) / SIGMA_LOG10;
  return Math.exp(-d * d);
}

function nearestNode(curve: EngineCurve, r: number): CurveNode {
  return curve.nodes.reduce((best, n) => (Math.abs(Math.log10(n.r) - Math.log10(r)) < Math.abs(Math.log10(best.r) - Math.log10(r)) ? n : best));
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

function decayConfidence(curve: EngineCurve, toDate: string): void {
  if (!curve.as_of) return;
  const days = daysBetween(curve.as_of, toDate);
  if (days <= 0) return;
  const f = Math.pow(0.5, days / CONF_HALF_LIFE_DAYS);
  for (const n of curve.nodes) n.conf *= f;
}

/** Apply one session's evidence to the curve (mutates). Pure in the sense of
 *  no I/O; the caller owns ordering by date. */
export function applySession(curve: EngineCurve, s: ContinuumSessionInput, c: ContinuumSession): void {
  decayConfidence(curve, s.date);
  curve.as_of = s.date;
  if (c.r == null || c.sustain == null) return;
  if (c.evidence === "record" || c.evidence === "zone2" || c.evidence === "no_trial" || c.evidence === "no_curve") return;

  const r = c.r;
  if (c.evidence === "ceiling") {
    const err = Math.max(-STEP_CLAMP, Math.min(STEP_CLAMP, c.sustain - nearestNode(curve, r).m));
    for (const n of curve.nodes) {
      const w = weight(n.r, r);
      if (w < 0.01) continue;
      n.m = clampM(n.m + K * w * err);
      n.conf += w;
      if (w >= STATE_W) n.state = "measured";
    }
    // a ceiling-evidence anaerobic session re-anchors the right end after a retest
    if (curve.awaiting_right_anchor && r >= RIGHT_ANCHOR_R) curve.awaiting_right_anchor = false;
  } else if (c.evidence === "floor") {
    // raise only: a sub-max session proves the athlete can; it never proves they can't
    for (const n of curve.nodes) {
      const w = weight(n.r, r);
      if (w < 0.01) continue;
      if (c.sustain > n.m) n.m = clampM(n.m + w * Math.min(STEP_CLAMP, c.sustain - n.m));
      n.conf += 0.25 * w; // a floor is weak evidence
      if (n.state === "blank" && w >= STATE_W) n.state = "floor";
    }
  } else if (c.evidence === "miss") {
    // lower toward what was delivered, at the pace that was ASKED
    const askedR = c.asked_r ?? r;
    const err = Math.max(-STEP_CLAMP, Math.min(0, r / askedR - 1));
    for (const n of curve.nodes) {
      const w = weight(n.r, askedR);
      if (w < 0.01) continue;
      n.m = clampM(n.m + K * w * err);
      n.conf += 0.5 * w;
      if (n.state === "blank" && w >= STATE_W) n.state = "floor";
    }
  }
}

function clampM(m: number): number {
  return Math.max(M_MIN, Math.min(M_MAX, m));
}

/** A retest landed: fold drift at the pinned node back into the level, and
 *  hold back part of the level change on the fast-twitch end until its own
 *  anchor (the next ceiling-evidence anaerobic session) re-places it. */
export function applyRetest(curve: EngineCurve, oldTrialPace: number, newTrialPace: number): void {
  const pinned = nearestNode(curve, 1.0).m;
  if (pinned > 0 && Math.abs(pinned - 1) > 1e-9) {
    for (const n of curve.nodes) n.m = clampM(n.m / pinned);
  }
  if (oldTrialPace > 0 && newTrialPace > 0 && newTrialPace !== oldTrialPace) {
    const ceiling = 2.6;
    for (const n of curve.nodes) {
      if (n.r <= RIGHT_ANCHOR_R) continue;
      const ramp = Math.min(1, (Math.log10(n.r) - Math.log10(RIGHT_ANCHOR_R)) / (Math.log10(ceiling) - Math.log10(RIGHT_ANCHOR_R)));
      n.m = clampM(n.m * Math.pow(oldTrialPace / newTrialPace, DAMP_BETA * ramp));
    }
    curve.awaiting_right_anchor = true;
  }
}

export interface TrialInput {
  modality: string;
  units: string | null;
  pace: number; // units per minute, the 10-minute pace
  date: string;
}

/** The trial in force on `date` for a machine/unit: the latest trial on or
 *  before that date. */
export function trialInForce(trials: TrialInput[], modality: string, units: string | null, date: string): TrialInput | null {
  let best: TrialInput | null = null;
  for (const t of trials) {
    if (t.modality !== modality || (t.units ?? null) !== (units ?? null)) continue;
    if (t.date <= date && (!best || t.date > best.date)) best = t;
  }
  return best;
}

export interface ReplayResult {
  curve: EngineCurve;
  sessions: Array<ContinuumSessionInput & ContinuumSession>;
}

/** Replay an athlete's whole history in date order: per-session values plus
 *  the ratchet, retests folded in as they land. `curves` keyed "modality|units". */
export function replayCurve(
  sessions: ContinuumSessionInput[],
  trials: TrialInput[],
  curves: Record<string, PdCurvePoint[]>,
): ReplayResult {
  const curve = newCurve();
  const ordered = [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: ReplayResult["sessions"] = [];
  const lastTrialByKey = new Map<string, number>();
  const uncalibrated = new Set<string>();
  let trialLow = false;
  let maxCeilingR = 0;

  for (const s of ordered) {
    const key = `${s.modality}|${s.units ?? ""}`;
    const t = trialInForce(trials, s.modality, s.units, s.date);
    const pdc = curves[key] ?? null;
    if (s.day_type === "time_trial" && t && t.date === s.date) {
      const prev = lastTrialByKey.get(key);
      if (prev != null && prev !== t.pace) applyRetest(curve, prev, t.pace);
      lastTrialByKey.set(key, t.pace);
    }
    const c = sessionContinuum(s, t?.pace ?? null, pdc);
    if (c.evidence === "no_trial") uncalibrated.add(key);
    if (c.evidence === "ceiling" && c.r != null && c.sustain != null) {
      // TRIAL_LOW: sustained longer than the balanced max at (or just above)
      // trial pace on a long bout — only possible if the level is wrong. A
      // 20-s sprint past the curve is the other flag (ceiling above balanced).
      if (c.r >= 1.0 && c.r <= 1.3 && c.sustain > 1.05 && (c.bout_seconds ?? 0) >= 300) trialLow = true;
      if (c.bout_seconds != null && c.bout_seconds <= 45 && c.r > maxCeilingR) maxCeilingR = c.r;
    }
    if (s.day_type === "time_trial") trialLow = false; // a retest resolves the flag
    applySession(curve, s, c);
    out.push({ ...s, ...c });
  }

  const flags: string[] = [];
  if (trialLow) flags.push("TRIAL_LOW");
  const echoCeiling = balancedCeiling(curves["echo_bike|cal"] ?? ECHO_BIKE_CAL_CURVE_V1);
  if (maxCeilingR >= echoCeiling * 1.05) flags.push("CEILING_ABOVE_BALANCED");
  else if (maxCeilingR > 0 && maxCeilingR <= echoCeiling * 0.9) flags.push("CEILING_BELOW_BALANCED");
  for (const k of uncalibrated) flags.push(`UNCALIBRATED:${k}`);
  if (curve.awaiting_right_anchor) flags.push("AWAITING_RIGHT_ANCHOR");
  curve.flags = flags;
  return { curve, sessions: out };
}

// ─── Summary for the sequencer ───────────────────────────────────────────────

export interface RegionSummary {
  label: string;
  r_lo: number;
  r_hi: number | null;
  m: number | null;
  state: NodeState;
  n: number;
  trend: "up" | "flat" | "down" | "unknown";
}

export const REGIONS: Array<[number, number | null, string]> = [
  [0.85, 0.95, "0.85–0.95×"],
  [0.95, 1.1, "0.95–1.1×"],
  [1.1, 1.3, "1.1–1.3×"],
  [1.3, 1.6, "1.3–1.6×"],
  [1.6, 2.0, "1.6–2.0×"],
  [2.0, 2.6, "2.0–2.6×"],
  [2.6, null, ">2.6×"],
];

export function summarizeCurve(curve: EngineCurve, sessions: ReplayResult["sessions"], now = curve.as_of ?? ""): RegionSummary[] {
  return REGIONS.map(([lo, hi, label]) => {
    const nodes = curve.nodes.filter((n) => n.r >= lo && (hi == null || n.r < hi));
    const totalConf = nodes.reduce((a, n) => a + n.conf, 0);
    const m = totalConf > 0 ? nodes.reduce((a, n) => a + n.m * n.conf, 0) / totalConf : null;
    const state: NodeState = nodes.some((n) => n.state === "measured") ? "measured" : nodes.some((n) => n.state === "floor") ? "floor" : "blank";
    // trend: ceiling-evidence sustains in the region, last 28 days vs the 28 before
    const ceil = sessions.filter((s) => s.evidence === "ceiling" && s.r != null && s.r >= lo && (hi == null || s.r < hi) && s.sustain != null);
    const recent = ceil.filter((s) => now && daysBetween(s.date, now) <= 28).map((s) => s.sustain as number);
    const prior = ceil.filter((s) => now && daysBetween(s.date, now) > 28 && daysBetween(s.date, now) <= 56).map((s) => s.sustain as number);
    let trend: RegionSummary["trend"] = "unknown";
    if (recent.length && prior.length) {
      const d = mean(recent) - mean(prior);
      trend = d > 0.03 ? "up" : d < -0.03 ? "down" : "flat";
    } else if (recent.length >= 2) {
      trend = "flat";
    }
    return { label, r_lo: lo, r_hi: hi, m: m != null ? Number(m.toFixed(3)) : null, state, n: Number(totalConf.toFixed(1)), trend };
  });
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** The prompt block the sequencer receives (spec §5). */
export function formatCurveForPrompt(curve: EngineCurve, regions: RegionSummary[], trials: TrialInput[], opts?: { trialsShown?: number }): string {
  const shown = opts?.trialsShown ?? 6;
  const lines: string[] = [];
  lines.push("ATHLETE CONDITIONING CURVE (pace as a multiple of the 10-min trial; M = ceiling vs a balanced athlete at your level, 1.0 = balanced; zone 2 below 0.85× is dose, not scored)");
  lines.push("r:      " + regions.map((x) => x.label.padEnd(11)).join(""));
  lines.push("M:      " + regions.map((x) => (x.m == null ? "—" : x.m.toFixed(2)).padEnd(11)).join(""));
  lines.push("state:  " + regions.map((x) => x.state.padEnd(11)).join(""));
  lines.push("n:      " + regions.map((x) => String(x.n).padEnd(11)).join(""));
  lines.push("trend:  " + regions.map((x) => ({ up: "↑", flat: "→", down: "↓", unknown: "?" }[x.trend]).padEnd(11)).join(""));
  const byKey = new Map<string, TrialInput[]>();
  for (const t of trials) {
    const k = `${t.modality} (${t.units ?? "?"})`;
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  for (const [k, ts] of byKey) {
    const last = ts.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-shown);
    lines.push(`Trials ${k.replace(/_/g, " ")}: ` + last.map((t) => `${t.pace} (${t.date})`).join(" → "));
  }
  lines.push("Flags: " + (curve.flags.length ? curve.flags.join(", ") : "none"));
  return lines.join("\n");
}
