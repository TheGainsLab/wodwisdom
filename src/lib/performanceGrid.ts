// The duration × barbell-presence performance grid and the per-skill cost
// table (founder spec, 2026-10-03). Pure compute over a source-agnostic row
// shape: competition all_results today, logged program metcons next — any
// source reduces to {time domain, percentile, movements}. Every figure is an
// event-weighted average plus its count; nothing derived, no taxonomy.

export type GridTimeDomain = 'short' | 'medium' | 'long';

export interface GridSourceRow {
  timeDomain: GridTimeDomain | null; // null = unbucketable; excluded from the grid
  percentile: number;
  hasBarbell: boolean;
  skills: string[]; // display names of skill movements present
  label: string;    // evidence line, e.g. "2024 Open · 24.2"
}

export interface GridCell { pct: number | null; n: number }

export interface GridRowData {
  key: 'all' | 'barbell' | 'no_barbell';
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
  const domains: GridTimeDomain[] = ['short', 'medium', 'long'];
  const mk = (keep: (r: GridSourceRow) => boolean): GridCell[] => [
    ...domains.map((d) => cellOf(rows.filter((r) => r.timeDomain === d && keep(r)))),
    cellOf(rows.filter(keep)), // the All column: event-weighted across the row
  ];
  return [
    { key: 'all', label: 'All', cells: mk(() => true) },
    { key: 'barbell', label: 'Barbell', cells: mk((r) => r.hasBarbell) },
    { key: 'no_barbell', label: 'No barbell', cells: mk((r) => !r.hasBarbell) },
  ];
}

export interface SkillCostRow {
  skill: string;
  pct: number;
  n: number;
  /** vs the event-weighted average across ALL rows (the grid's All×All cell). */
  delta: number;
  events: { label: string; pct: number }[];
}

export function computeSkillCost(source: GridSourceRow[]): SkillCostRow[] {
  const rows = source.filter((r) => r.timeDomain !== null);
  if (rows.length === 0) return [];
  const overall = avg(rows.map((r) => r.percentile));
  const bySkill = new Map<string, GridSourceRow[]>();
  for (const r of rows) {
    for (const s of r.skills) {
      const list = bySkill.get(s) ?? [];
      list.push(r);
      bySkill.set(s, list);
    }
  }
  return [...bySkill.entries()]
    .map(([skill, list]): SkillCostRow => ({
      skill,
      pct: avg(list.map((r) => r.percentile)),
      n: list.length,
      delta: avg(list.map((r) => r.percentile)) - overall,
      events: list.map((r) => ({ label: r.label, pct: r.percentile })),
    }))
    .sort((a, b) => a.delta - b.delta); // most expensive first
}

// ── Movement classification ─────────────────────────────────────────
// Fixed skill list, matched against normalized movement names. These are
// catalog/reference names (typed data), not generated prose.

const SKILL_PATTERNS: Array<[RegExp, string]> = [
  [/muscle.?up/, 'Muscle-ups'],
  [/handstand.?walk/, 'Handstand walk'],
  [/handstand.?push.?up|hspu/, 'HSPU'],
  [/rope.?climb/, 'Rope climbs'],
  [/pistol/, 'Pistols'],
  [/double.?under/, 'Double-unders'],
  [/wall.?walk/, 'Wall walks'],
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

/** Barbell presence from equipment arrays — the house vocabulary is the
 *  literal token "barbell", so "bar muscle-up" can never false-positive. */
export function hasBarbellEquipment(equipmentLists: string[][]): boolean {
  return equipmentLists.some((eq) => eq.some((e) => e.toLowerCase() === 'barbell'));
}

/** Barbell presence from movement NAMES — for sources without equipment
 *  arrays (logged program metcons). A name counts only when it matches a
 *  barbell lift AND carries no other-implement qualifier, so "dumbbell
 *  snatch" and "bar muscle-up" can't false-positive. Catalog/typed names,
 *  not generated prose. */
const BARBELL_LIFT = /snatch|clean|jerk|thruster|deadlift|front squat|back squat|overhead squat|push press|bench press|good morning|barbell/;
const OTHER_IMPLEMENT = /dumbbell|\bdb\b|kettlebell|\bkb\b|sandbag|odd.?object|wall.?ball|medicine|muscle.?up/;
export function hasBarbellMovementNames(names: string[]): boolean {
  return names.some((raw) => {
    const n = raw.toLowerCase();
    return BARBELL_LIFT.test(n) && !OTHER_IMPLEMENT.test(n);
  });
}
