/**
 * Diagnostic formatters — produce prompt-ready strings from an
 * AthleteDiagnostic object. Pure string builders; no logic, no I/O.
 *
 * Three outputs consumed by profile-analysis and generate-program:
 *   - formatLiftFindings → ATHLETE LIFT FINDINGS user-prompt block
 *   - formatSkillsFindings → ATHLETE SKILLS FINDINGS user-prompt block
 *   - formatActiveFlagRules → flag-conditional rule blocks for system prompt
 */

import type {
  AthleteDiagnostic,
  AccessoryPoolEntry,
  LiftLoading,
} from "./derive-athlete-diagnostic.ts";
import {
  LIFT_FLAG_RULE_BLOCKS,
  PREREQUISITE_GAP_RULE_BLOCK,
  SKILL_LEVEL_RULE_BLOCKS,
} from "./diagnostic-constants.ts";

// ============================================================
// Lift findings
// ============================================================

const SQUAT_LIFTS = ["back_squat", "front_squat", "overhead_squat"] as const;
const HINGE_LIFTS = ["deadlift"] as const;
const OLYMPIC_LIFTS = [
  "clean", "power_clean", "clean_and_jerk", "jerk",
  "snatch", "power_snatch", "push_jerk",
] as const;
const PRESSING_LIFTS = ["press", "push_press", "bench_press"] as const;

const LIFT_LABEL: Record<string, string> = {
  back_squat: "BS",
  front_squat: "FS",
  overhead_squat: "OHS",
  deadlift: "DL",
  clean: "clean",
  power_clean: "power_clean",
  clean_and_jerk: "C&J",
  jerk: "jerk",
  snatch: "snatch",
  power_snatch: "power_snatch",
  push_jerk: "push_jerk",
  press: "SP",
  push_press: "push_press",
  bench_press: "bench",
};

function lift1RMLine(
  oneRms: Record<string, number>,
  names: ReadonlyArray<string>,
): string {
  const parts = names
    .filter((n) => typeof oneRms[n] === "number" && oneRms[n] > 0)
    .map((n) => `${LIFT_LABEL[n] ?? n} ${oneRms[n]}`);
  return parts.join(" · ");
}

function levelLine(
  perLift: Record<string, string | null>,
  synthetic: Record<string, string | null>,
): string[] {
  const lines: string[] = [];
  const all: Array<[string, string | null]> = [];

  // BW-classified first.
  for (const lift of ["back_squat", "deadlift", "bench_press", "press"]) {
    if (perLift[lift]) all.push([lift, perLift[lift]]);
  }
  // Then ratio-only lifts in roughly the same family ordering.
  for (const lift of [
    "front_squat", "overhead_squat", "snatch", "power_snatch",
    "clean", "power_clean", "clean_and_jerk", "jerk",
    "push_press", "push_jerk",
  ]) {
    if (synthetic[lift]) all.push([lift, synthetic[lift]]);
  }

  // Group three per line for readability.
  for (let i = 0; i < all.length; i += 3) {
    const chunk = all.slice(i, i + 3);
    lines.push(
      "  " +
        chunk.map(([lift, lvl]) => `${LIFT_LABEL[lift] ?? lift}: ${lvl}`).join(" · "),
    );
  }
  return lines;
}

function formatPct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(0)}%`;
}

function boundsLine(lift: string, level: string | null, loading: LiftLoading): string {
  const lvl = level ? ` (${level})` : "";
  const ceiling = formatPct(loading.cycle_ceiling);
  const deload = formatPct(loading.deload_ceiling);
  const schemes = loading.allowed_schemes.join(", ");
  const ceilingPart = loading.cycle_ceiling != null
    ? `cycle ≤ ${ceiling} · deload ≤ ${deload}`
    : "no ceiling defined";
  return `  ${LIFT_LABEL[lift] ?? lift}${lvl}: ${ceilingPart} · schemes: ${schemes}`;
}

function poolLine(entry: AccessoryPoolEntry): string {
  const fired = entry.fired_by.length > 1
    ? ` — fired by: ${entry.fired_by.join(", ")}`
    : ` — ${entry.fired_by[0] ?? ""}`;
  return `  ${entry.movement} (${entry.category})${fired}`;
}

export function formatLiftFindings(d: AthleteDiagnostic): string {
  const out: string[] = ["ATHLETE LIFT FINDINGS", ""];

  // 1RMs
  out.push("1RMs (lbs):");
  const squatLine    = lift1RMLine(d.lifts.one_rms, SQUAT_LIFTS);
  const hingeLine    = lift1RMLine(d.lifts.one_rms, HINGE_LIFTS);
  const olympicLine  = lift1RMLine(d.lifts.one_rms, OLYMPIC_LIFTS);
  const pressingLine = lift1RMLine(d.lifts.one_rms, PRESSING_LIFTS);
  if (squatLine)    out.push(`  Squats:    ${squatLine}`);
  if (hingeLine)    out.push(`  Hinge:     ${hingeLine}`);
  if (olympicLine)  out.push(`  Olympic:   ${olympicLine}`);
  if (pressingLine) out.push(`  Pressing:  ${pressingLine}`);
  out.push("");

  // Per-lift levels (BW + synthetic interleaved by family).
  out.push("Per-lift levels:");
  out.push(...levelLine(d.lifts.per_lift_levels, d.lifts.synthetic_levels));
  out.push("");

  // Active flags
  if (d.lifts.flags.length > 0) {
    out.push("Active flags:");
    out.push("  " + d.lifts.flags.map((f) => f.name).join(" · "));
    out.push("");
  }

  // Permissible bounds per lift
  const liftEntries = Object.entries(d.lifts.loading);
  if (liftEntries.length > 0) {
    out.push("Permissible bounds:");
    for (const [lift, loading] of liftEntries) {
      const level =
        d.lifts.per_lift_levels[lift] ?? d.lifts.synthetic_levels[lift] ?? null;
      out.push(boundsLine(lift, level, loading));
    }
    out.push("");
  }

  // Accessory pool
  if (d.lifts.accessory_pool.length > 0) {
    out.push("Accessory pool (curated for active flags, ordered by leverage):");
    for (const entry of d.lifts.accessory_pool) out.push(poolLine(entry));
  }

  return out.join("\n").trimEnd();
}

// ============================================================
// Skills findings
// ============================================================

const PULLING_SKILLS = [
  "strict_pull_ups", "kipping_pull_ups", "butterfly_pull_ups",
  "chest_to_bar_pull_ups", "bar_muscle_ups",
  "muscle_ups", "strict_ring_muscle_ups",
] as const;

const HSPU_SKILLS = [
  "wall_facing_hspu", "strict_hspu", "hspu", "deficit_hspu", "handstand_walk",
] as const;

const OTHER_SKILLS = [
  "toes_to_bar", "ring_dips", "l_sit",
  "rope_climbs", "legless_rope_climbs",
  "double_unders", "pistols",
] as const;

const SKILL_LABEL: Record<string, string> = {
  strict_pull_ups: "strict",
  kipping_pull_ups: "kipping",
  butterfly_pull_ups: "butterfly",
  chest_to_bar_pull_ups: "C2B",
  bar_muscle_ups: "bar_MU",
  muscle_ups: "ring_MU (kipping)",
  strict_ring_muscle_ups: "ring_MU (strict)",
  wall_facing_hspu: "wall_facing",
  strict_hspu: "strict_HSPU",
  hspu: "kipping_HSPU",
  deficit_hspu: "deficit_HSPU",
  handstand_walk: "handstand_walk",
  toes_to_bar: "toes_to_bar",
  ring_dips: "ring_dips",
  l_sit: "l_sit",
  rope_climbs: "rope_climbs",
  legless_rope_climbs: "legless_rope_climbs",
  double_unders: "double_unders",
  pistols: "pistols",
};

function skillGroupLine(
  levels: Record<string, string>,
  group: ReadonlyArray<string>,
): string {
  return group
    .filter((s) => levels[s])
    .map((s) => `${SKILL_LABEL[s] ?? s}: ${levels[s]}`)
    .join(" · ");
}

export function formatSkillsFindings(d: AthleteDiagnostic): string {
  const out: string[] = ["ATHLETE SKILLS FINDINGS", ""];
  const levels = d.skills.per_skill_levels;

  // Levels by family
  const pullingLine = skillGroupLine(levels, PULLING_SKILLS);
  const hspuLine    = skillGroupLine(levels, HSPU_SKILLS);
  const otherLine   = skillGroupLine(levels, OTHER_SKILLS);
  if (pullingLine || hspuLine || otherLine) {
    out.push("Levels:");
    if (pullingLine) out.push(`  Pulling:  ${pullingLine}`);
    if (hspuLine)    out.push(`  HSPU:     ${hspuLine}`);
    if (otherLine)   out.push(`  Other:    ${otherLine}`);
    out.push("");
  }

  // Active flags (prerequisite_gap)
  if (d.skills.flags.length > 0) {
    out.push("Active flags:");
    for (const f of d.skills.flags) {
      const missing = f.missing_prerequisites.join(", ");
      out.push(`  ${f.name} on ${f.skill} (missing: ${missing})`);
    }
    out.push("");
  }

  // Top-N active focus
  if (d.skills.active_focus.length > 0) {
    out.push(`Top ${d.skills.active_focus.length} active focus:`);
    d.skills.active_focus.forEach((s, i) => {
      out.push(`  ${i + 1}. ${s}`);
    });
    out.push("");
  }

  // Metcon allow-list
  if (d.skills.metcon_allow_list.length > 0) {
    out.push("Metcon allow-list (movement categories):");
    out.push("  " + d.skills.metcon_allow_list.join(" · "));
  }

  return out.join("\n").trimEnd();
}

// ============================================================
// Competition profile (Tier 4)
// ============================================================

/**
 * Format the Tier 4 competition slot as a prompt-ready block.
 * Returns empty string when athlete isn't linked (diagnostic.competition is null).
 *
 * Conservative v1 surface: identity + tier + summary + recent evidence.
 * No flag interpretation yet — descriptive only.
 */
export function formatCompetitionProfile(d: AthleteDiagnostic): string {
  if (!d.competition) return "";

  const c = d.competition;
  const lines: string[] = ["COMPETITION PROFILE", ""];

  // Identity + tier + seasons + latest percentile.
  const tierLabel = c.observed_tier.replace(/_/g, " ");
  const seasonsLabel = c.seasons_competed === 1 ? "1 season" : `${c.seasons_competed} seasons`;
  lines.push(`${c.identity.name} (${tierLabel}, ${seasonsLabel}, latest cohort percentile ${c.latest_percentile.toFixed(1)})`);
  if (c.identity.profile_url) lines.push(`Profile: ${c.identity.profile_url}`);

  // Trend.
  const t = c.trend;
  if (t.direction === "new") {
    lines.push("Trend: new (fewer than 2 seasons — no trajectory available)");
  } else if (t.points_per_year != null) {
    const sign = t.points_per_year > 0 ? "+" : "";
    lines.push(`Trend: ${t.direction} (${sign}${t.points_per_year.toFixed(2)} pp/year)`);
  } else {
    lines.push(`Trend: ${t.direction}`);
  }

  // Consistency.
  if (c.consistency != null) {
    const desc = c.consistency < 5
      ? "steady"
      : c.consistency < 15
        ? "moderately variable"
        : "highly variable";
    lines.push(`Consistency: ${c.consistency.toFixed(2)} stddev (${desc})`);
  }

  if (c.competitor_bonus_active) {
    lines.push("Competitor bonus active (loading ceilings +3%).");
  }

  // Cohort caveat — keeps the model from comparing apples-to-apples
  // across stages where cohort sizes differ by orders of magnitude.
  lines.push("");
  lines.push("Note: percentiles are cohort-relative within each workout (e.g., Open-cohort = hundreds of thousands; Games-cohort = ~40 elites). Treat as descriptive context, not absolute strength.");

  // Recent results.
  if (c.recent_evidence.length > 0) {
    lines.push("");
    lines.push("Recent results (top by percentile):");
    for (const r of c.recent_evidence) {
      const unique = Array.from(new Set(r.movements ?? []));
      const moves = unique.length === 0
        ? "(no parsed movements)"
        : unique.slice(0, 4).join(" + ") + (unique.length > 4 ? " + ..." : "");
      const td = r.time_domain ? `${r.time_domain} time` : "no time domain";
      lines.push(`  ${r.workout_label} — ${r.percentile.toFixed(1)}pct (rank ${r.rank}, ${r.raw_score} ${r.scoring_unit}, ${td}): ${moves}`);
    }
  }

  return lines.join("\n").trimEnd();
}

// ============================================================
// Active flag rules (system prompt)
// ============================================================

/**
 * Concatenate flag-conditional rule prose for injection into the system
 * prompt. Only emits rules for flags / levels actually active in this
 * athlete's diagnostic — keeps the system prompt scoped to what matters.
 */
export function formatActiveFlagRules(d: AthleteDiagnostic): string {
  const blocks: string[] = [];

  // Lift flag rules
  for (const flag of d.lifts.flags) {
    const rule = LIFT_FLAG_RULE_BLOCKS[flag.name];
    if (rule) blocks.push(`- [${flag.name}] ${rule}`);
  }

  // prerequisite_gap rule (one block, fires when any skill flag is active)
  if (d.skills.flags.length > 0) {
    blocks.push(`- [prerequisite_gap] ${PREREQUISITE_GAP_RULE_BLOCK}`);
  }

  // Skill-level rules — only emit a level block when the active focus list
  // contains at least one skill at that level.
  const levelsInFocus = new Set<string>();
  for (const skill of d.skills.active_focus) {
    const lvl = d.skills.per_skill_levels[skill];
    if (lvl === "beginner" || lvl === "none") levelsInFocus.add("beginner");
    else if (lvl === "intermediate") levelsInFocus.add("intermediate");
    else if (lvl === "advanced") levelsInFocus.add("advanced");
  }
  for (const lvl of ["beginner", "intermediate", "advanced"] as const) {
    if (levelsInFocus.has(lvl)) {
      blocks.push(`- [skill ${lvl}] ${SKILL_LEVEL_RULE_BLOCKS[lvl]}`);
    }
  }

  if (blocks.length === 0) return "";
  return [
    "ATHLETE-SPECIFIC RULES (apply where relevant; only the rules below pertain to this athlete):",
    ...blocks,
  ].join("\n");
}
