// The Engine day's "Workout Details" rows are built once and used twice: the
// page draws them and the AI Coach is sent them. These tests hold the rows for
// each kind of session, and that the coach's lines are the screen's own text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBreakdown, breakdownLines, type BreakdownHelpers, type BreakdownParams } from '../src/lib/engineBreakdown.ts';

// The page's helpers, reduced: a baseline of 20 per minute, no rolling adjustment.
const BASELINE = 20;
const mid = (r: number[]) => (r[0] + r[1]) / 2;
const helpers: BreakdownHelpers<BreakdownParams & { basePace?: number[] }> = {
  resolveNum: (v, f = 0) => (typeof v === 'number' ? v : Array.isArray(v) ? v[0] : f),
  resolveRest: (r, w) => (typeof r === 'number' ? r : r === 'equal_to_work' ? w : 0),
  parseBurstTiming: () => 300,
  formatPace: (p) => (!p ? '' : p === 'max_effort' ? 'MAX' : Array.isArray(p) ? `${Math.round(p[0] * 100)}–${Math.round(p[1] * 100)}%` : String(p)),
  goalFor: (bp, dur, label, _b, _o, roundPace) => {
    const range = label === 'Flux' ? (bp.fluxPaceRange ?? bp.paceRange) : label === 'Base' ? (bp.basePace ?? bp.paceRange) : bp.paceRange;
    if (!Array.isArray(range)) return null;
    return Math.round(BASELINE * (roundPace ?? mid(range)) * (dur / 60) * 10) / 10;
  },
  fluxStageGoal: (_b, _o, dur, intensity) => Math.round(BASELINE * intensity * (dur / 60) * 10) / 10,
};
const fmt = { formatDuration: (s: number) => `${s}s`, goalText: (g: number, d: number) => `~${g} cal (${Math.round(g / (d / 60))} cal/min)` };
const rowsOf = (bp: BreakdownParams) => buildBreakdown([{ index: 0, bp }], helpers)[0].rows;

test('intervals: one row per round with rest between, each round its own target', () => {
  const rows = rowsOf({ rounds: 3, workDuration: 120, restDuration: 60, paceRange: [0.8, 0.9] });
  assert.deepEqual(rows.map((r) => r.label), ['R1', 'REST', 'R2', 'REST', 'R3']);
  assert.deepEqual(rows.filter((r) => r.kind === 'work').map((r) => r.goal), [34, 34, 34]);
});

test('rising rounds: every round has a different target (the single average hid this)', () => {
  const rows = rowsOf({ rounds: 3, workDuration: 60, restDuration: 60, paceRange: [0.7, 0.9], paceProgression: 'increasing' });
  assert.deepEqual(rows.filter((r) => r.kind === 'work').map((r) => r.goal), [14, 16, 18]);
});

test('flux: WORK and FLUX parts carry different targets', () => {
  const rows = rowsOf({ workProgression: 'alternating_paces', workDuration: 720, baseDuration: 300, fluxDuration: 60, paceRange: [0.7, 0.7], fluxPaceRange: [0.9, 0.9] });
  assert.deepEqual(rows.map((r) => r.label), ['WORK', 'FLUX', 'WORK', 'FLUX']);
  assert.deepEqual(rows.map((r) => r.goal), [70, 18, 70, 18]);
  assert.equal(rows[1].variant, 'flux');
});

test('flux stages: each FLUX part steps up', () => {
  const rows = rowsOf({ workProgression: 'progressive_flux_intensity', workDuration: 720, baseDuration: 300, fluxDuration: 60, paceRange: [0.7, 0.7], fluxStartIntensity: 0.8, fluxIncrement: 0.1 });
  assert.deepEqual(rows.filter((r) => r.label === 'FLUX').map((r) => r.goal), [16, 18]);
});

test('bursts are Max Effort with no number; a max-effort day has no number at all', () => {
  const polar = rowsOf({ workProgression: 'continuous_with_bursts', workDuration: 660, burstTiming: 'every_5_minutes', burstDuration: 30, paceRange: [0.7, 0.7] });
  assert.deepEqual(polar.map((r) => [r.label, r.goal, r.text]), [['BASE', 70, '70–70%'], ['BURST', null, 'Max Effort'], ['BASE', 70, '70–70%'], ['BURST', null, 'Max Effort']]);
  const max = rowsOf({ rounds: 2, workDuration: 30, restDuration: 120, paceRange: 'max_effort' });
  assert.deepEqual(max.filter((r) => r.kind === 'work').map((r) => [r.goal, r.text]), [[null, 'Max Effort'], [null, 'Max Effort']]);
});

test('continuous: one unbroken part', () => {
  const rows = rowsOf({ workProgression: 'continuous', rounds: 1, workDuration: 1200, paceRange: [0.7, 0.7] });
  assert.deepEqual(rows.map((r) => [r.label, r.durationSeconds, r.goal]), [['WORK', 1200, 280]]);
});

test("the coach's lines are the screen's rows, in order, with the screen's own wording", () => {
  const breakdown = buildBreakdown([
    { index: 0, bp: { rounds: 2, workDuration: 60, restDuration: 60, paceRange: [0.7, 0.9], paceProgression: 'increasing' } },
    { index: 1, bp: { rounds: 1, workDuration: 30, paceRange: 'max_effort' } },
  ], helpers);
  assert.deepEqual(breakdownLines(breakdown, { ...fmt, blockRestSeconds: 180 }), [
    'Block 1 R1 60s: ~14 cal (14 cal/min)',
    'Block 1 REST 60s',
    'Block 1 R2 60s: ~18 cal (18 cal/min)',
    'BLOCK REST 180s',
    'Block 2 R1 30s: Max Effort',
  ]);
  // One line per row: nothing shown is left out, nothing is added.
  assert.equal(breakdownLines(breakdown, fmt).length, breakdown.reduce((n, b) => n + b.rows.length, 0));
});

test('the day page draws from these rows and sends the same rows to the coach', () => {
  const page = readFileSync(new URL('../src/pages/EngineTrainingDayPage.tsx', import.meta.url), 'utf8');
  // Drawn from the shared rows…
  assert.ok(page.includes('const breakdown = breakdownFor(blocks);'));
  assert.ok(page.includes('{breakdown.map((block, blockArrayIdx) => {'));
  // …and no part's target is worked out inside the Workout Details markup any more.
  const details = page.slice(page.indexOf('className="engine-breakdown-toggle"'), page.indexOf('{/* Workout History'));
  assert.ok(details.includes('Workout Details') && details.includes('engine-breakdown-row'));
  assert.ok(!details.includes('goalFor('), 'Workout Details computes a target outside the shared rows');
  // Every way into the coach from the day page carries the screen's rows.
  const navs = page.match(/navigate\(`\/engine\/training\/\$\{dayNumber\}\/review`[^\n]*/g) ?? [];
  assert.equal(navs.length, 3);
  for (const n of navs) assert.ok(n.includes('screenTargets: workout ? screenTargetLines() : null'), n.slice(0, 80));
  // The lines are made with the page's own goal formatter, the one the row uses.
  assert.ok(page.includes('goalText: (goal, durationSeconds) => formatGoalWithPace(goal, durationSeconds, selectedUnit, modality)'));
  const review = readFileSync(new URL('../src/pages/EngineTrainingDayReviewPage.tsx', import.meta.url), 'utf8');
  assert.ok(review.includes('engine_screen_targets: screenTargets && screenTargets.length > 0 ? screenTargets : undefined'));
});

test('a time trial is saved per machine AND unit', () => {
  const svc = readFileSync(new URL('../src/lib/engineService.ts', import.meta.url), 'utf8');
  const save = svc.slice(svc.indexOf('export async function saveTimeTrial'), svc.indexOf('// ─── Modality preferences'));
  assert.ok(/\.eq\('modality', trial\.modality\)\s*\.eq\('units', trial\.units\)\s*\.eq\('is_current', true\)/.test(save));
});
