// Performance grid — server-side port of src/lib/performanceGrid.ts
// (founder spec, 2026-10-03). The duration × barbell-presence grid and the
// per-skill cost table, computed from raw per-workout rows: competition
// all_results or logged program metcons. Every figure is an event-weighted
// average plus its count; no taxonomy, no derived baselines. This is the
// honest replacement for feeding the program writer the competition
// service's opaque closable_gaps aggregation.

export type GridTimeDomain = "short" | "medium" | "long";

export interface GridSourceRow {
  timeDomain: GridTimeDomain | null;
  percentile: number;
  hasBarbell: boolean;
  skills: string[];
  label: string;
}

export interface GridCell { pct: number | null; n: number }

export interface GridRowData {
  key: "all" | "barbell" | "no_barbell";
  label: string;
  /** short, medium, long, all — in that order. */
  cells: GridCell[];
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function cellOf(rows: GridSourceRow[]): GridCell {
  if (rows.length === 0) return { pct: null, n: 0 };
  return { pct: avg(rows.map((r) => r.percentile)), n: rows.length };
}

export function computeGrid(source: GridSourceRow[]): GridRowData[] {
  const rows = source.filter((r) => r.timeDomain !== null);
  const domains: GridTimeDomain[] = ["short", "medium", "long"];
  const mk = (keep: (r: GridSourceRow) => boolean): GridCell[] => [
    ...domains.map((d) => cellOf(rows.filter((r) => r.timeDomain === d && keep(r)))),
    cellOf(rows.filter(keep)),
  ];
  return [
    { key: "all", label: "All", cells: mk(() => true) },
    { key: "barbell", label: "Barbell", cells: mk((r) => r.hasBarbell) },
    { key: "no_barbell", label: "No barbell", cells: mk((r) => !r.hasBarbell) },
  ];
}

export interface SkillCostRow {
  skill: string;
  pct: number;
  n: number;
  delta: number;
}

export function computeSkillCost(source: GridSourceRow[]): SkillCostRow[] {
  const rows = source.filter((r) => r.timeDomain !== null);
  if (rows.length === 0) return [];
  const overall = avg(rows.map((r) => r.percentile));
  const bySkill = new Map<string, number[]>();
  for (const r of rows) {
    for (const s of r.skills) {
      const list = bySkill.get(s) ?? [];
      list.push(r.percentile);
      bySkill.set(s, list);
    }
  }
  return [...bySkill.entries()]
    .map(([skill, pcts]): SkillCostRow => ({
      skill,
      pct: avg(pcts),
      n: pcts.length,
      delta: avg(pcts) - overall,
    }))
    .sort((a, b) => a.delta - b.delta);
}

// ── Movement classification (mirrors the frontend lib) ─────────────

const SKILL_PATTERNS: Array<[RegExp, string]> = [
  [/muscle.?up/, "Muscle-ups"],
  [/handstand.?walk/, "Handstand walk"],
  [/handstand.?push.?up|hspu/, "HSPU"],
  [/rope.?climb/, "Rope climbs"],
  [/pistol/, "Pistols"],
  [/double.?under/, "Double-unders"],
  [/wall.?walk/, "Wall walks"],
];

export function skillsInMovementNames(names: string[]): string[] {
  const found = new Set<string>();
  for (const raw of names) {
    const n = raw.toLowerCase();
    for (const [re, label] of SKILL_PATTERNS) {
      if (re.test(n)) found.add(label);
    }
  }
  return [...found];
}

export function hasBarbellEquipment(equipmentLists: string[][]): boolean {
  return equipmentLists.some((eq) => eq.some((e) => e.toLowerCase() === "barbell"));
}

const BARBELL_LIFT = /snatch|clean|jerk|thruster|deadlift|front squat|back squat|overhead squat|push press|bench press|good morning|barbell/;
const OTHER_IMPLEMENT = /dumbbell|\bdb\b|kettlebell|\bkb\b|sandbag|odd.?object|wall.?ball|medicine|muscle.?up/;
export function hasBarbellMovementNames(names: string[]): boolean {
  return names.some((raw) => {
    const n = raw.toLowerCase();
    return BARBELL_LIFT.test(n) && !OTHER_IMPLEMENT.test(n);
  });
}

// ── Prompt formatter ────────────────────────────────────────────────

const fmt = (c: GridCell) => (c.pct === null ? "—" : `${Math.round(c.pct)} (${c.n})`);

/** Compact fixed-width grid + skill-cost lines for a writer prompt.
 *  `sourceLabel` names the evidence and its population, e.g.
 *  "IN COMPETITION — cohort percentile (events)". */
export function formatPerformanceGridSection(
  sourceLabel: string,
  grid: GridRowData[],
  skills: SkillCostRow[],
): string {
  const lines: string[] = [`PERFORMANCE GRID — ${sourceLabel}, event-weighted`];
  const pad = (s: string, w: number) => s.padEnd(w);
  lines.push(`${pad("", 12)}${pad("Short", 11)}${pad("Medium", 11)}${pad("Long", 11)}All`);
  for (const row of grid) {
    lines.push(`${pad(row.label, 12)}${pad(fmt(row.cells[0]), 11)}${pad(fmt(row.cells[1]), 11)}${pad(fmt(row.cells[2]), 11)}${fmt(row.cells[3])}`);
  }
  if (skills.length > 0) {
    const overall = grid.find((r) => r.key === "all")?.cells[3];
    const overallTxt = overall?.pct != null ? ` vs overall ${Math.round(overall.pct)}` : "";
    lines.push(
      `Skill cost (percentile when present${overallTxt}): ` +
        skills.map((s) => `${s.skill} ${Math.round(s.pct)} (n=${s.n}, ${s.delta >= 0 ? "+" : ""}${Math.round(s.delta)})`).join(" · "),
    );
  }
  lines.push("Counts are the evidence size — weight cells accordingly; small-n cells are hints, not findings.");
  return lines.join("\n");
}
