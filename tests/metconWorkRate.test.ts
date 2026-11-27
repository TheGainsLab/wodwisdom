import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findWorkRate, type MovementWorkRate } from '../src/lib/metconScoring';

// The movement list after the 2026-11-27 clean-up: one bike row, no Kipping Pull Up row.
const RATES: MovementWorkRate[] = [
  { canonical_name: 'bike', display_name: 'Air Bike', work_rate: 350, weight_degradation_rate: null, modality: 'M', aliases: ['Assault Bike', 'Bike', 'Biking', 'Echo Bike'] },
  { canonical_name: 'pull_up', display_name: 'Pull Up', work_rate: 18, weight_degradation_rate: null, modality: 'G', aliases: ['Kipping Pull Up', 'Kipping Pull-Up', 'Pull-up'] },
  { canonical_name: 'burpee', display_name: 'Burpee', work_rate: 15, weight_degradation_rate: null, modality: 'G', aliases: null },
];

test('a workout written with an old name still finds its rate through the alternate spellings', () => {
  for (const name of ['Assault Bike', 'Echo Bike', 'Bike', 'echo-bike', 'Air Bike']) {
    assert.equal(findWorkRate(name, RATES)?.work_rate, 350, name);
  }
  for (const name of ['Kipping Pull Up', 'Kipping Pull-Up', 'Pull Up', 'pull-up']) {
    assert.equal(findWorkRate(name, RATES)?.work_rate, 18, name);
  }
});

test('the main name and the stored key still match first, and an unknown or empty name matches nothing', () => {
  assert.equal(findWorkRate('burpee', RATES)?.canonical_name, 'burpee');
  assert.equal(findWorkRate('pull_up', RATES)?.canonical_name, 'pull_up');
  assert.equal(findWorkRate('Strict Pull Up', RATES), null);
  assert.equal(findWorkRate('', RATES), null);
  // Rows without alternate spellings (as the app loaded them before) still work.
  assert.equal(findWorkRate('Burpee', [{ canonical_name: 'burpee', display_name: 'Burpee', work_rate: 15, weight_degradation_rate: null, modality: 'G' }])?.work_rate, 15);
});
