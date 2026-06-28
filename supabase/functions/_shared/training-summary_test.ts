/**
 * Unit tests for the deterministic Training Summary (Step 4). Run:
 *   deno test supabase/functions/_shared/training-summary_test.ts --no-check
 */

import { assert, assertEquals } from "jsr:@std/assert";
import {
  estimateOneRepMax,
  type RawLogEntry,
  summarizeTrainingEntries,
} from "./training-summary.ts";

Deno.test("estimateOneRepMax: Epley + reps-in-reserve", () => {
  // 200×5 @ RPE10 (0 RIR) → 200*(1+5/30) = 233.33 → 233
  assertEquals(estimateOneRepMax(200, 5, 10), 233);
  // 200×5 @ RPE8 (2 RIR → eff 7) → 200*(1+7/30) = 246.67 → 247
  assertEquals(estimateOneRepMax(200, 5, 8), 247);
  // no RPE → no RIR bonus, plain Epley
  assertEquals(estimateOneRepMax(200, 5, null), 233);
  // a true single @ RPE10 ≈ the weight
  assertEquals(estimateOneRepMax(300, 1, 10), 310);
});

const ASOF = "2026-06-28";

function entry(p: Partial<RawLogEntry> & { movement: string; workout_date: string }): RawLogEntry {
  return { reps: null, weight: null, weight_unit: "lbs", rpe: null, sets: null, ...p };
}

Deno.test("summarizeTrainingEntries: per-lift best e1RM + sessions + window", () => {
  const entries: RawLogEntry[] = [
    entry({ movement: "Back Squat", weight: 315, reps: 5, rpe: 8, workout_date: "2026-06-20" }),
    entry({ movement: "Back Squat", weight: 335, reps: 3, rpe: 9, workout_date: "2026-06-24" }),
    entry({ movement: "Bench Press", weight: 225, reps: 5, rpe: 8, workout_date: "2026-06-24" }),
    // OUT of the 56-day window — must be excluded:
    entry({ movement: "Back Squat", weight: 405, reps: 1, rpe: 10, workout_date: "2026-01-01" }),
  ];
  const s = summarizeTrainingEntries(entries, ASOF);

  // Back squat: best of the two IN-WINDOW sets (the 405 single is excluded).
  const bs = s.lifts.back_squat;
  assert(bs);
  assertEquals(bs.sessions, 2); // two distinct days
  // 335×3@9 (1 RIR → eff4) = 335*(1+4/30)=379.7→380; 315×5@8 (eff7)=315*1.233=388.5→389
  assertEquals(bs.best_est_1rm, 389);
  assert(bs.best_est_1rm < 405); // proves the out-of-window single was dropped
  assertEquals(s.lifts.bench_press.sessions, 1);
  assertEquals(s.sessions_logged, 2); // 06-20 + 06-24 (06-24 has 2 movements, 1 day)
});

Deno.test("summarizeTrainingEntries: movement_volume counts reps × sets", () => {
  const s = summarizeTrainingEntries([
    entry({ movement: "Toes To Bar", reps: 10, sets: 3, workout_date: "2026-06-25" }),
    entry({ movement: "Toes To Bar", reps: 12, sets: 1, workout_date: "2026-06-26" }),
  ], ASOF);
  assertEquals(s.movement_volume.toes_to_bar.reps, 42); // 10*3 + 12
  assertEquals(s.movement_volume.toes_to_bar.sessions, 2);
});

Deno.test("summarizeTrainingEntries: no logs → empty summary (absence, not weakness)", () => {
  const s = summarizeTrainingEntries([], ASOF);
  assertEquals(Object.keys(s.lifts).length, 0);
  assertEquals(s.sessions_logged, 0);
});

Deno.test("summarizeTrainingEntries: bodyweight (no weight) set → no lift evidence", () => {
  const s = summarizeTrainingEntries([
    entry({ movement: "Back Squat", reps: 5, workout_date: "2026-06-25" }), // weight null
  ], ASOF);
  assert(!s.lifts.back_squat); // unqualified for e1RM
});
