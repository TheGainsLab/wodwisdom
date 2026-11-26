// deno test -A supabase/functions/_shared/engine-continuum_test.ts --no-check
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyRetest, balancedBout, BAND_POSITION_LINES, bandPosition, balancedCeiling, balancedPaceMultiple, C2_CAL_CURVE_V1, C2_METERS_CURVE_V1, comparablePace, type ContinuumSessionInput, ECHO_BIKE_CAL_CURVE_V1, formatCurveForPrompt, newCurve, replayCurve, sessionBout, sessionContinuum, summarizeCurve, type TrialInput, qualifyFlag } from "./engine-continuum.ts";

const fixture = JSON.parse(await Deno.readTextFile(new URL("./fixtures/continuum_athlete.json", import.meta.url))) as {
  trials: TrialInput[];
  sessions: ContinuumSessionInput[];
};
const CURVES = { "echo_bike|cal": ECHO_BIKE_CAL_CURVE_V1 };
const ECHO = ECHO_BIKE_CAL_CURVE_V1;
const byDate = (d: string, type?: string) => fixture.sessions.find((s) => s.date === d && (!type || s.day_type === type))!;
const near = (a: number, b: number, tol = 0.02) => assertAlmostEquals(a, b, tol);

// ── reference curve ──────────────────────────────────────────────────────────

Deno.test("curve: the anchors — 2.6× peak at 15 s, 2.2× at 30 s (the glycolytic reference), 1.0× at 600 s", () => {
  near(balancedBout(ECHO, 2.6), 15, 1e-9);
  near(balancedBout(ECHO, 2.2), 30, 1e-9);
  near(balancedBout(ECHO, 1.0), 600, 1e-9);
  near(balancedPaceMultiple(ECHO, 15), 2.6, 1e-9);
  near(balancedPaceMultiple(ECHO, 600), 1.0, 1e-9);
  near(balancedCeiling(ECHO), 2.2, 1e-9);
});

Deno.test("curve: interpolation is on log-duration and clamps at the ends", () => {
  const d = balancedBout(ECHO, 1.06); // between 1.12×@240 s and 1.0×@600 s
  assert(d > 240 && d < 600, `got ${d}`);
  assertEquals(balancedBout(ECHO, 5.0), 10); // past the fastest point
  assertEquals(balancedBout(ECHO, 0.5), 3600); // past the slowest point
});

// ── units ────────────────────────────────────────────────────────────────────

Deno.test("units: no conversion — every machine is compared in its own native pace", () => {
  assertEquals(comparablePace("echo_bike", "cal", 18.4), 18.4);
  assertEquals(comparablePace("c2_row_erg", "meters", 250), 250);
  assertEquals(comparablePace("echo_bike", "cal", 0), null);
});

Deno.test("curves: Concept2 metres ≈ 1.27× @ 30 s, calories ≈ 1.78× — the same effort as the Echo's 2.2×", () => {
  near(balancedCeiling(C2_METERS_CURVE_V1), 1.27, 0.01);
  near(balancedCeiling(C2_CAL_CURVE_V1), 1.78, 0.02);
  near(balancedBout(C2_METERS_CURVE_V1, 1.0), 600, 1e-9);
  // a rower sprinting at 1.27× pace and an Echo rider at 2.2× land at the same effort duration
  near(balancedBout(C2_METERS_CURVE_V1, 1.267), balancedBout(ECHO_BIKE_CAL_CURVE_V1, 2.2), 1);
});

// ── per session, against the real athlete ────────────────────────────────────

Deno.test("session: 30-s all-out anaerobic at 2.63× is a ~14-s balanced effort held for 30 s — a ceiling well above the curve", () => {
  const c = sessionContinuum(byDate("2026-09-15"), 16.1, ECHO);
  near(c.r!, 2.63);
  assertEquals(c.evidence, "ceiling");
  assertEquals(c.bout_seconds, 30);
  near(c.effort_seconds!, 14, 1.5);
  assert(c.sustain! > 2.0, `sustain ${c.sustain}`);
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
  assert(e.effort_seconds! >= 2400, `effort ${e.effort_seconds}`);
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

Deno.test("replay: the real athlete — measured from 10-min efforts down to ≤30 s; 20–40 min floor-only; the 30–60 s band reads measured from his 24–25 s max efforts (reach ×/÷1.27 since 2026-11-17); aerobic side behind the sprint; trial-low resolved by the retest", () => {
  const { curve, sessions } = replayCurve(fixture.sessions, fixture.trials, CURVES);
  const regions = summarizeCurve(curve, sessions);
  const byLabel = Object.fromEntries(regions.map((r) => [r.label, r]));
  assertEquals(byLabel["4–10 min"].state, "measured"); // threshold at ~trial pace, MAP at 1.16×
  assertEquals(byLabel["2–4 min"].state, "measured"); // the 3-min interval at 1.18× reached the curve
  assertEquals(byLabel["1–2 min"].state, "measured"); // the 1:2 interval at 1.73×
  assertEquals(byLabel["≤30 s"].state, "measured"); // the 20–30 s max efforts at 2.6–3.2×
  assertEquals(byLabel["30–60 s"].state, "measured"); // nothing lands inside 30–60 s, but his 24–25-s max efforts reach the 31.6-s node (×1.27) — was blank at the old ×1.20 reach
  assertEquals(byLabel["20–40 min"].state, "floor"); // threshold at 0.90–0.94×: trained there, never maximal
  assert(curve.flags.includes("AEROBIC_SIDE_BEHIND_SPRINT"), curve.flags.join(","));
  // TRIAL_LOW was true in early October and the 15 Oct retest cleared it
  assert(!curve.flags.includes("TRIAL_LOW"), curve.flags.join(","));
  // the pinned node (600 s) sits near 1.0 after the retest fold (later sessions may drift it slightly)
  const pinned = curve.nodes.reduce((b, n) => (Math.abs(n.seconds - 600) < Math.abs(b.seconds - 600) ? n : b));
  near(pinned.m, 1.0, 0.1);
  // the far right: his 20-s efforts at 3.0–3.2× keep M near or above 1.0 at ≤20 s
  const right = curve.nodes.filter((n) => n.seconds <= 20);
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
  const pinned = c.nodes.reduce((b, n) => (Math.abs(n.seconds - 600) < Math.abs(b.seconds - 600) ? n : b));
  near(pinned.m, 1.0, 1e-9);
  const far = c.nodes[0]; // 10 s — the fast-twitch end
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
  assert(text.includes("AEROBIC_SIDE_BEHIND_SPRINT"));
  assert(text.includes("≤30 s"));
});

Deno.test("flags: TRIAL_STALE when a machine trained in the last 28 days has a trial older than 40 days; not when the trial is fresh", () => {
  const sessions = [
    { date: "2026-10-01", day_type: "threshold", modality: "echo_bike", units: "cal", actual_pace: 16, total_work_seconds: 600, intervals: 1 },
    { date: "2026-11-10", day_type: "threshold", modality: "echo_bike", units: "cal", actual_pace: 16, total_work_seconds: 600, intervals: 1 },
  ];
  const stale = replayCurve(sessions, [{ modality: "echo_bike", units: "cal", pace: 17, date: "2026-09-01" }], { "echo_bike|cal": ECHO });
  assert(stale.curve.flags.includes("TRIAL_STALE:echo_bike|cal"), stale.curve.flags.join(","));
  const fresh = replayCurve(sessions, [{ modality: "echo_bike", units: "cal", pace: 17, date: "2026-10-20" }], { "echo_bike|cal": ECHO });
  assert(!fresh.curve.flags.some((f) => f.startsWith("TRIAL_STALE")), fresh.curve.flags.join(","));
});

Deno.test("prompt block: no trend row; the sprint flag carries its trial-trend qualifier", () => {
  const { curve, sessions } = replayCurve(fixture.sessions, fixture.trials, CURVES);
  const text = formatCurveForPrompt(curve, summarizeCurve(curve, sessions), fixture.trials);
  assert(!text.includes("trend:"), text);
  assert(text.includes("AEROBIC_SIDE_BEHIND_SPRINT (trial RISING: +14% in 31 days"), text);
  // flat trial → the other reading
  const flat = qualifyFlag("AEROBIC_SIDE_BEHIND_SPRINT", [{ modality: "echo_bike", units: "cal", pace: 16.0, date: "2026-09-14" }, { modality: "echo_bike", units: "cal", pace: 16.2, date: "2026-10-15" }]);
  assert(flat.includes("FLAT") && flat.includes("aerobic side is the gap"), flat);
  assertEquals(qualifyFlag("TRIAL_LOW", fixture.trials), "TRIAL_LOW");
});

Deno.test("state reach: a 45-s max effort ridden at 1.74× (a 61-s effort) marks the 30–60 s band measured, not blank", () => {
  const r = replayCurve(
    [{ date: "2026-11-17", day_type: "anaerobic", modality: "echo_bike", units: "cal", actual_pace: 32.0, total_work_seconds: 270, intervals: 6, prescription: { blocks: [{ work_seconds: 45, rest_seconds: 225, pace_multiple: null, max_effort: true, continuous: false }] } }],
    [{ modality: "echo_bike", units: "cal", pace: 18.4, date: "2026-10-15" }],
    { "echo_bike|cal": ECHO },
  );
  near(r.sessions[0].effort_seconds!, 61, 1.5);
  const band = summarizeCurve(r.curve, r.sessions).find((x) => x.label === "30–60 s")!;
  assertEquals(band.state, "measured");
});

// ── UNCALIBRATED: a machine in current use with no time trial at all ─────────

Deno.test("UNCALIBRATED is about NOW: a session logged before the first trial does not flag a machine that has since been tested", () => {
  const base = byDate(fixture.sessions.filter((x) => x.day_type !== "time_trial").at(-1)!.date);
  const trial = fixture.trials.at(-1)!;
  // A session a week BEFORE any trial existed, then normal training after it.
  const before = { ...base, date: "2026-01-01" };
  const { curve, sessions } = replayCurve([before, base], [{ ...trial, modality: base.modality, units: base.units, date: "2026-01-08" }], CURVES);
  assertEquals(sessions[0].evidence, "no_trial"); // that session still cannot be scored…
  assert(!curve.flags.some((f) => f.startsWith("UNCALIBRATED")), `flags: ${curve.flags}`); // …but the machine IS calibrated now
});

Deno.test("UNCALIBRATED: a machine trained in the last 28 days with no trial at all is flagged, with its unit", () => {
  const base = byDate(fixture.sessions.filter((x) => x.day_type !== "time_trial").at(-1)!.date);
  const onRower = { ...base, modality: "c2_row_erg", units: "cal" };
  const { curve } = replayCurve([base, onRower], fixture.trials, { ...CURVES, "c2_row_erg|cal": C2_CAL_CURVE_V1 });
  assert(curve.flags.includes("UNCALIBRATED:c2_row_erg|cal"), `flags: ${curve.flags}`);
  assert(!curve.flags.includes(`UNCALIBRATED:${base.modality}|${base.units ?? ""}`));
  // A machine last used long ago is not in current use: no flag.
  const old = { ...onRower, date: "2025-01-01" };
  const { curve: c2 } = replayCurve([old, base], fixture.trials, { ...CURVES, "c2_row_erg|cal": C2_CAL_CURVE_V1 });
  assert(!c2.flags.some((f) => f.startsWith("UNCALIBRATED")), `flags: ${c2.flags}`);
});

// ── Band positions: the same number always reads the same way ───────────────

Deno.test("a measured band's position follows the fixed lines; an unmeasured band has none", () => {
  assertEquals(BAND_POSITION_LINES, { AHEAD_FROM: 1.05, BALANCED_FROM: 0.95, BEHIND_BELOW: 0.90 });
  const at = (m: number) => bandPosition(m, "measured");
  assertEquals([at(1.20), at(1.05)], ["ahead", "ahead"]);
  assertEquals([at(1.049), at(1.0), at(0.95)], ["balanced", "balanced", "balanced"]);
  assertEquals([at(0.949), at(0.93), at(0.90)], ["slightly behind", "slightly behind", "slightly behind"]);
  assertEquals([at(0.899), at(0.75)], ["behind", "behind"]);
  // The case that read both ways: 0.93 measured is "slightly behind", every time.
  assertEquals(at(0.93), "slightly behind");
  // A floor is a lower bound and a blank is nothing: no position.
  assertEquals(bandPosition(0.93, "floor"), null);
  assertEquals(bandPosition(1.0, "blank"), null);
  assertEquals(bandPosition(null, "measured"), null);
});

Deno.test("the position line is added only when asked for: the sequencer's curve text is unchanged", () => {
  const { curve, sessions } = replayCurve(fixture.sessions, fixture.trials, CURVES);
  const regions = summarizeCurve(curve, sessions);
  const plain = formatCurveForPrompt(curve, regions, fixture.trials);
  assert(!plain.includes("position:"));
  const withPos = formatCurveForPrompt(curve, regions, fixture.trials, { positions: true });
  const line = withPos.split("\n").find((l) => l.startsWith("position: "))!;
  assertEquals(line.split(" | ").length, 7);
  for (const r of regions) assert(line.includes(`${r.label}: ${bandPosition(r.m, r.state) ?? "—"}`));
  // Everything else is the same text.
  assertEquals(withPos.split("\n").filter((l) => !l.startsWith("position: ")).join("\n"), plain);
});
