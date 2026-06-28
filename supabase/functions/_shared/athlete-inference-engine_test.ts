/**
 * Unit tests for the Athlete Inference Engine — belief revision (Step 4). Run:
 *   deno test supabase/functions/_shared/athlete-inference-engine_test.ts --no-check
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { reviseCapabilities } from "./athlete-inference-engine.ts";
import type { Capability } from "./athlete-model.ts";
import type { TrainingSummary } from "./training-summary.ts";

function cap(value: number | null, source: Capability["source"] = "self_reported", confidence: Capability["confidence"] = "low"): Capability {
  return { value, source, confidence, as_of: "2026-01-01" };
}

function summaryWith(lift: string, best_est_1rm: number, sessions: number): TrainingSummary {
  return {
    training_summary_version: "v1",
    window_days: 56,
    as_of: "2026-06-28",
    sessions_logged: sessions,
    lifts: {
      [lift]: {
        lift,
        best_est_1rm,
        best_set: { weight: best_est_1rm, reps: 1, rpe: 10, date: "2026-06-25" },
        sessions,
        total_sets: sessions,
        avg_rpe: 9,
        last_performed: "2026-06-25",
      },
    },
    movement_volume: {},
  };
}

Deno.test("no evidence → unchanged (absence is neutral)", () => {
  const prior = { back_squat: cap(405) };
  const { capabilities, revisions } = reviseCapabilities(prior, null);
  assertEquals(capabilities.back_squat, prior.back_squat);
  assertEquals(revisions.length, 0);
});

Deno.test("observed above self-reported → RAISED", () => {
  const prior = { back_squat: cap(405) };
  const { capabilities, revisions } = reviseCapabilities(prior, summaryWith("back_squat", 423, 4));
  assertEquals(capabilities.back_squat.value, 425); // rounded to 5
  assertEquals(capabilities.back_squat.source, "observed");
  assertEquals(capabilities.back_squat.confidence, "high"); // 4 sessions
  assertEquals(revisions[0].action, "raised");
});

Deno.test("observed near self-reported → CORROBORATED (value held, confidence up)", () => {
  const prior = { back_squat: cap(405, "self_reported", "low") };
  // 395 is ≥ 95% of 405 (384.75) → corroborates
  const { capabilities, revisions } = reviseCapabilities(prior, summaryWith("back_squat", 395, 2));
  assertEquals(capabilities.back_squat.value, 405); // HELD, not lowered
  assertEquals(capabilities.back_squat.source, "observed");
  assertEquals(capabilities.back_squat.confidence, "medium"); // raised from low
  assertEquals(revisions[0].action, "corroborated");
});

Deno.test("observed well below → UNCHANGED (no-penalty; volume work isn't a max)", () => {
  const prior = { back_squat: cap(405) };
  // 300 is < 95% of 405 → likely accessory/volume → hold prior entirely
  const { capabilities, revisions } = reviseCapabilities(prior, summaryWith("back_squat", 300, 3));
  assertEquals(capabilities.back_squat.value, 405);
  assertEquals(capabilities.back_squat.source, "self_reported"); // not downgraded/changed
  assertEquals(revisions[0].action, "unchanged");
});

Deno.test("no self-reported value → ADOPTED from evidence", () => {
  const prior = { back_squat: cap(null, "missing") };
  const { capabilities, revisions } = reviseCapabilities(prior, summaryWith("back_squat", 312, 1));
  assertEquals(capabilities.back_squat.value, 310); // rounded
  assertEquals(capabilities.back_squat.source, "observed");
  assertEquals(capabilities.back_squat.confidence, "low"); // 1 session
  assertEquals(revisions[0].action, "adopted");
});
