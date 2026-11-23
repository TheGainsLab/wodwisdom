/**
 * plan-fidelity — a written week is checked against the plan it was told to
 * execute (2026-11-23).
 *
 * Until now nothing compared the written days with their skeleton days: the
 * fill could drop the strength, accessory or skills block, or train a
 * different lift than the planned primary_lift, and it shipped. The only
 * presence check was "has a metcon".
 *
 * Two rules, in the existing audit framework's shape (AuditResult, routed by
 * AUDIT_KIND in audits.ts):
 *
 *   plan_primary_lift  (block-local)      the strength block's main lift — its
 *       first movement, the one the fit gate also treats as the day's main
 *       lift — is not the planned primary_lift. The violation names the block
 *       ("Week W Day D block[i]"), so the existing surgical rewrite repairs
 *       it; that rewrite is already given the skeleton day.
 *   plan_block_types   (structural-writer) a planned block type is missing
 *       from the day. A missing block has nothing for a block rewrite to work
 *       on (the same reason metcon_presence is structural), so it is recorded
 *       in the generation audit log as a residual.
 *
 * WHERE IT RUNS: with the hard audits, in the benchmark_audit and surgical
 * stages of generate-program-v3 — BEFORE the fit gate and the restriction
 * gate. Those gates remove on purpose (the fit gate may drop the accessory
 * block for a session under 45 minutes, or drop or swap a movement; the
 * restriction gate may swap the main lift for an injury). This check never
 * sees their output, so it can neither flag nor undo a deliberate removal.
 * Do not call it after the gates.
 *
 * The lift comparison is deliberately forgiving: it flags a DIFFERENT lift,
 * not a different spelling. A false alarm costs a rewrite of a block that was
 * right.
 */

import type { AuditResult } from "./audits.ts";
import type { WriterOutput } from "./v2-output-schema.ts";

interface PlanDay {
  day_num: number;
  block_types?: string[];
  primary_lift?: string;
}
interface Plan {
  weeks?: Array<{ week_num: number; days?: PlanDay[] }>;
}

function planDay(plan: Plan | null | undefined, weekNum: number, dayNum: number): PlanDay | null {
  for (const w of plan?.weeks ?? []) {
    if (w.week_num !== weekNum) continue;
    for (const d of w.days ?? []) if (d.day_num === dayNum) return d;
  }
  return null;
}

/** A planned block type is missing from the written day. Extra blocks are not
 *  a violation; days with no plan (no skeleton, or an ingested program) pass. */
export function auditPlanBlockTypes(output: WriterOutput, plan: Plan | null | undefined): AuditResult {
  const violations: string[] = [];
  if (plan) {
    for (const week of output.weeks ?? []) {
      for (const day of week.days ?? []) {
        const planned = planDay(plan, week.week_num, day.day_num);
        if (!planned) continue;
        const written = new Set((day.blocks ?? []).map((b) => b.block_type as string));
        const missing = [...new Set(planned.block_types ?? [])].filter((t) => !written.has(t));
        if (missing.length > 0) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num}: planned block type${missing.length === 1 ? "" : "s"} missing from the written day: ${missing.join(", ")} ` +
              `(planned: ${(planned.block_types ?? []).join(", ")}; written: ${[...written].join(", ") || "nothing"}).`,
          );
        }
      }
    }
  }
  return { rule: "plan_block_types", passed: violations.length === 0, violations };
}

// ── Is this the planned lift? ───────────────────────────────────────────────

/** Lift families, most specific first; a name can belong to several (a
 *  complex, or "Clean and Jerk"). */
const FAMILIES: Array<[string, RegExp]> = [
  ["overhead_squat", /\boverhead squats?\b|\bohs\b/],
  ["front_squat", /\bfront squats?\b/],
  ["back_squat", /\bback squats?\b/],
  ["deadlift", /\bdead ?lifts?\b|\brdls?\b/],
  ["snatch", /\bsnatch(es)?\b/],
  ["clean", /\bcleans?\b|\bc ?and ?j\b/],
  ["jerk", /\bjerks?\b|\bc ?and ?j\b/],
  ["bench_press", /\bbench\b/],
  ["push_press", /\bpush press(es)?\b/],
  ["thruster", /\bthrusters?\b/],
];
const SQUAT_FAMILIES = new Set(["overhead_squat", "front_squat", "back_squat"]);
/** Words that describe HOW a lift is done, not WHICH lift it is. */
const NOISE = new Set([
  "and", "the", "a", "to", "of", "with", "plus", "into", "from", "complex", "barbell", "bb", "dumbbell", "db", "kettlebell", "kb",
  "weighted", "strict", "pause", "paused", "tempo", "heavy", "light", "technical", "touch", "single", "double", "triple", "work",
]);

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => norm(s).split(" ").filter((t) => t && !NOISE.has(t)).map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));

function familiesOf(name: string): Set<string> {
  const n = norm(name);
  const out = new Set<string>();
  for (const [family, re] of FAMILIES) if (re.test(n)) out.add(family);
  // A press that is not a bench or push press: strict / shoulder / overhead / military press.
  if (/\bpress(es)?\b/.test(n.replace(/\bbench press(es)?\b|\bpush press(es)?\b|\bleg press(es)?\b/g, " "))) out.add("press");
  // A squat with no bar position named matches any squat.
  if (/\bsquats?\b/.test(n) && ![...out].some((f) => SQUAT_FAMILIES.has(f))) out.add("squat");
  return out;
}

/**
 * Pure: does `movement` train the planned `primaryLift`? True for the same
 * lift under another spelling or variation ("Pause Back Squat" for "Back
 * Squat", "Strict Press" for "Overhead Press", "Clean" for "Clean and Jerk",
 * the first lift of a planned complex); false for a different lift ("Front
 * Squat" for "Back Squat"). Unknown lifts match when they share a naming word.
 */
export function isPlannedLift(primaryLift: string, movement: string): boolean {
  const a = norm(primaryLift); const b = norm(movement);
  if (!a || !b) return true; // nothing to compare
  if (a === b) return true;
  const fa = familiesOf(primaryLift); const fb = familiesOf(movement);
  // Two known lifts are compared by family, never by one name sitting inside
  // the other: "Press" is inside "Push Press" and they are different lifts.
  if (fa.size > 0 && fb.size > 0) {
    for (const f of fb) {
      if (fa.has(f)) return true;
      if (f === "squat" && [...fa].some((x) => SQUAT_FAMILIES.has(x))) return true;
      if (SQUAT_FAMILIES.has(f) && fa.has("squat")) return true;
    }
    return false;
  }
  if (a.includes(b) || b.includes(a)) return true;
  const ta = new Set(tokens(primaryLift));
  return tokens(movement).some((t) => ta.has(t));
}

/** The strength block's main lift (its first movement) is not the planned
 *  primary_lift. Block-local: the surgical rewrite repairs it. */
export function auditPlanPrimaryLift(output: WriterOutput, plan: Plan | null | undefined): AuditResult {
  const violations: string[] = [];
  if (plan) {
    for (const week of output.weeks ?? []) {
      for (const day of week.days ?? []) {
        const planned = planDay(plan, week.week_num, day.day_num);
        const lift = planned?.primary_lift?.trim();
        if (!lift) continue;
        const blocks = day.blocks ?? [];
        const i = blocks.findIndex((b) => b.block_type === "strength");
        if (i < 0) continue; // a missing strength block is plan_block_types' finding
        const main = (blocks[i].movements ?? [])[0]?.movement;
        if (!main) continue; // an empty block is required_fields' finding
        if (!isPlannedLift(lift, main)) {
          violations.push(
            `Week ${week.week_num} Day ${day.day_num} block[${i}] (strength): the plan's primary_lift for this day is "${lift}" but the block's main lift is "${main}". ` +
              `Rewrite the block so its first movement is ${lift}, keeping the planned strength_scheme.`,
          );
        }
      }
    }
  }
  return { rule: "plan_primary_lift", passed: violations.length === 0, violations };
}

/** Both plan checks, for the stages that run the hard audits. */
export function auditWeekAgainstPlan(output: WriterOutput, plan: Plan | null | undefined): AuditResult[] {
  return [auditPlanBlockTypes(output, plan), auditPlanPrimaryLift(output, plan)];
}

/** An audit run with the plan checks folded in (same shape as runAudits'). */
export function withPlanChecks<R extends { passed: boolean; failures: AuditResult[]; all: AuditResult[] }>(
  run: R,
  output: WriterOutput,
  plan: Plan | null | undefined,
): R {
  const extra = auditWeekAgainstPlan(output, plan);
  const failures = [...run.failures, ...extra.filter((r) => !r.passed)];
  return { ...run, passed: failures.length === 0, failures, all: [...run.all, ...extra] };
}
