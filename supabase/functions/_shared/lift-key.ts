/**
 * lift-key.ts — which of the athlete's profile lifts a written weight is
 * judged against.
 *
 * THE RULE (2026-11-25): the AI that wrote the movement says which profile
 * lift it counts toward (`counts_toward`, see counts-toward.ts) and code reads
 * that. The name is consulted ONLY for a movement nobody has labelled, so load
 * limits keep applying to anything written before the field existed.
 *
 * Before this, the lift was found by exact, case-sensitive spelling: "Clean
 * And Jerk" (what the catalogue calls it, 73 weighted entries) missed the list
 * on a capital A and got no code-enforced limit.
 */
import { isLabelled, liftCountedToward } from "./counts-toward.ts";

/** Exact display name → profile lift key. For UNLABELLED movements only. */
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
 * The profile lift this movement's weight is judged against, or undefined.
 * A labelled movement follows the AI's answer; a weight the writer marked as
 * NOT on a barbell is never judged against a barbell max.
 */
export function liftKeyOf(m: { movement: string; counts_toward?: string | null; on_barbell?: boolean | null }): string | undefined {
  if (isLabelled(m.counts_toward)) {
    if (m.on_barbell === false) return undefined;
    return liftCountedToward(m.counts_toward) ?? undefined;
  }
  return DISPLAY_TO_LIFT_KEY[m.movement];
}
