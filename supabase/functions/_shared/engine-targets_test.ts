import { assert, assertEquals } from "jsr:@std/assert";
import { C2_METERS_CURVE_V1, ECHO_BIKE_CAL_CURVE_V1, type EngineCurve, mAtEffort, effortBandOf } from "./engine-continuum.ts";
import { authoredFraction, legacyTarget, segmentTarget, type TargetBlockParams, type TargetContext, type TargetSegment } from "./engine-targets.ts";

const TYPES: Array<{ id: string; block_1_params: TargetBlockParams; block_2_params: TargetBlockParams | null }> =
  JSON.parse(await Deno.readTextFile(new URL("./fixtures/engine_day_types.json", import.meta.url)));
const block = (id: string, n = 1): TargetBlockParams => (n === 1 ? TYPES.find((t) => t.id === id)!.block_1_params : TYPES.find((t) => t.id === id)!.block_2_params!);
const near = (a: number, b: number, tol = 0.01) => assert(Math.abs(a - b) <= tol, `${a} vs ${b}`);

const seg = (label: string, duration_seconds: number, round_index = 0, rounds = 1): TargetSegment => ({ label, duration_seconds, round_index, rounds });
const ECHO: TargetContext = { mode: "curve", trialPace: 18.4, machineCurve: ECHO_BIKE_CAL_CURVE_V1, kEffort: 1, athleteCurve: null };
const ROWER: TargetContext = { mode: "curve", trialPace: 240, machineCurve: C2_METERS_CURVE_V1, kEffort: 0.30, athleteCurve: null }; // 240 m/min = 2:05/500

// A curve whose 4–10 min band sits at 0.90 and 1–2 min at 1.10.
function athleteCurve(bands: Array<[number, number, number]>): EngineCurve {
  const nodes = [];
  for (let s = 10; s <= 3600; s *= Math.pow(10, 0.1)) {
    const hit = bands.find(([lo, hi]) => s >= lo && s < hi);
    nodes.push({ seconds: s, m: hit ? hit[2] : 1, conf: hit ? 1 : 0.001, state: hit ? "measured" as const : "blank" as const });
  }
  return { version: 2, nodes, flags: [], as_of: "2026-11-17", awaiting_right_anchor: false };
}

// ── legacy parity: the day page's calculateIntervalGoal, verbatim ──────────────
Deno.test("legacy: trial × centre(paceRange) × rolling — MAP [0.85,1.05] at 18.4 with rolling 1.04", () => {
  const t = legacyTarget(block("max_aerobic_power"), seg("Work", 180), { ...ECHO, mode: "legacy", rollingRatio: 1.04 });
  assertEquals(t.basis, "legacy");
  near(t.target_pace!, 18.4 * 0.95 * 1.04, 1e-9);
});
Deno.test("legacy: a sequenced day ('gen:') ignores the rolling ratio", () => {
  const t = legacyTarget(block("max_aerobic_power"), seg("Work", 180), { ...ECHO, mode: "legacy", rollingRatio: 1.2, isGenerated: true });
  near(t.target_pace!, 18.4 * 0.95, 1e-9);
});
Deno.test("legacy: ascending progresses per round — [0.9,1.3] with paceIncrement 0.05: round 5 asks 1.10", () => {
  near(authoredFraction(block("ascending"), seg("Work", 60, 4, 8))!, 1.10, 1e-9);
});
Deno.test("legacy: flux stages step the flux intensity 0.75 + 0.05 × step; the base is 0.70", () => {
  near(authoredFraction(block("flux_stages"), seg("Flux", 60, 2, 6))!, 0.85, 1e-9);
  near(authoredFraction(block("flux_stages"), seg("Base", 300, 2, 6))!, 0.70, 1e-9);
});
Deno.test("legacy: max effort and bursts have no target; no trial → no_trial", () => {
  assertEquals(legacyTarget(block("anaerobic"), seg("Max Effort", 30), { ...ECHO, mode: "legacy" }).basis, "max_effort");
  assertEquals(legacyTarget(block("polarized"), seg("BURST", 7), { ...ECHO, mode: "legacy" }).basis, "max_effort");
  assertEquals(legacyTarget(block("threshold"), seg("Work", 600), { ...ECHO, mode: "legacy", trialPace: null }).basis, "no_trial");
});

// ── curve mode ─────────────────────────────────────────────────────────────────
const MAP = { ...block("max_aerobic_power"), intensityShare: [0.75, 0.85] };

Deno.test("curve: MAP 4 min on the Echo — R(240 s) = 1.12 × share 0.80 → 0.90 of trial, which a balanced athlete holds ~25 min (band 20–40 min); M 1 when the curve is blank", () => {
  const t = segmentTarget(MAP, seg("Work", 240, 0, 4), ECHO);
  assertEquals(t.basis, "curve");
  near(t.p_balanced!, 1.12, 0.005);
  near(t.share!, 0.80, 1e-9);
  near(t.p_asked!, 0.896, 0.005);
  assertEquals(t.m, 1);
  assertEquals(t.band, "20–40 min"); // 0.90× is a ~25-min effort for a balanced athlete — MAP's M comes from that band
  near(t.target_pace!, 18.4 * 0.896, 0.1);
});

Deno.test("curve: the same block on the rower — the share is a share of EFFORT: 0.80^0.30 = 0.935 → 0.97 of trial pace, not 0.83", () => {
  const t = segmentTarget(MAP, seg("Work", 240, 0, 4), ROWER);
  near(t.p_balanced!, 1.035, 0.005);
  near(t.p_asked!, 1.035 * Math.pow(0.8, 0.3), 0.005);
  near(t.fraction!, 0.97, 0.01);
});

Deno.test("curve: the athlete's M scales the ask — 0.90 in the band the asked pace lands in", () => {
  const curve = athleteCurve([[1200, 2400, 0.90]]);
  const t = segmentTarget(MAP, seg("Work", 240, 0, 4), { ...ECHO, athleteCurve: curve });
  near(t.m!, 0.90, 0.02);
  near(t.fraction!, 0.896 * 0.90, 0.02);
});

Deno.test("curve: the weekly cap — a jump from 15.0 to 16.5 is held to 15.75 (+5 %); a retest lifts the cap", () => {
  const prev = { band: "20–40 min", target_pace: 15.0, trial_pace: 18.4 };
  const t = segmentTarget(MAP, seg("Work", 240, 0, 4), { ...ECHO, previous: prev });
  assert(t.capped);
  near(t.target_pace!, 15.75, 1e-6);
  const after = segmentTarget(MAP, seg("Work", 240, 0, 4), { ...ECHO, trialPace: 19.5, previous: prev });
  assert(!after.capped);
  near(after.target_pace!, 19.5 * 0.896, 0.1);
});

Deno.test("curve: no share → authored fraction (zone 2 is a dose); Base/Flux segments are always authored", () => {
  const e = segmentTarget(block("endurance"), seg("Work", 2400), ECHO);
  assertEquals(e.basis, "authored");
  near(e.fraction!, 0.70, 1e-9);
  const f = segmentTarget({ ...block("flux"), intensityShare: [0.5, 0.6] }, seg("Flux", 60, 1, 6), ECHO);
  assertEquals(f.basis, "authored");
  near(f.fraction!, 0.85, 1e-9);
});

Deno.test("curve: precedence — no trial beats everything; max effort beats no curve; no curve → authored fraction", () => {
  assertEquals(segmentTarget(MAP, seg("Work", 240), { ...ECHO, trialPace: null, machineCurve: null }).basis, "no_trial");
  assertEquals(segmentTarget(block("anaerobic"), seg("Max Effort", 30), { ...ECHO, machineCurve: null }).basis, "max_effort");
  const w = segmentTarget(MAP, seg("Work", 240), { ...ECHO, machineCurve: null, kEffort: null, trialPace: 300 }); // watts
  assertEquals(w.basis, "no_curve");
  near(w.fraction!, 0.95, 1e-9);
});

Deno.test("curve: ascending's share progresses per round like its pace did — [0.59,0.75] over 8 rounds", () => {
  const asc = { ...block("ascending"), intensityShare: [0.59, 0.75] };
  near(segmentTarget(asc, seg("Work", 60, 0, 8), ECHO).share!, 0.59, 1e-9);
  near(segmentTarget(asc, seg("Work", 60, 7, 8), ECHO).share!, 0.75, 1e-9);
  // the top round is a 2–4 min effort on the Echo
  assertEquals(segmentTarget(asc, seg("Work", 60, 7, 8), ECHO).band, "2–4 min");
});

Deno.test("curve: hybrid anaerobic 60 s, share 0.73 — Echo 1.28×, rower 1.06× (today both get 1.05–1.2×)", () => {
  const hy = { ...block("hybrid_anaerobic"), intensityShare: [0.68, 0.78] };
  near(segmentTarget(hy, seg("Work", 60, 0, 4), ECHO).fraction!, 1.75 * 0.73, 0.02);
  near(segmentTarget(hy, seg("Work", 60, 0, 4), ROWER).fraction!, 1.17 * Math.pow(0.73, 0.3), 0.02);
});

Deno.test("mAtEffort / effortBandOf: blank curve → 1; a band reads its M; 600 s is the trial's band", () => {
  assertEquals(mAtEffort(null, 300), 1);
  near(mAtEffort(athleteCurve([[240, 600, 0.82]]), 400), 0.82, 0.02);
  assertEquals(effortBandOf(600), "10–20 min");
  assertEquals(effortBandOf(2400), "zone 2 (40 min+)");
});

import { dayTargets, previousFromSnapshot } from "./engine-targets.ts";
const DAY = (id: string, extra: Record<number, Partial<TargetBlockParams>> = {}) => {
  const t = TYPES.find((x) => x.id === id)! as unknown as { block_count: number; block_1_params: TargetBlockParams | null; block_2_params: TargetBlockParams | null; block_3_params: TargetBlockParams | null; block_4_params: TargetBlockParams | null; max_duration_minutes: number | null };
  const b = (n: number, p: TargetBlockParams | null) => (p ? { ...p, ...(extra[n] ?? {}) } : null);
  // concrete values where the envelope is a range (the day page gets concrete catalogue days)
  const concrete = (p: TargetBlockParams | null): TargetBlockParams | null => {
    if (!p) return null;
    const out: TargetBlockParams = { ...p };
    for (const k of ["rounds", "workDuration", "baseDuration", "fluxDuration"]) if (Array.isArray(out[k])) out[k] = (out[k] as number[])[1];
    return out;
  };
  return { day_number: 0, day_type: id, phase: null, month: null, block_count: t.block_count, set_rest_seconds: null, block_1_params: concrete(b(1, t.block_1_params)), block_2_params: concrete(b(2, t.block_2_params)), block_3_params: concrete(b(3, t.block_3_params)), block_4_params: concrete(b(4, t.block_4_params)), total_duration_minutes: t.max_duration_minutes };
};
const BASE = { trialPace: 18.4, machineCurve: ECHO_BIKE_CAL_CURVE_V1, kEffort: 1, athleteCurve: null, rollingRatio: 1.04, isGenerated: false };

Deno.test("dayTargets: MAP day — both formulas per segment; legacy 0.95 × 1.04, curve from the share; weighted fractions", () => {
  const d = dayTargets(DAY("max_aerobic_power", { 1: { intensityShare: [0.72, 0.82] } }), BASE);
  assertEquals(d.blocks.length, 1);
  assertEquals(d.blocks[0].rounds, 10);
  assertEquals(d.blocks[0].segments.length, 10);
  near(d.legacy_fraction!, 0.95 * 1.04, 1e-9);
  const s = d.blocks[0].segments[0];
  assertEquals(s.curve.basis, "curve");
  near(s.curve.share!, 0.77, 1e-9);
  near(s.curve.p_balanced!, 1.10, 0.01); // 300-s intervals
});

Deno.test("dayTargets: hybrid anaerobic (2 blocks) targets both blocks; polarized day is authored base + untargeted bursts", () => {
  const h = dayTargets(DAY("hybrid_anaerobic", { 1: { intensityShare: [0.68, 0.78] }, 2: { intensityShare: [0.68, 0.78] } }), BASE);
  assertEquals(h.blocks.map((b) => b.block_index), [0, 1]);
  assert(h.blocks.every((b) => b.segments.every((s) => s.curve.basis === "curve")));
  const p = dayTargets(DAY("polarized"), BASE);
  const bases = new Set(p.blocks[0].segments.map((s) => s.curve.basis));
  assertEquals(bases, new Set(["authored", "max_effort"]));
  near(p.curve_fraction!, 0.70, 1e-9); // bursts carry no fraction
});

Deno.test("dayTargets: the weekly cap reads the previous snapshot per band and binds only that band", () => {
  const first = dayTargets(DAY("max_aerobic_power", { 1: { intensityShare: [0.72, 0.82] } }), BASE);
  const snap = { trial: { pace: 18.4 }, blocks: first.blocks.map((b) => b.segments.map((s) => ({ ...s.curve, target_pace: s.curve.target_pace! * 0.9 }))) };
  const prev = previousFromSnapshot(snap);
  assert(Object.keys(prev).length === 1, JSON.stringify(prev));
  const second = dayTargets(DAY("max_aerobic_power", { 1: { intensityShare: [0.72, 0.82] } }), BASE, prev);
  const s = second.blocks[0].segments[0];
  assert(s.curve.capped);
  near(s.curve.target_pace!, first.blocks[0].segments[0].curve.target_pace! * 0.9 * 1.05, 1e-6);
  // a retest (different trial pace in the snapshot) lifts it
  const lifted = dayTargets(DAY("max_aerobic_power", { 1: { intensityShare: [0.72, 0.82] } }), BASE, previousFromSnapshot({ ...snap, trial: { pace: 17.0 } }));
  assert(!lifted.blocks[0].segments[0].curve.capped);
});
