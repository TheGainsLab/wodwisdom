// The Training Log sorts a logged entry onto a card by what the AI said the
// movement counts toward. The name is used only for an entry nobody labelled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIFT_CARD_OF, SKILL_CARD_OF, liftCardFor, skillCardFor } from '../src/lib/trainingLogCards.ts';
import { PROFILE_LIFT_KEYS, PROFILE_SKILL_KEYS } from '../supabase/functions/_shared/counts-toward.ts';

const page = readFileSync(new URL('../src/pages/TrainingLogPage.tsx', import.meta.url), 'utf8');
const never = () => { throw new Error('the name was read for a labelled entry'); };

test('every profile lift has a card that exists on the page', () => {
  assert.deepEqual(Object.keys(LIFT_CARD_OF).sort(), [...PROFILE_LIFT_KEYS].sort());
  for (const card of new Set(Object.values(LIFT_CARD_OF))) assert.ok(page.includes(`{ key: '${card}',`), `no lift card "${card}"`);
});

test('every profile skill has a card that exists on the page, except GHD sit-ups (Other Skills)', () => {
  assert.deepEqual([...Object.keys(SKILL_CARD_OF), 'ghd_sit_ups'].sort(), [...PROFILE_SKILL_KEYS].sort());
  for (const card of new Set(Object.values(SKILL_CARD_OF))) assert.ok(page.includes(`{ key: '${card}',`), `no skill card "${card}"`);
});

test('a labelled entry goes where the AI said, whatever it is called', () => {
  assert.equal(liftCardFor({ movement: 'Military Press', counts_toward: 'press' }, never), 'press');
  assert.equal(liftCardFor({ movement: 'Clean And Jerk', counts_toward: 'clean_and_jerk' }, never), 'clean_and_jerk');
  assert.equal(liftCardFor({ movement: 'Hang Power Snatch', counts_toward: 'power_snatch' }, never), 'snatch');
  // The old keyword sorter put these on the Snatch and Clean & Jerk cards.
  assert.equal(liftCardFor({ movement: 'Snatch Grip Deadlift', counts_toward: 'deadlift' }, never), 'deadlift');
  assert.equal(liftCardFor({ movement: 'Clean Pull', counts_toward: 'none' }, never), 'other');
  assert.equal(skillCardFor({ movement: 'Chest To Bar', counts_toward: 'chest_to_bar_pull_ups' }, never), 'pull_up');
  assert.equal(skillCardFor({ movement: 'Ring Muscle Up', counts_toward: 'muscle_ups' }, never), 'muscle_up');
  assert.equal(skillCardFor({ movement: 'Handstand Push Up', counts_toward: 'hspu' }, never), 'hspu');
  assert.equal(skillCardFor({ movement: 'Ghd Sit Up', counts_toward: 'ghd_sit_ups' }, never), 'other_skills');
  assert.equal(skillCardFor({ movement: 'Step Up', counts_toward: 'none' }, never), 'other_skills');
});

test('a lift label in a skills block, or a skill label in a strength block, is "other"', () => {
  assert.equal(liftCardFor({ movement: 'Pull Up', counts_toward: 'kipping_pull_ups' }, never), 'other');
  assert.equal(skillCardFor({ movement: 'Back Squat', counts_toward: 'back_squat' }, never), 'other_skills');
});

test('an entry nobody has labelled is sorted by name, as before', () => {
  assert.equal(liftCardFor({ movement: 'Back Squat' }, () => 'back_squat'), 'back_squat');
  assert.equal(liftCardFor({ movement: 'Back Squat', counts_toward: null }, () => 'back_squat'), 'back_squat');
  assert.equal(skillCardFor({ movement: 'Pull Up', counts_toward: 'not a key' }, () => 'pull_up'), 'pull_up');
});

test('the page sorts with these functions and loads the label on its own', () => {
  assert.ok(page.includes('liftCardFor(e, classifyLift)'));
  assert.ok(page.includes('skillCardFor(e, classifySkill)'));
  // The main entries query must not name the new column: the page has to load before the migration runs.
  const mainSelect = page.match(/\.select\('id, log_id, movement,[^']*'\)/)?.[0] ?? '';
  assert.ok(mainSelect.length > 0 && !mainSelect.includes('counts_toward'));
});
