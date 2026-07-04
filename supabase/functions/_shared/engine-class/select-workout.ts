/**
 * engine-class/select-workout.ts — pick "today's" shared Engine Class workout from a
 * cohort program. PURE (no DB) so it's unit-tested and shared by F5 (view), the log
 * endpoint, and TV mode.
 *
 * Gap the cohort program leaves (flagged in the #551 recon): `WriterOutput` is pure
 * week_num(1..4)/day_num(1..N) indices with NO calendar anchor. v1 mapping: flatten
 * weeks→days into an ordered workout list; dayOfCycle = whole days since the program's
 * created_at; pick min(dayOfCycle, lastIndex) — so the gym runs one workout per
 * calendar day and HOLDS on the last one until the monthly cron regenerates. This
 * gives the whole gym ONE shared "today's workout" (so a per-workout leaderboard is
 * well-defined). A real per-gym class schedule is a documented follow-up.
 */

import type { BlockPrescription, WriterOutput } from "../v2-output-schema.ts";

export type ScoreType = "for_time" | "amrap" | "load" | "reps" | "rounds_reps" | "other";

export interface SelectedWorkout {
  week_num: number;
  day_num: number;
  /** The full day's blocks (for display). */
  blocks: BlockPrescription[];
  /** Index into `blocks` of the leaderboard-scored piece (the class's scored effort). */
  scored_block_idx: number | null;
  /** Division axis: the scored block's modality (row/bike/run/…) or its block_type. */
  modality: string | null;
  /** How the scored block is scored — drives the log form + ranking direction. */
  score_type: ScoreType;
  /** Position in the flattened cycle (0-based) + the cycle length, for context. */
  cycle_index: number;
  cycle_length: number;
}

const DAY_MS = 86_400_000;

/** Whole UTC days from an ISO instant to another (>= 0, clamped). */
function daysBetween(startIso: string, nowIso: string): number {
  const start = Date.parse(startIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - start) / DAY_MS));
}

/** Flatten weeks→days in program order. */
function flattenDays(output: WriterOutput): Array<{ week_num: number; day_num: number; blocks: BlockPrescription[] }> {
  const out: Array<{ week_num: number; day_num: number; blocks: BlockPrescription[] }> = [];
  for (const w of output.weeks ?? []) {
    for (const d of w.days ?? []) {
      out.push({ week_num: w.week_num, day_num: d.day_num, blocks: d.blocks ?? [] });
    }
  }
  return out;
}

/** Pick the block the leaderboard scores: prefer the last metcon/cardio (the class's
 *  conditioning piece), else the last strength block, else none. */
function pickScoredBlock(blocks: BlockPrescription[]): number | null {
  const preferred: BlockPrescription["block_type"][] = ["metcon", "cardio"];
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (preferred.includes(blocks[i].block_type)) return i;
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].block_type === "strength") return i;
  }
  return null;
}

function inferScoreType(block: BlockPrescription | null): ScoreType {
  if (!block) return "other";
  if (block.block_type === "strength") return "load";
  if (block.block_type === "metcon" || block.block_type === "cardio") {
    const scheme = (block.block_scheme ?? "").toLowerCase();
    if (scheme.includes("amrap")) return "amrap";
    if (scheme.includes("rft") || /\d+\s*rounds/.test(scheme)) return "rounds_reps";
    return "for_time";
  }
  return "other";
}

function inferModality(block: BlockPrescription | null): string | null {
  if (!block) return null;
  if (block.cardio_modality) return block.cardio_modality;
  // A movement-level cardio modality (an erg inside a metcon).
  for (const m of block.movements ?? []) {
    if (m.cardio_modality) return m.cardio_modality;
  }
  return block.block_type; // 'metcon' | 'cardio' | 'strength' — a coarse division axis
}

/**
 * Select today's shared workout. Returns null only when the program has no days.
 * `programCreatedAtIso` anchors the cycle; `nowIso` is "today".
 */
export function selectTodaysWorkout(
  output: WriterOutput,
  programCreatedAtIso: string,
  nowIso: string,
): SelectedWorkout | null {
  const days = flattenDays(output);
  if (days.length === 0) return null;

  const dayOfCycle = daysBetween(programCreatedAtIso, nowIso);
  const idx = Math.min(dayOfCycle, days.length - 1);
  const chosen = days[idx];
  const scoredIdx = pickScoredBlock(chosen.blocks);
  const scored = scoredIdx != null ? chosen.blocks[scoredIdx] : null;

  return {
    week_num: chosen.week_num,
    day_num: chosen.day_num,
    blocks: chosen.blocks,
    scored_block_idx: scoredIdx,
    modality: inferModality(scored),
    score_type: inferScoreType(scored),
    cycle_index: idx,
    cycle_length: days.length,
  };
}
