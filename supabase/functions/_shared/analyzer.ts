// Shared program analyzer - used by analyze-program and incorporate-movements

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

const MOVEMENT_ALIASES: Record<string, string> = {
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
  movement_frequency: { name: string; count: number; modality: string; load: string }[];
  notices: string[];
  not_programmed: Record<string, string[]>;
  consecutive_overlaps: { week: number; days: string; movements: string[] }[];
}

function extractMovements(text: string): { name: string; canonical: string; modality: string; load: string }[] {
  const found = new Map<string, { name: string; modality: string; load: string }>();
  const lower = text.toLowerCase();

  function tryMatch(pattern: string | RegExp, canonical: string): void {
    const regex = typeof pattern === "string" ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : pattern;
    if (regex.test(lower)) {
      const existing = found.get(canonical);
      if (!existing) {
        const info = MOVEMENT_LIBRARY[canonical] || { modality: "?", category: "Other" };
        found.set(canonical, { name: canonical.replace(/_/g, " "), modality: info.modality, load: "" });
      }
    }
  }

  for (const [canonical] of Object.entries(MOVEMENT_LIBRARY)) {
    const spaced = canonical.replace(/_/g, " ");
    tryMatch(`\\b${spaced}s?\\b`, canonical);
    tryMatch(`\\b${canonical}\\b`, canonical);
  }

  for (const [alias, canonical] of Object.entries(MOVEMENT_ALIASES)) {
    const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "gi");
    if (regex.test(lower)) {
      const existing = found.get(canonical);
      if (!existing && MOVEMENT_LIBRARY[canonical]) {
        const info = MOVEMENT_LIBRARY[canonical];
        found.set(canonical, { name: canonical.replace(/_/g, " "), modality: info.modality, load: "" });
      }
    }
  }

  return Array.from(found.entries()).map(([canonical, v]) => ({ ...v, canonical }));
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

function inferTimeDomain(text: string): "short" | "medium" | "long" {
  const t = text.toLowerCase();
  const amrapMatch = t.match(/amrap\s*(\d+)|as many.*?(\d+)\s*min/i);
  if (amrapMatch) {
    const mins = parseInt(amrapMatch[1] || amrapMatch[2] || "10", 10);
    if (mins <= 9) return "short";
    if (mins <= 20) return "medium";
    return "long";
  }
  const rftMatch = t.match(/(\d+)\s*round|(\d+)\s*rft/i);
  if (rftMatch) {
    const rounds = parseInt(rftMatch[1] || rftMatch[2] || "5", 10);
    if (rounds <= 3) return "short";
    if (rounds <= 5) return "medium";
    return "long";
  }
  const emomMatch = t.match(/emom\s*(\d+)|e(\d+)mom|every\s+(\d+)\s+min/i);
  if (emomMatch) {
    const mins = parseInt(emomMatch[1] || emomMatch[2] || emomMatch[3] || "10", 10);
    if (mins <= 10) return "short";
    if (mins <= 15) return "medium";
    return "long";
  }
  return "medium";
}

function countMetconMovements(text: string): number {
  const movements = extractMovements(text);
  return new Set(movements.map((m) => m.canonical)).size;
}

export function analyzeWorkouts(workouts: WorkoutInput[]): AnalysisOutput {
  const modalCounts: Record<string, number> = { Weightlifting: 0, Gymnastics: 0, Monostructural: 0 };
  const timeDomainCounts: Record<string, number> = { short: 0, medium: 0, long: 0 };
  const structureCounts: Record<string, number> = { couplets: 0, triplets: 0, chipper: 0, other: 0 };
  const formatCounts: Record<string, number> = {};
  const movementTotals = new Map<string, { count: number; modality: string; load: string }>();
  const allFoundMovements = new Set<string>();
  const notices: string[] = [];

  for (const w of workouts) {
    const text = w.workout_text;
    const format = detectWorkoutFormat(text);
    formatCounts[format] = (formatCounts[format] || 0) + 1;

    if (format !== "Strength") {
      const domain = inferTimeDomain(text);
      timeDomainCounts[domain] = (timeDomainCounts[domain] || 0) + 1;

      const mc = countMetconMovements(text);
      if (mc === 2) structureCounts.couplets++;
      else if (mc === 3) structureCounts.triplets++;
      else if (mc >= 4) structureCounts.chipper++;
      else structureCounts.other++;
    } else {
      structureCounts.other++;
    }

    const moves = extractMovements(text);
    for (const m of moves) {
      allFoundMovements.add(m.canonical);
      const modLabel = m.modality === "W" ? "Weightlifting" : m.modality === "G" ? "Gymnastics" : "Monostructural";
      modalCounts[modLabel] = (modalCounts[modLabel] || 0) + 1;

      const existing = movementTotals.get(m.canonical);
      if (existing) existing.count++;
      else movementTotals.set(m.canonical, { count: 1, modality: m.modality, load: m.load });
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
      load: v.load,
    }))
    .sort((a, b) => b.count - a.count);

  const notProgrammed: Record<string, string[]> = {
    Weightlifting: [],
    Gymnastics: [],
    Monostructural: [],
  };
  for (const [canonical, info] of Object.entries(MOVEMENT_LIBRARY)) {
    if (!allFoundMovements.has(canonical) && notProgrammed[info.category]) {
      notProgrammed[info.category].push(canonical.replace(/_/g, " "));
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

    const currMoves = new Set(extractMovements(curr.workout_text).map((m) => m.canonical));
    const nextMoves = extractMovements(next.workout_text).map((m) => m.canonical);
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
  };
}
