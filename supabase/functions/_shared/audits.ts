/**
 * audits.ts
 *
 * The 7 deterministic audit functions for the v2 generate-program
 * writer's output. Each is a pure function (no IO, no LLM calls) that
 * takes the parsed WriterOutput plus the context it needs (vocabulary,
 * lifts, days_per_week) and returns an AuditResult.
 *
 * The audit-runner (separate file) dispatches these, collects
 * failures, and decides whether to regenerate (up to N attempts) or
 * hard-fail to the user.
 *
 * The 8th audit (LLM-mediated safety review) lives in its own module
 * because it's async + makes a Claude call.
 *
 * Rules locked in competition_history_feature_plan.md, section
 * "Audit rules — FULL SET LOCKED 2026-05-14":
 *   1. Block-type enum existence
 *   2. Strength-block one-primary-lift
 *   3. Metcon-block one-main-piece (proxied by: requires block_scheme)
 *   4. Required-fields existence (block has movements; movement has
 *      at least one of sets/reps/weight/time_seconds/distance)
 *   5. Day-count structural (4 × days_per_week, no duplicates)
 *   6. Load sanity (prescribed weight ≤ 100% of athlete's 1RM)
 *   7. Movement vocabulary compliance (display_name match)
 */

import {
  BLOCK_TYPES,
  type WriterOutput,
  type BlockPrescription,
  type MovementPrescription,
} from "./v2-output-schema.ts";

export interface AuditResult {
  rule: string;
  passed: boolean;
  /** Human-readable violation messages — empty when passed. */
  violations: string[];
}

// ============================================================
// Rule 1 — block_type enum existence
// ============================================================

/**
 * Every block must declare a block_type from the canonical 8-enum.
 * Redundant with Anthropic tool-use schema enforcement but kept as
 * belt-and-suspenders (and protects against any future path that
 * doesn't enforce the schema at decode time).
 */
export function auditBlockTypeEnum(output: WriterOutput): AuditResult {
  const allowed = new Set<string>(BLOCK_TYPES);
  const violations: string[] = [];
  for (const week of output.weeks) {
    for (const day of week.days) {
      for (let i = 0; i < day.blocks.length; i++) {
        const b = day.blocks[i];
        if (!allowed.has(b.block_type)) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}]: block_type "${b.block_type}" is not in the canonical 8-enum (${BLOCK_TYPES.join(", ")}).`,
          );
        }
      }
    }
  }
  return { rule: "block_type_enum", passed: violations.length === 0, violations };
}

// ============================================================
// Rule 2 — strength block contains exactly one primary lift
// ============================================================

/**
 * A strength block represents the day's primary heavy lift. Multiple
 * movements in a strength block means supplementary work is mixed in
 * — should be split: primary stays in strength, secondary moves to
 * accessory.
 */
export function auditStrengthOneLift(output: WriterOutput): AuditResult {
  const violations: string[] = [];
  for (const week of output.weeks) {
    for (const day of week.days) {
      for (let i = 0; i < day.blocks.length; i++) {
        const b = day.blocks[i];
        if (b.block_type !== "strength") continue;
        if (b.movements.length !== 1) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}] (strength): contains ${b.movements.length} movements (must be exactly 1; supplementary work belongs in an accessory block).`,
          );
        }
      }
    }
  }
  return { rule: "strength_one_lift", passed: violations.length === 0, violations };
}

// ============================================================
// Rule 3 — metcon block represents one conditioning piece
// ============================================================

/**
 * A metcon block represents a single conditioning workout (possibly
 * with multiple movements, like Fran = thrusters + pull-ups). The
 * audit-able proxy: every metcon block must declare a `block_scheme`
 * (the workout's structure — "21-15-9 for time", "AMRAP 12", etc.).
 * A block without a scheme is either a non-metcon mislabeled or
 * multiple metcons glued together (writer should split).
 */
export function auditMetconOnePiece(output: WriterOutput): AuditResult {
  const violations: string[] = [];
  for (const week of output.weeks) {
    for (const day of week.days) {
      for (let i = 0; i < day.blocks.length; i++) {
        const b = day.blocks[i];
        if (b.block_type !== "metcon") continue;
        const scheme = (b.block_scheme ?? "").trim();
        if (scheme === "") {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}] (metcon): block_scheme is missing. Every metcon block must declare its scheme (e.g., "21-15-9 for time", "AMRAP 12", "EMOM 10"). If multiple metcons are intended, split into separate metcon blocks.`,
          );
        }
      }
    }
  }
  return { rule: "metcon_one_piece", passed: violations.length === 0, violations };
}

// ============================================================
// Rule 4 — required-fields existence
// ============================================================

function movementHasAnyPrescription(m: MovementPrescription): boolean {
  return (
    (m.sets != null && m.sets > 0) ||
    (m.reps != null && m.reps > 0) ||
    (m.weight != null && m.weight > 0) ||
    (m.time_seconds != null && m.time_seconds > 0) ||
    (m.distance != null && m.distance > 0)
  );
}

/**
 * Block types that carry a structured prescription (sets/reps/weight
 * etc.). For these, each movement must have at least one of {sets,
 * reps, weight, time_seconds, distance} > 0 so the program has a real
 * working dose, not just a movement name.
 *
 * Warm-up / mobility / cool-down / active-recovery are intentionally
 * descriptive ("Cat-cow, slow" / "Foam roll quads") and skipped — the
 * per-movement-prescription check matched v2's structured-output bias
 * but didn't match how those blocks naturally read.
 */
const PRESCRIPTION_REQUIRED_BLOCK_TYPES = new Set([
  "strength",
  "accessory",
  "metcon",
  "skills",
]);

/**
 * Every block must contain at least one movement (regardless of type).
 * For the prescription-bearing block types above, every movement must
 * also have at least one of {sets, reps, weight, time_seconds, distance}
 * with a positive value.
 *
 * Locked nuance: NOT every block type must exist on every day — a
 * valid day might be warm-up + strength + cool-down alone. Per-day
 * composition is the writer's call. This rule only checks that the
 * blocks the writer DID emit are non-empty.
 */
export function auditRequiredFields(output: WriterOutput): AuditResult {
  const violations: string[] = [];
  for (const week of output.weeks) {
    for (const day of week.days) {
      for (let i = 0; i < day.blocks.length; i++) {
        const b = day.blocks[i];
        if (b.movements.length === 0) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}] (${b.block_type}): no movements.`,
          );
          continue;
        }
        if (!PRESCRIPTION_REQUIRED_BLOCK_TYPES.has(b.block_type)) continue;
        for (let j = 0; j < b.movements.length; j++) {
          const m = b.movements[j];
          if (!movementHasAnyPrescription(m)) {
            violations.push(
              `Week ${week.week_num} Day ${day.day_num} block[${i}] (${b.block_type}) movement[${j}] "${m.movement}": has none of {sets, reps, weight, time_seconds, distance} populated.`,
            );
          }
        }
      }
    }
  }
  return { rule: "required_fields", passed: violations.length === 0, violations };
}

// ============================================================
// Rule 5 — day count structural
// ============================================================

/**
 * Output must contain exactly 4 weeks × days_per_week days. Catches
 * truncated outputs (max_tokens failures, dropped days). Each week
 * must have a unique week_num 1..4; each day within a week a unique
 * day_num 1..daysPerWeek.
 */
export function auditDayCount(
  output: WriterOutput,
  daysPerWeek: number,
): AuditResult {
  const violations: string[] = [];

  if (output.weeks.length !== 4) {
    violations.push(`Output has ${output.weeks.length} weeks; expected exactly 4.`);
  }

  const seenWeekNums = new Set<number>();
  for (const week of output.weeks) {
    if (week.week_num < 1 || week.week_num > 4) {
      violations.push(`Week_num ${week.week_num} is out of range (expected 1..4).`);
    }
    if (seenWeekNums.has(week.week_num)) {
      violations.push(`Duplicate week_num: ${week.week_num}.`);
    }
    seenWeekNums.add(week.week_num);

    if (week.days.length !== daysPerWeek) {
      violations.push(
        `Week ${week.week_num} has ${week.days.length} days; expected exactly ${daysPerWeek}.`,
      );
    }

    const seenDayNums = new Set<number>();
    for (const day of week.days) {
      if (day.day_num < 1 || day.day_num > daysPerWeek) {
        violations.push(
          `Week ${week.week_num} day_num ${day.day_num} is out of range (expected 1..${daysPerWeek}).`,
        );
      }
      if (seenDayNums.has(day.day_num)) {
        violations.push(`Week ${week.week_num} duplicate day_num: ${day.day_num}.`);
      }
      seenDayNums.add(day.day_num);
    }
  }

  return { rule: "day_count", passed: violations.length === 0, violations };
}

// ============================================================
// Rule 6 — load sanity
// ============================================================

/**
 * Maps writer-output display_name (Title Case) back to the
 * athlete_profiles.lifts canonical key. Used to look up 1RMs for the
 * load-sanity check. Only covers the 14 canonical lifts — non-barbell
 * movement weights (DB snatch, KB swing, wall ball, etc.) are NOT
 * checked here (they have no 1RM column to compare against).
 */
const DISPLAY_TO_LIFT_KEY: Record<string, string> = {
  "Back Squat": "back_squat",
  "Front Squat": "front_squat",
  "Overhead Squat": "overhead_squat",
  "Deadlift": "deadlift",
  "Snatch": "snatch",
  "Power Snatch": "power_snatch",
  "Clean": "clean",
  "Clean and Jerk": "clean_and_jerk",
  "Clean & Jerk": "clean_and_jerk",
  "Jerk": "jerk",
  "Power Clean": "power_clean",
  "Push Jerk": "push_jerk",
  "Press": "press",
  "Strict Press": "press",
  "Push Press": "push_press",
  "Bench Press": "bench_press",
};

/**
 * For any prescribed barbell movement matching a known 1RM, the
 * prescribed weight must be ≤ 100% of the athlete's 1RM. Catches
 * "prescribed 285 when their 1RM is 245" bugs (writer hallucinating
 * heavier loads than the athlete has). 1rm_attempt schemes are an
 * intentional exception — those days the prescribed weight IS the
 * goal-attempt and may exceed current 1RM (writer should phrase it
 * "attempt new 1RM"; we detect by block_scheme/notes mentioning
 * "1rm_attempt" or "1RM attempt").
 */
export function auditLoadSanity(
  output: WriterOutput,
  lifts: Record<string, number | null>,
): AuditResult {
  const violations: string[] = [];
  for (const week of output.weeks) {
    for (const day of week.days) {
      for (let i = 0; i < day.blocks.length; i++) {
        const b = day.blocks[i];
        const schemeStr = `${b.block_scheme ?? ""} ${b.block_notes ?? ""}`.toLowerCase();
        const isAttempt = schemeStr.includes("1rm attempt") ||
          schemeStr.includes("1rm_attempt") ||
          schemeStr.includes("max attempt") ||
          schemeStr.includes("new 1rm");
        for (let j = 0; j < b.movements.length; j++) {
          const m = b.movements[j];
          if (m.weight == null || m.weight <= 0) continue;
          const liftKey = DISPLAY_TO_LIFT_KEY[m.movement];
          if (!liftKey) continue; // non-barbell or unmapped — skip
          const oneRM = lifts[liftKey];
          if (oneRM == null || oneRM <= 0) continue; // no 1RM to compare
          if (isAttempt) continue; // intentional max attempt
          if (m.weight > oneRM) {
            violations.push(
              `Week ${week.week_num} Day ${day.day_num} block[${i}] (${b.block_type}) movement[${j}] "${m.movement}": prescribed weight ${m.weight} exceeds athlete's 1RM of ${oneRM}.`,
            );
          }
        }
      }
    }
  }
  return { rule: "load_sanity", passed: violations.length === 0, violations };
}

// ============================================================
// Rule 7 — movement vocabulary compliance
// ============================================================

/**
 * Every movement string in the output must exactly match one of the
 * display_name strings in the per-call vocabulary (the array passed
 * in the user-message payload, sourced from `movements WHERE
 * competition_count > 0`). No free-text inventions.
 */
export function auditVocabularyCompliance(
  output: WriterOutput,
  vocabulary: string[],
): AuditResult {
  const allowed = new Set(vocabulary);
  const violations: string[] = [];
  const seenUnknown = new Set<string>();
  for (const week of output.weeks) {
    for (const day of week.days) {
      for (let i = 0; i < day.blocks.length; i++) {
        const b = day.blocks[i];
        for (let j = 0; j < b.movements.length; j++) {
          const name = b.movements[j].movement;
          if (!allowed.has(name)) {
            // Deduplicate by name in the violations list — same
            // unknown movement across many days otherwise spams.
            if (!seenUnknown.has(name)) {
              seenUnknown.add(name);
              violations.push(
                `Movement "${name}" is not in the vocabulary (first seen Week ${week.week_num} Day ${day.day_num} block[${i}] movement[${j}]).`,
              );
            }
          }
        }
      }
    }
  }
  return { rule: "vocabulary_compliance", passed: violations.length === 0, violations };
}

// ============================================================
// Convenience: lift the 7 audits as a list for the runner.
// ============================================================

export interface AuditContext {
  output: WriterOutput;
  daysPerWeek: number;
  lifts: Record<string, number | null>;
  vocabulary: string[];
}

export const ALL_AUDITS = [
  (ctx: AuditContext): AuditResult => auditBlockTypeEnum(ctx.output),
  (ctx: AuditContext): AuditResult => auditStrengthOneLift(ctx.output),
  (ctx: AuditContext): AuditResult => auditMetconOnePiece(ctx.output),
  (ctx: AuditContext): AuditResult => auditRequiredFields(ctx.output),
  (ctx: AuditContext): AuditResult => auditDayCount(ctx.output, ctx.daysPerWeek),
  (ctx: AuditContext): AuditResult => auditLoadSanity(ctx.output, ctx.lifts),
  // vocabulary_compliance dropped 2026-05-14 — see chat log. v1 had no
  // vocabulary enforcement; v2 reverted to free movement naming with
  // RAG grounding. auditVocabularyCompliance() retained as a callable
  // but no longer wired into the audit run.
] as const;
