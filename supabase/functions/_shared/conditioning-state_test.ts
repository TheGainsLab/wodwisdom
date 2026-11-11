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
  return { rolling_avg_ratio: 1.0, rolling_count: 4, last_5_ratios: [1, 1, 1, 1], learned_max_pace: 100, ...p };
}
function tt(modality: string, date: string, rpm = 300, is_current = true, units = "cal"): TimeTrialRow {
  return { modality, units, calculated_rpm: rpm, date, is_current };
}

// ── structured diagnosis: raw passthrough + taxonomy tags ─────────────────
Deno.test("computeConditioningDiagnosis: passes ratios through and tags by taxonomy", () => {
  const diag = computeConditioningDiagnosis({
    metrics: [
      metric({ day_type: "threshold", modality: "c2_row", rolling_avg_ratio: 0.91, last_5_ratios: [0.95, 0.93, 0.9, 0.91] }),
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
  assertEquals(thr.last_5_ratios, [0.95, 0.93, 0.9, 0.91]);
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
      // Both current: a per-unit baseline can be live for cal AND watts at once
      // (they're never compared). Only is_current baselines surface post-13228be.
      tt("echo_bike", "2026-01-01", 18, true, "cal"), // current, calories
      tt("echo_bike", "2026-05-27", 200, true, "watts"), // current, watts
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
      metric({ day_type: "threshold", modality: "c2_row", rolling_avg_ratio: 0.91, last_5_ratios: [0.95, 0.93, 0.9, 0.91] }),
    ],
    timeTrials: [tt("c2_row", "2026-06-10")],
    sessions: [{ date: "2026-06-10" }],
    now: NOW,
  });
  // raw numbers present
  assert(out.includes("ratio 0.91"));
  assert(out.includes("recent [0.95,0.93,0.90,0.91]"));
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

// ── Drift guard — the column-name fence ─────────────────────────────────
// Production's column is last_5_ratios; the repo once said last_4_ratios and
// every read 400'd SILENTLY for months (pace multiplier pinned at 1.0, the
// sequencer's diagnosis blind). This test greps the actual reader sources so
// the name can never quietly fork again: if the schema evolves, this test,
// the readers, and a migration must all move together.
Deno.test("drift guard: no reader references the retired last_4_ratios column", async () => {
  const readers = [
    "./supabase/functions/_shared/conditioning-state.ts",
    "./src/lib/engineService.ts",
  ];
  // Test cwd may be repo root or supabase/functions — resolve from either.
  for (const rel of readers) {
    let src: string | null = null;
    for (const prefix of ["", "../../"]) {
      try {
        src = await Deno.readTextFile(prefix + rel);
        break;
      } catch { /* try next prefix */ }
    }
    if (src === null) throw new Error(`drift guard could not read ${rel}`);
    assert(!src.includes("last_4_ratios"), `${rel} references retired column last_4_ratios`);
    assert(src.includes("last_5_ratios"), `${rel} must read the production column last_5_ratios`);
  }
});

Deno.test("max-effort types (anaerobic) render their ratio as 'vs baseline' and the explainer says why", () => {
  const text = formatConditioningState({
    metrics: [
      { day_type: "anaerobic", modality: "echo_bike", rolling_avg_ratio: 1.42, rolling_count: 3, last_5_ratios: [1.38, 1.4, 1.48], learned_max_pace: 22 },
      { day_type: "max_aerobic_power", modality: "echo_bike", rolling_avg_ratio: 1.03, rolling_count: 3, last_5_ratios: [1.0, 1.04, 1.05], learned_max_pace: 16 },
    ],
    timeTrials: [],
    sessions: [],
    now: new Date("2026-11-11T00:00:00Z"),
  });
  if (!text.includes("anaerobic / echo bike  trains[GL] root  ratio 1.42 vs baseline")) throw new Error(text);
  if (text.includes("max aerobic power / echo bike  trains[AP] root  ratio 1.03 vs baseline")) throw new Error("MAP must not be vs baseline");
  if (!text.includes("MAX-EFFORT day types")) throw new Error("explainer missing");
});

Deno.test("time-trial history: the last three trials per modality+units, oldest→newest, on the calibration line", () => {
  const text = formatConditioningState({
    metrics: [],
    timeTrials: [
      { modality: "echo_bike", units: "cal", calculated_rpm: 14, date: "2026-07-01", is_current: false },
      { modality: "echo_bike", units: "cal", calculated_rpm: 15, date: "2026-08-01", is_current: false },
      { modality: "echo_bike", units: "cal", calculated_rpm: 15.8, date: "2026-09-01", is_current: false },
      { modality: "echo_bike", units: "cal", calculated_rpm: 16.2, date: "2026-10-01", is_current: true },
    ],
    sessions: [],
    now: new Date("2026-10-15T00:00:00Z"),
  });
  if (!text.includes("baseline 16.2 · trials 15 (2026-08-01) → 15.8 (2026-09-01) → 16.2 (2026-10-01)")) throw new Error(text);
});

Deno.test("adherence: sessions in the last 28 and 90 days, with the cadence's expectation when known", () => {
  const now = new Date("2026-11-11T00:00:00Z");
  const day = (n: number) => ({ date: new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10) });
  const sessions = [day(2), day(5), day(9), day(13), day(20), day(27), day(40), day(60)];
  const withCadence = computeConditioningDiagnosis({ metrics: [], timeTrials: [], sessions, now, daysPerWeek: 3 });
  assertEquals(withCadence.adherence, { sessions_last_28_days: 6, sessions_last_90_days: 8, expected_last_28_days: 12 });
  const text = formatConditioningState({ metrics: [], timeTrials: [], sessions, now, daysPerWeek: 3 });
  if (!text.includes("Adherence: 6 sessions in the last 28 days (the program's cadence implies 12); 8 in the last 90.")) throw new Error(text);
  const noCadence = formatConditioningState({ metrics: [], timeTrials: [], sessions, now });
  if (!noCadence.includes("Adherence: 6 sessions in the last 28 days; 8 in the last 90.")) throw new Error(noCadence);
});

