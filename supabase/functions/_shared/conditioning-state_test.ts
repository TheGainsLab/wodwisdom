/**
 * Unit tests for the conditioning-state core. Run with:
 *   deno test supabase/functions/_shared/conditioning-state_test.ts
 *
 * Pure-function coverage; no I/O, no network. All tests deterministic.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import {
  computeCalibration,
  computeConditioningDiagnosis,
  detectFatigue,
  detectWeakRoots,
  formatConditioningState,
  type PerfMetricRow,
  rollupSystems,
  type TimeTrialRow,
  trendOf,
} from "./conditioning-state.ts";

const NOW = new Date("2026-06-19T00:00:00Z");

function metric(p: Partial<PerfMetricRow> & Pick<PerfMetricRow, "day_type" | "modality">): PerfMetricRow {
  return {
    rolling_avg_ratio: 1.0,
    rolling_count: 4,
    last_4_ratios: [1, 1, 1, 1],
    learned_max_pace: 100,
    ...p,
  };
}

function tt(modality: string, date: string, rpm = 300, is_current = true): TimeTrialRow {
  return { modality, calculated_rpm: rpm, date, is_current };
}

// ── trendOf ───────────────────────────────────────────────────────────────
Deno.test("trendOf: rising / flat / falling / insufficient", () => {
  assertEquals(trendOf([0.9, 0.95, 1.0, 1.05]), "rising");
  assertEquals(trendOf([1.0, 1.0, 1.0, 1.0]), "flat");
  assertEquals(trendOf([1.1, 1.0, 0.95, 0.9]), "falling");
  assertEquals(trendOf([1.0]), null);
  assertEquals(trendOf("nope"), null);
});

// ── calibration gate ─────────────────────────────────────────────────────
Deno.test("computeCalibration: current vs stale vs uncalibrated + baseline progression", () => {
  const cal = computeCalibration(
    ["c2_row", "echo_bike", "ski_erg"],
    [
      tt("c2_row", "2026-05-01", 280, false),
      tt("c2_row", "2026-06-10", 312, true), // 9 days old → current; +11.4%
      tt("echo_bike", "2026-03-01", 200, true), // ~110 days old → stale
    ],
    NOW,
    40,
  );
  assertEquals(cal.get("c2_row")?.status, "current");
  assertEquals(cal.get("c2_row")?.baselineDeltaPct, 11.4);
  assertEquals(cal.get("echo_bike")?.status, "stale");
  assertEquals(cal.get("ski_erg")?.status, "uncalibrated");
});

// ── energy-system roll-up ────────────────────────────────────────────────
Deno.test("rollupSystems: confidence-weighted score + status + ignores uncalibrated", () => {
  const cal = computeCalibration(["c2_row"], [tt("c2_row", "2026-06-10")], NOW, 40);
  const systems = rollupSystems(
    [
      metric({ day_type: "endurance", modality: "c2_row", rolling_avg_ratio: 1.06 }), // AB strong
      metric({ day_type: "threshold", modality: "c2_row", rolling_avg_ratio: 0.92 }), // LT lagging
      metric({ day_type: "max_aerobic_power", modality: "c2_row", rolling_avg_ratio: 1.0 }), // AP solid
    ],
    cal,
  );
  const ab = systems.find((s) => s.system === "AB")!;
  const lt = systems.find((s) => s.system === "LT")!;
  const ap = systems.find((s) => s.system === "AP")!;
  const gl = systems.find((s) => s.system === "GL")!;
  assertEquals(ab.status, "strong");
  assertEquals(lt.status, "lagging");
  assertEquals(ap.status, "solid");
  assertEquals(gl.status, "no-data");
});

Deno.test("rollupSystems: uncalibrated modality is excluded from the roll-up", () => {
  const cal = computeCalibration(["ski_erg"], [], NOW, 40); // no TT → uncalibrated
  const systems = rollupSystems(
    [metric({ day_type: "endurance", modality: "ski_erg", rolling_avg_ratio: 1.2 })],
    cal,
  );
  assertEquals(systems.find((s) => s.system === "AB")?.status, "no-data");
});

// ── weak-root detection (guardrails) ─────────────────────────────────────
Deno.test("detectWeakRoots: requires confidence AND a current time trial", () => {
  const calCurrent = computeCalibration(["c2_row"], [tt("c2_row", "2026-06-10")], NOW, 40);
  const calStale = computeCalibration(["c2_row"], [tt("c2_row", "2026-01-01")], NOW, 40);

  // Weak + confident + current TT → flagged
  assertEquals(
    detectWeakRoots([metric({ day_type: "threshold", modality: "c2_row", rolling_avg_ratio: 0.9 })], calCurrent).length,
    1,
  );
  // Low confidence → not flagged
  assertEquals(
    detectWeakRoots(
      [metric({ day_type: "threshold", modality: "c2_row", rolling_avg_ratio: 0.9, rolling_count: 1 })],
      calCurrent,
    ).length,
    0,
  );
  // Stale TT → not flagged (can't trust the score)
  assertEquals(
    detectWeakRoots([metric({ day_type: "threshold", modality: "c2_row", rolling_avg_ratio: 0.9 })], calStale).length,
    0,
  );
  // Non-root weak competency → not a "root" flag
  assertEquals(
    detectWeakRoots([metric({ day_type: "flux", modality: "c2_row", rolling_avg_ratio: 0.9 })], calCurrent).length,
    0,
  );
});

// ── fatigue heuristic ────────────────────────────────────────────────────
Deno.test("detectFatigue: high RPE with sub-target output flags accumulation", () => {
  const sessions = [
    { date: "2026-06-18", day_type: "interval", modality: "c2_row", performance_ratio: 0.95, perceived_exertion: 9 },
    { date: "2026-06-16", day_type: "threshold", modality: "c2_row", performance_ratio: 0.96, perceived_exertion: 8 },
    { date: "2026-06-14", day_type: "endurance", modality: "c2_row", performance_ratio: 0.94, perceived_exertion: 8 },
  ];
  const flags = detectFatigue(sessions, NOW);
  assert(flags.some((f) => f.includes("fatigue accumulation")));
});

Deno.test("detectFatigue: long gap since last session is flagged", () => {
  const flags = detectFatigue(
    [{ date: "2026-06-01", day_type: "endurance", modality: "c2_row", performance_ratio: 1.0, perceived_exertion: 5 }],
    NOW,
  );
  assert(flags.some((f) => f.includes("since last session")));
});

// ── structured diagnosis (the AI sequencer's input) ──────────────────────
Deno.test("computeConditioningDiagnosis: returns structured fields", () => {
  const diag = computeConditioningDiagnosis({
    metrics: [
      metric({ day_type: "endurance", modality: "c2_row", rolling_avg_ratio: 1.06 }),
      metric({ day_type: "threshold", modality: "c2_row", rolling_avg_ratio: 0.9 }),
    ],
    timeTrials: [tt("c2_row", "2026-06-10")],
    sessions: [],
    now: NOW,
  });
  assertEquals(diag.hasData, true);
  assertEquals(diag.modalities, ["c2_row"]);
  assertEquals(diag.calibration[0].status, "current");
  assertEquals(diag.systems.find((s) => s.system === "AB")?.status, "strong");
  assertEquals(diag.systems.find((s) => s.system === "LT")?.status, "lagging");
  assertEquals(diag.weakRoots.length, 1); // threshold root weak + current TT
});

Deno.test("computeConditioningDiagnosis: empty → hasData false", () => {
  const diag = computeConditioningDiagnosis({ metrics: [], timeTrials: [], sessions: [], now: NOW });
  assertEquals(diag.hasData, false);
  assertEquals(diag.modalities.length, 0);
});

// ── format: no-op + smoke ────────────────────────────────────────────────
Deno.test("formatConditioningState: empty input → no-op", () => {
  assertEquals(
    formatConditioningState({ metrics: [], timeTrials: [], sessions: [], now: NOW }),
    "",
  );
});

Deno.test("formatConditioningState: produces a labelled block with the key sections", () => {
  const out = formatConditioningState({
    metrics: [
      metric({ day_type: "endurance", modality: "c2_row", rolling_avg_ratio: 1.05 }),
      metric({ day_type: "threshold", modality: "c2_row", rolling_avg_ratio: 0.9 }),
    ],
    timeTrials: [tt("c2_row", "2026-06-10")],
    sessions: [
      { date: "2026-06-17", day_type: "threshold", modality: "c2_row", performance_ratio: 0.9, perceived_exertion: 9 },
    ],
    now: NOW,
  });
  assert(out.includes("ENGINE CONDITIONING STATE"));
  assert(out.includes("Calibration:"));
  assert(out.includes("Energy systems:"));
  assert(out.includes("Weak root"));
  // diagnosis is position-free: no curriculum/next-day line
  assert(!out.includes("Next new day-type"));
  assert(!out.includes("Curriculum"));
  // phosphagen guard present
  assert(out.toLowerCase().includes("phosphagen"));
});
