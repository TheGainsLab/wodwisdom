/**
 * Unit tests for the three diffs (Step 4 — "what changed in training / belief /
 * decisions"). Run: deno test supabase/functions/_shared/three-diffs_test.ts --no-check
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { type TrainingSummary, trainingSummaryDiff } from "./training-summary.ts";
import { type CoachStateContent, coachStateDiff } from "./coach-state.ts";
import { athleteModelDiff } from "./athlete-model.ts";
import type { Capability, Normative } from "./athlete-model.ts";

// ── Training Summary diff ──────────────────────────────────────────
function ts(lifts: Record<string, { best_est_1rm: number; sessions: number }>, movements: string[], sessions_logged: number): TrainingSummary {
  return {
    training_summary_version: "v1", window_days: 56, as_of: "2026-06-28", sessions_logged,
    lifts: Object.fromEntries(Object.entries(lifts).map(([k, v]) => [k, {
      lift: k, best_est_1rm: v.best_est_1rm, best_set: { weight: v.best_est_1rm, reps: 1, rpe: 10, date: "2026-06-25" },
      sessions: v.sessions, total_sets: v.sessions, avg_rpe: 8, last_performed: "2026-06-25",
    }])),
    movement_volume: Object.fromEntries(movements.map((m) => [m, { reps: 30, sessions: 2 }])),
  };
}

Deno.test("trainingSummaryDiff: raised lift + new movement + session delta", () => {
  const prev = ts({ back_squat: { best_est_1rm: 405, sessions: 2 } }, ["back_squat"], 8);
  const next = ts({ back_squat: { best_est_1rm: 425, sessions: 4 }, deadlift: { best_est_1rm: 500, sessions: 1 } }, ["back_squat", "pistol"], 12);
  const d = trainingSummaryDiff(prev, next);
  assert(d.lift_changes.some((c) => c.lift === "back_squat" && c.from_est_1rm === 405 && c.to_est_1rm === 425));
  assert(d.lift_changes.some((c) => c.lift === "deadlift" && c.from_est_1rm === null)); // newly logged
  assertEquals(d.new_movements, ["pistol"]);
  assertEquals(d.sessions_logged_from, 8);
  assertEquals(d.sessions_logged_to, 12);
});

Deno.test("trainingSummaryDiff: prev null → everything is a change", () => {
  const next = ts({ back_squat: { best_est_1rm: 405, sessions: 2 } }, ["back_squat"], 5);
  const d = trainingSummaryDiff(null, next);
  assertEquals(d.lift_changes.length, 1);
  assertEquals(d.lift_changes[0].from_est_1rm, null);
  assertEquals(d.new_movements, ["back_squat"]);
});

// ── CoachState diff ────────────────────────────────────────────────
function cs(priorities: Array<{ focus: string; rank: number }>, recovery: string, emphasis: string): CoachStateContent {
  return {
    coach_state_builder_version: "v1.4", headline: "h", summary: "s",
    // deno-lint-ignore no-explicit-any
    priorities: priorities.map((p) => ({ focus: p.focus, rank: p.rank, confidence: "high", reasons: ["supports_stated_goal"], evidence: [], athlete_facing_rationale: "r", recommended_action: "a" })) as any,
    maintain: [], deprioritize: [],
    // deno-lint-ignore no-explicit-any
    recovery_posture: { stance: recovery, confidence: "high", reasons: ["masters_age"] } as any,
    // deno-lint-ignore no-explicit-any
    strength_emphasis: { value: emphasis, confidence: "high", reasons: ["oly_imbalance"] } as any,
  };
}

Deno.test("coachStateDiff: priority add/remove/rerank + posture + emphasis changes", () => {
  const prev = cs([{ focus: "midline", rank: 1 }, { focus: "powerlifting_strength", rank: 2 }], "conservative", "absolute_strength");
  const next = cs([{ focus: "gymnastics_pressing", rank: 1 }, { focus: "midline", rank: 2 }], "standard", "technical");
  const d = coachStateDiff(prev, next);
  assertEquals(d.priorities_added, ["gymnastics_pressing"]);
  assertEquals(d.priorities_removed, ["powerlifting_strength"]);
  assert(d.rank_changes.some((c) => c.focus === "midline" && c.from === 1 && c.to === 2));
  assertEquals(d.recovery_change, { from: "conservative", to: "standard" });
  assertEquals(d.strength_emphasis_change, { from: "absolute_strength", to: "technical" });
});

// ── Athlete Model diff ─────────────────────────────────────────────
function cap(value: number | null, source: Capability["source"]): Capability {
  return { value, source, confidence: "low", as_of: null };
}
function norm(value: number, position: Normative["position"]): Normative {
  return { value, threshold: 1.9, gap: value - 1.9, position };
}

Deno.test("athleteModelDiff: capability raise + position change", () => {
  const prev = {
    capabilities: { back_squat: cap(405, "self_reported") },
    normative: { back_squat_to_bodyweight: norm(1.8, "below") },
  };
  const next = {
    capabilities: { back_squat: cap(425, "observed") },
    normative: { back_squat_to_bodyweight: norm(1.9, "at_or_near") },
  };
  const d = athleteModelDiff(prev, next);
  assert(d.capability_changes.some((c) => c.lift === "back_squat" && c.from === 405 && c.to === 425 && c.from_source === "self_reported" && c.to_source === "observed"));
  assert(d.position_changes.some((c) => c.key === "back_squat_to_bodyweight" && c.from === "below" && c.to === "at_or_near"));
});
