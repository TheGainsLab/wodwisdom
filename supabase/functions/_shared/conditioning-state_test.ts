/**
 * Unit tests for the raw conditioning-signal core. Run with:
 *   deno test supabase/functions/_shared/conditioning-state_test.ts
 *
 * Pure-function coverage; no I/O. The diagnosis emits raw numbers + taxonomy
 * tags only — no labels/thresholds — so tests assert the numbers pass through
 * untouched and no verdicts appear.
 */

import { assert, assertEquals } from "jsr:@std/assert";

import {
  computeConditioningDiagnosis,
  formatConditioningState,
  type PerfMetricRow,
  type TimeTrialRow,
} from "./conditioning-state.ts";

const NOW = new Date("2026-06-19T00:00:00Z");

function metric(p: Partial<PerfMetricRow> & Pick<PerfMetricRow, "day_type" | "modality">): PerfMetricRow {
  return { rolling_avg_ratio: 1.0, rolling_count: 4, last_4_ratios: [1, 1, 1, 1], learned_max_pace: 100, ...p };
}
function tt(modality: string, date: string, rpm = 300, is_current = true, units = "cal"): TimeTrialRow {
  return { modality, units, calculated_rpm: rpm, date, is_current };
}

// ── structured diagnosis: raw passthrough + taxonomy tags ─────────────────
Deno.test("computeConditioningDiagnosis: passes ratios through and tags by taxonomy", () => {
  const diag = computeConditioningDiagnosis({
    metrics: [
      metric({ day_type: "threshold", modality: "c2_row", rolling_avg_ratio: 0.91, last_4_ratios: [0.95, 0.93, 0.9, 0.91] }),
      metric({ day_type: "endurance", modality: "c2_row", rolling_avg_ratio: 1.05 }),
    ],
    timeTrials: [tt("c2_row", "2026-06-10")],
    sessions: [{ date: "2026-06-17" }],
    now: NOW,
  });
  assertEquals(diag.hasData, true);
  const thr = diag.competencies.find((c) => c.day_type === "threshold")!;
  // raw number untouched, no labeling
  assertEquals(thr.rolling_avg_ratio, 0.91);
  assertEquals(thr.last_4_ratios, [0.95, 0.93, 0.9, 0.91]);
  // taxonomy tags
  assertEquals(thr.systems, ["LT"]);
  assertEquals(thr.is_root, true);
  // interval is multi-system, not a root
  // calibration is a raw age, not a "stale" verdict
  assertEquals(diag.calibration[0].time_trial_age_days, 9);
  // days since last is raw
  assertEquals(diag.daysSinceLastSession, 2);
});

Deno.test("computeConditioningDiagnosis: no current time trial → null age (fact, not verdict)", () => {
  const diag = computeConditioningDiagnosis({
    metrics: [metric({ day_type: "endurance", modality: "ski_erg", rolling_avg_ratio: 1.2 })],
    timeTrials: [],
    sessions: [],
    now: NOW,
  });
  assertEquals(diag.calibration.find((c) => c.modality === "ski_erg")?.time_trial_age_days, null);
  // ratio still passed through verbatim — not suppressed, just uncalibrated context
  assertEquals(diag.competencies[0].rolling_avg_ratio, 1.2);
});

Deno.test("computeConditioningDiagnosis: separates calibration by units (no watt/cal mixing)", () => {
  const diag = computeConditioningDiagnosis({
    metrics: [metric({ day_type: "endurance", modality: "echo_bike", rolling_avg_ratio: 1.0 })],
    timeTrials: [
      tt("echo_bike", "2026-01-01", 18, false, "cal"), // old, calories
      tt("echo_bike", "2026-05-27", 200, true, "watts"), // recent, watts
    ],
    sessions: [],
    now: NOW,
  });
  const cal = diag.calibration.filter((c) => c.modality === "echo_bike");
  assertEquals(cal.length, 2); // two units → two separate baselines, never compared
  assertEquals(cal.find((c) => c.units === "watts")?.baseline_rpm, 200);
  assertEquals(cal.find((c) => c.units === "cal")?.baseline_rpm, 18);
  // the cross-history delta that produced "+1233%" is gone entirely
  assert(!("baseline_delta_pct" in cal[0]));
});

Deno.test("computeConditioningDiagnosis: empty → hasData false", () => {
  const diag = computeConditioningDiagnosis({ metrics: [], timeTrials: [], sessions: [], now: NOW });
  assertEquals(diag.hasData, false);
  assertEquals(diag.competencies.length, 0);
});

// ── format: raw block, no labels, no RPE/HR ───────────────────────────────
Deno.test("formatConditioningState: empty → no-op", () => {
  assertEquals(formatConditioningState({ metrics: [], timeTrials: [], sessions: [], now: NOW }), "");
});

Deno.test("formatConditioningState: emits raw numbers + tags, zero verdict words", () => {
  const out = formatConditioningState({
    metrics: [
      metric({ day_type: "threshold", modality: "c2_row", rolling_avg_ratio: 0.91, last_4_ratios: [0.95, 0.93, 0.9, 0.91] }),
    ],
    timeTrials: [tt("c2_row", "2026-06-10")],
    sessions: [{ date: "2026-06-10" }],
    now: NOW,
  });
  // raw numbers present
  assert(out.includes("ratio 0.91"));
  assert(out.includes("last4 [0.95,0.93,0.90,0.91]"));
  assert(out.includes("trains[LT] root"));
  assert(out.includes("Days since last completed session: 9"));
  assert(out.includes("9d old")); // calibration age, raw
  // NO judgment vocabulary anywhere
  for (const verdict of ["strong", "lagging", "solid", "weak root", "STALE", "overreach", "fatigue accumulation"]) {
    assert(!out.toLowerCase().includes(verdict.toLowerCase()), `should not contain verdict "${verdict}"`);
  }
  // phosphagen scope note kept (a fact, not a verdict)
  assert(out.toLowerCase().includes("phosphagen"));
});
