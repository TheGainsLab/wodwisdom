/**
 * Tests for what the Athlete Profile page says after a save (src/lib/profileSaveEffect).
 * Run: npm run test:calculators
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedBySave, saveEffectNotes, NO_SAVE_EFFECT } from '../src/lib/profileSaveEffect';
import { describeEffect } from '../supabase/functions/_shared/profile-effect-text.ts';

const base = { days: '5', len: '60', goal: 'Get strong', injuries: '', equipment: { barbell: true, rower: true } };
const weekly = { weekly: true, outlineWeeksLeft: 2 };
const none = { days: false, session: false, goal: false, injuries: false, equipment: false };

test('a save is compared with what was stored: only real changes count', () => {
  assert.deepEqual(changedBySave(base, { ...base }), none);
  assert.deepEqual(changedBySave(base, { ...base, days: '4' }), { ...none, days: true });
  assert.deepEqual(changedBySave(base, { ...base, len: '45', goal: 'Get strong ' }), { ...none, session: true });
  assert.deepEqual(changedBySave(base, { ...base, injuries: 'No running' }), { ...none, injuries: true });
  // Same ticks in another key order is not a change.
  assert.deepEqual(changedBySave(base, { ...base, equipment: { rower: true, barbell: true } }), none);
  assert.deepEqual(changedBySave(base, { ...base, equipment: { barbell: true, rower: false } }), { ...none, equipment: true });
  // A never-reviewed checklist saved with everything ticked changes nothing the generator reads.
  assert.deepEqual(changedBySave({ ...base, equipment: {} }, base), none);
});

test('no program yet: nothing is shown', () => {
  assert.deepEqual(saveEffectNotes({ ...none, days: true, injuries: true, equipment: true }, null), NO_SAVE_EFFECT);
});

test('nothing changed: nothing is shown, even with a program', () => {
  assert.deepEqual(saveEffectNotes(none, weekly), NO_SAVE_EFFECT);
});

test('days or session length: the unwritten weeks are re-planned, written weeks stay', () => {
  const n = saveEffectNotes({ ...none, days: true }, weekly);
  assert.deepEqual(n.schedule, ["The weeks of this month that aren't written yet are re-planned from it when your next week is written. Weeks already written stay as they are."]);
  assert.deepEqual(n.coach, []); assert.deepEqual(n.equipment, []);
  assert.deepEqual(saveEffectNotes({ ...none, session: true }, weekly).schedule, n.schedule);
});

test('goal and injury note sit under the coach card, in the page voice', () => {
  const n = saveEffectNotes({ ...none, goal: true, injuries: true }, weekly);
  assert.equal(n.coach.length, 2);
  assert.match(n.coach[0], /re-planned from it when your next week is written/);
  assert.equal(n.coach[1], 'Every week written from now on is checked against it. Weeks already written stay as they are; to change one of those days, open it and ask the coach there.');
});

test('equipment: new weeks are written without what they lack', () => {
  assert.deepEqual(saveEffectNotes({ ...none, equipment: true }, weekly).equipment,
    ["New weeks are written without the equipment you don't have. Weeks already written stay as they are; to change one of those days, open it and ask the coach there."]);
});

test('a program with every week already written is told it applies from next month', () => {
  for (const program of [{ weekly: true, outlineWeeksLeft: 0 }, { weekly: false, outlineWeeksLeft: 0 }]) {
    assert.deepEqual(saveEffectNotes({ ...none, days: true }, program).schedule,
      ['It applies from your next month. Weeks already written stay as they are; to change one of those days, open it and ask the coach there.']);
  }
});

test('the page never says "ask me": that is the coach speaking', () => {
  const n = saveEffectNotes({ days: true, session: true, goal: true, injuries: true, equipment: true }, weekly);
  for (const line of [...n.schedule, ...n.coach, ...n.equipment]) assert.doesNotMatch(line, /ask me/);
  // …and the coach card still does.
  const facts = { hasProgramming: true, hasEngine: false, program: weekly, engineProgramChosen: false, engineSequencing: false };
  assert.match(describeEffect({ injuries: true }, facts).join(' '), /ask me there/);
});
