// Shared program analyzer - used by analyze-program and incorporate-movements

import { inferTimeDomain } from "./time-domain.ts";

/** Passed when movements table is used. Drives recognition + essential-only not_programmed. */
export interface MovementsContext {
  library: Record<string, { modality: "W" | "G" | "M"; category: string }>;
  aliases: Record<string, string>;
  /** Canonical names with competition_count > 0 — only these appear in not_programmed */
  essentialCanonicals: Set<string>;
}

const MOVEMENT_LIBRARY: Record<string, { modality: "W" | "G" | "M"; category: string }> = {
  back_squat: { modality: "W", category: "Weightlifting" },
  front_squat: { modality: "W", category: "Weightlifting" },
  overhead_squat: { modality: "W", category: "Weightlifting" },
  squat: { modality: "W", category: "Weightlifting" },
  deadlift: { modality: "W", category: "Weightlifting" },
  sumo_deadlift: { modality: "W", category: "Weightlifting" },
  clean: { modality: "W", category: "Weightlifting" },
  power_clean: { modality: "W", category: "Weightlifting" },
  clean_and_jerk: { modality: "W", category: "Weightlifting" },
  jerk: { modality: "W", category: "Weightlifting" },
  snatch: { modality: "W", category: "Weightlifting" },
  power_snatch: { modality: "W", category: "Weightlifting" },
  push_jerk: { modality: "W", category: "Weightlifting" },
  press: { modality: "W", category: "Weightlifting" },
  push_press: { modality: "W", category: "Weightlifting" },
  bench_press: { modality: "W", category: "Weightlifting" },
  thruster: { modality: "W", category: "Weightlifting" },
  hang_power_clean: { modality: "W", category: "Weightlifting" },
  hang_squat_clean: { modality: "W", category: "Weightlifting" },
  sdhp: { modality: "W", category: "Weightlifting" },
  sumo_deadlift_high_pull: { modality: "W", category: "Weightlifting" },
  strict_press: { modality: "W", category: "Weightlifting" },
  strict_pull_up: { modality: "G", category: "Gymnastics" },
  pull_up: { modality: "G", category: "Gymnastics" },
  kipping_pull_up: { modality: "G", category: "Gymnastics" },
  chest_to_bar: { modality: "G", category: "Gymnastics" },
  bar_muscle_up: { modality: "G", category: "Gymnastics" },
  muscle_up: { modality: "G", category: "Gymnastics" },
  ring_muscle_up: { modality: "G", category: "Gymnastics" },
  toes_to_bar: { modality: "G", category: "Gymnastics" },
  knee_raise: { modality: "G", category: "Gymnastics" },
  l_sit: { modality: "G", category: "Gymnastics" },
  hspu: { modality: "G", category: "Gymnastics" },
  handstand_push_up: { modality: "G", category: "Gymnastics" },
  wall_facing_hspu: { modality: "G", category: "Gymnastics" },
  strict_hspu: { modality: "G", category: "Gymnastics" },
  push_up: { modality: "G", category: "Gymnastics" },
  pushup: { modality: "G", category: "Gymnastics" },
  ring_dip: { modality: "G", category: "Gymnastics" },
  ring_dips: { modality: "G", category: "Gymnastics" },
  bar_dip: { modality: "G", category: "Gymnastics" },
  dip: { modality: "G", category: "Gymnastics" },
  pistol: { modality: "G", category: "Gymnastics" },
  pistols: { modality: "G", category: "Gymnastics" },
  handstand_walk: { modality: "G", category: "Gymnastics" },
  lunge: { modality: "G", category: "Gymnastics" },
  walking_lunge: { modality: "G", category: "Gymnastics" },
  burpee: { modality: "G", category: "Gymnastics" },
  burpees: { modality: "G", category: "Gymnastics" },
  box_jump: { modality: "G", category: "Gymnastics" },
  box_jumps: { modality: "G", category: "Gymnastics" },
  wall_ball: { modality: "G", category: "Gymnastics" },
  wall_balls: { modality: "G", category: "Gymnastics" },
  double_under: { modality: "G", category: "Gymnastics" },
  double_unders: { modality: "G", category: "Gymnastics" },
  single_under: { modality: "G", category: "Gymnastics" },
  rope_climb: { modality: "G", category: "Gymnastics" },
  rope_climbs: { modality: "G", category: "Gymnastics" },
  legless_rope_climb: { modality: "G", category: "Gymnastics" },
  kettlebell_swing: { modality: "W", category: "Weightlifting" },
  kb_swing: { modality: "W", category: "Weightlifting" },
  kettlebell_swings: { modality: "W", category: "Weightlifting" },
  goblet_squat: { modality: "W", category: "Weightlifting" },
  turkish_get_up: { modality: "W", category: "Weightlifting" },
  tgu: { modality: "W", category: "Weightlifting" },
  farmer_carry: { modality: "W", category: "Weightlifting" },
  running: { modality: "M", category: "Monostructural" },
  run: { modality: "M", category: "Monostructural" },
  rowing: { modality: "M", category: "Monostructural" },
  row: { modality: "M", category: "Monostructural" },
  bike: { modality: "M", category: "Monostructural" },
  biking: { modality: "M", category: "Monostructural" },
  assault_bike: { modality: "M", category: "Monostructural" },
  echo_bike: { modality: "M", category: "Monostructural" },
  ski_erg: { modality: "M", category: "Monostructural" },
  swimming: { modality: "M", category: "Monostructural" },
  swim: { modality: "M", category: "Monostructural" },
  jumping_jack: { modality: "G", category: "Gymnastics" },
  jump_rope: { modality: "G", category: "Gymnastics" },
};

/** Default shorthand and common aliases; merged into DB aliases when using movements table */
export const DEFAULT_MOVEMENT_ALIASES: Record<string, string> = {
  t2b: "toes_to_bar",
  "toes to bar": "toes_to_bar",
  "toes to bars": "toes_to_bar",
  c2b: "chest_to_bar",
  "chest to bar": "chest_to_bar",
  mu: "muscle_up",
  "muscle ups": "muscle_up",
  "ring muscle up": "ring_muscle_up",
  "bar muscle up": "bar_muscle_up",
  pc: "power_clean",
  "power cleans": "power_clean",
  "power clean": "power_clean",
  cj: "clean_and_jerk",
  "clean and jerk": "clean_and_jerk",
  "cleans and jerks": "clean_and_jerk",
  "clean & jerk": "clean_and_jerk",
  wb: "wall_ball",
  "wall balls": "wall_ball",
  du: "double_under",
  "double unders": "double_unders",
  sdhp: "sdhp",
  "sumo deadlift high pull": "sdhp",
  hpc: "hang_power_clean",
  hsc: "hang_squat_clean",
  "hang power clean": "hang_power_clean",
  "hang squat clean": "hang_squat_clean",
  bj: "box_jump",
  "box jumps": "box_jump",
  "calorie row": "row",
  "row calorie": "row",
  "rowing calorie": "row",
  "row calories": "row",
  "bike calorie": "bike",
  "calorie bike": "bike",
  "assault bike": "assault_bike",
  "echo bike": "echo_bike",
  "run 400": "run",
  "400m run": "run",
  "400 m run": "run",
  "800m run": "run",
  "1 mile run": "run",
};

export interface WorkoutInput {
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order?: number;
}

export interface AnalysisOutput {
  modal_balance: Record<string, number>;
  time_domains: Record<string, number>;
  workout_structure: Record<string, number>;
  workout_formats: Record<string, number>;
  movement_frequency: { name: string; count: number; modality: string; loads: string[] }[];
  notices: string[];
  not_programmed: Record<string, string[]>;
  consecutive_overlaps: { week: number; days: string; movements: string[] }[];
  loading_ratio: { loaded: number; bodyweight: number };
  distinct_loads: number;
  load_bands: Record<string, number>;
}

// Load patterns: regex and label extractor. Specific patterns first; bare numbers last (to avoid rep counts).
const LOAD_PATTERNS: { regex: RegExp; toLabel: (m: RegExpMatchArray) => string; filter?: (m: RegExpMatchArray) => boolean }[] = [
  { regex: /\((\d+)\s*\/\s*(\d+)\)/g, toLabel: (m) => `${m[1]}/${m[2]}` },
  { regex: /\((\d+)\)/g, toLabel: (m) => m[1] },
  { regex: /@\s*(\d+)\s*%/gi, toLabel: (m) => `${m[1]}%` },
  { regex: /\b(\d+)\s*\/\s*(\d+)\b/g, toLabel: (m) => `${m[1]}/${m[2]}` },
  { regex: /\b(\d+)\b/g, toLabel: (m) => m[1], filter: (m) => {
    const n = parseInt(m[1], 10);
    return n >= 20;
  } },
];

function findAllLoadsInSegment(segment: string): { label: string; start: number; end: number }[] {
  const loads: { label: string; start: number; end: number }[] = [];
  const usedRanges = new Set<string>();
  for (const { regex, toLabel, filter } of LOAD_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpMatchArray | null;
    while ((match = regex.exec(segment)) !== null) {
      if (filter && !filter(match)) continue;
      const label = toLabel(match);
      const rangeKey = `${match.index}-${match.index + match[0].length}`;
      if (usedRanges.has(rangeKey)) continue;
      usedRanges.add(rangeKey);
      loads.push({ label, start: match.index, end: match.index + match[0].length });
    }
  }
  return loads;
}

function assignLoadsToMovements(
  movementMatches: { canonical: string; start: number; end: number }[],
  loads: { label: string; start: number; end: number }[]
): Map<number, string> {
  const assignment = new Map<number, { label: string; dist: number }>();

  for (const load of loads) {
    let bestMov: { idx: number; dist: number } | null = null;
    for (let mi = 0; mi < movementMatches.length; mi++) {
      const mov = movementMatches[mi];
      const dist = Math.min(
        Math.abs(load.start - mov.end),
        Math.abs(load.end - mov.start)
      );
      if (!bestMov || dist < bestMov.dist) {
        bestMov = { idx: mi, dist };
      }
    }
    if (bestMov) {
      const existing = assignment.get(bestMov.idx);
      if (!existing || bestMov.dist < existing.dist) {
        assignment.set(bestMov.idx, { label: load.label, dist: bestMov.dist });
      }
    }
  }
  return new Map([...assignment].map(([k, v]) => [k, v.label]));
}

type ExtractedMovement = { name: string; canonical: string; modality: string; load: string };

function extractMovementsImpl(
  text: string,
  library: Record<string, { modality: "W" | "G" | "M"; category: string }>,
  aliases: Record<string, string>
): ExtractedMovement[] {
  const segments = text.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  const result: ExtractedMovement[] = [];
  const seenInSegment = new Set<string>();

  for (const segment of segments) {
    const lower = segment.toLowerCase();
    seenInSegment.clear();
    const movementMatches: { canonical: string; start: number; end: number }[] = [];

    for (const [canonical] of Object.entries(library)) {
      const spaced = canonical.replace(/_/g, " ");
      const patterns = [`\\b${spaced}s?\\b`, `\\b${canonical}\\b`];
      for (const p of patterns) {
        const regex = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        let m: RegExpMatchArray | null;
        while ((m = regex.exec(lower)) !== null) {
          movementMatches.push({ canonical, start: m.index, end: m.index + m[0].length });
        }
      }
    }
    for (const [alias, canonical] of Object.entries(aliases)) {
      if (!library[canonical]) continue;
      const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "gi");
      let m: RegExpMatchArray | null;
      while ((m = regex.exec(lower)) !== null) {
        movementMatches.push({ canonical, start: m.index, end: m.index + m[0].length });
      }
    }

    const loads = findAllLoadsInSegment(segment);
    const loadAssignment = assignLoadsToMovements(movementMatches, loads);

    for (let i = 0; i < movementMatches.length; i++) {
      const { canonical, start } = movementMatches[i];
      const key = `${canonical}-${start}`;
      if (seenInSegment.has(key)) continue;
      seenInSegment.add(key);

      const loadLabel = loadAssignment.get(i) ?? "BW";
      const info = library[canonical] || { modality: "?" as const, category: "Other" };
      result.push({
        name: canonical.replace(/_/g, " "),
        canonical,
        modality: info.modality,
        load: loadLabel,
      });
    }
  }

  return result;
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
  if (/\d+X\d+|@\d+%/.test(t)) return "Strength";
  return "Other";
}

function countMetconMovements(
  text: string,
  extract: (t: string) => ExtractedMovement[]
): number {
  return new Set(extract(text).map((m) => m.canonical)).size;
}

export function analyzeWorkouts(
  workouts: WorkoutInput[],
  movements?: MovementsContext
): AnalysisOutput {
  const library = movements?.library ?? MOVEMENT_LIBRARY;
  const aliases = movements?.aliases ?? DEFAULT_MOVEMENT_ALIASES;
  const essentialCanonicals =
    movements?.essentialCanonicals ?? new Set(Object.keys(MOVEMENT_LIBRARY));
  const extract = (text: string) => extractMovementsImpl(text, library, aliases);
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

  for (const w of workouts) {
    const text = w.workout_text;
    const format = detectWorkoutFormat(text);
    formatCounts[format] = (formatCounts[format] || 0) + 1;

    if (format !== "Strength") {
      const domain = inferTimeDomain(text);
      timeDomainCounts[domain] = (timeDomainCounts[domain] || 0) + 1;

      const mc = countMetconMovements(text, extract);
      if (mc === 2) structureCounts.couplets++;
      else if (mc === 3) structureCounts.triplets++;
      else if (mc >= 4) structureCounts.chipper++;
      else structureCounts.other++;
    } else {
      structureCounts.other++;
    }

    const moves = extract(text);
    for (const m of moves) {
      allFoundMovements.add(m.canonical);
      const modLabel = m.modality === "W" ? "Weightlifting" : m.modality === "G" ? "Gymnastics" : "Monostructural";
      modalCounts[modLabel] = (modalCounts[modLabel] || 0) + 1;

      if (m.load === "BW") {
        bodyweightCount++;
      } else {
        loadedCount++;
        allLoads.add(m.load);
      }

      const existing = movementTotals.get(m.canonical);
      if (existing) {
        existing.count++;
        existing.loads.push(m.load);
      } else {
        movementTotals.set(m.canonical, { count: 1, modality: m.modality, loads: [m.load] });
      }
    }
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

  function toNumericLoad(load: string): number | null {
    if (load === "BW") return null;
    const pct = load.match(/^(\d+)%$/);
    if (pct) return parseInt(pct[1], 10);
    const slash = load.match(/^(\d+)\/\d+$/);
    if (slash) return parseInt(slash[1], 10);
    const n = parseInt(load, 10);
    return isNaN(n) ? null : n;
  }

  const loadBands: Record<string, number> = {
    "0–95": 0,
    "135–185": 0,
    "225+": 0,
  };
  for (const [, v] of movementTotals) {
    for (const load of v.loads) {
      if (load === "BW") continue;
      const num = toNumericLoad(load);
      if (num !== null) {
        if (num <= 95) loadBands["0–95"]++;
        else if (num <= 185) loadBands["135–185"]++;
        else loadBands["225+"]++;
      }
    }
  }

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

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const overlaps: { week: number; days: string; movements: string[] }[] = [];
  const sorted = [...workouts].sort((a, b) => (a.week_num - b.week_num) * 100 + (a.day_num - b.day_num));

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const isConsecutive = curr.week_num === next.week_num && next.day_num === curr.day_num + 1;
    if (!isConsecutive) continue;

    const currMoves = new Set(extract(curr.workout_text).map((m) => m.canonical));
    const nextMoves = extract(next.workout_text).map((m) => m.canonical);
    const shared = nextMoves.filter((c) => currMoves.has(c));
    if (shared.length > 0) {
      overlaps.push({
        week: curr.week_num,
        days: `${dayNames[curr.day_num - 1]}-${dayNames[next.day_num - 1]}`,
        movements: shared.map((c) => c.replace(/_/g, " ")),
      });
    }
  }

  if (timeDomainCounts.long === 0 && workouts.length >= 5) {
    notices.push("No workouts exceed 15 minutes. Consider adding at least one long time domain.");
  }
  if (modalCounts.Weightlifting === 0 && workouts.length >= 5) {
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
