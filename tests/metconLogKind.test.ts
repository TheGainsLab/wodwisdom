/**
 * Tests for which result a metcon's logger asks for (src/lib/metconLogKind).
 * Run: npm run test:calculators
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { metconLogKind, METCON_LOG_FIELDS } from '../src/lib/metconLogKind';
import { SCHEME_FORMATS } from '../supabase/functions/_shared/v2-output-schema.ts';

test('a race against the clock asks for a time and offers the cap', () => {
  for (const f of ['for_time', 'rft']) {
    assert.equal(metconLogKind(f), 'time');
  }
  assert.equal(METCON_LOG_FIELDS.time.cap, true);
});

test('an AMRAP asks for rounds and reps, with no cap', () => {
  assert.equal(metconLogKind('amrap'), 'rounds_reps');
  assert.equal(METCON_LOG_FIELDS.rounds_reps.cap, false);
});

test('an interval piece is never asked for a finish time or a cap', () => {
  const fields = METCON_LOG_FIELDS[metconLogKind('intervals')];
  assert.equal(fields.cap, false);
  assert.equal(fields.scoreType, null);
  assert.doesNotMatch(fields.label, /time/i);
});

test('every format the writer can choose has a decided logger; only the two races get a cap', () => {
  for (const f of SCHEME_FORMATS) {
    const kind = metconLogKind(f);
    assert.ok(kind === 'time' || kind === 'rounds_reps' || kind === 'open', f);
    assert.equal(METCON_LOG_FIELDS[kind].cap, f === 'for_time' || f === 'rft', f);
  }
});

test('a block with no stored format assumes nothing', () => {
  assert.equal(metconLogKind(null), 'open');
  assert.equal(metconLogKind(undefined), 'open');
  assert.equal(metconLogKind('something new'), 'open');
});

test('the logger no longer reads the title to decide the fields', () => {
  const src = readFileSync(new URL('../src/components/blockLog.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /inferMetconType/);
  assert.match(src, /metconLogKind\(block\.scheme_format\?\.format\)/);
});
