/**
 * Engine day-type catalogue — the AI sequencer's option space.
 *
 * Loads the 22 day-type definitions from engine_day_types (their coaching
 * intent + block_N_params envelopes) and formats them for an AI prompt, with a
 * legend explaining the parameter vocabulary. The self-sequencer feeds this to
 * the AI so it understands each day type's architecture and can only produce
 * output WITHIN each type's authored envelope. The structured rows are also the
 * source the deterministic validator checks AI output against.
 *
 * See docs/engine_competency_graph.md and docs/engine_self_sequencing_plan.md.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface EngineDayTypeRow {
  id: string;
  name: string;
  phase_requirement: number;
  block_count: number;
  set_rest_seconds: number | null;
  block_1_params: Record<string, unknown> | null;
  block_2_params: Record<string, unknown> | null;
  block_3_params: Record<string, unknown> | null;
  block_4_params: Record<string, unknown> | null;
  max_duration_minutes: number | null;
  is_support_day: boolean;
  coaching_intent: string | null;
}

/**
 * Explains the block_N_params vocabulary so the AI can read the authored
 * envelopes and stay inside them. Kept in sync with the seed
 * (supabase/migrations/20260240000000_engine_seed_data.sql) and the resolver
 * (src/lib/engineService.ts → calculateWorkDurationSeconds).
 */
export const PARAM_LEGEND = `BLOCK PARAMETER VOCABULARY (how to read block_N_params):
- A day type has block_count blocks (1-4); each has its own params object (block_1_params ... block_4_params).
- All durations are in SECONDS. paceRange values are FRACTIONS of the athlete's current time-trial baseline pace (1.00 = baseline).
- rounds: a fixed integer, a [min,max] range (choose within), or "inherit_from_part_a" (Rocket Races B reuses Part A's value).
- workDuration: seconds (int), [min,max] range, or "inherit_from_part_a".
- restDuration: seconds (int), [start,end] (endpoints of a progression), or a RATIO-OF-WORK keyword:
    equal_to_work, one_third_work, five_times_work, two_to_three_times_work,
    half_to_two_thirds_work, one_point_five_to_three_times_work, one_to_one_point_five_times_work.
- paceRange: [min,max] fraction of baseline, or "max_effort", or "inherit_from_part_a".
- workProgression: consistent | single | increasing | continuous | alternating_paces | continuous_with_bursts | progressive_flux_intensity.
- paceProgression: increasing (with paceIncrement, e.g. 0.05 per round).
- restProgression: decreasing | consistent.   workDurationIncrement: seconds added per round when workProgression=increasing.
- restDurationOptions / workDurationOptions (atomic, synthesis): pick a value from the listed array per round.
- Flux family: basePace, baseDuration (Zone-2 segment), fluxDuration, fluxPaceRange, fluxIntensityByDuration {seconds:intensity},
    fluxStartIntensity + fluxIncrement (flux_stages increases flux pace each round).
- Polarized: basePace + burstTiming (e.g. every_7_minutes), burstDuration, burstIntensity (max_effort).
- HARD LIMITS to respect: phase_requirement (earliest phase the type may appear), max_duration_minutes (total session cap),
    and every chosen value must stay inside the [min,max] / option set the day type defines. Never invent a new day type or a parameter outside these.`;

/** Load all day-type definitions, ordered by when they're introduced. */
export async function loadDayTypeCatalogue(supa: SupabaseClient): Promise<EngineDayTypeRow[]> {
  const { data } = await supa
    .from("engine_day_types")
    .select(
      "id, name, phase_requirement, block_count, set_rest_seconds, block_1_params, block_2_params, block_3_params, block_4_params, max_duration_minutes, is_support_day, coaching_intent",
    )
    .order("phase_requirement", { ascending: true })
    .order("name", { ascending: true });
  return (data as EngineDayTypeRow[]) ?? [];
}

/** Format the catalogue as an AI-readable reference: legend + per-type intent + raw envelopes. */
export function formatDayTypeCatalogue(rows: EngineDayTypeRow[]): string {
  if (rows.length === 0) return "";
  const parts: string[] = [PARAM_LEGEND, "", `DAY TYPES (${rows.length}):`];

  for (const dt of rows) {
    const gating = [
      `phase>=${dt.phase_requirement}`,
      `${dt.block_count} block${dt.block_count === 1 ? "" : "s"}`,
      dt.max_duration_minutes != null ? `cap ${dt.max_duration_minutes}min` : null,
      dt.set_rest_seconds != null ? `set-rest ${dt.set_rest_seconds}s` : null,
      dt.is_support_day ? "support-day" : null,
    ].filter(Boolean).join(", ");

    parts.push("", `### ${dt.id} (${dt.name}) — ${gating}`);
    if (dt.coaching_intent) parts.push(dt.coaching_intent);

    const blocks = [dt.block_1_params, dt.block_2_params, dt.block_3_params, dt.block_4_params];
    for (let i = 0; i < dt.block_count; i++) {
      const b = blocks[i];
      if (b) parts.push(`block_${i + 1}_params: ${JSON.stringify(b)}`);
    }
  }

  return parts.join("\n");
}

/** Convenience: load + format in one call for prompt assembly. */
export async function buildDayTypeCatalogue(supa: SupabaseClient): Promise<string> {
  return formatDayTypeCatalogue(await loadDayTypeCatalogue(supa));
}
