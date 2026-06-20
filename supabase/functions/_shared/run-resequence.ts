/**
 * runResequence — the shared core of the Engine self-sequencer.
 *
 * One code path used by two callers:
 *   - engine-resequence (HTTP)        — admin dry-run preview / on-demand.
 *   - engine-resequence-cron (server) — automatic live generation, per eligible user.
 *
 * Flow: gate (>= MIN_COMPLETED_DAYS) -> diagnosis + catalogue + current phase ->
 * AI generates the non-pinned days of the block within each envelope -> parse +
 * validate -> (dry run returns the preview | persist accepted days as engine_workouts
 * rows + position overrides). Month-boundary time trials are pinned (left as the
 * catalog TT). Returns a plain object; the HTTP caller maps it to a response.
 *
 * See docs/engine_self_sequencing_plan.md.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "./call-claude.ts";
import { buildConditioningState } from "./conditioning-state.ts";
import { buildDayTypeCatalogue, loadDayTypeCatalogue } from "./engine-catalogue.ts";
import { parseProposal, type ProposedDay, validateProposal } from "./engine-sequence.ts";

export const MIN_COMPLETED_DAYS = 10; // loop starts after the athlete completes 10 Engine days

const SYSTEM_PROMPT =
  `You are the Engine conditioning sequencer. You personalise an athlete's UPCOMING conditioning by ` +
  `GENERATING training days within a fixed taxonomy — you never invent day-types or parameters outside ` +
  `their authored envelopes.\n\n` +
  `You are given: (1) the athlete's RAW conditioning signals (per-competency rolling ratios + recent ` +
  `trend, time-trial/calibration age, days since last session — no labels; you interpret them), ` +
  `(2) the day-type catalogue with each type's parameter envelope, and (3) the athlete's ` +
  `current phase and how many days to generate.\n\n` +
  `Read the signals and form your own judgment: which energy systems are behind, what's trending down, ` +
  `whether a layoff warrants re-baselining, which prerequisites are met. Then choose day-types that ` +
  `serve that judgment. For each chosen day, GENERATE concrete block ` +
  `parameters STRICTLY inside that day-type's envelope.\n\n` +
  `Intensity judgment — the key value you add: the rolling ratio is a SLOW smoother; if an athlete is ` +
  `consistently beating target you may set the pace where they actually are NOW rather than waiting weeks ` +
  `for it to catch up. BUT scale that confidence by the sample count: where a competency has a solid ` +
  `rolling history (n≈3-4) and a clear trend, set intensity decisively; where it is thin (n≈1, or no ` +
  `rolling data at all), stay conservative — pick a mid/standard intensity, don't jump on one session.\n\n` +
  `Rules:\n` +
  `- Only use day_types whose phase_requirement <= the athlete's current phase.\n` +
  `- Supply exactly block_count blocks, each an object with the same keys as the day-type's block_N_params.\n` +
  `- Choose a SINGLE concrete value for every parameter — never return a range/array where the envelope ` +
  `expects one value (e.g. workDuration must be a number like 120, not [90,210]).\n` +
  `- Durations are SECONDS. paceRange is [lo,hi] as a fraction of baseline and must sit inside the envelope's [min,max].\n` +
  `- Keep workProgression/paceProgression/restProgression EXACTLY as the envelope specifies. Use the exact ` +
  `rest keyword (e.g. one_third_work) when the envelope uses one.\n` +
  `- Stay within max_duration_minutes.\n\n` +
  `Output ONLY JSON, no prose, in this shape:\n` +
  `{"summary":"one-line rationale","days":[{"day_type":"<id>","reason":"<why this day>","blocks":[{ ...params... }]}]}`;

/** Rough total minutes for display: work (rounds×workDuration) + numeric rest per block. */
function estimateMinutes(blocks: Record<string, unknown>[]): number {
  let secs = 0;
  for (const b of blocks) {
    const rounds = typeof b.rounds === "number" ? b.rounds : 1;
    const work = typeof b.workDuration === "number" ? b.workDuration : 0;
    const rest = typeof b.restDuration === "number" ? b.restDuration : 0;
    secs += rounds * work + Math.max(0, rounds - 1) * rest;
  }
  return Math.round(secs / 60);
}

export type ResequenceStatus = "skipped" | "preview" | "applied" | "unparseable" | "error";

export interface ResequenceResult {
  status: ResequenceStatus;
  [k: string]: unknown;
}

export interface RunResequenceOpts {
  dryRun: boolean;
  debug?: boolean;
}

/** The shared sequencer core. Pure of HTTP; returns a plain result object. */
export async function runResequence(
  supa: SupabaseClient,
  userId: string,
  opts: RunResequenceOpts,
): Promise<ResequenceResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const { dryRun, debug } = opts;

  // 1) Gate: at least MIN_COMPLETED_DAYS completed Engine sessions.
  const { count: completed } = await supa
    .from("engine_workout_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("completed", true);
  if ((completed ?? 0) < MIN_COMPLETED_DAYS) {
    return { status: "skipped", reason: `needs ${MIN_COMPLETED_DAYS} completed days, has ${completed ?? 0}` };
  }

  // 2) Diagnosis + catalogue (text for the prompt, rows for validation).
  const [diagnosis, catalogueText, catalogueRows] = await Promise.all([
    buildConditioningState(supa, userId),
    buildDayTypeCatalogue(supa),
    loadDayTypeCatalogue(supa),
  ]);
  if (!diagnosis) return { status: "skipped", reason: "no conditioning diagnosis available" };

  // 3) Program + cadence. The athlete's program defines the position space:
  // specialty programs curate NON-consecutive catalog days via engine_program_mapping,
  // so "the next N positions" must come from the mapping, not currentDay+i.
  const { data: prof } = await supa
    .from("athlete_profiles").select("engine_program_version").eq("user_id", userId).maybeSingle();
  const version = (prof?.engine_program_version as string) ?? "main_5day";
  const { data: program } = await supa
    .from("engine_programs").select("days_per_week").eq("id", version).maybeSingle();
  const maxDays = (program?.days_per_week as number) ?? 5;

  // 3b) Current position = highest completed program_day_number IN THIS PROGRAM + 1.
  // program_day_number == the catalog day_number; scope by program_version so a
  // switch (which resets engine_current_day to that program's own progress) is
  // sequenced correctly rather than off a different program's completions.
  const { data: maxDay } = await supa
    .from("engine_workout_sessions")
    .select("program_day_number")
    .eq("user_id", userId).eq("completed", true).eq("program_version", version)
    .not("program_day_number", "is", null)
    .order("program_day_number", { ascending: false }).limit(1).maybeSingle();
  const highestCompleted = (maxDay?.program_day_number as number) ?? 0;
  const currentDay = highestCompleted + 1;

  // 3c) The next maxDays positions = the program's mapped catalog days after the
  // furthest completed one, in sequence order. main_5day's mapping is identity, so
  // this reduces to currentDay..currentDay+maxDays-1; curated programs skip the gaps.
  const { data: mapRows } = await supa
    .from("engine_program_mapping")
    .select("engine_workout_day_number, program_sequence_order")
    .eq("engine_program_id", version)
    .gt("engine_workout_day_number", highestCompleted)
    .order("program_sequence_order", { ascending: true })
    .limit(maxDays);
  let blockPositions = (mapRows ?? []).map((m) => m.engine_workout_day_number as number);
  // Fallback for a program with no mapping rows: consecutive positions.
  if (blockPositions.length === 0) {
    blockPositions = Array.from({ length: maxDays }, (_, i) => currentDay + i);
  }

  // 3d) Phase at the current position (read from the curated catalog day).
  let currentPhase = 1;
  if (highestCompleted > 0) {
    const { data: w } = await supa
      .from("engine_workouts")
      .select("phase")
      .eq("program_type", "main_5day")
      .eq("day_number", highestCompleted).maybeSingle();
    currentPhase = (w?.phase as number) ?? 1;
  }

  // 4) Pin month-boundary time trials (left as the catalog TT; AI fills the rest).
  const { data: catalogBlock } = await supa
    .from("engine_workouts")
    .select("day_number, day_type")
    .eq("program_type", "main_5day")
    .in("day_number", blockPositions);
  const ttPositions = (catalogBlock ?? [])
    .filter((d) => d.day_type === "time_trial")
    .map((d) => d.day_number as number);
  const aiPositions = blockPositions.filter((p) => !ttPositions.includes(p));
  const daysToGenerate = aiPositions.length;
  if (daysToGenerate === 0) {
    return { status: "skipped", reason: "block is entirely pinned time trials", currentDay, pinned_time_trials: ttPositions };
  }

  // 5) Ask the AI to generate the non-pinned days of the block.
  const ttNote = ttPositions.length > 0
    ? `Note: a scheduled time trial (re-baseline) falls within this week and is handled separately — ` +
      `sequence your days assuming a recalibration occurs; do not generate a time trial yourself unless ` +
      `the signals clearly call for an extra one.\n`
    : "";
  const userContent =
    `${diagnosis}\n\n` +
    `ATHLETE CURRENT PHASE: ${currentPhase} (only day_types with phase_requirement <= ${currentPhase} are legal)\n` +
    `GENERATE THE NEXT ${daysToGenerate} ENGINE DAYS.\n` +
    ttNote + `\n` +
    `${catalogueText}`;

  const raw = await callClaude({ apiKey: apiKey!, system: SYSTEM_PROMPT, userContent, maxTokens: 4096 });

  const proposal = parseProposal(raw);
  if (!proposal) return { status: "unparseable", error: "AI returned unparseable output", raw };

  const result = validateProposal(proposal, catalogueRows, { currentPhase, maxDays: daysToGenerate });

  if (dryRun || result.accepted.length === 0) {
    return {
      status: "preview",
      dry_run: dryRun,
      persisted: 0,
      currentDay,
      currentPhase,
      maxDays,
      days_to_generate: daysToGenerate,
      pinned_time_trials: ttPositions,
      ai_positions: aiPositions,
      summary: proposal.summary,
      diagnosis,
      proposed: proposal.days,
      accepted: result.accepted,
      validation_errors: result.errors,
      raw_ai_output: raw,
      ...(debug ? { prompt: userContent } : {}),
    };
  }

  // 6) Persist accepted days as engine_workouts rows + position overrides.
  const programType = `gen:${userId}`;
  const { data: lastGen } = await supa
    .from("engine_workouts")
    .select("day_number")
    .eq("program_type", programType)
    .order("day_number", { ascending: false }).limit(1).maybeSingle();
  let nextGenNumber = ((lastGen?.day_number as number) ?? 0) + 1;

  const placed: { position: number; day_type: string; reason: string }[] = [];
  const persistErrors: string[] = [];

  const accepted = result.accepted as ProposedDay[];
  for (let i = 0; i < accepted.length && i < aiPositions.length; i++) {
    const day = accepted[i];
    const position = aiPositions[i];
    try {
      const blocks = day.blocks;
      const { data: wrow, error: wErr } = await supa
        .from("engine_workouts")
        .insert({
          program_type: programType,
          day_number: nextGenNumber,
          day_type: day.day_type,
          phase: currentPhase,
          block_count: blocks.length,
          block_1_params: blocks[0] ?? null,
          block_2_params: blocks[1] ?? null,
          block_3_params: blocks[2] ?? null,
          block_4_params: blocks[3] ?? null,
          total_duration_minutes: estimateMinutes(blocks),
        })
        .select("id").single();
      if (wErr || !wrow) throw new Error(wErr?.message ?? "insert engine_workouts failed");

      const { error: oErr } = await supa
        .from("engine_user_day_overrides")
        .upsert(
          { user_id: userId, program_version: version, sequence_position: position, engine_workout_id: wrow.id, reason: day.reason, updated_at: new Date().toISOString() },
          { onConflict: "user_id,program_version,sequence_position" },
        );
      if (oErr) throw new Error(oErr.message);

      placed.push({ position, day_type: day.day_type, reason: day.reason });
      nextGenNumber += 1;
    } catch (e) {
      persistErrors.push(`pos ${position} ${day.day_type}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`[run-resequence] user=${userId} currentDay=${currentDay} phase=${currentPhase} placed=${placed.length} errors=${result.errors.length + persistErrors.length}`);

  return {
    status: "applied",
    currentDay,
    currentPhase,
    maxDays,
    summary: proposal.summary,
    persisted: placed.length,
    placed,
    pinned_time_trials: ttPositions,
    validation_errors: result.errors,
    persist_errors: persistErrors,
  };
}
