/**
 * The coach's cards, as the server sends them in ANY chat (2026-11-24).
 *
 * The server can send a profile-update card and a note card in every chat.
 * Only the main chat showed both: the program-day and workout-review chats
 * dropped the note card, and the Engine-day chat dropped both. The coach was
 * still told the card was "on the athlete's screen", so it asked members to
 * tap Save on a card that was not there, and nothing was saved.
 *
 * Every chat screen now reads the events with these two functions and shows
 * the cards with components/CoachCards.tsx. tests/coachCards.test.ts fails if
 * a screen that talks to the coach does not handle both.
 */
import type { ProfileProposalData } from '../components/ProfileUpdateCard';
import type { NoteProposalData } from '../components/CoachNoteCard';

type ChatEvent = Record<string, unknown> | null | undefined;

/** A `profile_proposal` event → the card's data, or null for any other event. */
export function profileProposalFromEvent(event: ChatEvent): ProfileProposalData | null {
  if (!event || event.type !== 'profile_proposal' || typeof event.proposal_id !== 'string' || !event.proposal_id) return null;
  return {
    proposal_id: event.proposal_id,
    rationale: typeof event.rationale === 'string' ? event.rationale : '',
    current: event.current as ProfileProposalData['current'],
    proposal: event.proposal as ProfileProposalData['proposal'],
  };
}

/** A `note_proposal` event → the card's data, or null for any other event. */
export function noteProposalFromEvent(event: ChatEvent): NoteProposalData | null {
  if (!event || event.type !== 'note_proposal' || typeof event.proposal_id !== 'string' || !event.proposal_id) return null;
  return {
    proposal_id: event.proposal_id,
    text: typeof event.text === 'string' ? event.text : '',
    horizon: event.horizon === 'until_removed' ? 'until_removed' : 'next_week',
    rationale: typeof event.rationale === 'string' ? event.rationale : '',
  };
}
