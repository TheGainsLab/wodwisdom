/**
 * block-edit.ts — the chat coach's hands.
 *
 * The AI Coach's day-scoped chat can PROPOSE a structured edit to one block of
 * the athlete's program (2026-08-12 ruling: the chat replaces the retired AI
 * Edit button — conversation is the deliberation the button's one-shot lock
 * was simulating, so proposals are unlimited and each rides the thread).
 *
 * Contract (mirrors adjust-workout's propose path, which this supersedes):
 *   - Proposals are emitted in the SAME BlockPrescription schema the program
 *     writer uses, so an edited block is indistinguishable from a generated
 *     one — logging, review, history, and next-cycle reads all keep working.
 *   - Validation is server-side and BEFORE the athlete sees anything: the
 *     do_not_program list is absolute, movements come from the vocabulary.
 *     An illegal proposal bounces back to the model, never to the athlete.
 *   - Apply is server-side (apply-block-edit fn): write rows, mark the
 *     ai_edit_log row accepted, and for metcons null-then-recompute the
 *     expected_benchmark (the stale-benchmark gap the old button left).
 *   - ai_edit_log rows form a proposal CHAIN (each row snapshots the block it
 *     replaced; outcome: null=pending, accepted, refused). No per-block lock.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildEmitBlockTool,
  type BlockPrescription,
  type MovementPrescription,
} from "./v2-output-schema.ts";
import {
  computeMergedAvoidance,
  fetchVocabulary,
  type AvoidanceConfirmed,
  type InjuryConstraints,
} from "./build-writer-payload.ts";
import { buildRecentLoadLine, fetchOutsideTraining } from "./athlete-activities.ts";
import { computeBlockBenchmark } from "./compute-block-benchmark.ts";
import { normalizeGender } from "./metcon-workcalc.ts";

// ---------------------------------------------------------------------------
// Day blocks — what the coach may reference
// ---------------------------------------------------------------------------

export interface DayBlockRef {
  id: string;
  block_type: string;
  block_label: string | null;
  block_scheme: string | null;
}

/** The coached block types the tool may target. Warm-up/cool-down edits are
 *  conversation, not proposals — nobody negotiates their warm-up card. */
const EDITABLE_BLOCK_TYPES = new Set(["strength", "metcon", "skills", "accessory"]);

export async function loadDayBlocks(
  supa: SupabaseClient,
  programWorkoutId: string,
): Promise<DayBlockRef[]> {
  const { data } = await supa
    .from("program_blocks_v2")
    .select("id, block_type, block_label, block_scheme, sort_order")
    .eq("program_workout_id", programWorkoutId)
    .order("sort_order");
  return ((data ?? []) as (DayBlockRef & { sort_order: number })[])
    .filter((b) => EDITABLE_BLOCK_TYPES.has(b.block_type))
    .map(({ id, block_type, block_label, block_scheme }) => ({ id, block_type, block_label, block_scheme }));
}

// ---------------------------------------------------------------------------
// Block load + ownership
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
function rowToMovement(m: any): MovementPrescription {
  const mv: MovementPrescription = { movement: m.movement };
  if (m.sets != null) mv.sets = m.sets;
  if (m.reps != null) mv.reps = m.reps;
  if (Array.isArray(m.rep_scheme)) mv.rep_scheme = m.rep_scheme;
  if (m.weight != null) mv.weight = m.weight;
  if (m.weight_unit != null) mv.weight_unit = m.weight_unit;
  if (m.rpe != null) mv.rpe = m.rpe;
  if (m.time_seconds != null) mv.time_seconds = m.time_seconds;
  if (m.distance != null) mv.distance = m.distance;
  if (m.distance_unit != null) mv.distance_unit = m.distance_unit;
  if (m.scaling_note != null) mv.scaling_note = m.scaling_note;
  if (m.target_pct_1rm != null) mv.target_pct_1rm = m.target_pct_1rm;
  if (m.cardio_modality != null) mv.cardio_modality = m.cardio_modality;
  if (m.calories != null) mv.calories = m.calories;
  return mv;
}

/** Load one block as a BlockPrescription, verifying it belongs to `userId`'s
 *  program. Returns null when missing or not owned. */
export async function loadOwnedBlock(
  supa: SupabaseClient,
  blockId: string,
  userId: string,
): Promise<{ original: BlockPrescription; programWorkoutId: string } | null> {
  const { data: block } = await supa
    .from("program_blocks_v2")
    .select("id, program_workout_id, block_type, block_label, block_scheme, time_cap_seconds, block_notes, cardio_modality")
    .eq("id", blockId)
    .maybeSingle();
  if (!block) return null;

  const { data: workout } = await supa
    .from("program_workouts").select("id, program_id").eq("id", block.program_workout_id).maybeSingle();
  if (!workout) return null;
  const { data: program } = await supa
    .from("programs").select("id, user_id").eq("id", workout.program_id).maybeSingle();
  if (!program || program.user_id !== userId) return null;

  const { data: movementRows } = await supa
    .from("program_movements_v2")
    .select("movement, sets, reps, rep_scheme, weight, weight_unit, rpe, time_seconds, distance, distance_unit, scaling_note, target_pct_1rm, cardio_modality, calories, sort_order")
    .eq("block_id", blockId)
    .order("sort_order");

  const original: BlockPrescription = {
    block_type: block.block_type,
    ...(block.block_label != null ? { block_label: block.block_label } : {}),
    ...(block.block_scheme != null ? { block_scheme: block.block_scheme } : {}),
    ...(block.time_cap_seconds != null ? { time_cap_seconds: block.time_cap_seconds } : {}),
    ...(block.block_notes != null ? { block_notes: block.block_notes } : {}),
    ...(block.cardio_modality != null ? { cardio_modality: block.cardio_modality } : {}),
    movements: (movementRows ?? []).map(rowToMovement),
  };
  return { original, programWorkoutId: block.program_workout_id as string };
}

// ---------------------------------------------------------------------------
// Athlete safety context (same merge as adjust-workout + generation)
// ---------------------------------------------------------------------------

interface EditProfileRow {
  lifts?: Record<string, number> | null;
  equipment?: Record<string, boolean> | null;
  units?: string | null;
  gender?: string | null;
  injuries_constraints?: string | null;
  injuries_structured?: InjuryConstraints | null;
  injuries_constraints_hash?: string | null;
  injuries_avoidance_confirmed?: AvoidanceConfirmed | null;
}

export interface BlockEditContext {
  units: "lbs" | "kg";
  gender: string | null;
  doNotProgram: string[];
  injuryNotes: string;
  vocabulary: string[];
  /** Compact object rendered into the coach's prompt. */
  promptContext: Record<string, unknown>;
}

export async function buildBlockEditContext(
  supa: SupabaseClient,
  userId: string,
): Promise<BlockEditContext> {
  const [{ data: profile }, vocabulary, recentLoad] = await Promise.all([
    supa.from("athlete_profiles")
      .select("lifts, equipment, units, gender, injuries_constraints, injuries_structured, injuries_constraints_hash, injuries_avoidance_confirmed")
      .eq("user_id", userId)
      .maybeSingle(),
    fetchVocabulary(supa),
    fetchOutsideTraining(supa, userId).then(buildRecentLoadLine).catch(() => null),
  ]);
  const prof = (profile ?? {}) as EditProfileRow;
  const units = (prof.units === "kg" ? "kg" : "lbs") as "lbs" | "kg";
  const avoidance = computeMergedAvoidance(prof);
  const doNotProgram = avoidance.injuries_structured.do_not_program;
  const injuryNotes = (prof.injuries_constraints ?? "").trim();
  const equipmentUnavailable = prof.equipment
    ? Object.entries(prof.equipment).filter(([, v]) => v === false).map(([k]) => k.replace(/_/g, " "))
    : [];
  return {
    units,
    gender: prof.gender ?? null,
    doNotProgram,
    injuryNotes,
    vocabulary,
    promptContext: {
      units,
      lifts: prof.lifts ?? {},
      equipment_not_available: equipmentUnavailable,
      ...(doNotProgram.length > 0 ? { do_not_program: doNotProgram } : {}),
      ...(injuryNotes ? { injury_notes: injuryNotes } : {}),
      ...(recentLoad ? { recent_outside_training: recentLoad } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// The propose tool
// ---------------------------------------------------------------------------

export function buildProposeBlockEditTool(units: "lbs" | "kg", dayBlocks: DayBlockRef[]) {
  const blockSchema = buildEmitBlockTool(units, null).input_schema;
  return {
    name: "propose_block_edit",
    description:
      "Propose a revision to ONE block of today's programmed workout. The athlete sees the proposal as a card with Apply/Keep buttons — nothing changes until they tap Apply. Use ONLY after the conversation has established what the athlete actually needs (diagnose before prescribing). One proposal per message. block_id must be one of today's blocks; the block payload fully replaces the existing block, so include every movement the revised block should contain.",
    input_schema: {
      type: "object",
      properties: {
        block_id: {
          type: "string",
          enum: dayBlocks.map((b) => b.id),
          description: "The id of the block being revised (from TODAY'S BLOCKS).",
        },
        rationale: {
          type: "string",
          description: "One athlete-facing sentence: what changes and why it preserves the day's purpose.",
        },
        block: blockSchema,
      },
      required: ["block_id", "rationale", "block"],
    },
  };
}

// ---------------------------------------------------------------------------
// Validation — pure, tested
// ---------------------------------------------------------------------------

function hasVolumeSpecifier(m: MovementPrescription): boolean {
  const positive = (v: unknown) => typeof v === "number" && v > 0;
  return positive(m.sets) || positive(m.reps) || positive(m.calories) ||
    positive(m.weight) || positive(m.time_seconds) || positive(m.distance) ||
    (Array.isArray(m.rep_scheme) && m.rep_scheme.some((n) => typeof n === "number" && n > 0));
}

/** Validate a proposed block against the athlete's hard constraints. Returns
 *  problem strings (empty = legal). Safety is one of the three forever-hard
 *  classes: a banned movement NEVER reaches the athlete, even by request. */
export function validateBlockProposal(
  proposal: BlockPrescription,
  opts: { doNotProgram: string[]; vocabulary: string[] },
): string[] {
  const problems: string[] = [];
  const movements = proposal.movements ?? [];
  if (movements.length === 0) {
    problems.push("The proposed block has no movements.");
    return problems;
  }
  const banned = new Set(opts.doNotProgram.map((s) => s.toLowerCase().trim()));
  const vocab = new Set(opts.vocabulary.map((s) => s.toLowerCase().trim()));
  for (const m of movements) {
    const name = (m.movement ?? "").trim();
    if (!name) {
      problems.push("A movement is missing its name.");
      continue;
    }
    const key = name.toLowerCase();
    if (banned.has(key)) {
      problems.push(`"${name}" is on this athlete's do-not-program list — substitute a safe alternative that preserves the stimulus.`);
    }
    if (vocab.size > 0 && !vocab.has(key)) {
      problems.push(`"${name}" is not in the movement vocabulary — use an exact display name from the vocabulary list.`);
    }
    if (!hasVolumeSpecifier(m)) {
      problems.push(`"${name}" has no work specified — populate at least one of sets/reps/rep_scheme/calories/weight/time_seconds/distance.`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Apply (server-side) + benchmark refresh
// ---------------------------------------------------------------------------

/** Server-side port of the frontend applyAiProposal: reps reconciled with
 *  rep_scheme exactly as the client did (reps = sum of the cleaned scheme). */
export function reconcileReps(
  reps: number | null | undefined,
  repScheme: number[] | null | undefined,
): { reps: number | null; rep_scheme: number[] | null } {
  if (!Array.isArray(repScheme) || repScheme.length === 0) {
    return { reps: reps ?? null, rep_scheme: null };
  }
  const cleaned = repScheme.filter((n) => Number.isFinite(n) && n > 0 && n <= 1000);
  if (cleaned.length === 0) return { reps: reps ?? null, rep_scheme: null };
  return { reps: cleaned.reduce((a, b) => a + b, 0), rep_scheme: cleaned };
}

export async function applyBlockProposal(
  supa: SupabaseClient,
  blockId: string,
  proposal: BlockPrescription,
): Promise<void> {
  const { error: bErr } = await supa.from("program_blocks_v2").update({
    block_type: proposal.block_type,
    block_label: proposal.block_label ?? null,
    block_scheme: proposal.block_scheme ?? null,
    time_cap_seconds: proposal.time_cap_seconds ?? null,
    block_notes: proposal.block_notes ?? null,
    cardio_modality: proposal.cardio_modality ?? null,
    // Truthfulness: the old prediction describes a workout that no longer
    // exists. Null immediately; refreshMetconBenchmark refills best-effort.
    expected_benchmark: null,
  }).eq("id", blockId);
  if (bErr) throw new Error(`block update failed: ${bErr.message}`);

  const { error: dErr } = await supa.from("program_movements_v2").delete().eq("block_id", blockId);
  if (dErr) throw new Error(`movement delete failed: ${dErr.message}`);

  const inserts = (proposal.movements ?? []).map((m, i) => {
    const { reps, rep_scheme } = reconcileReps(m.reps, m.rep_scheme);
    return {
      block_id: blockId,
      movement: m.movement,
      sets: m.sets ?? null,
      reps,
      rep_scheme,
      weight: m.weight ?? null,
      weight_unit: m.weight_unit ?? null,
      rpe: m.rpe ?? null,
      time_seconds: m.time_seconds ?? null,
      distance: m.distance ?? null,
      distance_unit: m.distance_unit ?? null,
      calories: m.calories ?? null,
      cardio_modality: m.cardio_modality ?? null,
      scaling_note: m.scaling_note ?? null,
      target_pct_1rm: m.target_pct_1rm ?? null,
      sort_order: i,
    };
  });
  if (inserts.length) {
    const { error: iErr } = await supa.from("program_movements_v2").insert(inserts);
    if (iErr) throw new Error(`movement insert failed: ${iErr.message}`);
  }
}

/** Best-effort benchmark recompute for an edited metcon. Never throws; a
 *  failure leaves the (correctly) nulled benchmark in place. */
export async function refreshMetconBenchmark(
  supa: SupabaseClient,
  blockId: string,
  proposal: BlockPrescription,
  gender: string | null,
): Promise<void> {
  if (proposal.block_type !== "metcon") return;
  try {
    const benchmark = await computeBlockBenchmark(proposal, normalizeGender(gender));
    if (benchmark) {
      await supa.from("program_blocks_v2").update({ expected_benchmark: benchmark }).eq("id", blockId);
    }
  } catch (e) {
    console.warn(`[block-edit] benchmark refresh failed (benchmark stays null): ${(e as Error).message}`);
  }
}
