// deno test -A supabase/functions/_shared/engine-continuum_test.ts --no-check
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyRetest,
  balancedBout,
  balancedCeiling,
  balancedPaceMultiple,
  comparablePace,
  type ContinuumSessionInput,
  ECHO_BIKE_CAL_CURVE_V1,
  formatCurveForPrompt,
  newCurve,
  replayCurve,
  sessionBout,
  sessionContinuum,
  summarizeCurve,
  type TrialInput,
} from "./engine-continuum.ts";

const fixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/continuum_athlete.json", import.meta.url))) as {
  trials: TrialInput[];
  sessions: ContinuumSessionInput[];
};
const CURVES = { "echo_bike|cal": ECHO_BIKE_CAL_CURVE_V1 };
const ECHO = ECHO_BIKE_CAL_CURVE_V1;
const byDate = (d: string, type?: string) => fixture.sessions.find((s) => s.date === d && (!type || s.day_type === type))!;
const near = (a: number, b: number, tol = 0.02) => assertAlmostEquals(a, b, tol);

// ── reference curve ──────────────────────────────────────────────────────────

Deno.test("curve: the two anchors — 2.6× at 30 s, 1.0× at 600 s", () => {
  near(balancedBout(ECHO, 2.6), 30, 1e-9);
  near(balancedBout(ECHO, 1.0), 600, 1e-9);
  near(balancedPaceMultiple(ECHO, 30), 2.6, 1e-9);
  near(balancedPaceMultiple(ECHO, 600), 1.0, 1e-9);
  near(balancedCeiling(ECHO), 2.6, 1e-9);
});

Deno.test("curve: interpolation is on log-duration and clamps at the ends", () => {
  const d = balancedBout(ECHO, 1.06); // between 1.12×@240 s and 1.0×@600 s
  assert(d > 240 && d < 600, `got ${d}`);
  assertEquals(balancedBout(ECHO, 5.0), 10); // past the fastest point
  assertEquals(balancedBout(ECHO, 0.5), 3600); // past the slowest point
});

// ── units ────────────────────────────────────────────────────────────────────

Deno.test("units: Echo calories are their own currency; C2 meters convert to watts (ratio = pace ratio cubed)", () => {
  assertEquals(comparablePace("echo_bike", "cal", 18.4), 18.4);
  const w1 = comparablePace("c2_row_erg", "meters", 250)!; // 250 m/min = 2:00/500
  const w2 = comparablePace("c2_row_erg", "meters", 275)!;
  near(w2 / w1, Math.pow(275 / 250, 3), 1e-6);
  near(w1, 2.80 / Math.pow(60 / 250, 3), 1e-6);
  // C2 calories: cal/hr = 4W + 300
  near(comparablePace("c2_row_erg", "cal", 20)!, (20 * 60 - 300) / 4, 1e-9);
  assertEquals(comparablePace("c2_row_erg", "watts", 200), 200);
  assertEquals(comparablePace("echo_bike", "cal", 0), null);
});

// ── per session, against the real athlete ────────────────────────────────────

Deno.test("session: 30-s all-out anaerobic lands at 2.63× and reaches the curve (ceiling)", () => {
  const c = sessionContinuum(byDate("2026-09-15"), 16.1, ECHO);
  near(c.r!, 2.63);
  near(c.sustain!, 1.04, 0.05);
  assertEquals(c.evidence, "ceiling");
  assertEquals(c.bout_seconds, 30);
});

Deno.test("session: 15 min at 1.06× — sustained longer than the balanced max → sustain > 1, the trial was low", () => {
  const c = sessionContinuum(byDate("2026-10-02", "threshold"), 16.1, ECHO);
  near(c.r!, 1.06);
  assert(c.sustain! > 1.0, `sustain ${c.sustain}`);
  assertEquals(c.evidence, "ceiling");
});

Deno.test("session: 4 × 4 min at trial pace, target beaten, is still only a floor (sustain ≈ 0.43)", () => {
  const s = byDate("2026-09-18", "max_aerobic_power"); // 16.25 delivered vs 15.3 asked
  const c = sessionContinuum(s, 16.1, ECHO);
  near(c.r!, 1.01);
  near(c.sustain!, 0.43, 0.03);
  assertEquals(c.evidence, "floor");
  assert(c.asked_r != null && c.r! > c.asked_r * 0.98, "beat the target, still only a floor");
});

Deno.test("session: missing an ask that was itself near a balanced max (5 × 5 min at 1.08×) is a floor, not a miss", () => {
  const s = byDate("2026-10-28", "max_aerobic_power"); // 18.47 delivered vs 19.80 asked
  const c = sessionContinuum(s, 18.4, ECHO);
  near(c.r!, 1.0);
  assertEquals(c.evidence, "floor");
});

Deno.test("session: missing a comfortably sub-max ask (6 × 3 min at 1.08×) is a miss", () => {
  const s = byDate("2026-11-13", "interval"); // 18.5 delivered vs 19.86 asked
  const c = sessionContinuum(s, 18.4, ECHO);
  near(c.r!, 1.0);
  assertEquals(c.evidence, "miss");
  near(c.asked_r!, 1.08);
});

Deno.test("session: the same 1:2 interval prescription — one reached the curve (1.73×), one was held back (1.36×, floor)", () => {
  const hard = sessionContinuum(byDate("2026-10-02", "interval"), 16.1, ECHO);
  const held = sessionContinuum(byDate("2026-10-30", "interval"), 18.4, ECHO);
  near(hard.r!, 1.73);
  assertEquals(hard.evidence, "ceiling");
  near(held.r!, 1.36);
  assertEquals(held.evidence, "floor");
});

Deno.test("session: endurance at 0.70× is zone 2; the time trial is a record at exactly 1.0×, 600 s", () => {
  const e = sessionContinuum(byDate("2026-09-17"), 16.1, ECHO);
  assertEquals(e.evidence, "zone2");
  assert(e.r! < 0.85);
  const tt = sessionContinuum(byDate("2026-10-15", "time_trial"), 18.4, ECHO);
  assertEquals(tt.evidence, "record");
  assertEquals(tt.r, 1.0);
  assertEquals(tt.bout_seconds, 600);
  near(tt.sustain!, 1.0, 1e-9);
});

Deno.test("session: a miss — delivered below the asked pace", () => {
  const s: ContinuumSessionInput = { ...byDate("2026-10-17", "interval"), actual_pace: 17.0, target_pace: 21.1 };
  const c = sessionContinuum(s, 18.4, ECHO);
  assertEquals(c.evidence, "miss");
  assert(c.asked_r! > c.r!);
});

Deno.test("session: no trial on the machine → not computable; no curve → not computable", () => {
  assertEquals(sessionContinuum(byDate("2026-09-15"), null, ECHO).evidence, "no_trial");
  assertEquals(sessionContinuum(byDate("2026-09-15"), 16.1, null).evidence, "no_curve");
});

Deno.test("bout: the longest work block decides a multi-block day; continuous work is the whole block", () => {
  const atomic: ContinuumSessionInput = {
    date: "2026-11-01", day_type: "atomic", modality: "echo_bike", units: "cal", actual_pace: 20,
    total_work_seconds: 80 + 720, total_rest_seconds: 400, intervals: 12,
    prescription: { blocks: [{ work_seconds: 10, rest_seconds: 50, max_effort: true }, { work_seconds: 180, rest_seconds: 0, pace_multiple: 0.85, continuous: false }] },
  };
  assertEquals(sessionBout(atomic), 180);
  // the judged block is the 180-s aerobic one, so the sprint block's max effort does not make this a ceiling
  const c = sessionContinuum(atomic, 20, ECHO); // 20 cal/min delivered on a 20 trial → 1.0×, 180 s vs 600 s balanced
  assertEquals(c.evidence, "floor");
  const endurance = byDate("2026-09-17");
  assertEquals(sessionBout(endurance), 1260);
  const noPrescription: ContinuumSessionInput = { ...byDate("2026-09-25"), prescription: null };
  assertEquals(sessionBout(noPrescription), 90); // 720 s / 8 intervals
});

// ── the curve ────────────────────────────────────────────────────────────────

Deno.test("replay: the real athlete — measured near the trial, at 1.18× and above 1.7×; floor only between 1.3× and 1.6×; ceiling above balanced; trial-low resolved by the retest", () => {
  const { curve, sessions } = replayCurve(fixture.sessions, fixture.trials, CURVES);
  const regions = summarizeCurve(curve, sessions);
  const byLabel = Object.fromEntries(regions.map((r) => [r.label, r]));
  assertEquals(byLabel["0.95–1.1×"].state, "measured");
  assertEquals(byLabel[">2.6×"].state, "measured");
  assertEquals(byLabel["1.6–2.0×"].state, "measured"); // the 1.73× interval
  assertEquals(byLabel["1.1–1.3×"].state, "measured"); // the 3-min interval at 1.18× reached the curve
  assertEquals(byLabel["1.3–1.6×"].state, "floor"); // trained there, never tested
  assert(curve.flags.includes("CEILING_ABOVE_BALANCED"), curve.flags.join(","));
  // TRIAL_LOW was true in early October and the 15 Oct retest cleared it
  assert(!curve.flags.includes("TRIAL_LOW"), curve.flags.join(","));
  // the pinned node sits at 1.0 after the retest fold (later sessions may drift it slightly)
  const pinned = curve.nodes.reduce((b, n) => (Math.abs(n.r - 1) < Math.abs(b.r - 1) ? n : b));
  near(pinned.m, 1.0, 0.1);
  // the right end: his 20-s efforts at 3.0–3.2× keep M near or above 1.0 there
  const right = curve.nodes.filter((n) => n.r > 2.6);
  assert(right.every((n) => n.m >= 0.95), right.map((n) => n.m.toFixed(2)).join(","));
});

Deno.test("replay: trial-low is flagged while it is true", () => {
  // stop the history before the retest
  const early = fixture.sessions.filter((s) => s.date < "2026-10-15");
  const { curve } = replayCurve(early, fixture.trials.filter((t) => t.date < "2026-10-15"), CURVES);
  assert(curve.flags.includes("TRIAL_LOW"), curve.flags.join(","));
});

Deno.test("retest: folds the pinned node back to 1.0, holds back the right end, keeps confidence", () => {
  const c = newCurve();
  for (const n of c.nodes) { n.m = 1.1; n.conf = 3; }
  applyRetest(c, 16.1, 18.4);
  const pinned = c.nodes.reduce((b, n) => (Math.abs(n.r - 1) < Math.abs(b.r - 1) ? n : b));
  near(pinned.m, 1.0, 1e-9);
  const far = c.nodes[c.nodes.length - 1];
  assert(far.m < 1.0, `far-right held back: ${far.m}`);
  assertEquals(c.nodes[0].conf, 3);
  assert(c.awaiting_right_anchor);
});

Deno.test("ratchet: a floor only raises; a miss only lowers; zone 2 and records change nothing", () => {
  const base = { modality: "echo_bike", units: "cal", total_work_seconds: 600, total_rest_seconds: 600, intervals: 5, prescription: { blocks: [{ work_seconds: 120, rest_seconds: 120, pace_multiple: 1.1 }] } };
  const trials: TrialInput[] = [{ modality: "echo_bike", units: "cal", pace: 20, date: "2026-01-01" }];
  // floor below the current M: no change
  const low: ContinuumSessionInput = { ...base, date: "2026-01-10", day_type: "interval", actual_pace: 22, target_pace: 21 }; // 1.1×, 120 s vs ~270 s balanced → floor 0.44
  const { curve: c1 } = replayCurve([low], trials, CURVES);
  assert(c1.nodes.every((n) => n.m === 1.0));
  // miss: lowers near the asked pace
  const miss: ContinuumSessionInput = { ...base, date: "2026-01-12", day_type: "interval", actual_pace: 20, target_pace: 23 };
  const { curve: c2 } = replayCurve([miss], trials, CURVES);
  assert(c2.nodes.some((n) => n.m < 1.0));
  // zone 2 and records: nothing
  const z: ContinuumSessionInput = { ...base, date: "2026-01-14", day_type: "endurance", actual_pace: 14, target_pace: 14, prescription: { blocks: [{ work_seconds: 1800, continuous: true, pace_multiple: 0.7 }] } };
  const rec: ContinuumSessionInput = { ...base, date: "2026-01-16", day_type: "rocket_races_b", actual_pace: 30, target_pace: 28 };
  const { curve: c3 } = replayCurve([z, rec], trials, CURVES);
  assert(c3.nodes.every((n) => n.m === 1.0 && n.state === "blank"));
});

Deno.test("prompt block: regions, trials (last 6), flags", () => {
  const { curve, sessions } = replayCurve(fixture.sessions, fixture.trials, CURVES);
  const text = formatCurveForPrompt(curve, summarizeCurve(curve, sessions), fixture.trials);
  assert(text.includes("ATHLETE CONDITIONING CURVE"));
  assert(text.includes("16.1 (2026-09-14) → 18.4 (2026-10-15)"));
  assert(text.includes("CEILING_ABOVE_BALANCED"));
  assert(text.includes(">2.6×"));
});
