/**
 * Tests for the pure rules of the Athlete Profile form (src/lib/profileFormRules).
 * Run: npm run test:calculators
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDaysPerWeek, DAYS_PER_WEEK_MESSAGE, draftFieldsToRestore, GOAL_BOX_MAX_CHARS,
  intakeSaveAction, sameEquipment, type DraftFields,
  generateOutcomeMessage, GENERATE_FAILED_MESSAGE, GENERATE_NOT_STARTED_MESSAGE, afterLostContact,
  freshEvaluationNote, generateReminder, FRESH_EVALUATION_NOTE, GENERATE_REMINDER, GENERATE_REMINDER_WITH_FRESH_EVALUATION,
} from '../src/lib/profileFormRules';

// ── Days per week ──────────────────────────────────────────────────────────

test('days per week: 2 to 6 and blank can be saved', () => {
  for (const n of [2, 3, 4, 5, 6]) assert.deepEqual(checkDaysPerWeek(String(n)), { value: n, error: null });
  assert.deepEqual(checkDaysPerWeek(''), { value: null, error: null });
  assert.deepEqual(checkDaysPerWeek('  4 '), { value: 4, error: null });
});

test('days per week: anything else is refused with a short message, never saved as typed', () => {
  for (const bad of ['0', '1', '7', '9', '12', '-3', '3.5', '4.0', '2e0', 'four', '45']) {
    assert.deepEqual(checkDaysPerWeek(bad), { value: null, error: DAYS_PER_WEEK_MESSAGE }, bad);
  }
});

// ── Goal box limit ─────────────────────────────────────────────────────────

test('the goal boxes accept as much as the coach and the Engine read (not 500)', () => {
  assert.equal(GOAL_BOX_MAX_CHARS, 4000);
});

// ── Signup answers ─────────────────────────────────────────────────────────

test('intake: an answer with text is extracted', () => {
  assert.equal(intakeSaveAction({ anything_else: 'I love chippers' }, {}), 'extract');
  // One answer cleared, a retired one still holding text: re-extract from what is left.
  assert.equal(intakeSaveAction({ anything_else: '', history: 'ten years of CrossFit' }, { anything_else: 'old', history: 'ten years of CrossFit' }), 'extract');
});

test('intake: every answer deleted while something is stored clears what is stored', () => {
  assert.equal(intakeSaveAction({ anything_else: '' }, { anything_else: 'I love chippers' }), 'clear');
  assert.equal(intakeSaveAction({ anything_else: '   ' }, { anything_else: 'I love chippers' }), 'clear');
  assert.equal(intakeSaveAction({}, { history: 'ten years' }), 'clear');
});

test('intake: nothing typed and nothing stored does nothing', () => {
  assert.equal(intakeSaveAction({}, {}), 'none');
  assert.equal(intakeSaveAction({ anything_else: '' }, null), 'none');
  assert.equal(intakeSaveAction({ anything_else: '' }, { anything_else: ' ' }), 'none');
});

// ── Draft vs a newer stored value ──────────────────────────────────────────

const STORED: DraftFields = { days: '4', len: '60', goal: 'Get strong', injuries: '', equipment: { rower: true, rings: true } };

test('draft: a field typed over the value still stored is restored', () => {
  const draft = { ...STORED, goal: 'Get strong and row faster', base: STORED };
  assert.deepEqual(draftFieldsToRestore(draft, STORED), { goal: 'Get strong and row faster' });
});

test('draft: a coach card applied after the draft was typed wins, field by field', () => {
  // Typed a goal and a days change, left without saving...
  const draft = { ...STORED, goal: 'Get strong and row faster', days: '5', base: STORED };
  // ...then applied a coach card that appended to the goal. Days were not touched by the card.
  const now = { ...STORED, goal: 'Get strong\n\nNov 2026: first muscle-up' };
  assert.deepEqual(draftFieldsToRestore(draft, now), { days: '5' });
});

test('draft: the same rule covers days, session length, injuries and equipment', () => {
  const draft = {
    days: '5', len: '90', goal: STORED.goal, injuries: 'sore elbow', equipment: { rower: true, rings: false }, base: STORED,
  };
  const now: DraftFields = { days: '3', len: '45', goal: STORED.goal, injuries: 'Left knee: no running', equipment: { rower: false, rings: true } };
  assert.deepEqual(draftFieldsToRestore(draft, now), {});
  // Nothing changed underneath: every typed field comes back.
  assert.deepEqual(draftFieldsToRestore(draft, STORED), { days: '5', len: '90', injuries: 'sore elbow', equipment: { rower: true, rings: false } });
});

test('draft: equipment is compared by its ticks, not by the order the keys come back in', () => {
  assert.equal(sameEquipment({ rower: true, rings: false }, { rings: false, rower: true }), true);
  assert.equal(sameEquipment({ rower: true }, { rower: false }), false);
  assert.equal(sameEquipment(null, {}), true);
  const draft = { equipment: { rower: true, rings: false }, base: { equipment: { rower: true, rings: true } } };
  // Stored record unchanged, keys in another order: still "typed over this", so restored.
  assert.deepEqual(draftFieldsToRestore(draft, { ...STORED, equipment: { rings: true, rower: true } }), { equipment: { rower: true, rings: false } });
  // A draft identical to what is stored restores nothing.
  assert.deepEqual(draftFieldsToRestore({ equipment: { rings: true, rower: true }, base: STORED }, STORED), {});
});

test('draft: one written before the base was recorded restores as it always did', () => {
  assert.deepEqual(draftFieldsToRestore({ goal: 'typed', days: '4' }, STORED), { goal: 'typed' });
});

// ── Before the first build ─────────────────────────────────────────────────
const newMember = { hasProgramming: true, hasProgram: false, hasEvaluation: true, evalCredits: 1 };

test('a new Programming member with an old evaluation is told a fresh one is available', () => {
  assert.equal(freshEvaluationNote(newMember), FRESH_EVALUATION_NOTE);
  assert.equal(generateReminder(newMember), GENERATE_REMINDER_WITH_FRESH_EVALUATION);
});

test('the fresh-evaluation note is not shown to a free member, a member with a program, or one with no credit', () => {
  assert.equal(freshEvaluationNote({ ...newMember, hasProgramming: false }), null);
  assert.equal(freshEvaluationNote({ ...newMember, hasProgram: true }), null);
  assert.equal(freshEvaluationNote({ ...newMember, evalCredits: 0 }), null);
  // Never ran one: the ordinary run card already asks them to; no "fresh" wording.
  assert.equal(freshEvaluationNote({ ...newMember, hasEvaluation: false }), null);
});

test('every member about to build their first program is reminded to review their profile', () => {
  assert.equal(generateReminder({ ...newMember, evalCredits: 0 }), GENERATE_REMINDER);
  assert.equal(generateReminder({ ...newMember, hasProgram: true }), null);
  assert.equal(generateReminder({ ...newMember, hasProgramming: false }), null);
});

// ── A first build that did not finish ──────────────────────────────────────
test('a failed build is described in plain words, and says the team was notified', () => {
  assert.equal(generateOutcomeMessage({ kind: 'failed' }), GENERATE_FAILED_MESSAGE);
  assert.match(GENERATE_FAILED_MESSAGE, /Tap Generate to try again/);
  assert.match(GENERATE_FAILED_MESSAGE, /team has been notified/);
});

test("a refusal the server worded for the member is shown as written", () => {
  assert.equal(generateOutcomeMessage({ kind: 'refused', code: 'EVALUATION_REQUIRED', message: 'Run your evaluation first — your new program is built from it.' }),
    'Run your evaluation first — your new program is built from it.');
});

test('any other refusal never shows internal text, and does not claim the team was notified', () => {
  const m = generateOutcomeMessage({ kind: 'refused', code: 'GENERATION_FAILED', message: 'TypeError: cannot read properties of undefined' });
  assert.equal(m, GENERATE_NOT_STARTED_MESSAGE);
  assert.doesNotMatch(m, /notified|TypeError/);
  assert.equal(generateOutcomeMessage({ kind: 'refused', message: '  ' }), GENERATE_NOT_STARTED_MESSAGE);
});

// ── The page lost contact with a build ─────────────────────────────────────
const lost = { hasProgram: false, jobStatus: 'processing', jobIsFresh: true, rewatches: 0 };

test('lost contact: a finished program is opened, whatever the job says', () => {
  assert.equal(afterLostContact({ ...lost, hasProgram: true }), 'go_to_program');
  assert.equal(afterLostContact({ ...lost, hasProgram: true, jobStatus: null }), 'go_to_program');
});

test('lost contact: a build that is still running keeps the button on Generating', () => {
  assert.equal(afterLostContact(lost), 'keep_watching');
});

test('lost contact: the member is told only when the build failed', () => {
  assert.equal(afterLostContact({ ...lost, jobStatus: 'failed' }), 'show_failed');
  // Unknown, gone quiet, or watched three times already: reset, say nothing.
  assert.equal(afterLostContact({ ...lost, jobStatus: null }), 'reset_quietly');
  assert.equal(afterLostContact({ ...lost, jobIsFresh: false }), 'reset_quietly');
  assert.equal(afterLostContact({ ...lost, rewatches: 3 }), 'reset_quietly');
});
