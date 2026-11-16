/**
 * engine-continuum — the conditioning continuum, pure compute.
 *
 * Spec: docs/conditioning_continuum_spec.md (v2 + the 2026-11-16 revisions
 * after the first production run). Phase 0 plan: docs/conditioning_continuum_phase0_plan.md.
 *
 * The idea: an athlete's conditioning is a curve over one axis. Each machine
 * and unit has a BALANCED power-duration curve in its own native pace: at
 * pace r × the athlete's 10-minute trial, a balanced athlete sustains one
 * bout of D(r) seconds. A session lands at the pace the athlete actually
 * delivered (r), which the machine's curve turns into an EFFORT DURATION
 * D(r) — the machine-independent coordinate ("a 30-second-max effort" is the
 * same place on a rower at 1.27× pace and on an Echo at 2.2× calories). The
 * session's height is how long the athlete sustained a bout at that pace
 * against D(r). Max efforts pin the ceiling; sub-max days prove floors;
 * misses lower. The ratchet replays those into the athlete's multiplier
 * curve M over effort duration — shared across machines, read by the
 * sequencer.
 *
 * Decisions 2026-11-16 (post first run): no unit conversion — every curve is
 * authored in its machine's native pace multiples; the shared coordinate is
 * effort duration, not the pace multiple.
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

/** Echo-bike calories curve. Anchors: 1.0× @ 600 s (the trial) and the
 *  research figure of peak power ≈ 2.6× VO2max power, placed at its own
 *  duration — a 10–15 s peak, not 30 s (decided 2026-11-16 after the first
 *  production run): 2.6× @ 15 s, hence ≈ 2.2× @ 30 s, which is where this
 *  base's median 30-s effort (2.27×) sits. Envelope midpoints between. Also
 *  the fan bikes' curve (Assault, Airdyne). */
export const ECHO_BIKE_CAL_CURVE_V1: PdCurvePoint[] = [
  { r: 2.8, seconds: 10 },
  { r: 2.6, seconds: 15 },
  { r: 2.5, seconds: 20 },
  { r: 2.2, seconds: 30 },
  { r: 1.95, seconds: 45 },
  { r: 1.75, seconds: 60 },
  { r: 1.35, seconds: 120 },
  { r: 1.2, seconds: 180 },
  { r: 1.12, seconds: 240 },
  { r: 1.0, seconds: 600 },
  { r: 0.95, seconds: 900 },
  { r: 0.92, seconds: 1200 },
  { r: 0.88, seconds: 1800 },
  { r: 0.82, seconds: 3600 },
];

/** Concept2-class ergs in metres (rower, ski, bike-erg, Rogue rower): PACE
 *  multiples. Power ∝ pace³, so the same effort spans a much narrower pace
 *  range than Echo calories. Derived from the Echo curve by
 *  r_pace = r_echo^0.30 → ≈ 1.27× @ 30 s, on this base's rowers' median.
 *  First pass; refit from each machine's own max-effort data. */
export const C2_METERS_CURVE_V1: PdCurvePoint[] = ECHO_BIKE_CAL_CURVE_V1.map((p) => ({ r: Number(Math.pow(p.r, 0.30).toFixed(3)), seconds: p.seconds }));

/** Concept2 ergs read in calories (cal/hr = 4·W + 300 on the monitor): the
 *  calorie multiple of a watt multiple depends on the athlete's level; for a
 *  ~200 W 10-minute athlete a 30-s max near 2.35× watts reads ≈ 2.0× calories.
 *  Derived by r_cal = r_echo^0.73. First pass. */
export const C2_CAL_CURVE_V1: PdCurvePoint[] = ECHO_BIKE_CAL_CURVE_V1.map((p) => ({ r: Number(Math.pow(p.r, 0.73).toFixed(3)), seconds: p.seconds }));

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

// ─── Units ───────────────────────────────────────────────────────────────────

/** No conversion (decided 2026-11-16, after the first production run showed
 *  the watt-converted Concept2 curves were wrong on the right): every
 *  machine/unit is compared in its own native pace against its own curve.
 *  Kept as a function so a conversion can be reintroduced in one place. */
export function comparablePace(_modality: string, _units: string | null, pacePerMin: number): number | null {
  if (!Number.isFinite(pacePerMin) || pacePerMin <= 0) return null;
  return pacePerMin;
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
  /** the machine-independent coordinate: the bout a balanced athlete sustains at this pace, D(r) */
  effort_seconds: number | null;
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

/** Zone 2 = an effort a balanced athlete sustains for 40 min or more. Fixed
 *  (decided 2026-11-16); on the Echo curve this is r ≈ 0.86. Expressed in
 *  seconds so it means the same on every machine. */
export const ZONE2_MIN_EFFORT_SECONDS = 2400;
export const CEILING_SUSTAIN = 0.85; // "reached the curve" — open threshold (spec §11)
const MISS_TOLERANCE = 0.98; // delivered below 98 % of asked = a miss

/** The block a session is judged on: the one with the LONGEST work bout
 *  (decided 2026-11-16 — what the athlete had to sustain); a continuous block
 *  counts as its whole work time. Null when the prescription has no usable
 *  block. */
export function judgedBlock(s: ContinuumSessionInput): { work_seconds: number; max_effort: boolean } | null {
  let best: { work_seconds: number; max_effort: boolean } | null = null;
  for (const b of s.prescription?.blocks ?? []) {
    const w = b.continuous ? (b.work_seconds ?? s.total_work_seconds ?? null) : (b.work_seconds ?? null);
    if (typeof w !== "number" || w <= 0) continue;
    if (!best || w > best.work_seconds) best = { work_seconds: w, max_effort: b.max_effort === true };
  }
  return best;
}

/** The bout a session is judged on (seconds): the judged block's work, else
 *  the logged average interval. */
export function sessionBout(s: ContinuumSessionInput): number | null {
  const jb = judgedBlock(s);
  if (jb) return jb.work_seconds;
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
  const none = (evidence: ContinuumEvidence): ContinuumSession => ({ r: null, effort_seconds: null, bout_seconds: null, rest_ratio: null, sustain: null, evidence, asked_r: null });
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
  const effort = balancedBout(curve, r);
  const sustain = bout != null ? bout / effort : null;
  const askedComparable = s.target_pace != null ? comparablePace(s.modality, s.units, s.target_pace) : null;
  const askedR = askedComparable != null ? askedComparable / trial : null;

  let evidence: ContinuumEvidence;
  // Max effort by construction: the day type is max effort, or the JUDGED
  // block (the longest) is. A sprint block beside a longer aerobic block
  // (atomic, afterburner) does not make the blended session a ceiling.
  const maxEffortDay = MAX_EFFORT_DAY_TYPES.has(s.day_type) || judgedBlock(s)?.max_effort === true;
  if (ASSESS_DAY_TYPES.has(s.day_type)) evidence = "record";
  else if (effort >= ZONE2_MIN_EFFORT_SECONDS) evidence = "zone2";
  else if (maxEffortDay || (sustain != null && sustain >= CEILING_SUSTAIN)) evidence = "ceiling";
  else if (askedR != null && r < askedR * MISS_TOLERANCE && bout != null && bout / balancedBout(curve, askedR) < CEILING_SUSTAIN) {
    // A miss lowers the curve only when the ASK was comfortably sub-max for a
    // balanced athlete. Missing an ask that was itself near the curve (e.g.
    // 4 min at 1.12× — a balanced max) says nothing new: it is a floor.
    evidence = "miss";
  } else evidence = "floor";

  return { r, effort_seconds: effort, bout_seconds: bout, rest_ratio: restRatio, sustain, evidence, asked_r: askedR };
}

// ─── The athlete's curve M over effort duration ──────────────────────────────

export type NodeState = "measured" | "floor" | "blank";

export interface CurveNode {
  /** effort duration in seconds — the bout a balanced athlete sustains at that pace */
  seconds: number;
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
  /** set at a retest; cleared by the next ceiling-evidence short max effort */
  awaiting_right_anchor: boolean;
}

export const CURVE_VERSION = 2; // v2: nodes indexed by effort seconds (was pace multiple)
const NODE_STEP_LOG10 = 0.1; // nodes every 0.1 in log10 seconds: 10, 12.6, 15.8 … 3600
const SIGMA_LOG10 = 0.15; // a session touches roughly ×/÷ 1.4 in duration
const K = 0.6; // how far a ceiling session pulls the node toward its sustain
const STATE_W = 0.75; // a session marks a node measured/floor only within ~×/÷ 1.25 of its effort
const STEP_CLAMP = 0.15;
const M_MIN = 0.7, M_MAX = 1.5;
const CONF_HALF_LIFE_DAYS = 60;
const TRIAL_SECONDS = 600; // the pinned node
const RIGHT_ANCHOR_SECONDS = 60; // efforts shorter than this are re-anchored by their own max effort after a retest
const CEILING_SECONDS = 30; // the glycolytic anchor
const DAMP_BETA = 0.5;
const MIN_SECONDS = 10, MAX_SECONDS = 3600;

export function newCurve(): EngineCurve {
  const nodes: CurveNode[] = [];
  for (let x = Math.log10(MIN_SECONDS); x <= Math.log10(MAX_SECONDS) + 1e-9; x += NODE_STEP_LOG10) {
    nodes.push({ seconds: Number(Math.pow(10, x).toFixed(1)), m: 1.0, conf: 0, state: "blank" });
  }
  return { version: CURVE_VERSION, nodes, flags: [], as_of: null, awaiting_right_anchor: false };
}

function weight(nodeSeconds: number, seconds: number): number {
  const d = (Math.log10(nodeSeconds) - Math.log10(seconds)) / SIGMA_LOG10;
  return Math.exp(-d * d);
}

function nearestNode(curve: EngineCurve, seconds: number): CurveNode {
  return curve.nodes.reduce((best, n) =>
    Math.abs(Math.log10(n.seconds) - Math.log10(seconds)) < Math.abs(Math.log10(best.seconds) - Math.log10(seconds)) ? n : best
  );
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

function clampM(m: number): number {
  return Math.max(M_MIN, Math.min(M_MAX, m));
}

/** Apply one session's evidence to the curve (mutates). The session's
 *  coordinate is its effort duration D(r). The caller owns ordering by date. */
export function applySession(curve: EngineCurve, s: ContinuumSessionInput, c: ContinuumSession, curveForAsk?: PdCurvePoint[] | null): void {
  decayConfidence(curve, s.date);
  curve.as_of = s.date;
  if (c.r == null || c.sustain == null || c.effort_seconds == null) return;
  if (c.evidence === "record" || c.evidence === "zone2" || c.evidence === "no_trial" || c.evidence === "no_curve") return;

  const x = c.effort_seconds;
  if (c.evidence === "ceiling") {
    const err = Math.max(-STEP_CLAMP, Math.min(STEP_CLAMP, c.sustain - nearestNode(curve, x).m));
    for (const n of curve.nodes) {
      const w = weight(n.seconds, x);
      if (w < 0.01) continue;
      n.m = clampM(n.m + K * w * err);
      n.conf += w;
      if (w >= STATE_W) n.state = "measured";
    }
    if (curve.awaiting_right_anchor && x <= RIGHT_ANCHOR_SECONDS) curve.awaiting_right_anchor = false;
  } else if (c.evidence === "floor") {
    // raise only: a sub-max session proves the athlete can; it never proves they can't
    for (const n of curve.nodes) {
      const w = weight(n.seconds, x);
      if (w < 0.01) continue;
      if (c.sustain > n.m) n.m = clampM(n.m + w * Math.min(STEP_CLAMP, c.sustain - n.m));
      n.conf += 0.25 * w; // a floor is weak evidence
      if (n.state === "blank" && w >= STATE_W) n.state = "floor";
    }
  } else if (c.evidence === "miss") {
    // lower toward what was delivered, at the effort that was ASKED
    const askedR = c.asked_r ?? c.r;
    const askedX = curveForAsk ? balancedBout(curveForAsk, askedR) : x;
    const err = Math.max(-STEP_CLAMP, Math.min(0, c.r / askedR - 1));
    for (const n of curve.nodes) {
      const w = weight(n.seconds, askedX);
      if (w < 0.01) continue;
      n.m = clampM(n.m + K * w * err);
      n.conf += 0.5 * w;
      if (n.state === "blank" && w >= STATE_W) n.state = "floor";
    }
  }
}

/** A retest landed: fold drift at the pinned node (the 10-minute effort)
 *  back into the level, and hold back part of the level change on the
 *  fast-twitch end until its own anchor (the next ceiling-evidence effort of
 *  60 s or shorter) re-places it. */
export function applyRetest(curve: EngineCurve, oldTrialPace: number, newTrialPace: number): void {
  const pinned = nearestNode(curve, TRIAL_SECONDS).m;
  if (pinned > 0 && Math.abs(pinned - 1) > 1e-9) {
    for (const n of curve.nodes) n.m = clampM(n.m / pinned);
  }
  if (oldTrialPace > 0 && newTrialPace > 0 && newTrialPace !== oldTrialPace) {
    for (const n of curve.nodes) {
      if (n.seconds >= RIGHT_ANCHOR_SECONDS) continue;
      const ramp = Math.min(1, (Math.log10(RIGHT_ANCHOR_SECONDS) - Math.log10(n.seconds)) / (Math.log10(RIGHT_ANCHOR_SECONDS) - Math.log10(CEILING_SECONDS)));
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
  // the athlete's short max efforts against each machine's OWN curve
  let ceilingRatio: number | null = null;

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
    if (c.evidence === "ceiling" && c.r != null && c.sustain != null && c.effort_seconds != null && pdc) {
      // TRIAL_LOW: sustained longer than the balanced max on a long bout at
      // or just above trial pace — only possible if the level is wrong.
      if (c.effort_seconds <= TRIAL_SECONDS && c.effort_seconds >= 180 && c.sustain > 1.05 && (c.bout_seconds ?? 0) >= 300) trialLow = true;
      // CEILING vs balanced: a short all-out bout's pace against what the
      // machine's curve says a balanced athlete holds for that bout.
      if (c.bout_seconds != null && c.bout_seconds <= 45) {
        const ratio = c.r / balancedPaceMultiple(pdc, c.bout_seconds);
        if (ceilingRatio == null || ratio > ceilingRatio) ceilingRatio = ratio;
      }
    }
    if (s.day_type === "time_trial") trialLow = false; // a retest resolves the flag
    applySession(curve, s, c, pdc);
    out.push({ ...s, ...c });
  }

  const flags: string[] = [];
  if (trialLow) flags.push("TRIAL_LOW");
  // A short max effort well ABOVE the balanced curve, relative to the trial,
  // is not a strong sprint — it is a trial (aerobic level) that lags the
  // athlete's fast-twitch capacity (founder, 2026-11-16). Named accordingly.
  if (ceilingRatio != null && ceilingRatio >= 1.05) flags.push("AEROBIC_SIDE_BEHIND_SPRINT");
  else if (ceilingRatio != null && ceilingRatio <= 0.9) flags.push("GLYCOLYTIC_BELOW_BALANCED");
  for (const k of uncalibrated) flags.push(`UNCALIBRATED:${k}`);
  if (curve.awaiting_right_anchor) flags.push("AWAITING_RIGHT_ANCHOR");
  curve.flags = flags;
  return { curve, sessions: out };
}

// ─── Summary for the sequencer ───────────────────────────────────────────────

export interface RegionSummary {
  label: string;
  seconds_lo: number;
  seconds_hi: number | null;
  m: number | null;
  state: NodeState;
  n: number;
  trend: "up" | "flat" | "down" | "unknown";
}

/** Effort-duration bands, short on the right as on the chart. */
export const REGIONS: Array<[number, number | null, string]> = [
  [1200, 2400, "20–40 min"],
  [600, 1200, "10–20 min"],
  [240, 600, "4–10 min"],
  [120, 240, "2–4 min"],
  [60, 120, "1–2 min"],
  [30, 60, "30–60 s"],
  [0, 30, "≤30 s"],
];

export function summarizeCurve(curve: EngineCurve, sessions: ReplayResult["sessions"], now = curve.as_of ?? ""): RegionSummary[] {
  return REGIONS.map(([lo, hi, label]) => {
    const inBand = (sec: number) => sec >= lo && (hi == null || sec < hi);
    const nodes = curve.nodes.filter((n) => inBand(n.seconds));
    const totalConf = nodes.reduce((a, n) => a + n.conf, 0);
    const m = totalConf > 0 ? nodes.reduce((a, n) => a + n.m * n.conf, 0) / totalConf : null;
    const state: NodeState = nodes.some((n) => n.state === "measured") ? "measured" : nodes.some((n) => n.state === "floor") ? "floor" : "blank";
    const ceil = sessions.filter((s) => s.evidence === "ceiling" && s.effort_seconds != null && inBand(s.effort_seconds) && s.sustain != null);
    const recent = ceil.filter((s) => now && daysBetween(s.date, now) <= 28).map((s) => s.sustain as number);
    const prior = ceil.filter((s) => now && daysBetween(s.date, now) > 28 && daysBetween(s.date, now) <= 56).map((s) => s.sustain as number);
    let trend: RegionSummary["trend"] = "unknown";
    if (recent.length && prior.length) {
      const d = mean(recent) - mean(prior);
      trend = d > 0.03 ? "up" : d < -0.03 ? "down" : "flat";
    } else if (recent.length >= 2) {
      trend = "flat";
    }
    return { label, seconds_lo: lo, seconds_hi: hi, m: m != null ? Number(m.toFixed(3)) : null, state, n: Number(totalConf.toFixed(1)), trend };
  });
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** The prompt block the sequencer receives (spec §5). */
export function formatCurveForPrompt(curve: EngineCurve, regions: RegionSummary[], trials: TrialInput[], opts?: { trialsShown?: number }): string {
  const shown = opts?.trialsShown ?? 6;
  const lines: string[] = [];
  lines.push("ATHLETE CONDITIONING CURVE (by effort duration — the bout a balanced athlete sustains at the pace the athlete actually delivered; M = ceiling vs a balanced athlete at your level, 1.0 = balanced; efforts of 40 min+ are zone 2: dose, not scored)");
  lines.push("effort: " + regions.map((x) => x.label.padEnd(11)).join(""));
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
