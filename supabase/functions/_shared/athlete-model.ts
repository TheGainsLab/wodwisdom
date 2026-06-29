/**
 * athlete-model.ts
 *
 * Step 1 of the coaching-state architecture (see memory:
 * coaching-state-architecture). The DETERMINISTIC truth layer.
 *
 * `buildAthleteModel()` is a PURE function — no LLM, no I/O, no clock.
 * Given the athlete's static profile inputs (+ competition, + later
 * training history), it computes the facts that every downstream stage
 * (eval, skeleton, week-fill) used to RE-derive in prose: strength
 * ratios, bodyweight multipliers, normative positions, recovery class.
 *
 * THE FACT/JUDGMENT SEAM (locked):
 *   - This layer emits FACTS + a normative position ("snatch ratio 0.605;
 *     position below"). It NEVER emits the word "weakness" and NEVER a
 *     priority label (develop/maintain/ignore). That judgment belongs to
 *     Coaching Strategy (Step 2). `ranked_by_position` is a FACTUAL
 *     ordering only — most-below-benchmark first — NOT a programming
 *     priority.
 *
 * v1 scope:
 *   - capabilities source = self_reported (confidence "low").
 *   - thresholds = gender-only reference bars (age handled via
 *     recovery_class downstream). They are "advanced" bars, so "below" is
 *     common and means "below advanced," NOT a weakness.
 *   - training history / assessments accepted in the signature but UNUSED
 *     (wired in at the Step 4 feedback loop without a schema change).
 *
 * Persistence + versioning live in persist-athlete-model.ts; this file is
 * intentionally I/O-free so it stays trivially testable.
 */

import {
  ALL_CONDITIONING_KEYS,
  ALL_EQUIPMENT_KEYS,
  ALL_LIFT_KEYS,
  ALL_SKILL_KEYS,
} from "./tier-status.ts";
import {
  type CapabilityRevision,
  INFERENCE_VERSION,
  reviseCapabilities,
} from "./athlete-inference-engine.ts";
import type { TrainingSummary } from "./training-summary.ts";

// ============================================================
// Versions — bump MODEL_BUILDER_VERSION on any logic change, and
// THRESHOLDS_VERSION on any config change. Either bump produces a NEW
// Athlete Model version on recompute (same as an input change).
// ============================================================

// v1.1 (Step 1.5): added competition_movements — movement-level competition
// percentiles as typed facts.
// v1.2 (Step 4): the Model is now a SYNTHESIZER — capabilities are revised from
// training evidence (via the Athlete Inference Engine), and ratios/normatives
// compute off the synthesized (not raw self-reported) values.
// v1.3: surfaces logged_competition_results (self-logged Try-It throwbacks) so
// CoachState/eval read them like imported competition history.
export const MODEL_BUILDER_VERSION = "v1.3";
export const THRESHOLDS_VERSION = "v1";

// ============================================================
// Types
// ============================================================

type SkillLevelLike = "none" | "beginner" | "intermediate" | "advanced";

export type Source =
  | "self_reported"
  | "competition"
  | "observed"
  | "estimated"
  | "missing";

export type Confidence = "low" | "medium" | "high";

export interface Capability {
  value: number | null;
  source: Source;
  confidence: Confidence;
  /** When these inputs were last known true (profile updated_at). Informational
   *  in v1 — the confidence envelope that lets intake→observed evolve later. */
  as_of: string | null;
}

export type Position =
  | "well_below"
  | "below"
  | "at_or_near"
  | "above"
  | "well_above";

export interface Normative {
  value: number;
  threshold: number;
  /** value − threshold. */
  gap: number;
  position: Position;
}

/**
 * The COMPLETE keyspace of normative metrics buildAthleteModel can emit — the
 * controlled vocabulary CoachState.evidence references. Exported so the Coach
 * State layer types `evidence: AthleteModelKey[]` (compiler-checked) AND feeds
 * the SAME list as the tool-schema enum (the LLM can only cite real keys).
 * Named AthleteModelKey (not NormativeKey) so it can grow past normatives
 * later without a rename. Keep in sync with buildAthleteModel's normative map.
 */
export const NORMATIVE_KEYS = [
  // strength ratios (vs thresholds.ratios)
  "snatch_to_back_squat",
  "clean_jerk_to_back_squat",
  "snatch_to_clean_jerk",
  "front_squat_to_back_squat",
  "overhead_squat_to_snatch",
  "deadlift_to_back_squat",
  // relative strength (÷ bodyweight, gender-keyed bars)
  "back_squat_to_bodyweight",
  "deadlift_to_bodyweight",
  "press_to_bodyweight",
  "bench_to_bodyweight",
  // competition percentiles (vs median p50)
  "competition_latest_percentile",
  "power_overall_percentile",
] as const;

export type AthleteModelKey = typeof NORMATIVE_KEYS[number];

/**
 * Movement-level competition performance as a typed FACT (Step 1.5). One per
 * movement the athlete has competed in (flattened from movement_affinity's
 * per-category by_movement maps). Same fact/judgment seam as the strength
 * normatives: this is the percentile vs the population median — NOT a weakness
 * label. "66th percentile" can still be a relative gap for a 90th-percentile
 * athlete; that judgment is CoachState's, made by comparing to the athlete's
 * own competition_latest_percentile.
 *
 * CAVEAT: percentile is pooled across competition stages (Open's huge field +
 * Quarterfinals). Per-stage weighting is a future refinement.
 */
export interface MovementNormative {
  /** Display name as returned by the competition service. */
  movement: string;
  /** avg_percentile vs the population (0–100). */
  percentile: number;
  threshold: number; // 50 (median)
  gap: number; // percentile − 50
  position: Position;
  /** Number of competition exposures behind the percentile. */
  sample_size: number;
  /** Confidence in the FACT, from sample_size (not a coaching judgment). */
  confidence: Confidence;
}

/** Build the per-call CoachState evidence keyspace = the static strength
 *  normative keys + this athlete's competition-movement keys. */
export function athleteModelEvidenceKeys(
  model: { competition_movements?: Record<string, unknown> | null } | null | undefined,
): string[] {
  return [...NORMATIVE_KEYS, ...Object.keys(model?.competition_movements ?? {})];
}

export type RecoveryClass =
  | "open"
  | "masters_35"
  | "masters_40"
  | "masters_45"
  | "masters_50"
  | "masters_55"
  | "masters_60";

/** The static inputs the model is computed from — exactly what
 *  build-writer-payload already hydrates. Lifts + skills keyed by the
 *  canonical SNAKE keys. */
export interface AthleteProfileStatic {
  age: number | null;
  bodyweight: number | null;
  /** Raw user value (e.g. "male"/"female"); normalized internally. */
  gender: string | null;
  height: number | null;
  units: "lbs" | "kg" | null;
  lifts: Record<string, number | null>;
  skills: Record<string, SkillLevelLike | null>;
  conditioning: Record<string, string | number | null>;
  equipment: Record<string, boolean>;
}

/** Structural, loose view of the competition slice the model reads. The
 *  full CompetitionPayload (build-writer-payload) is assignable to this. */
/** A Try-It throwback the athlete logged (competition_workout_results, enriched
 *  with catalog metadata). Self-logged competition evidence — fed into the model
 *  the same way imported history is, tagged source "logged". */
export interface LoggedCompetitionResult {
  workout_name: string;
  movements: string[];
  time_domain: string | null; // short | medium | long
  classification: string | null;
  score_type: string;
  score_value: number;
  finished: boolean | null;
  worldwide_percentile: number | null;
  cohort_percentile: number | null;
  avg_power_watts: number | null;
  avg_w_per_kg: number | null;
  performed_at: string;
}

export interface AthleteModelCompetitionInput {
  competition_summary?: {
    overall_competitive_tier?: string | null;
    latest_percentile?: number | null;
  } | null;
  power_profile?: {
    overall?: { cohort_percentile?: number | null } | null;
    by_time_domain?:
      | Record<string, { cohort_percentile?: number | null } | null>
      | null;
  } | null;
  /** Per-category competition affinity; per-movement percentiles live in
   *  by_movement. The full Tier4MovementAffinityEntry[] is assignable. */
  movement_affinity?:
    | Array<
      {
        by_movement?:
          | Record<string, { exposures?: number; avg_percentile?: number | null } | null>
          | null;
      } | null
    >
    | null;
}

export interface DerivedMetrics {
  competition_tier?: string | null;
  power_overall_percentile?: number | null;
  power_time_domain_percentiles?: {
    short: number | null;
    medium: number | null;
    long: number | null;
  };
  // future: consistency_score, training_age, avg_w_per_kg, competition_movement_bias
}

/** The deterministic content of an Athlete Model. version / profile_version /
 *  created_at are assigned by the persistence layer (NOT here). */
export interface AthleteModelContent {
  thresholds_version: string;
  model_builder_version: string;
  /** Inference Engine version that revised capabilities from evidence (Step 4).
   *  null when no training summary was supplied (pure intake model). */
  inference_version: string | null;

  capabilities: Record<string, Capability>;
  /** Per-lift belief revisions the Inference Engine applied (Step 4) — the
   *  "what we learned" trace. Empty when intake-only. */
  capability_revisions: CapabilityRevision[];
  recovery_class: RecoveryClass;

  /** Pure lift relationships. null when an input 1RM is missing. */
  strength_ratios: Record<string, number | null>;

  /** Non-ratio analytics only (keeps strength_ratios clean + extensible). */
  derived_metrics: DerivedMetrics;

  /** Movement-level competition percentiles as typed facts (Step 1.5). Keyed
   *  by `<snake_movement>_competition_percentile` (the key CoachState cites as
   *  evidence). Empty when unlinked / no competition movement data. Kept in its
   *  OWN section (not `normative`) so the strength normatives stay clean. */
  competition_movements: Record<string, MovementNormative>;

  /** Self-logged Try-It throwbacks (source "logged") — competition evidence the
   *  athlete generated by doing catalog workouts. Surfaced so CoachState (→ the
   *  eval) reads them like imported history. Empty when none logged. */
  logged_competition_results: LoggedCompetitionResult[];

  /** Ratios + relative-strength + competition percentiles vs thresholds.
   *  NO priority labels (fact/judgment seam). Only keys with a computable
   *  value AND threshold appear. */
  normative: Record<string, Normative>;

  /** FACTUAL ordering only — normative keys sorted most-below-benchmark
   *  first (by gap / threshold ascending). NEVER a programming priority;
   *  "what to train" is owned solely by Coaching Strategy. */
  ranked_by_position: string[];
}

/** The persisted, versioned snapshot. */
export interface AthleteModel extends AthleteModelContent {
  version: number;
  profile_version: number;
  created_at: string;
}

// ============================================================
// Thresholds — curated coaching knowledge encoded as DATA (the place
// expertise enters the deterministic layer). A change here → a new
// THRESHOLDS_VERSION → a new Athlete Model version on recompute.
//
// SEMANTICS: relative_strength bars are ADVANCED reference bars, not
// "average" — so "below" is common and means "below advanced," NOT a
// weakness. The priority call is Coaching Strategy's (fact/judgment seam).
// v1 = gender-only (age handled via recovery_class downstream).
// ============================================================

export interface Thresholds {
  version: string;
  ratios: Record<string, number>;
  relative_strength: { men: Record<string, number>; women: Record<string, number> };
}

export const THRESHOLDS_V1: Thresholds = {
  version: THRESHOLDS_VERSION,
  ratios: {
    snatch_to_back_squat: 0.60,
    clean_jerk_to_back_squat: 0.80,
    snatch_to_clean_jerk: 0.76,
    front_squat_to_back_squat: 0.85,
    overhead_squat_to_snatch: 0.95,
    deadlift_to_back_squat: 1.30,
  },
  relative_strength: {
    men: { back_squat: 1.90, deadlift: 2.50, press: 0.86, bench: 1.46 },
    women: { back_squat: 1.50, deadlift: 2.00, press: 0.60, bench: 1.00 },
  },
};

// Relative-deviation bands for the {value vs threshold} → Position mapping.
// Symmetric + threshold-relative so a single rule covers ratios and
// percentiles. Purely factual classification — no coaching judgment.
const POSITION_BANDS = {
  well_below: -0.15, // dev < -0.15
  below: -0.05, //      -0.15 <= dev < -0.05
  // -0.05 <= dev <= 0.05 → at_or_near
  above: 0.05, //        0.05 < dev <= 0.15
  well_above: 0.15, //   dev > 0.15
} as const;

// ============================================================
// Helpers
// ============================================================

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pos(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Safe ratio: null when numerator/denominator missing or denominator 0. */
function ratio(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return round(a / b);
}

export function normalizeGender(g: string | null): "men" | "women" | null {
  if (typeof g !== "string") return null;
  const s = g.trim().toLowerCase();
  if (s === "men" || s === "male" || s === "m" || s === "man") return "men";
  if (s === "women" || s === "female" || s === "f" || s === "woman") return "women";
  return null;
}

/** Normalize a competition movement display name to a stable snake key. */
export function normalizeMovementKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function movementConfidence(exposures: number): Confidence {
  if (exposures >= 8) return "high";
  if (exposures >= 3) return "medium";
  return "low";
}

export function recoveryClassForAge(age: number | null): RecoveryClass {
  if (age == null || !Number.isFinite(age) || age < 35) return "open";
  if (age < 40) return "masters_35";
  if (age < 45) return "masters_40";
  if (age < 50) return "masters_45";
  if (age < 55) return "masters_50";
  if (age < 60) return "masters_55";
  return "masters_60";
}

function classifyPosition(value: number, threshold: number): Position {
  if (threshold === 0) return "at_or_near";
  const dev = (value - threshold) / threshold;
  if (dev < POSITION_BANDS.well_below) return "well_below";
  if (dev < POSITION_BANDS.below) return "below";
  if (dev <= POSITION_BANDS.above) return "at_or_near";
  if (dev <= POSITION_BANDS.well_above) return "above";
  return "well_above";
}

function makeNormative(value: number | null, threshold: number | null): Normative | null {
  if (value == null || threshold == null || threshold === 0) return null;
  return {
    value: round(value),
    threshold: round(threshold),
    gap: round(value - threshold),
    position: classifyPosition(value, threshold),
  };
}

function asSkill(v: unknown): SkillLevelLike | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s === "none" || s === "beginner" || s === "intermediate" || s === "advanced"
    ? s
    : null;
}

function asCond(v: unknown): string | number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

/** Raw athlete_profiles-shaped row (the JSONB blobs are uncoerced). */
export interface RawProfileRow {
  age: number | null;
  height: number | null;
  bodyweight: number | null;
  gender: string | null;
  units: string | null;
  lifts: Record<string, unknown> | null;
  skills: Record<string, unknown> | null;
  conditioning: Record<string, unknown> | null;
  equipment: Record<string, unknown> | null;
}

/**
 * Hydrate a raw athlete_profiles row into the canonical-key AthleteProfileStatic
 * the model consumes — the SAME coercion build-writer-payload applies (positive-
 * finite lifts, skill-level whitelist, conditioning string|number, equipment
 * boolean), so the model's inputs always match what the LLM is shown. Lifts +
 * skills keyed by SNAKE key. Used by build-writer-payload AND the read-only
 * inspector (which must NOT persist, so it can't go through buildWriterPayload).
 */
export function profileStaticFromRow(row: RawProfileRow): AthleteProfileStatic {
  const lifts: Record<string, number | null> = {};
  for (const k of ALL_LIFT_KEYS) lifts[k] = pos((row.lifts ?? {})[k]);

  const skills: Record<string, SkillLevelLike | null> = {};
  for (const k of ALL_SKILL_KEYS) skills[k] = asSkill((row.skills ?? {})[k]);

  const conditioning: Record<string, string | number | null> = {};
  for (const k of ALL_CONDITIONING_KEYS) conditioning[k] = asCond((row.conditioning ?? {})[k]);

  const equipment: Record<string, boolean> = {};
  for (const k of ALL_EQUIPMENT_KEYS) equipment[k] = (row.equipment ?? {})[k] === true;

  const units = row.units === "lbs" || row.units === "kg" ? row.units : null;

  return {
    age: num(row.age),
    bodyweight: num(row.bodyweight),
    gender: typeof row.gender === "string" && row.gender.trim() !== "" ? row.gender.trim() : null,
    height: num(row.height),
    units,
    lifts,
    skills,
    conditioning,
    equipment,
  };
}

// ============================================================
// Model diff — "what did we learn about the athlete?" (Step 4). Pure compare of
// two Athlete Model snapshots → capability + normative-position changes. Powers
// the three-diffs product story (training / belief / decisions) and the eval's
// "what changed" narrative. Deterministic.
// ============================================================

export interface AthleteModelDiff {
  capability_changes: Array<{
    lift: string;
    from: number | null;
    to: number | null;
    from_source: Source;
    to_source: Source;
  }>;
  position_changes: Array<{ key: string; from: Position; to: Position }>;
}

export function athleteModelDiff(
  prev: Pick<AthleteModelContent, "capabilities" | "normative"> | null,
  next: Pick<AthleteModelContent, "capabilities" | "normative">,
): AthleteModelDiff {
  const capability_changes: AthleteModelDiff["capability_changes"] = [];
  for (const [lift, cap] of Object.entries(next.capabilities)) {
    const before = prev?.capabilities?.[lift];
    if (!before) continue;
    if (before.value !== cap.value || before.source !== cap.source) {
      capability_changes.push({
        lift,
        from: before.value,
        to: cap.value,
        from_source: before.source,
        to_source: cap.source,
      });
    }
  }
  const position_changes: AthleteModelDiff["position_changes"] = [];
  for (const [key, n] of Object.entries(next.normative)) {
    const before = prev?.normative?.[key];
    if (before && before.position !== n.position) {
      position_changes.push({ key, from: before.position, to: n.position });
    }
  }
  return { capability_changes, position_changes };
}

// ============================================================
// Main entry point — PURE.
// ============================================================

export interface BuildAthleteModelOptions {
  /** Profile updated_at — stamped into each capability's `as_of`. */
  asOf?: string | null;
  thresholds?: Thresholds;
  /** Observed training evidence (Step 4). When present, the Inference Engine
   *  revises capabilities from it and ratios/normatives compute off the
   *  synthesized values. null/omitted → pure intake model (no-penalty). */
  trainingSummary?: TrainingSummary | null;
  /** Self-logged Try-It throwbacks (source "logged"), independent of whether the
   *  athlete linked official history — surfaced on the model so CoachState (→ the
   *  eval) and, via CoachState, the generator read them like imported results. */
  loggedCompetitionResults?: LoggedCompetitionResult[] | null;
  // assessments: accepted by the LOCKED signature but UNUSED (future evidence
  // source — plugs into the same synthesizer seam).
  assessments?: unknown;
}

export function buildAthleteModel(
  profile: AthleteProfileStatic,
  competition: AthleteModelCompetitionInput | null,
  options: BuildAthleteModelOptions = {},
): AthleteModelContent {
  const thresholds = options.thresholds ?? THRESHOLDS_V1;
  const asOf = options.asOf ?? null;

  const lifts = profile.lifts ?? {};
  const bw = pos(profile.bodyweight);
  const gender = normalizeGender(profile.gender);

  // --- Capabilities: start from self-reported intake, then SYNTHESIZE with
  //     observed training evidence via the Athlete Inference Engine (Step 4).
  //     The Model is the current best belief, not just the intake claim.
  const selfReported: Record<string, Capability> = {};
  for (const k of ALL_LIFT_KEYS) {
    const value = pos(lifts[k]);
    selfReported[k] = {
      value,
      source: value != null ? "self_reported" : "missing",
      confidence: "low",
      as_of: value != null ? asOf : null,
    };
  }
  const trainingSummary = options.trainingSummary ?? null;
  const { capabilities, revisions: capability_revisions } = reviseCapabilities(
    selfReported,
    trainingSummary,
  );
  const inference_version = trainingSummary ? INFERENCE_VERSION : null;

  // Ratios/normatives compute off the SYNTHESIZED capability values (the belief),
  // not the raw intake — so an evidence-raised squat flows into every ratio.
  const L = (k: string): number | null => capabilities[k]?.value ?? null;

  // --- Strength ratios (pure lift relationships; null when input missing) ---
  const strength_ratios: Record<string, number | null> = {
    snatch_to_back_squat: ratio(L("snatch"), L("back_squat")),
    clean_jerk_to_back_squat: ratio(L("clean_and_jerk"), L("back_squat")),
    snatch_to_clean_jerk: ratio(L("snatch"), L("clean_and_jerk")),
    front_squat_to_back_squat: ratio(L("front_squat"), L("back_squat")),
    overhead_squat_to_snatch: ratio(L("overhead_squat"), L("snatch")),
    back_squat_to_bodyweight: ratio(L("back_squat"), bw),
    deadlift_to_bodyweight: ratio(L("deadlift"), bw),
    press_to_bodyweight: ratio(L("press"), bw),
    bench_to_bodyweight: ratio(L("bench_press"), bw),
    deadlift_to_back_squat: ratio(L("deadlift"), L("back_squat")),
  };

  const recovery_class = recoveryClassForAge(num(profile.age));

  // --- Derived metrics (non-ratio analytics from competition) ---
  const derived_metrics: DerivedMetrics = {};
  if (competition) {
    const tier = competition.competition_summary?.overall_competitive_tier ?? null;
    if (tier != null) derived_metrics.competition_tier = tier;
    const overall = num(competition.power_profile?.overall?.cohort_percentile);
    if (overall != null) derived_metrics.power_overall_percentile = overall;
    const byTd = competition.power_profile?.by_time_domain;
    if (byTd) {
      derived_metrics.power_time_domain_percentiles = {
        short: num(byTd.short?.cohort_percentile ?? null),
        medium: num(byTd.medium?.cohort_percentile ?? null),
        long: num(byTd.long?.cohort_percentile ?? null),
      };
    }
  }

  // --- Normative: ratios + relative-strength + competition percentiles ---
  const normative: Record<string, Normative> = {};

  for (const key of Object.keys(thresholds.ratios)) {
    const n = makeNormative(strength_ratios[key], thresholds.ratios[key]);
    if (n) normative[key] = n;
  }

  // Relative-strength bars are gender-keyed; only when gender known.
  if (gender) {
    const bars = thresholds.relative_strength[gender];
    const relMap: Record<string, string> = {
      back_squat_to_bodyweight: "back_squat",
      deadlift_to_bodyweight: "deadlift",
      press_to_bodyweight: "press",
      bench_to_bodyweight: "bench",
    };
    for (const [ratioKey, barKey] of Object.entries(relMap)) {
      const n = makeNormative(strength_ratios[ratioKey], bars[barKey] ?? null);
      if (n) normative[ratioKey] = n;
    }
  }

  // --- Movement-level competition facts (Step 1.5) ---
  // Flatten movement_affinity's per-category by_movement maps into one typed
  // map. Each movement = its percentile vs the population median. A movement
  // competed in multiple categories keeps the higher-exposure reading.
  const competition_movements: Record<string, MovementNormative> = {};
  for (const cat of competition?.movement_affinity ?? []) {
    const byMovement = cat?.by_movement;
    if (!byMovement) continue;
    for (const [name, stats] of Object.entries(byMovement)) {
      const pct = num(stats?.avg_percentile);
      const exposures = num(stats?.exposures) ?? 0;
      if (pct == null || exposures <= 0) continue;
      const key = `${normalizeMovementKey(name)}_competition_percentile`;
      const existing = competition_movements[key];
      if (existing && existing.sample_size >= exposures) continue;
      competition_movements[key] = {
        movement: name,
        percentile: round(pct, 2),
        threshold: 50,
        gap: round(pct - 50, 2),
        position: classifyPosition(pct, 50),
        sample_size: exposures,
        confidence: movementConfidence(exposures),
      };
    }
  }

  // Competition percentiles vs the median (p50) — factual position only.
  if (competition) {
    const latest = num(competition.competition_summary?.latest_percentile);
    const n1 = makeNormative(latest, 50);
    if (n1) normative.competition_latest_percentile = n1;
    const powerOverall = num(competition.power_profile?.overall?.cohort_percentile);
    const n2 = makeNormative(powerOverall, 50);
    if (n2) normative.power_overall_percentile = n2;
  }

  // --- ranked_by_position: FACTUAL ordering, most-below-benchmark first ---
  // Sort by normalized gap (gap / threshold) ascending. NOT a priority.
  const ranked_by_position = Object.entries(normative)
    .map(([key, n]) => ({ key, norm: n.threshold === 0 ? 0 : n.gap / n.threshold }))
    .sort((a, b) => a.norm - b.norm)
    .map((e) => e.key);

  return {
    thresholds_version: thresholds.version,
    model_builder_version: MODEL_BUILDER_VERSION,
    inference_version,
    capabilities,
    capability_revisions,
    recovery_class,
    strength_ratios,
    derived_metrics,
    competition_movements,
    logged_competition_results: options.loggedCompetitionResults ?? [],
    normative,
    ranked_by_position,
  };
}
