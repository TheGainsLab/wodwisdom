/**
 * build-writer-payload.ts
 *
 * v2 payload assembler. Produces the typed object that both the v2
 * writer LLM (program-gen) and the safety-review LLM consume. Replaces
 * what `derive-athlete-diagnostic.ts` + `reconciler.ts` + the prose
 * formatters did in v1: pre-digesting raw data into curated prose.
 *
 * v2's approach is the opposite — hand the LLM raw data and let it
 * apply coaching judgment, with the system prompt carrying the
 * conventions. This module does *nothing* but data shaping:
 *   - one SELECT against athlete_profiles
 *   - optionally one Tier 4 bundle fetch (when athlete is linked)
 *   - one SELECT against movements for the vocabulary
 *   - RAG passthrough (TODO: wire to v1's searchChunks chain)
 *
 * Locked design rules (see competition_history_feature_plan.md):
 *   - 9 top-level payload keys: basics, lifts, skills, conditioning,
 *     equipment, training_context, competition, vocabulary, rag.
 *   - JSONB blobs (lifts/skills/conditioning/equipment) hydrate to
 *     complete canonical-key maps; missing values = null (equipment
 *     missing = false).
 *   - days_per_week defaults to 5, clamped to [3, 6].
 *   - Tier 4 bundle is sliced: character_affinity + identity dropped;
 *     everything else passed through.
 *   - Vocabulary = display_name strings (Title Case) from movements
 *     WHERE competition_count > 0.
 *   - recent_training omitted from Month 1 payload entirely (folded
 *     into deferred month-to-month continuity work).
 *   - guidelines dropped — coaching judgment lives in the system
 *     prompt, not a parallel channel.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ALL_SKILL_KEYS,
  ALL_CONDITIONING_KEYS,
  ALL_LIFT_KEYS,
  ALL_EQUIPMENT_KEYS,
} from "./tier-status.ts";
import { fetchTier4Bundle, type Tier4Bundle } from "./fetch-tier4-bundle.ts";
import { buildRagContext } from "./build-rag-context.ts";

// ============================================================
// Payload types
// ============================================================

export type SkillLevel = "none" | "beginner" | "intermediate" | "advanced";

export interface BasicsPayload {
  age: number | null;
  height: number | null;
  bodyweight: number | null;
  gender: string | null;
  units: "lbs" | "kg" | null;
}

export interface TrainingContextPayload {
  /** User-specified or default 5; clamped to [3, 6]. */
  days_per_week: 3 | 4 | 5 | 6;
  session_length_minutes: number | null;
  /** Raw user free-text — NOT parsed. */
  goal_text: string | null;
  /** Raw user free-text — NOT parsed. */
  injuries_constraints_text: string | null;
  self_perception_level: string | null;
}

/**
 * Tier 4 slice the writer consumes. Bundle's `character_affinity` and
 * `identity` are deliberately dropped per the locked design.
 */
export interface CompetitionPayload {
  competition_summary: Tier4Bundle["competition_summary"];
  movement_affinity: Tier4Bundle["movement_affinity"];
  time_domain_modality_breakdown: Tier4Bundle["time_domain_modality_breakdown"];
  recent_raw_results: Tier4Bundle["recent_raw_results"];
  /** Per-workout career history. Optional — dropped from the program-generator
   *  payload (the aggregates carry enough signal) but kept for the evaluator. */
  all_results?: NonNullable<Tier4Bundle["all_results"]>;
  movement_competency: NonNullable<Tier4Bundle["movement_competency"]>;
  fitness_signature: NonNullable<Tier4Bundle["fitness_signature"]>;
}

export interface WriterPayload {
  basics: BasicsPayload;
  /** All 14 canonical lift keys; null when user hasn't entered. */
  lifts: Record<string, number | null>;
  /** All canonical skill keys; null when user hasn't rated. */
  skills: Record<string, SkillLevel | null>;
  /** All 7 conditioning benchmark keys; null when user hasn't entered. */
  conditioning: Record<string, string | number | null>;
  /** All canonical equipment keys; false when absent. */
  equipment: Record<string, boolean>;
  training_context: TrainingContextPayload;
  /** Tier 4 slice when linked + fetch succeeded; null otherwise. */
  competition: CompetitionPayload | null;
  /** display_name strings — the writer's allowed-movement set. */
  vocabulary: string[];
  /** Concatenated RAG context (TODO: wire to v1's searchChunks chain). */
  rag: string;
}

// ============================================================
// Helpers — coercion / hydration
// ============================================================

function clampDaysPerWeek(n: number | null | undefined): 3 | 4 | 5 | 6 {
  if (n == null || !Number.isFinite(n)) return 5;
  const r = Math.round(n);
  if (r <= 3) return 3;
  if (r >= 6) return 6;
  return r as 3 | 4 | 5 | 6;
}

function asLiftValue(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function asSkillLevel(v: unknown): SkillLevel | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "none" || s === "beginner" || s === "intermediate" || s === "advanced") {
    return s;
  }
  return null;
}

function asConditioningValue(v: unknown): string | number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

function asEquipmentValue(v: unknown): boolean {
  return v === true;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asUnits(v: unknown): "lbs" | "kg" | null {
  const s = asString(v);
  return s === "lbs" || s === "kg" ? s : null;
}

// ============================================================
// Tier 4 bundle slicer — drops character_affinity + identity; passes
// everything else through. NonNullable fallbacks return empty
// structures so the writer reads stable shapes regardless of which
// `?include=` flags the upstream returned data for.
// ============================================================

function sliceTier4Bundle(bundle: Tier4Bundle, includeAllResults: boolean): CompetitionPayload {
  const sliced: CompetitionPayload = {
    competition_summary: bundle.competition_summary,
    movement_affinity: bundle.movement_affinity,
    time_domain_modality_breakdown: bundle.time_domain_modality_breakdown,
    recent_raw_results: bundle.recent_raw_results,
    movement_competency: bundle.movement_competency ?? [],
    fitness_signature: bundle.fitness_signature ?? {
      closable_gaps: [],
      stage_progression: [],
      stimulus_breakdown: {
        overall: { all: { n_workouts: 0, cohort_percentile: 0, worldwide_percentile: 0 } },
        modality: {},
        load_class: {},
        skill_gated: {},
        time_domain: {},
      },
    },
  };
  if (includeAllResults) {
    sliced.all_results = bundle.all_results ?? [];
  }
  return sliced;
}

// ============================================================
// Vocabulary fetch — display_name strings from movements WHERE
// competition_count > 0. The writer's allowed-movement set.
// ============================================================

async function fetchVocabulary(supa: SupabaseClient): Promise<string[]> {
  const { data, error } = await supa
    .from("movements")
    .select("display_name")
    .gt("competition_count", 0)
    .order("display_name", { ascending: true });

  if (error) {
    console.warn(
      "[build-writer-payload] vocabulary fetch failed; proceeding with empty list. Audit rule #7 will reject any movement strings.",
      error,
    );
    return [];
  }
  return (data ?? [])
    .map((row) => (row as { display_name: unknown }).display_name)
    .filter((s): s is string => typeof s === "string" && s.trim() !== "");
}

// ============================================================
// RAG context — delegates to _shared/build-rag-context.ts (the
// extracted v1 chain). Takes the hydrated lifts + skills maps so
// the RAG builder doesn't have to re-walk the raw athlete_profiles
// row. Same queries, same dedup, same "REFERENCE …" prefix v1
// emits; soft-fails to "" when OPENAI_API_KEY is missing.
// ============================================================

// ============================================================
// Profile row shape — exactly the columns we SELECT.
// ============================================================

interface AthleteProfileRow {
  age: number | null;
  height: number | null;
  bodyweight: number | null;
  gender: string | null;
  units: string | null;
  lifts: Record<string, unknown> | null;
  skills: Record<string, unknown> | null;
  conditioning: Record<string, unknown> | null;
  equipment: Record<string, unknown> | null;
  days_per_week: number | null;
  session_length_minutes: number | null;
  goal: string | null;
  injuries_constraints: string | null;
  self_perception_level: string | null;
  competition_athlete_id: string | null;
}

const PROFILE_COLS =
  "age, height, bodyweight, gender, units, " +
  "lifts, skills, conditioning, equipment, " +
  "days_per_week, session_length_minutes, " +
  "goal, injuries_constraints, self_perception_level, " +
  "competition_athlete_id";

// ============================================================
// Main entry point.
// ============================================================

export interface BuildWriterPayloadOptions {
  /**
   * Include the per-workout `all_results` career array in the competition
   * slice. Defaults to true (preserves eval behavior). The program-generator
   * sets this to false — the aggregates (movement_affinity, fitness_signature,
   * movement_competency, closable_gaps) carry enough signal and the raw
   * career array adds ~50–100k tokens of noise.
   */
  includeAllResults?: boolean;
}

export async function buildWriterPayload(
  supa: SupabaseClient,
  userId: string,
  options: BuildWriterPayloadOptions = {},
): Promise<WriterPayload> {
  const includeAllResults = options.includeAllResults ?? true;

  // 1. Athlete profile row — hard requirement.
  const { data: profile, error: profileErr } = await supa
    .from("athlete_profiles")
    .select(PROFILE_COLS)
    .eq("user_id", userId)
    .maybeSingle<AthleteProfileRow>();

  if (profileErr) {
    throw new Error(
      `[build-writer-payload] athlete_profiles fetch failed for ${userId}: ${profileErr.message}`,
    );
  }
  if (!profile) {
    throw new Error(
      `[build-writer-payload] athlete_profiles row not found for user ${userId}`,
    );
  }

  // 2. Tier 4 bundle — only when linked. Soft-fails to null on any
  // upstream error (matches fetchTier4Bundle's existing contract).
  let competition: CompetitionPayload | null = null;
  if (profile.competition_athlete_id) {
    const tier4Include = ["competency", "signature"];
    if (includeAllResults) tier4Include.unshift("all_results");
    const bundle = await fetchTier4Bundle(profile.competition_athlete_id, {
      include: tier4Include,
    });
    if (bundle) {
      competition = sliceTier4Bundle(bundle, includeAllResults);
    }
  }

  // 3. Vocabulary — display_name list.
  const vocabulary = await fetchVocabulary(supa);

  // 4. Hydrate JSONB blobs to complete canonical-key maps. We need
  // these before the RAG call (it consumes lifts + skills directly).
  const lifts: Record<string, number | null> = {};
  for (const k of ALL_LIFT_KEYS) {
    lifts[k] = asLiftValue((profile.lifts ?? {})[k]);
  }

  const skills: Record<string, SkillLevel | null> = {};
  for (const k of ALL_SKILL_KEYS) {
    skills[k] = asSkillLevel((profile.skills ?? {})[k]);
  }

  // 5. RAG — same v1 chain, hydrated maps in.
  const rag = await buildRagContext(supa, lifts, skills);

  // 6. Hydrate the remaining JSONB blobs (after RAG kicked off).
  const conditioning: Record<string, string | number | null> = {};
  for (const k of ALL_CONDITIONING_KEYS) {
    conditioning[k] = asConditioningValue((profile.conditioning ?? {})[k]);
  }

  const equipment: Record<string, boolean> = {};
  for (const k of ALL_EQUIPMENT_KEYS) {
    equipment[k] = asEquipmentValue((profile.equipment ?? {})[k]);
  }

  return {
    basics: {
      age: asNumber(profile.age),
      height: asNumber(profile.height),
      bodyweight: asNumber(profile.bodyweight),
      gender: asString(profile.gender),
      units: asUnits(profile.units),
    },
    lifts,
    skills,
    conditioning,
    equipment,
    training_context: {
      days_per_week: clampDaysPerWeek(profile.days_per_week),
      session_length_minutes: asNumber(profile.session_length_minutes),
      goal_text: asString(profile.goal),
      injuries_constraints_text: asString(profile.injuries_constraints),
      self_perception_level: asString(profile.self_perception_level),
    },
    competition,
    vocabulary,
    rag,
  };
}
