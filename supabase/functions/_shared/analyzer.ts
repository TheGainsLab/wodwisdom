// Block-level program analyzer — used by analyze-program.
// No regex. Counts from parsed_tasks only.

import { inferTimeDomain } from "./time-domain.ts";

/** Movements context from DB. */
export interface MovementsContext {
  library: Record<string, { modality: "W" | "G" | "M"; category: string }>;
  aliases: Record<string, string>;
  /** Canonical names with competition_count > 0 — only these appear in not_programmed */
  essentialCanonicals: Set<string>;
}

/** A block with its type, parent workout context, and parsed movement data. */
export interface BlockInput {
  block_type: string;
  block_text: string;
  parsed_tasks: Record<string, unknown>[] | null;
  /** Parent workout sort_order — used for consecutive day overlap detection */
  sort_order: number;
  /** Parent workout week_num */
  week_num?: number;
  /** Parent workout day_num */
  day_num?: number;
}

export type ExtractedMovementForAnalysis = { canonical: string; modality: string; load: string };

export interface AnalysisOutput {
  modal_balance: Record<string, number>;
  time_domains: Record<string, number>;
  workout_structure: Record<string, number>;
  workout_formats: Record<string, number>;
  movement_frequency: { name: string; count: number; modality: string; loads: string[] }[];
  notices: string[];
  not_programmed: Record<string, string[]>;
  consecutive_overlaps: { days: string; movements: string[] }[];
  loading_ratio: { loaded: number; bodyweight: number };
  distinct_loads: number;
  load_bands: Record<string, number>;
}

function detectWorkoutFormat(text: string): string {
  const t = text.trim().toUpperCase();
  if (/AMRAP|AS MANY ROUNDS/.test(t)) return "AMRAP";
  if (/FOR TIME|FORTIME/.test(t)) return "FOR TIME";
  if (/\d+\s*RFT|\d+\s*ROUNDS?\s+FOR\s+TIME/.test(t)) return "Rounds For Time";
  if (/EMOM|E\d+MOM|EVERY\s+\d+\s+MIN/.test(t)) return "EMOM";
  if (/DEATH\s+BY/.test(t)) return "Death By";
  if (/TABATA/.test(t)) return "Tabata";
  if (/BUY\s+IN|CASH\s+OUT/.test(t)) return "Buy-In/Cash-Out";
  return "Other";
}

/** Convert parsed_tasks items to movements using the movements library. */
function parsedTasksToMovements(
  tasks: Record<string, unknown>[],
  blockType: string,
  library: Record<string, { modality: "W" | "G" | "M"; category: string }>,
): ExtractedMovementForAnalysis[] {
  const results: ExtractedMovementForAnalysis[] = [];

  for (const task of tasks) {
    const movementName = task.movement as string | undefined;
    if (!movementName) continue;

    const canonical = movementName.toLowerCase().replace(/[\s-]+/g, "_");

    const info = library[canonical];
    let modality: string;
    if (info) {
      modality = info.modality;
    } else if (blockType === "strength") {
      modality = "W";
    } else {
      const cat = task.category as string | undefined;
      modality = cat === "weighted" ? "W" : cat === "monostructural" ? "M" : "G";
    }

    let load = "BW";
    if (blockType === "strength") {
      const weight = task.weight as number | null;
      const pct = task.percentage as number | null;
      if (weight) load = String(weight);
      else if (pct) load = `${pct}%`;
    } else {
      const weight = task.weight as number | null;
      if (weight) load = String(weight);
    }

    results.push({ canonical, modality, load });
  }

  return results;
}

/**
 * Compute load bands dynamically from actual data using tercile splits.
 */
function computeLoadBands(numericLoads: number[]): Record<string, number> {
  if (numericLoads.length === 0) return {};
  const sorted = [...numericLoads].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  if (min === max) return { [String(min)]: sorted.length };

  const p33 = sorted[Math.floor(sorted.length / 3)];
  const p66 = sorted[Math.floor((2 * sorted.length) / 3)];

  const bands: Record<string, number> = {};
  for (const n of sorted) {
    let key: string;
    if (n <= p33) key = `≤${p33}`;
    else if (n <= p66) key = `${p33 + 1}–${p66}`;
    else key = `${p66 + 1}+`;
    bands[key] = (bands[key] || 0) + 1;
  }
  return bands;
}

function toNumericLoad(load: string): number | null {
  if (load === "BW") return null;
  const pct = load.match(/^(\d+)%$/);
  if (pct) return parseInt(pct[1], 10);
  const slash = load.match(/^(\d+)\/\d+$/);
  if (slash) return parseInt(slash[1], 10);
  const n = parseInt(load, 10);
  return isNaN(n) ? null : n;
}

/**
 * Analyze program using pre-parsed blocks.
 * - strength/skills: modal balance + movement frequency only
 * - metcon: full analysis (format, time domain, structure)
 * - warm-up/cool-down: skipped
 */
export function analyzeBlocks(
  blocks: BlockInput[],
  movements: MovementsContext,
): AnalysisOutput {
  const { library, essentialCanonicals } = movements;

  const modalCounts: Record<string, number> = { Weightlifting: 0, Gymnastics: 0, Monostructural: 0 };
  const timeDomainCounts: Record<string, number> = { short: 0, medium: 0, long: 0 };
  const structureCounts: Record<string, number> = { couplets: 0, triplets: 0, chipper: 0, other: 0 };
  const formatCounts: Record<string, number> = {};
  const movementTotals = new Map<string, { count: number; modality: string; loads: string[] }>();
  const allFoundMovements = new Set<string>();
  const notices: string[] = [];
  let loadedCount = 0;
  let bodyweightCount = 0;
  const allLoads = new Set<string>();
  const numericLoads: number[] = [];

  const blocksBySortOrder = new Map<number, ExtractedMovementForAnalysis[]>();

  for (const block of blocks) {
    const { block_type, block_text, parsed_tasks, sort_order } = block;

    if (["warm-up", "cool-down", "mobility"].includes(block_type)) continue;
    if (!parsed_tasks || !Array.isArray(parsed_tasks) || parsed_tasks.length === 0) continue;

    const moves = parsedTasksToMovements(parsed_tasks, block_type, library);

    if (block_type === "metcon") {
      const format = detectWorkoutFormat(block_text);
      formatCounts[format] = (formatCounts[format] || 0) + 1;

      const domain = inferTimeDomain(block_text);
      timeDomainCounts[domain] = (timeDomainCounts[domain] || 0) + 1;

      const mc = new Set(moves.map((m) => m.canonical)).size;
      if (mc === 2) structureCounts.couplets++;
      else if (mc === 3) structureCounts.triplets++;
      else if (mc >= 4) structureCounts.chipper++;
      else structureCounts.other++;
    }

    if (block_type === "strength") {
      formatCounts["Strength"] = (formatCounts["Strength"] || 0) + 1;
    }

    for (const m of moves) {
      allFoundMovements.add(m.canonical);
      const modLabel = m.modality === "W" ? "Weightlifting" : m.modality === "G" ? "Gymnastics" : "Monostructural";
      modalCounts[modLabel] = (modalCounts[modLabel] || 0) + 1;

      if (m.load === "BW") {
        bodyweightCount++;
      } else {
        loadedCount++;
        allLoads.add(m.load);
        const num = toNumericLoad(m.load);
        if (num !== null) numericLoads.push(num);
      }

      const existing = movementTotals.get(m.canonical);
      if (existing) {
        existing.count++;
        existing.loads.push(m.load);
      } else {
        movementTotals.set(m.canonical, { count: 1, modality: m.modality, loads: [m.load] });
      }
    }

    const existing = blocksBySortOrder.get(sort_order) ?? [];
    existing.push(...moves);
    blocksBySortOrder.set(sort_order, existing);
  }

  const modalBalance = {
    Weightlifting: modalCounts.Weightlifting,
    Gymnastics: modalCounts.Gymnastics,
    Monostructural: modalCounts.Monostructural,
  };

  const movementFreq = Array.from(movementTotals.entries())
    .map(([canonical, v]) => ({
      name: canonical.replace(/_/g, " "),
      count: v.count,
      modality: v.modality,
      loads: v.loads,
    }))
    .sort((a, b) => b.count - a.count);

  const loadBands = computeLoadBands(numericLoads);

  const notProgrammed: Record<string, string[]> = {
    Weightlifting: [],
    Gymnastics: [],
    Monostructural: [],
  };
  for (const canonical of essentialCanonicals) {
    if (allFoundMovements.has(canonical)) continue;
    const info = library[canonical];
    const category = info?.category ?? "Weightlifting";
    if (notProgrammed[category]) {
      notProgrammed[category].push(canonical.replace(/_/g, " "));
    }
  }

  const overlaps: { days: string; movements: string[] }[] = [];
  const sortOrders = [...blocksBySortOrder.keys()].sort((a, b) => a - b);
  for (let i = 0; i < sortOrders.length - 1; i++) {
    const curr = sortOrders[i];
    const next = sortOrders[i + 1];
    if (next !== curr + 1) continue;

    const currMoves = new Set(blocksBySortOrder.get(curr)!.map((m) => m.canonical));
    const nextMoves = blocksBySortOrder.get(next)!.map((m) => m.canonical);
    const shared = [...new Set(nextMoves.filter((c) => currMoves.has(c)))];
    if (shared.length > 0) {
      overlaps.push({
        days: `Days ${curr + 1}–${next + 1}`,
        movements: shared.map((c) => c.replace(/_/g, " ")),
      });
    }
  }

  if (timeDomainCounts.long === 0 && sortOrders.length >= 5) {
    notices.push("No workouts exceed 15 minutes. Consider adding at least one long time domain.");
  }
  if (modalCounts.Weightlifting === 0 && sortOrders.length >= 5) {
    notices.push("No dedicated strength work detected. Consider adding barbell or loaded movements.");
  }
  if (overlaps.length > 0) {
    notices.push(`${overlaps.length} day pair(s) share movements. Review for recovery.`);
  }
  const totalNotProg = Object.values(notProgrammed).reduce((s, arr) => s + arr.length, 0);
  if (totalNotProg > 20) {
    notices.push("Many movements from the CrossFit canon are not programmed. Consider variety.");
  }

  return {
    modal_balance: modalBalance,
    time_domains: timeDomainCounts,
    workout_structure: structureCounts,
    workout_formats: formatCounts,
    movement_frequency: movementFreq,
    notices,
    not_programmed: notProgrammed,
    consecutive_overlaps: overlaps,
    loading_ratio: { loaded: loadedCount, bodyweight: bodyweightCount },
    distinct_loads: allLoads.size,
    load_bands: loadBands,
  };
}
