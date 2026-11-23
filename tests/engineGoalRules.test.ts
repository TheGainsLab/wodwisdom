/**
 * Tests for the Engine goal write rules (src/lib/engineGoalRules) and the
 * coach card's equipment lines (src/lib/profileCardLines).
 * Run: npm run test:calculators
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalToSaveOnProgramPick, goalWriteFor } from '../src/lib/engineGoalRules';
import { equipmentChangeLines } from '../src/lib/profileCardLines';

test('a typed goal is written to both columns (one goal)', () => {
  assert.deepEqual(goalWriteFor('  Row a 2k under 7:00 '), { engine_goal: 'Row a 2k under 7:00', goal: 'Row a 2k under 7:00' });
  assert.deepEqual(goalWriteFor('Sub-20 5k', { allowClear: true, hasProgramming: true }), { engine_goal: 'Sub-20 5k', goal: 'Sub-20 5k' });
});

test('blank from the setup or the switcher writes nothing', () => {
  assert.equal(goalWriteFor(''), null);
  assert.equal(goalWriteFor('   ', { hasProgramming: false }), null);
});

test('blank from the Engine dashboard clears the Engine goal', () => {
  // Engine-only member: one goal, cleared in both columns, as the profile page does.
  assert.deepEqual(goalWriteFor('', { allowClear: true, hasProgramming: false }), { engine_goal: null, goal: null });
  // A member with AI Programming keeps the profile goal their program is built from.
  assert.deepEqual(goalWriteFor('  ', { allowClear: true, hasProgramming: true }), { engine_goal: null });
  // Entitlements not known: never erase the profile goal on a guess.
  assert.deepEqual(goalWriteFor('', { allowClear: true }), { engine_goal: null });
});

test('program switch: an untouched goal box is not written back', () => {
  // The box still holds the goal loaded when the screen opened; the stored goal may have changed since.
  assert.equal(goalToSaveOnProgramPick('Row a 2k under 7:00', false), null);
  assert.equal(goalToSaveOnProgramPick('', false), null);
});

test('program switch: a goal edited in that screen is saved; edited to blank writes nothing', () => {
  assert.equal(goalToSaveOnProgramPick('Sub-20 5k', true), 'Sub-20 5k');
  assert.equal(goalToSaveOnProgramPick('   ', true), null);
});

test('card: each named equipment item shows what it was and what it becomes', () => {
  assert.deepEqual(
    equipmentChangeLines({ rower: true, ski_erg: false }, ['ski_erg'], ['rower', 'ghd']),
    [
      { key: 'ski_erg', was: "Don't have", now: 'Have' },
      { key: 'rower', was: 'Have', now: "Don't have" },
      // Never unticked (absent from the record) reads as owned, as the profile shows it.
      { key: 'ghd', was: 'Have', now: "Don't have" },
    ],
  );
  assert.deepEqual(equipmentChangeLines(null, undefined, undefined), []);
});
