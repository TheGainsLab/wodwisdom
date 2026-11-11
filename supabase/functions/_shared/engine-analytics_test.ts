// deno test supabase/functions/_shared/engine-analytics_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calculatePace, computeEngineAnalytics, energySystemPaces, formatEngineAnalytics, formatWorkRestRatio,
  heartRate, overview, personalRecords, targetsVsActual, workRest, type AnalyticsSession, type AnalyticsTrial,
} from "./engine-analytics.ts";

const S = (p: Partial<AnalyticsSession>): AnalyticsSession => ({
  date: "2026-10-01", day_type: "endurance", modality: "echo_bike", units: "cal", actual_pace: null, total_output: null,
  performance_ratio: null, perceived_exertion: null, average_heart_rate: null, peak_heart_rate: null, workout_data: null, ...p,
});
const trials: AnalyticsTrial[] = [
  { modality: "echo_bike", units: "cal", date: "2026-09-01", calculated_rpm: 14 },
  { modality: "echo_bike", units: "cal", date: "2026-10-01", calculated_rpm: 15 },
];
const sessions: AnalyticsSession[] = [
  S({ date: "2026-10-02", day_type: "anaerobic", actual_pace: 21, total_output: 63, performance_ratio: 1.4 }),
  S({ date: "2026-10-04", day_type: "max_aerobic_power", actual_pace: 14.2, total_output: 227, performance_ratio: 0.99, perceived_exertion: 8, average_heart_rate: 170, peak_heart_rate: 182, workout_data: { total_work_seconds: 960, avg_work_rest_ratio: 1.0 } }),
  S({ date: "2026-10-06", day_type: "max_aerobic_power", actual_pace: 14.8, total_output: 237, performance_ratio: 1.03, perceived_exertion: 7, average_heart_rate: 168, peak_heart_rate: 180, workout_data: { total_work_seconds: 960, avg_work_rest_ratio: 1.0 } }),
  S({ date: "2026-10-08", day_type: "endurance", actual_pace: 10.8, total_output: 324, performance_ratio: 1.03, workout_data: { total_work_seconds: 1800 } }),
  S({ date: "2026-10-01", day_type: "time_trial", actual_pace: 15, total_output: 150 }),
];

Deno.test("helpers: pace falls back to output over work time; work:rest buckets", () => {
  assertEquals(calculatePace(S({ total_output: 120, workout_data: { total_work_seconds: 600 } })), 12);
  assertEquals(formatWorkRestRatio(1.0), "1:1");
  assertEquals(formatWorkRestRatio(0.33), "1:3");
  assertEquals(formatWorkRestRatio(3), "3:1");
});

Deno.test("overview: time trials excluded from workouts; averages over sessions that have the field", () => {
  const o = overview(sessions, trials);
  assertEquals(o.workouts, 4);
  assertEquals(o.sessions, 5);
  assertEquals(o.time_trials, 2);
  assertEquals(Number(o.avg_performance!.toFixed(4)), Number(((1.4 + 0.99 + 1.03 + 1.03) / 4).toFixed(4)));
  assertEquals(o.avg_rpe, 7.5);
  assertEquals(o.rpe_count, 2);
  assertEquals(o.by_day_type.map((x) => `${x.day_type}:${x.count}`), ["anaerobic:1", "endurance:1", "max_aerobic_power:2"]);
});

Deno.test("energy system paces: ratios against the LATEST trial and between systems (page formula)", () => {
  const e = energySystemPaces(sessions, trials, "echo_bike");
  assertEquals(e.glycolytic, 21 / 15);
  assertEquals(e.aerobic, 14.5 / 15);
  assertEquals(e.systems, 21 / 14.5);
  assertEquals(e.peak, 21);
  assertEquals(e.units, "cal");
});

Deno.test("personal records: best output per day type, sorted by pace", () => {
  const r = personalRecords(sessions, "echo_bike");
  assertEquals(r.map((x) => x.day_type), ["anaerobic", "max_aerobic_power", "endurance"]);
  assertEquals(r[1].output, 237);
});

Deno.test("targets vs actual and work:rest and heart rate per modality", () => {
  assertEquals(targetsVsActual(sessions, "echo_bike").find((t) => t.day_type === "max_aerobic_power")?.avg_ratio, 1.01);
  const wr = workRest(sessions, "echo_bike");
  assertEquals(wr, [{ ratio: "1:1", count: 2, avg_pace: 14.5, units: "cal" }]);
  const hr = heartRate(sessions, trials, "echo_bike");
  assertEquals(hr.length, 1);
  assertEquals(hr[0].avg_hr, 169);
  assertEquals(hr[0].max_peak_hr, 182);
});

Deno.test("the prompt block carries every section and is empty with no data", () => {
  const text = formatEngineAnalytics(computeEngineAnalytics(sessions, trials));
  for (const needle of ["ENGINE ANALYTICS", "Overview: 4 workouts, 2 time trials", "echo bike:", "anaerobic÷trial 1.40", "personal records", "pace by work:rest", "heart rate (when logged)"]) {
    if (!text.includes(needle)) throw new Error(`missing "${needle}" in:\n${text}`);
  }
  assertEquals(formatEngineAnalytics(computeEngineAnalytics([], [])), "");
});
