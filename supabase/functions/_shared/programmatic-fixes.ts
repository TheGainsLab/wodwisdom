/**
 * programmatic-fixes.ts
 *
 * Deterministic in-place patches for audit violations that don't need
 * an LLM call. When the writer's output trips an audit but the right
 * correction is a clear math operation (clamp a weight, normalize an
 * enum, round to plate math), we apply it here and re-run audits.
 *
 * Each fix:
 *   - Mutates the output in place (for now — could return a copy later)
 *   - Returns { patched, log } where patched is the count of changes
 *     and log is a list of human-readable correction notes
 *   - Is "safe" — never introduces a violation; the worst case is
 *     it doesn't fully resolve the failure and we fall through to the
 *     next recovery tier (surgical or writer-retry)
 *
 * Visibility: corrections are logged via console.warn in the v3 worker;
 * they are NOT surfaced to the athlete (no scaling_note pollution).
 */

import type { WriterOutput } from "./v2-output-schema.ts";

// Mirror of audits.ts DISPLAY_TO_LIFT_KEY — kept in sync manually. If the
// audit's mapping changes, this must too.
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
 * Clamp every prescribed weight to the audit's load_sanity ceiling.
 *
 * Layered to mirror auditLoadSanity:
 *   - Mapped (movement is in DISPLAY_TO_LIFT_KEY) → clamp at that lift's 1RM
 *   - Unmapped → clamp at max(all athlete 1RMs)
 *   - "1rm_attempt" / "max attempt" schemes are exempt (writer intends to
 *     exceed the stored 1RM — testing a new PR)
 *
 * After clamping, floors to plate-math (lbs→5, kg→2.5) so the result also
 * passes the plate_math_safe soft audit. Resulting weight is always
 * ≤ ceiling AND plate-math-friendly.
 */
export function clampLoadSanity(
  output: WriterOutput,
  lifts: Record<string, number | null>,
): { patched: number; log: string[] } {
  const log: string[] = [];
  let patched = 0;

  const validLifts = Object.values(lifts).filter((v): v is number => v != null && v > 0);
  const maxOneRm = validLifts.length > 0 ? Math.max(...validLifts) : 0;

  for (const week of output.weeks ?? []) {
    for (const day of week.days ?? []) {
      const blocks = day.blocks ?? [];
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        const schemeStr = `${b.block_scheme ?? ""} ${b.block_notes ?? ""}`.toLowerCase();
        const isAttempt = schemeStr.includes("1rm attempt") ||
          schemeStr.includes("1rm_attempt") ||
          schemeStr.includes("max attempt") ||
          schemeStr.includes("new 1rm");
        if (isAttempt) continue;

        const movements = b.movements ?? [];
        for (let mi = 0; mi < movements.length; mi++) {
          const m = movements[mi];
          if (m.weight == null || m.weight <= 0) continue;

          // Pick the ceiling per the audit's two-layer logic.
          const liftKey = DISPLAY_TO_LIFT_KEY[m.movement];
          let ceiling: number | null = null;
          let ceilingLabel = "";
          if (liftKey) {
            const oneRM = lifts[liftKey];
            if (oneRM == null || oneRM <= 0) continue;
            ceiling = oneRM;
            ceilingLabel = `${liftKey} 1RM`;
          } else if (maxOneRm > 0) {
            ceiling = maxOneRm;
            ceilingLabel = `max 1RM`;
          }
          if (ceiling === null) continue;

          if (m.weight > ceiling) {
            const before = m.weight;
            const unit = m.weight_unit ?? null;
            const step = unit === "kg" ? 2.5 : 5;
            // Floor to plate-math so result is ≤ ceiling AND plate-math-clean.
            const clamped = Math.floor(ceiling / step) * step;
            m.weight = clamped;
            patched++;
            log.push(
              `Week ${week.week_num} Day ${day.day_num} block[${bi}] (${b.block_type}) movement[${mi}] (${m.movement}): ${before}${unit ?? ""} → ${clamped}${unit ?? ""} (clamped to ${ceilingLabel} ${ceiling})`,
            );
          }
        }
      }
    }
  }

  return { patched, log };
}

