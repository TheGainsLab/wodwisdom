// deno test supabase/functions/_shared/engine-class/engine-class_test.ts --allow-env --no-check
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { selectTodaysWorkout } from "./select-workout.ts";
import {
  buildWorkoutBoard,
  buildSeasonStandings,
  parseScoreSort,
  type LeaderboardEntry,
  type ModerationRow,
  type ProfileInfo,
} from "./leaderboard.ts";
import type { WriterOutput } from "../v2-output-schema.ts";

const PROGRAM_START = "2026-07-01T00:00:00.000Z";

const OUTPUT: WriterOutput = {
  weeks: [
    { week_num: 1, days: [
      { day_num: 1, blocks: [{ block_type: "strength", movements: [{ movement: "Back Squat", weight: 225 }] }] },
      { day_num: 2, blocks: [{ block_type: "metcon", block_scheme: "21-15-9 for time", cardio_modality: "row", movements: [{ movement: "Row (Calories)", calories: 45 }] }] },
    ] },
    { week_num: 2, days: [
      { day_num: 1, blocks: [{ block_type: "metcon", block_scheme: "AMRAP 12", movements: [{ movement: "Burpee", rep_scheme: [10] }] }] },
    ] },
  ],
} as unknown as WriterOutput;

Deno.test("selectTodaysWorkout: day 0 → first workout (strength → load)", () => {
  const w = selectTodaysWorkout(OUTPUT, PROGRAM_START, "2026-07-01T09:00:00.000Z")!;
  assertEquals([w.week_num, w.day_num], [1, 1]);
  assertEquals(w.score_type, "load");
  assertEquals(w.cycle_index, 0);
  assertEquals(w.cycle_length, 3);
});

Deno.test("selectTodaysWorkout: day 1 → metcon (for_time), modality from block", () => {
  const w = selectTodaysWorkout(OUTPUT, PROGRAM_START, "2026-07-02T09:00:00.000Z")!;
  assertEquals([w.week_num, w.day_num], [1, 2]);
  assertEquals(w.score_type, "for_time");
  assertEquals(w.modality, "row");
});

Deno.test("selectTodaysWorkout: AMRAP scheme → amrap score_type", () => {
  const w = selectTodaysWorkout(OUTPUT, PROGRAM_START, "2026-07-03T09:00:00.000Z")!;
  assertEquals([w.week_num, w.day_num], [2, 1]);
  assertEquals(w.score_type, "amrap");
});

Deno.test("selectTodaysWorkout: past the cycle → HOLDS on the last workout", () => {
  const w = selectTodaysWorkout(OUTPUT, PROGRAM_START, "2026-08-15T09:00:00.000Z")!;
  assertEquals([w.week_num, w.day_num], [2, 1]); // last flattened workout
  assertEquals(w.cycle_index, 2);
});

Deno.test("selectTodaysWorkout: empty program → null", () => {
  assertEquals(selectTodaysWorkout({ weeks: [] } as WriterOutput, PROGRAM_START, "2026-07-01T00:00:00Z"), null);
});

// ── leaderboard ────────────────────────────────────────────────────────────
const PROFILES = new Map<string, ProfileInfo>([
  ["u1", { full_name: "Alice", leaderboard_anonymous: false, leaderboard_excluded: false, role: "user", gender: "female", bodyweight: 60, units: "kg" }],
  ["u2", { full_name: "Bob", leaderboard_anonymous: false, leaderboard_excluded: false, role: "user", gender: "male", bodyweight: 80, units: "kg" }],
  ["u3", { full_name: "Cara", leaderboard_anonymous: true, leaderboard_excluded: false, role: "user", gender: "female", bodyweight: 70, units: "kg" }],
  ["u4", { full_name: "Admin", leaderboard_anonymous: false, leaderboard_excluded: false, role: "admin", gender: "male", bodyweight: 90, units: "kg" }],
]);

function entry(over: Partial<LeaderboardEntry> & { result_ref: string; user_id: string }): LeaderboardEntry {
  return {
    week_num: 1, day_num: 2, modality: "row", score_type: "for_time",
    score_display: "5:00", score_sort: -300, avg_power_watts: 300, rx: true, ...over,
  };
}

Deno.test("buildWorkoutBoard: W·kg uses live bodyweight; divisions by gender+modality; admin excluded; anon renamed", () => {
  const entries = [
    entry({ result_ref: "r1", user_id: "u1", avg_power_watts: 240 }), // 240/60 = 4.0 W·kg (F·row)
    entry({ result_ref: "r2", user_id: "u2", avg_power_watts: 320 }), // 320/80 = 4.0 W·kg (M·row)
    entry({ result_ref: "r3", user_id: "u3", avg_power_watts: 350 }), // 350/70 = 5.0 W·kg (F·row), anon
    entry({ result_ref: "r4", user_id: "u4", avg_power_watts: 999 }), // admin → dropped
  ];
  const divisions = buildWorkoutBoard(entries, PROFILES, new Map(), "wkg", "u1");
  const women = divisions.find((d) => d.division === "W · row")!;
  const men = divisions.find((d) => d.division === "M · row")!;
  assert(!divisions.some((d) => d.division.startsWith("Open")), "no admin/open row");
  // Women: Cara 5.0 > Alice 4.0; Cara is anon.
  assertEquals(women.rows.map((r) => [r.rnk, r.display_name]), [[1, "Anonymous Athlete"], [2, "Alice"]]);
  assertEquals(women.rows[1].is_viewer, true); // u1 = Alice = viewer
  assertEquals(men.rows.length, 1);
});

Deno.test("buildWorkoutBoard: moderation — hide drops, flag badges, adjust re-scores + re-ranks", () => {
  const entries = [
    entry({ result_ref: "r1", user_id: "u1", score_sort: -300, avg_power_watts: 240 }),
    entry({ result_ref: "r2", user_id: "u3", score_sort: -240, avg_power_watts: 350 }), // faster (raw)
  ];
  const mods = new Map<string, ModerationRow>([
    ["r2", { result_ref: "r2", decision: "hide" }],
  ]);
  // raw metric: r2 hidden → only Alice remains.
  const raw = buildWorkoutBoard(entries, PROFILES, mods, "raw", null);
  const w = raw.find((d) => d.division === "W · row")!;
  assertEquals(w.rows.length, 1);
  assertEquals(w.rows[0].display_name, "Alice");

  // flag: badge under_review, keep visible.
  const flagged = buildWorkoutBoard(entries, PROFILES, new Map([["r1", { result_ref: "r1", decision: "flag" }]]), "raw", null);
  const wf = flagged.find((d) => d.division === "W · row")!;
  assertEquals(wf.rows.find((r) => r.display_name === "Alice")!.under_review, true);

  // adjust: correct Alice's raw score to a faster 3:00 → she should now beat Cara (4:00).
  const adjusted = buildWorkoutBoard(entries, PROFILES,
    new Map([["r1", { result_ref: "r1", decision: "adjust", adjustment: { raw_score: "3:00" } }]]), "raw", null);
  const wa = adjusted.find((d) => d.division === "W · row")!;
  assertEquals(wa.rows[0].display_name, "Alice");
  assertEquals(wa.rows[0].score_display, "3:00");
});

Deno.test("buildSeasonStandings: points sum across workouts; 1st gets most", () => {
  const entries = [
    // workout 1:2 — Bob alone (M): 1 participant → 1 pt
    entry({ result_ref: "a", user_id: "u2", week_num: 1, day_num: 2 }),
    // workout 2:1 — Bob again: 1 pt
    entry({ result_ref: "b", user_id: "u2", week_num: 2, day_num: 1, modality: null, score_type: "amrap", score_display: "100 reps", score_sort: 100 }),
  ];
  const season = buildSeasonStandings(entries, PROFILES, new Map(), "raw", "u2");
  const bob = season.find((r) => r.display_name === "Bob")!;
  assertEquals(bob.points, 2); // 1 + 1
  assertEquals(bob.workouts, 2);
  assertEquals(bob.is_viewer, true);
});

Deno.test("parseScoreSort: for_time mm:ss → negative seconds; numeric otherwise", () => {
  assertEquals(parseScoreSort("4:30", "for_time"), -270);
  assertEquals(parseScoreSort("150", "amrap"), 150);
  assertEquals(parseScoreSort("225 lb", "load"), 225);
  assertEquals(parseScoreSort("", "for_time"), null);
  // Malformed time (seconds > 59) must NOT be mis-read as bare minutes via parseFloat.
  assertEquals(parseScoreSort("12:99", "for_time"), null);
});

Deno.test("buildSeasonStandings: null-metric entries don't inflate participant points", () => {
  // W·kg mode: u2 has watts (rankable), u3 has no watts (null metric) in the same
  // division. u2 should get 1 pt (one rankable participant), not 2.
  const profiles = new Map<string, ProfileInfo>([
    ["u2", { full_name: "Bob", leaderboard_anonymous: false, leaderboard_excluded: false, role: "user", gender: "male", bodyweight: 80, units: "kg" }],
    ["m2", { full_name: "Max", leaderboard_anonymous: false, leaderboard_excluded: false, role: "user", gender: "male", bodyweight: 80, units: "kg" }],
  ]);
  const entries = [
    entry({ result_ref: "a", user_id: "u2", week_num: 1, day_num: 1, avg_power_watts: 320 }),
    entry({ result_ref: "b", user_id: "m2", week_num: 1, day_num: 1, avg_power_watts: null }), // no physics → null W·kg
  ];
  const season = buildSeasonStandings(entries, profiles, new Map(), "wkg", null);
  const bob = season.find((r) => r.display_name === "Bob")!;
  assertEquals(bob.rnk, 1);
  assertEquals(bob.points, 1); // 1 rankable participant → 1 pt (not 2)
  assertEquals(season.find((r) => r.display_name === "Max")!.points, 0);
});
