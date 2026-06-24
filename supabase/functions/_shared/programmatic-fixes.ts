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

/**
 * Strip the writer's INTERNAL programming markers from athlete-facing fields.
 *
 * The writer is told to keep Track A/B labels and week/deload tags in
 * block_notes (hidden reasoning), but it leaks them into block_label and
 * block_scheme anyway. These tokens are a controlled, finite vocabulary —
 * safe to remove deterministically (regex), unlike coaching prose, which is
 * open-ended and handled at the prompt level.
 *
 * Removes from block_label AND block_scheme:
 *   - "Track A" / "Track B" / "Track A/B" (with any leading separator)
 *   - parentheticals mentioning a week or deload — "(Wk 4 Deload)", "(Week 3)"
 *   - a trailing "— Deload" tag
 * Then cleans up any dangling separators / doubled spaces.
 *
 * Always-run (not audit-gated). Idempotent. Mutates in place; returns a count.
 */
export function stripInternalMarkers(
  output: WriterOutput,
): { patched: number; log: string[] } {
  const log: string[] = [];
  let patched = 0;

  const clean = (raw: string): string => {
    let s = raw;
    // "Track A" / "Track B" / "Track A/B" with an optional leading dash/em-dash.
    s = s.replace(/\s*[—–-]?\s*Track\s+[A-Z](?:\/[A-Z])?\b/gi, "");
    // Parentheticals that mention a week or deload: "(Wk 4 Deload)", "(Week 3)".
    s = s.replace(/\s*\((?:[^)]*\b(?:wk|week|deload)\b[^)]*)\)/gi, "");
    // A trailing "— Deload" / "- deload" tag.
    s = s.replace(/\s*[—–-]\s*deload\b/gi, "");
    // Tidy: drop a dangling trailing separator, collapse doubled spaces.
    s = s.replace(/\s*[—–-]\s*$/, "").replace(/\s{2,}/g, " ").trim();
    return s;
  };

  for (const week of output.weeks ?? []) {
    for (const day of week.days ?? []) {
      for (const b of day.blocks ?? []) {
        if (typeof b.block_label === "string" && b.block_label) {
          const next = clean(b.block_label);
          if (next !== b.block_label) {
            log.push(`Week ${week.week_num} Day ${day.day_num} (${b.block_type}) block_label: "${b.block_label}" → "${next}"`);
            b.block_label = next;
            patched++;
          }
        }
        if (typeof b.block_scheme === "string" && b.block_scheme) {
          const next = clean(b.block_scheme);
          if (next !== b.block_scheme) {
            log.push(`Week ${week.week_num} Day ${day.day_num} (${b.block_type}) block_scheme: "${b.block_scheme}" → "${next}"`);
            b.block_scheme = next;
            patched++;
          }
        }
      }
    }
  }

  return { patched, log };
}

