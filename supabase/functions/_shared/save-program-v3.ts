/**
 * save-program-v3.ts
 *
 * Shared persistence for a v3 structured program (WriterOutput) — the single
 * write path for BOTH doors into v3 program storage:
 *   - generate-program-v3 (the AI writer)
 *   - preprocess-program  (freelance ingestion of a pasted/uploaded program)
 *
 * Writes programs → program_workouts → program_blocks_v2 →
 * program_movements_v2, with delete-the-program rollback on any failure.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { WriterOutput } from "./v2-output-schema.ts";
import type { SkeletonOutput } from "./v3-output-schema.ts";

interface InsertedWorkout {
  id: string;
  week_num: number;
  day_num: number;
}

/**
 * Round a prescribed weight to plate math so the writer's odd numbers
 * (e.g. 208lb or 67.3kg) snap to a liftable bar. lbs → nearest 5,
 * kg → nearest 2.5. Null and non-positive weights pass through unchanged
 * (bodyweight / distance-only / time-only movements).
 */
function roundToPlateMath(w: number | null, unit: string | null): number | null {
  if (w == null) return null;
  if (!Number.isFinite(w) || w <= 0) return w;
  const step = unit === 'kg' ? 2.5 : 5;
  return Math.round(w / step) * step;
}

/**
 * Reconcile `reps` with `rep_scheme` at save time. The writer emits the
 * per-iteration breakdown as an array; code does the addition so the scalar
 * `reps` is always accurate (no LLM arithmetic).
 *
 * Returns the [reps, rep_scheme] pair to persist:
 *   - rep_scheme present + valid → reps = sum(rep_scheme), rep_scheme persisted
 *   - rep_scheme missing → reps and rep_scheme pass through unchanged
 *   - rep_scheme empty or malformed → drop it, keep the original reps
 */
function reconcileReps(
  reps: number | null | undefined,
  repScheme: number[] | null | undefined,
): { reps: number | null; rep_scheme: number[] | null } {
  if (!Array.isArray(repScheme) || repScheme.length === 0) {
    return { reps: reps ?? null, rep_scheme: null };
  }
  const cleaned = repScheme.filter((n) => Number.isFinite(n) && n > 0 && n <= 1000);
  if (cleaned.length === 0) {
    return { reps: reps ?? null, rep_scheme: null };
  }
  const sum = cleaned.reduce((a, b) => a + b, 0);
  return { reps: sum, rep_scheme: cleaned };
}

/**
 * Build a per-block intent object from the skeleton day's metadata.
 * Each block type carries the slice of skeleton reasoning that shaped it.
 * Returns null when there is no skeleton (e.g. an ingested program).
 */
function buildBlockIntent(
  daySkel:
    | {
      day_intent: string;
      primary_lift?: string;
      strength_scheme?: string;
      metcon_focus?: string;
      skill_focus?: string;
      block_intents?: Array<{
        block_type: string;
        focus: string;
        purpose: string;
        source_priority_rank?: number;
      }>;
    }
    | undefined,
  blockType: string,
): Record<string, unknown> | null {
  if (!daySkel) return null;
  const base: Record<string, unknown> = { day_intent: daySkel.day_intent };
  // Movement-level focus the fill reads (the lift / skill / metcon descriptor).
  if (blockType === "strength") {
    if (daySkel.primary_lift) base.focus = daySkel.primary_lift;
    if (daySkel.strength_scheme) base.scheme = daySkel.strength_scheme;
  } else if (blockType === "metcon") {
    if (daySkel.metcon_focus) base.focus = daySkel.metcon_focus;
  } else if (blockType === "skills") {
    if (daySkel.skill_focus) base.focus = daySkel.skill_focus;
  }
  // DECLARED coaching intent (Step 3): the FocusArea + purpose this block serves.
  // Distinct from `focus` above (a movement descriptor) — coaching_focus is the
  // typed axis, for explainability + traceability.
  const declared = daySkel.block_intents?.find((bi) => bi.block_type === blockType);
  if (declared) {
    base.coaching_focus = declared.focus;
    base.purpose = declared.purpose;
    if (declared.source_priority_rank != null) base.source_priority_rank = declared.source_priority_rank;
  }
  return base;
}

export interface SaveProgramV3Opts {
  /** programs.name — "AI Programmer (v3)" for generation, the user's title for ingestion. */
  name: string;
  /** Skeleton metadata for block_intent. Null/omitted for an ingested program. */
  skeleton?: SkeletonOutput | null;
  /** "external" marks an ingested (freelance) program; omitted for generation. */
  source?: string;
  gymName?: string | null;
  isOngoing?: boolean;
  committed?: boolean;
  /** APPEND MODE: when set, do NOT insert a new programs row — append this
   *  cycle's workouts/blocks/movements to the existing program and bump
   *  generated_months. Used by v3 monthly continuation. */
  programId?: string;
  /** Which cycle this output is (1 = first cycle). Drives program_workouts.
   *  month_number + a month-offset sort_order so multiple cycles coexist in one
   *  program and render under their own "Month N" section. Defaults to 1. */
  monthNumber?: number;
}

/**
 * Persist a WriterOutput as a v3 program. Returns the new program id.
 * On any failure the program row is deleted (children cascade) and the
 * error is re-thrown.
 */
export async function saveProgramV3(
  supa: SupabaseClient,
  userId: string,
  output: WriterOutput,
  opts: SaveProgramV3Opts,
): Promise<string> {
  const monthNumber = opts.monthNumber ?? 1;
  const appendMode = !!opts.programId;

  // 1. programs row — insert a new one (first cycle) or reuse the existing
  //    program (append/continuation mode).
  let programId: string;
  if (appendMode) {
    programId = opts.programId!;
  } else {
    const programRow: Record<string, unknown> = {
      user_id: userId,
      name: opts.name,
      program_version: "v3",
      month_plan: output.month_plan ?? null,
      // AI-generated programs must be source='generated' so the programs list
      // renders month expansion AND the auto-continuation paths (stripe-webhook
      // + monthly-generation-cron both filter .eq("source","generated")) can
      // find this program to drip the next month. Freelance ingestion overrides
      // to 'external' below.
      source: "generated",
    };
    if (opts.source === "external") {
      programRow.source = "external";
      if (opts.gymName) programRow.gym_name = opts.gymName;
      programRow.is_ongoing = opts.isOngoing === true;
      programRow.committed = opts.committed === true;
    }
    const { data: program, error: progErr } = await supa
      .from("programs")
      .insert(programRow)
      .select("id")
      .single();
    if (progErr || !program) {
      throw new Error(`[save-v3] programs insert failed: ${progErr?.message ?? "unknown"}`);
    }
    programId = program.id as string;
  }

  try {
    // 2. program_workouts — one row per day.
    const workoutInserts: Array<Record<string, unknown>> = [];
    for (const week of output.weeks) {
      for (const day of week.days) {
        workoutInserts.push({
          program_id: programId,
          week_num: week.week_num,
          day_num: day.day_num,
          month_number: monthNumber,
          workout_text: null,
          // Month-offset so cycles sort sequentially (month 2 after month 1)
          // within the program; ProgramDetailPage orders by sort_order and
          // groups by month_number. Month 1 → (0)+..., matching prior rows.
          sort_order: (monthNumber - 1) * 100 + (week.week_num - 1) * 10 + day.day_num,
        });
      }
    }
    const { data: workouts, error: wkErr } = await supa
      .from("program_workouts")
      .insert(workoutInserts)
      .select("id, week_num, day_num");
    if (wkErr || !workouts) {
      throw new Error(`[save-v3] program_workouts insert failed: ${wkErr?.message ?? "unknown"}`);
    }
    const workoutByDay = new Map<string, InsertedWorkout>();
    for (const w of workouts as InsertedWorkout[]) {
      workoutByDay.set(`${w.week_num}-${w.day_num}`, w);
    }

    // Index skeleton days for block_intent. Empty when no skeleton (ingested).
    const skelDayByKey = new Map<
      string,
      {
        day_intent: string;
        primary_lift?: string;
        strength_scheme?: string;
        metcon_focus?: string;
        skill_focus?: string;
        block_intents?: Array<{ block_type: string; focus: string; purpose: string; source_priority_rank?: number }>;
      }
    >();
    if (opts.skeleton) {
      for (const skWeek of opts.skeleton.weeks) {
        for (const skDay of skWeek.days) {
          skelDayByKey.set(`${skWeek.week_num}-${skDay.day_num}`, skDay);
        }
      }
    }

    // 3. program_blocks_v2 — one row per block per day.
    const blockInserts: Array<Record<string, unknown>> = [];
    const blockKeys: string[] = [];
    for (const week of output.weeks) {
      for (const day of week.days) {
        const w = workoutByDay.get(`${week.week_num}-${day.day_num}`);
        if (!w) throw new Error(`[save-v3] missing program_workouts row for w${week.week_num}d${day.day_num}`);
        const skDay = skelDayByKey.get(`${week.week_num}-${day.day_num}`);
        for (let bIdx = 0; bIdx < day.blocks.length; bIdx++) {
          const b = day.blocks[bIdx];
          blockInserts.push({
            program_workout_id: w.id,
            block_type: b.block_type,
            block_label: b.block_label ?? null,
            block_scheme: b.block_scheme ?? null,
            time_cap_seconds: b.time_cap_seconds ?? null,
            block_notes: b.block_notes ?? null,
            cardio_modality: b.cardio_modality ?? null,
            sort_order: bIdx,
            block_intent: buildBlockIntent(skDay, b.block_type),
            expected_benchmark: (b as { expected_benchmark?: unknown }).expected_benchmark ?? null,
          });
          blockKeys.push(`${week.week_num}-${day.day_num}-${bIdx}`);
        }
      }
    }
    const { data: blocks, error: blErr } = await supa
      .from("program_blocks_v2")
      .insert(blockInserts)
      .select("id");
    if (blErr || !blocks) {
      throw new Error(`[save-v3] program_blocks_v2 insert failed: ${blErr?.message ?? "unknown"}`);
    }
    const blockIdByKey = new Map<string, string>();
    for (let i = 0; i < blocks.length; i++) {
      blockIdByKey.set(blockKeys[i], (blocks[i] as { id: string }).id);
    }

    // 4. program_movements_v2 — one row per movement per block.
    const movementInserts: Array<Record<string, unknown>> = [];
    for (const week of output.weeks) {
      for (const day of week.days) {
        for (let bIdx = 0; bIdx < day.blocks.length; bIdx++) {
          const b = day.blocks[bIdx];
          const blockId = blockIdByKey.get(`${week.week_num}-${day.day_num}-${bIdx}`);
          if (!blockId) continue;
          for (let m = 0; m < b.movements.length; m++) {
            const mv = b.movements[m];
            const { reps, rep_scheme } = reconcileReps(mv.reps, mv.rep_scheme);
            movementInserts.push({
              block_id: blockId,
              movement: mv.movement,
              sets: mv.sets ?? null,
              reps,
              rep_scheme,
              weight: roundToPlateMath(mv.weight ?? null, mv.weight_unit ?? null),
              weight_unit: mv.weight_unit ?? null,
              rpe: mv.rpe ?? null,
              time_seconds: mv.time_seconds ?? null,
              distance: mv.distance ?? null,
              distance_unit: mv.distance_unit ?? null,
              calories: mv.calories ?? null,
              cardio_modality: mv.cardio_modality ?? null,
              scaling_note: mv.scaling_note ?? null,
              target_pct_1rm: mv.target_pct_1rm ?? null,
              sort_order: m,
            });
          }
        }
      }
    }
    if (movementInserts.length > 0) {
      const { error: mvErr } = await supa.from("program_movements_v2").insert(movementInserts);
      if (mvErr) throw new Error(`[save-v3] program_movements_v2 insert failed: ${mvErr.message}`);
    }

    // Record how many cycles this program now has. Set for BOTH paths: first
    // cycle → 1 (so continuation math nextMonth = generated_months + 1 works),
    // append → the new month number. Only ever raises.
    const { error: bumpErr } = await supa
      .from("programs")
      .update({ generated_months: monthNumber }) // NB: programs has no updated_at column
      .eq("id", programId)
      .lt("generated_months", monthNumber); // no-op if already at/ahead of this month
    if (bumpErr) {
      // Non-fatal for first cycle (generated_months may already be >=1), but in
      // append mode a failure here means continuation math would stall — surface it.
      if (appendMode) throw new Error(`[save-v3] generated_months bump failed: ${bumpErr.message}`);
      console.warn(`[save-v3] generated_months bump warning: ${bumpErr.message}`);
    }

    return programId;
  } catch (err) {
    if (appendMode) {
      // Append failure: remove ONLY this cycle's partial rows (cascades to its
      // blocks/movements). NEVER delete the program — prior months must survive.
      await supa
        .from("program_workouts")
        .delete()
        .eq("program_id", programId)
        .eq("month_number", monthNumber)
        .then(() => {}, () => {});
    } else {
      // First-cycle failure: delete the new program (children cascade).
      await supa.from("programs").delete().eq("id", programId).then(() => {}, () => {});
    }
    throw err;
  }
}
