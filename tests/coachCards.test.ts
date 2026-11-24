/**
 * Tests for the coach's cards in every chat (src/lib/coachCards).
 * Run: npm run test:calculators
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { noteProposalFromEvent, profileProposalFromEvent } from '../src/lib/coachCards';

const SRC = new URL('../src/', import.meta.url).pathname;
const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

test('every screen that talks to the coach shows BOTH cards', () => {
  // A screen talks to the coach when it posts to the chat endpoint.
  const screens = filesUnder(SRC).filter((f) => /fetch\(CHAT_ENDPOINT/.test(readFileSync(f, 'utf8')));
  assert.ok(screens.length >= 3, `expected the main chat and both day chats, found ${screens.length}`);
  for (const f of screens) {
    const src = readFileSync(f, 'utf8');
    const name = f.slice(SRC.length);
    assert.match(src, /'profile_proposal'|profileProposalFromEvent/, `${name} drops the profile card`);
    assert.match(src, /'note_proposal'|noteProposalFromEvent/, `${name} drops the note card`);
  }
});

test('a note card carries exactly the text and horizon the server sent', () => {
  assert.deepEqual(
    noteProposalFromEvent({ type: 'note_proposal', proposal_id: 'p1', text: 'Hotel gym next week, dumbbells only', horizon: 'next_week', rationale: 'You said so.' }),
    { proposal_id: 'p1', text: 'Hotel gym next week, dumbbells only', horizon: 'next_week', rationale: 'You said so.' },
  );
  assert.equal(noteProposalFromEvent({ type: 'note_proposal', proposal_id: 'p2', text: 'x', horizon: 'until_removed' })!.horizon, 'until_removed');
});

test('a profile card carries the whole proposal the server sent', () => {
  const proposal = { days_per_week: 4, session_length_minutes: 45, equipment_dont_have: ['rower'] };
  const card = profileProposalFromEvent({ type: 'profile_proposal', proposal_id: 'p3', rationale: 'r', current: { days_per_week: 5 }, proposal });
  assert.equal(card!.proposal_id, 'p3');
  assert.deepEqual(card!.proposal, proposal);
});

test('other events, and events with no id, are not cards', () => {
  for (const e of [null, undefined, { type: 'delta', text: 'hi' }, { type: 'note_proposal' }, { type: 'profile_proposal', proposal_id: '' }]) {
    assert.equal(noteProposalFromEvent(e as never), null);
    assert.equal(profileProposalFromEvent(e as never), null);
  }
});
