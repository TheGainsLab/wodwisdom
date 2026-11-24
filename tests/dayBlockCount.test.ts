/**
 * Tests for which blocks count toward a day being done.
 * Run: npm run test:calculators
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countsTowardDay, UNCOUNTED_BLOCK_TYPES_FILTER } from '../supabase/functions/_shared/day-block-count.ts';
import { BLOCK_TYPES } from '../supabase/functions/_shared/v2-output-schema.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('every block type that counts toward a day has a logger', () => {
  // The logger's own list, read from its source (the component cannot be imported here).
  const m = read('../src/components/blockLog.tsx').match(/const LOGGABLE_TYPES = \[([^\]]+)\]/);
  assert.ok(m, 'LOGGABLE_TYPES not found');
  const loggable = m![1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
  for (const t of BLOCK_TYPES) {
    if (countsTowardDay(t)) assert.ok(loggable.includes(t), `${t} counts toward the day but cannot be logged`);
  }
});

test('active-recovery, warm-up, mobility and cool-down do not count', () => {
  for (const t of ['active-recovery', 'warm-up', 'mobility', 'cool-down']) assert.equal(countsTowardDay(t), false);
  for (const t of ['strength', 'skills', 'accessory', 'metcon', 'cardio']) assert.equal(countsTowardDay(t), true);
  assert.equal(UNCOUNTED_BLOCK_TYPES_FILTER, '("warm-up","mobility","cool-down","active-recovery")');
});

test('the server and the program page both count with the shared list', () => {
  const server = read('../supabase/functions/save-workout-block/index.ts');
  assert.equal((server.match(/UNCOUNTED_BLOCK_TYPES_FILTER\)/g) ?? []).length, 2);
  assert.doesNotMatch(server, /"warm-up","mobility","cool-down"/);
  const page = read('../src/pages/ProgramDetailPage.tsx');
  assert.match(page, /SKIP_BLOCK_TYPES = UNCOUNTED_BLOCK_TYPES_FILTER/);
});
