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
// Defensive shape helpers — Anthropic's tool_use schema enforcement
// is meant to guarantee output.weeks / week.days / day.blocks /
// block.movements are all arrays, but in practice the writer
// occasionally emits a malformed response (especially under heavy
// prompt load). Treat missing arrays as empty so audits report
// clean violations instead of throwing TypeErrors.
// ============================================================

function safeWeeks(output: WriterOutput): WriterOutput["weeks"] {
  return Array.isArray((output as { weeks?: unknown }).weeks)
    ? (output.weeks as WriterOutput["weeks"])
    : [];
}
function safeDays(week: WriterOutput["weeks"][number]): WriterOutput["weeks"][number]["days"] {
  return Array.isArray((week as { days?: unknown }).days)
    ? week.days
    : [];
}
function safeBlocks(day: WriterOutput["weeks"][number]["days"][number]): BlockPrescription[] {
  return Array.isArray((day as { blocks?: unknown }).blocks)
    ? day.blocks
    : [];
}
function safeMovements(block: BlockPrescription): MovementPrescription[] {
  return Array.isArray((block as { movements?: unknown }).movements)
    ? block.movements
    : [];
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
  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
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
  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.block_type !== "strength") continue;
        const movements = safeMovements(b);
        if (movements.length !== 1) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}] (strength): contains ${movements.length} movements (must be exactly 1; supplementary work belongs in an accessory block).`,
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
 * with multiple movements, like Fran = thrusters + pull-ups). Two checks:
 *
 *   1. Every metcon block must declare a `block_scheme` (the workout's
 *      structure — "21-15-9 for time", "AMRAP 12", "EMOM 10", etc.).
 *   2. A day must have at most one metcon block. Multiple metcon blocks
 *      per day means the writer stitched several conditioning pieces
 *      together — should be split across days or moved to accessory.
 */
export function auditMetconOnePiece(output: WriterOutput): AuditResult {
  const violations: string[] = [];
  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      let metconCount = 0;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.block_type !== "metcon") continue;
        metconCount++;
        const scheme = (b.block_scheme ?? "").trim();
        if (scheme === "") {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}] (metcon): block_scheme is missing. Every metcon block must declare its scheme (e.g., "21-15-9 for time", "AMRAP 12", "EMOM 10").`,
          );
        }
      }
      if (metconCount > 1) {
        violations.push(
          `Week ${week.week_num} Day ${day.day_num}: ${metconCount} metcon blocks on one day. Each day should have at most one conditioning piece — split across days or move secondary to accessory.`,
        );
      }
    }
  }
  return { rule: "metcon_one_piece", passed: violations.length === 0, violations };
}

// ============================================================
// Rule — at most one monostructural cardio modality per metcon block
// ============================================================
//
// Athletes typically have one machine in front of them. Mixing Row + Bike
// (or any two of Row / Bike / Ski-erg / Run / Swim) in the same metcon
// round forces equipment swaps mid-workout — almost always a writer error.

const MONOSTRUCTURAL_KEYWORDS = [
  "row", "rowing",
  "bike", "biking", "assault bike", "echo bike", "schwinn", "bike erg",
  "ski erg", "ski-erg", "ski",
  "run", "running",
  "swim", "swimming",
];

// Strength-row variants — name contains "row" but isn't the rowing machine.
const ROW_NON_MACHINE_KEYWORDS = [
  "dumbbell row", "db row", "barbell row", "bent over row", "bent-over row",
  "ring row", "inverted row", "single arm row", "single-arm row",
  "pendlay row", "kroc row", "seal row", "t-bar", "tbar",
];

function isMonostructural(movement: string): boolean {
  const n = movement.toLowerCase();
  if (n.includes("row") && ROW_NON_MACHINE_KEYWORDS.some((k) => n.includes(k))) return false;
  return MONOSTRUCTURAL_KEYWORDS.some((k) => n.includes(k));
}

function monostructuralFamily(movement: string): string {
  const n = movement.toLowerCase();
  if (n.includes("row")) return "row";
  if (n.includes("bike")) return "bike";
  if (n.includes("ski")) return "ski";
  if (n.includes("swim")) return "swim";
  if (n.includes("run")) return "run";
  return n;
}

export function auditMetconMonostructural(output: WriterOutput): AuditResult {
  const violations: string[] = [];
  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.block_type !== "metcon") continue;
        const families = new Set<string>();
        for (const m of safeMovements(b)) {
          if (isMonostructural(m.movement)) families.add(monostructuralFamily(m.movement));
        }
        if (families.size > 1) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}] (metcon): contains ${families.size} monostructural cardio modalities (${[...families].join(", ")}). Pick one per metcon block — athletes typically have one machine available; mid-workout machine swaps are bad programming.`,
          );
        }
      }
    }
  }
  return { rule: "metcon_one_monostructural", passed: violations.length === 0, violations };
}

// ============================================================
// Rule — barbell movements in a metcon share a single load
// ============================================================
//
// Multiple distinct barbell movements in a metcon are fine ONLY when they
// share the same load (DT, Bear Complex — all at one bar setup). Different
// loads mid-workout means swapping plates, which is bad metcon design.
// Flag when there are 2+ barbell movements AND 2+ distinct loads.

const BARBELL_KEYWORDS = [
  "snatch", "clean", "jerk", "thruster",
  "deadlift", "rdl",
  "back squat", "front squat", "overhead squat",
  "push press", "strict press", "shoulder press", "overhead press", "bench press",
  "shoulder to overhead", "ground to overhead",
  "barbell row", "bent over row", "bent-over row", "pendlay row",
];

const NON_BARBELL_QUALIFIERS = [
  "dumbbell", "kettlebell", " db ", " kb ", "single arm", "single-arm",
  "sandbag", "medicine ball", "med ball", "wall ball", "odd object",
];

function isBarbellLoadedMovement(movement: string): boolean {
  const n = ` ${movement.toLowerCase()} `;
  if (NON_BARBELL_QUALIFIERS.some((k) => n.includes(k))) return false;
  return BARBELL_KEYWORDS.some((k) => n.includes(k));
}

export function auditMetconBarbellLoads(output: WriterOutput): AuditResult {
  const violations: string[] = [];
  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.block_type !== "metcon") continue;
        const barbell: Array<{ name: string; weight: number | null }> = [];
        for (const m of safeMovements(b)) {
          if (isBarbellLoadedMovement(m.movement)) {
            barbell.push({ name: m.movement, weight: m.weight ?? null });
          }
        }
        if (barbell.length < 2) continue;
        const distinctLoads = new Set(barbell.map((x) => x.weight));
        if (distinctLoads.size > 1) {
          const summary = barbell.map((x) => `${x.name} @ ${x.weight ?? "?"}`).join(", ");
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}] (metcon): contains ${barbell.length} barbell movements at ${distinctLoads.size} different loads (${summary}). Pick one barbell movement, or use a complex where all barbells share a single load (DT-style). Mid-workout plate swaps are bad metcon programming.`,
          );
        }
      }
    }
  }
  return { rule: "metcon_barbell_one_load", passed: violations.length === 0, violations };
}

// ============================================================
// SOFT AUDIT — plate-math sanity (log-only, NOT in ALL_AUDITS)
// ============================================================
//
// roundToPlateMath in generate-program-v3/index.ts already rounds weights
// to liftable plate increments (lbs → 5, kg → 2.5) at insert time. This
// audit is a belt-and-suspenders safety net: if a non-plate-math weight
// ever lands on a movement, we want to see it in the logs so we can
// track down the regression. Run separately, never blocks save.

function isPlateMathSafe(weight: number, unit: string | null): boolean {
  const step = unit === "kg" ? 2.5 : 5;
  const ratio = weight / step;
  return Math.abs(ratio - Math.round(ratio)) < 0.01;
}

/** Movements where the `weight` field, if populated, is NOT plate-math
 *  relevant — typically because the writer mis-used `weight` for box
 *  height instead of `scaling_note`. The fix lives in the writer prompt;
 *  this audit just stops false-alarming on the residual. Skip on any
 *  match. */
function isNonPlateMathWeightMovement(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("box jump") || n.includes("step up") || n.includes("step-up");
}

export function auditPlateMath(output: WriterOutput): AuditResult {
  const violations: string[] = [];
  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        for (let mi = 0; mi < safeMovements(b).length; mi++) {
          const m = safeMovements(b)[mi];
          if (m.weight == null || m.weight <= 0) continue;
          if (isNonPlateMathWeightMovement(m.movement)) continue;
          if (!isPlateMathSafe(m.weight, m.weight_unit ?? null)) {
            const step = m.weight_unit === "kg" ? "2.5kg" : "5lb";
            violations.push(
              `Week ${week.week_num} Day ${day.day_num} block[${i}] (${b.block_type}) movement[${mi}] (${m.movement}): weight ${m.weight}${m.weight_unit ?? ""} is not divisible by ${step}. roundToPlateMath should have caught this — investigate.`,
            );
          }
        }
      }
    }
  }
  return { rule: "plate_math_safe", passed: violations.length === 0, violations };
}

// ============================================================
// Rule 4 — required-fields existence
// ============================================================

function movementHasAnyPrescription(m: MovementPrescription): boolean {
  return (
    (m.sets != null && m.sets > 0) ||
    (m.reps != null && m.reps > 0) ||
    // rep_scheme is the canonical rep specifier — writer prompt tells the
    // LLM to emit this and leave reps null (the save layer derives reps as
    // sum(rep_scheme)). Required-fields must accept it as a valid prescription.
    (Array.isArray(m.rep_scheme)
      && m.rep_scheme.length > 0
      && m.rep_scheme.some((n) => typeof n === "number" && n > 0)) ||
    // calories is the typed specifier for Cal Row / Cal Bike / Cal Ski.
    (m.calories != null && m.calories > 0) ||
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
  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const movements = safeMovements(b);
        if (movements.length === 0) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}] (${b.block_type}): no movements.`,
          );
          continue;
        }
        if (!PRESCRIPTION_REQUIRED_BLOCK_TYPES.has(b.block_type)) continue;
        for (let j = 0; j < movements.length; j++) {
          const m = movements[j];
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
// Rule — no contraindicated movements (injury safety)
// ============================================================

/**
 * Every movement must NOT be on the athlete's injuries_structured.do_not_program
 * list (parsed from their free-text injuries by parse-injuries-constraints). This
 * is the DETERMINISTIC enforcement of free-text injury constraints: the writer is
 * told to honor them, this guarantees it. Block-local → surgical swaps the
 * offending movement for a safe one (it already receives do_not_program). Match
 * is exact/normalized name against the canonical do_not_program list (both sides
 * use canonical vocabulary) — no regex.
 */
export function auditDoNotProgram(output: WriterOutput, doNotProgram: string[]): AuditResult {
  const violations: string[] = [];
  const banned = new Set((doNotProgram ?? []).map((m) => m.trim().toLowerCase()).filter(Boolean));
  if (banned.size === 0) return { rule: "do_not_program", passed: true, violations };

  for (const week of output.weeks ?? []) {
    for (const day of week.days ?? []) {
      const blocks = day.blocks ?? [];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        for (const m of b.movements ?? []) {
          if (m.movement && banned.has(m.movement.trim().toLowerCase())) {
            violations.push(
              `Week ${week.week_num} Day ${day.day_num} block[${i}] (${b.block_type}): "${m.movement}" is on the athlete's do-not-program list (injury constraint). Replace it with a safe substitute that preserves the block's intent — do NOT re-emit any do-not-program movement.`,
            );
          }
        }
      }
    }
  }
  return { rule: "do_not_program", passed: violations.length === 0, violations };
}

// ============================================================
// Rule 4c — metcon duration matches the labeled time-domain bucket
// ============================================================

/**
 * The skeleton labels each metcon day with a metcon_focus string that
 * specifies a time-domain bucket — "short power couplet (6-8 min)",
 * "long aerobic chipper (20-25 min)", etc. The writer is supposed to
 * prescribe work that actually completes in that bucket. This audit closes
 * the loop:
 *   1. Read the bucket from the skeleton day's metcon_focus.
 *   2. Read the computed median_seconds from the block's expected_benchmark
 *      (populated server-side by compute-block-benchmark before runAudits).
 *   3. Fail block-local if the prescribed work lands outside the bucket's
 *      tolerance range — surgical retry then adjusts volume.
 *
 * Tolerance ranges (loose at boundaries so 5-10% rounding doesn't fire):
 *   short:  ≤ 540s        (label: under 8 min; allow up to 9 min)
 *   medium: 420s – 960s   (label: 8-15 min; allow 7-16 min)
 *   long:   ≥ 840s        (label: 15+ min; allow as low as 14 min)
 *
 * Skips when:
 *   - No skeleton context (ingestion path)
 *   - No metcon_focus string on the day
 *   - Bucket word not parseable from the focus string
 *   - No expected_benchmark on the block (compute failed — already logged)
 *   - expected_benchmark.median_seconds is null (AMRAP — "rounds+reps"
 *     doesn't parse to a duration; AMRAP duration IS the time_cap, separate
 *     check)
 */

type TimeDomainBucket = "short" | "medium" | "long";

/** Parse the time-domain bucket out of a metcon_focus string. The skeleton
 *  is taught to emit short/medium/long explicitly; also catch "aerobic"
 *  (typically long) and "power" / "sprint" (typically short) as backups. */
function parseMetconFocusBucket(focus: string | null | undefined): TimeDomainBucket | null {
  if (!focus) return null;
  const s = focus.toLowerCase();
  if (/\blong\b/.test(s) || /\baerobic\b/.test(s)) return "long";
  if (/\bshort\b/.test(s) || /\bsprint\b/.test(s) || /\bpower\b/.test(s)) return "short";
  if (/\bmedium\b/.test(s)) return "medium";
  return null;
}

interface BucketRange { min: number; max: number; label: string }
const BUCKET_RANGES: Record<TimeDomainBucket, BucketRange> = {
  short:  { min: 0,    max: 540,        label: "≤ 9 min" },
  medium: { min: 420,  max: 960,        label: "7–16 min" },
  long:   { min: 840,  max: Infinity,   label: "≥ 14 min" },
};

// deno-lint-ignore no-explicit-any
function findSkeletonDay(skeleton: any, weekNum: number, dayNum: number): any | null {
  for (const w of skeleton?.weeks ?? []) {
    if (w.week_num !== weekNum) continue;
    for (const d of w.days ?? []) {
      if (d.day_num === dayNum) return d;
    }
  }
  return null;
}

export function auditMetconDuration(
  output: WriterOutput,
  // deno-lint-ignore no-explicit-any
  skeleton: any | undefined,
): AuditResult {
  if (!skeleton) return { rule: "metcon_duration_matches_focus", passed: true, violations: [] };
  const violations: string[] = [];
  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      const skDay = findSkeletonDay(skeleton, week.week_num, day.day_num);
      const focus = skDay?.metcon_focus as string | undefined;
      const bucket = parseMetconFocusBucket(focus);
      if (!bucket) continue;
      const range = BUCKET_RANGES[bucket];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.block_type !== "metcon") continue;
        const bench = (b as { expected_benchmark?: { median_seconds?: number | null } }).expected_benchmark;
        if (!bench) continue;
        const seconds = bench.median_seconds;
        if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) continue;
        if (seconds < range.min || seconds > range.max) {
          const mm = Math.floor(seconds / 60);
          const ss = Math.round(seconds % 60).toString().padStart(2, "0");
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}] (metcon): skeleton labeled this "${focus}" (${bucket} bucket, expected ${range.label}) but prescribed work completes in ~${mm}:${ss}. Adjust volume — ${bucket === "long" ? "add more work (longer ladder, more rounds, longer row/run leg)" : bucket === "short" ? "trim volume (fewer reps or one less round)" : "tune volume up or down"} until the expected duration matches the labeled bucket.`,
          );
        }
      }
    }
  }
  return { rule: "metcon_duration_matches_focus", passed: violations.length === 0, violations };
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
  const weeks = safeWeeks(output);

  if (weeks.length !== 4) {
    violations.push(`Output has ${weeks.length} weeks; expected exactly 4.`);
  }

  const seenWeekNums = new Set<number>();
  for (const week of weeks) {
    if (week.week_num < 1 || week.week_num > 4) {
      violations.push(`Week_num ${week.week_num} is out of range (expected 1..4).`);
    }
    if (seenWeekNums.has(week.week_num)) {
      violations.push(`Duplicate week_num: ${week.week_num}.`);
    }
    seenWeekNums.add(week.week_num);

    const days = safeDays(week);
    if (days.length !== daysPerWeek) {
      violations.push(
        `Week ${week.week_num} has ${days.length} days; expected exactly ${daysPerWeek}.`,
      );
    }

    const seenDayNums = new Set<number>();
    for (const day of days) {
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
// Exact display-name → canonical 1RM lift key. Exported so the domain pack can
// hand it to the Engine's cohort scaler (single source of truth — the mirror in
// programmatic-fixes.ts is still synced manually).
export const DISPLAY_TO_LIFT_KEY: Record<string, string> = {
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
 * Two-layer weight check:
 *
 *  - Specific: any prescribed weight on a movement that maps to a known
 *    canonical lift must be ≤ that lift's 1RM.
 *  - Fallback: any prescribed weight on an UNMAPPED movement (e.g.,
 *    "Snatch Pull", "Push Press complex", "1¼ Back Squat") must be
 *    ≤ max(all athlete's 1RMs). Catches wild hallucinations on barbell
 *    variants that the canonical lookup misses. Permissive enough not
 *    to flag DB/KB/wall ball movements which are typically well below
 *    any 1RM.
 *
 * 1rm_attempt schemes (block_scheme/block_notes containing
 * "1rm attempt", "1rm_attempt", "max attempt", or "new 1rm") are an
 * intentional exception — those days the prescribed weight IS the
 * goal-attempt and may exceed current 1RMs.
 */
export function auditLoadSanity(
  output: WriterOutput,
  lifts: Record<string, number | null>,
): AuditResult {
  const violations: string[] = [];
  const liftValues = Object.values(lifts).filter(
    (v): v is number => typeof v === "number" && v > 0,
  );
  const maxOneRm = liftValues.length > 0 ? Math.max(...liftValues) : null;

  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const schemeStr = `${b.block_scheme ?? ""} ${b.block_notes ?? ""}`.toLowerCase();
        const isAttempt = schemeStr.includes("1rm attempt") ||
          schemeStr.includes("1rm_attempt") ||
          schemeStr.includes("max attempt") ||
          schemeStr.includes("new 1rm");
        const movements = safeMovements(b);
        for (let j = 0; j < movements.length; j++) {
          const m = movements[j];
          if (m.weight == null || m.weight <= 0) continue;
          if (isAttempt) continue; // intentional max attempt

          const liftKey = DISPLAY_TO_LIFT_KEY[m.movement];
          if (liftKey) {
            const oneRM = lifts[liftKey];
            if (oneRM == null || oneRM <= 0) continue; // no 1RM to compare
            if (m.weight > oneRM) {
              violations.push(
                `Week ${week.week_num} Day ${day.day_num} block[${i}] (${b.block_type}) movement[${j}] "${m.movement}": prescribed weight ${m.weight} exceeds athlete's 1RM of ${oneRM}.`,
              );
            }
            continue;
          }

          // Fallback for unmapped movements (barbell variants, accessory
          // lifts, etc.). Only flag if the prescribed weight exceeds the
          // athlete's strongest 1RM — generous floor, catches the wild ones.
          if (maxOneRm != null && m.weight > maxOneRm) {
            violations.push(
              `Week ${week.week_num} Day ${day.day_num} block[${i}] (${b.block_type}) movement[${j}] "${m.movement}": prescribed weight ${m.weight} exceeds athlete's strongest 1RM of ${maxOneRm} (movement not in canonical-lift table; fallback cap).`,
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
  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const movements = safeMovements(b);
        for (let j = 0; j < movements.length; j++) {
          const name = movements[j].movement;
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
// Rule — "work up to" / "build to" schemes keep the ramp athlete-discretion
// ============================================================
//
// A strength block whose scheme/notes say "work up to" / "build to" a heavy
// single/double/triple is GRANTING the athlete discretion over the warm-up
// ramp — they pick their own jumps based on how the bar feels. The structured
// prescription should be the TOP working set only (sets = 1), with any fixed
// back-off ("...then 3×1 @85%") in its OWN movement row. The writer's failure
// mode is to flatten the whole ramp onto the top weight — "5×3 @ the top
// triple" — which reads as 15 reps at 90% and contradicts the build-up text.
//
// Signature: a strength movement carrying BOTH multiple sets (≥3) AND multiple
// reps-per-set (≥2) inside a work-up block. A legitimate back-off row (3×1)
// has reps-per-set = 1 → does NOT trip. A fixed-load scheme ("5x3 @85%")
// carries no work-up language → does NOT trip. Block-local: surgical rewrites
// the block down to the top set (+ a separate back-off row if prescribed).

const WORKUP_LANGUAGE = ["work up", "work-up", "build to", "build up", "ascend"];

function isWorkupScheme(block: BlockPrescription): boolean {
  const s = `${block.block_scheme ?? ""} ${block.block_notes ?? ""}`.toLowerCase();
  return WORKUP_LANGUAGE.some((k) => s.includes(k));
}

/** Reps within a single set. rep_scheme entries are per-iteration, and for a
 *  uniform strength scheme every entry is the same; take the max to be safe.
 *  Falls back to reps/sets, then reps. */
function repsPerSet(m: MovementPrescription): number {
  if (Array.isArray(m.rep_scheme) && m.rep_scheme.length > 0) {
    const nums = m.rep_scheme.filter((n): n is number => typeof n === "number" && n > 0);
    if (nums.length > 0) return Math.max(...nums);
  }
  if (m.reps != null && m.sets != null && m.sets > 0) return Math.round(m.reps / m.sets);
  if (m.reps != null) return m.reps;
  return 0;
}

export function auditWorkupTopSet(output: WriterOutput): AuditResult {
  const violations: string[] = [];
  for (const week of safeWeeks(output)) {
    for (const day of safeDays(week)) {
      const blocks = safeBlocks(day);
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.block_type !== "strength") continue;
        if (!isWorkupScheme(b)) continue;
        const movements = safeMovements(b);
        for (let j = 0; j < movements.length; j++) {
          const m = movements[j];
          const sets = m.sets ?? 0;
          const rps = repsPerSet(m);
          if (sets >= 3 && rps >= 2) {
            violations.push(
              `Week ${week.week_num} Day ${day.day_num} block[${i}] (strength) movement[${j}] "${m.movement}": the block scheme says "work up / build to" — that's an athlete-discretion ramp — but the movement is prescribed as ${sets}×${rps} at one weight, which flattens the whole ramp onto the top set (reads as ${sets * rps} reps at the top weight). Emit ONLY the top working set (sets = 1, rep_scheme = [${rps}]) at the target weight; the warm-up ramp is the athlete's call and stays in the notes as prose. If a fixed back-off follows the work-up (e.g. "then 3×1 @85%"), give the back-off its OWN movement row.`,
            );
          }
        }
      }
    }
  }
  return { rule: "workup_top_set", passed: violations.length === 0, violations };
}

// ============================================================
// Convenience: lift the 7 audits as a list for the runner.
// ============================================================

export interface AuditContext {
  output: WriterOutput;
  daysPerWeek: number;
  lifts: Record<string, number | null>;
  vocabulary: string[];
  /** Optional — when present, the duration audit reads each day's
   *  metcon_focus to validate that prescribed work matches the labeled
   *  time-domain bucket. Null on ingestion paths that have no skeleton. */
  // deno-lint-ignore no-explicit-any
  skeleton?: any;
  /** injuries_structured.do_not_program — canonical movement names the athlete
   *  must never be programmed (parsed from free-text injuries). Empty/omitted
   *  when no injury constraints. */
  doNotProgram?: string[];
}

export const ALL_AUDITS = [
  (ctx: AuditContext): AuditResult => auditBlockTypeEnum(ctx.output),
  (ctx: AuditContext): AuditResult => auditDoNotProgram(ctx.output, ctx.doNotProgram ?? []),
  // strength_one_lift dropped 2026-05-15 — rule banned legitimate strength
  // complexes (snatch + OHS + snatch balance as one block). auditStrengthOneLift()
  // retained as a callable but no longer wired.
  (ctx: AuditContext): AuditResult => auditMetconOnePiece(ctx.output),
  (ctx: AuditContext): AuditResult => auditMetconMonostructural(ctx.output),
  (ctx: AuditContext): AuditResult => auditMetconBarbellLoads(ctx.output),
  (ctx: AuditContext): AuditResult => auditRequiredFields(ctx.output),
  (ctx: AuditContext): AuditResult => auditWorkupTopSet(ctx.output),
  (ctx: AuditContext): AuditResult => auditMetconDuration(ctx.output, ctx.skeleton),
  (ctx: AuditContext): AuditResult => auditDayCount(ctx.output, ctx.daysPerWeek),
  (ctx: AuditContext): AuditResult => auditLoadSanity(ctx.output, ctx.lifts),
  // vocabulary_compliance dropped 2026-05-14 — see chat log. v1 had no
  // vocabulary enforcement; v2 reverted to free movement naming with
  // RAG grounding. auditVocabularyCompliance() retained as a callable
  // but no longer wired into the audit run.
] as const;

/** Recovery strategy for each audit rule. The v3 audit-failure dispatcher
 *  routes failures based on this:
 *    - 'programmatic-fix' → patch the output in place, no LLM (cheapest)
 *    - 'block-local'      → surgical LLM call to rewrite the affected block
 *    - 'structural-writer' → fall through to writer-retry (last resort)
 *  Skeleton-stage audits aren't here — they're handled by the skeleton-retry
 *  loop in generate-program-v3.
 */
export type AuditKind = "programmatic-fix" | "block-local" | "structural-writer";

export const AUDIT_KIND: Record<string, AuditKind> = {
  // Programmatic — deterministic in-place patch
  load_sanity: "programmatic-fix",
  plate_math_safe: "programmatic-fix",
  // Block-local — single block (or two) needs rewriting via surgical LLM call
  metcon_one_piece: "block-local",
  metcon_one_monostructural: "block-local",
  metcon_barbell_one_load: "block-local",
  metcon_duration_matches_focus: "block-local",
  required_fields: "block-local",
  workup_top_set: "block-local",
  do_not_program: "block-local",
  // Structural — whole-program issues; only writer-retry can fix
  block_type_enum: "structural-writer",
  day_count: "structural-writer",
  structural_integrity: "structural-writer",
};

// Soft audits — run after save, log violations only, never trigger any
// recovery. Use ONLY for safety-net checks where an upstream fix should
// have caught the issue (e.g., roundToPlateMath at insert time handles
// plate-math; the soft audit is a regression safety net).
export const SOFT_AUDITS = [
  (ctx: AuditContext): AuditResult => auditPlateMath(ctx.output),
] as const;
