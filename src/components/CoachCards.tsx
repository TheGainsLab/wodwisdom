/**
 * Self-contained coach cards: each one owns its own status and its own save,
 * so a chat screen only has to render it (see lib/coachCards.ts for why).
 *
 * What is saved is exactly what the card shows:
 *  - a note card saves its text and how long it applies;
 *  - a profile card applies the stored proposal it displays, by id, on the
 *    server (apply-profile-update), which writes every field in it.
 */
import { useState } from 'react';
import ProfileUpdateCard, { type ProfileProposalData, type ProfileCardStatus } from './ProfileUpdateCard';
import CoachNoteCard, { type NoteProposalData, type NoteCardStatus } from './CoachNoteCard';
import { addCoachNote } from '../lib/coachNotes';
import { APPLY_PROFILE_UPDATE_ENDPOINT, getAuthHeaders } from '../lib/supabase';

export function NoteCardHost({ data }: { data: NoteProposalData }) {
  const [status, setStatus] = useState<NoteCardStatus>('pending');
  return (
    <CoachNoteCard
      data={data}
      status={status}
      onResolve={async (action) => {
        if (action === 'decline') { setStatus('declined'); return; }
        setStatus('saving');
        try {
          await addCoachNote({ text: data.text, horizon: data.horizon, source: 'coach' });
          setStatus('saved');
        } catch {
          setStatus('error');
        }
      }}
    />
  );
}

export function ProfileCardHost({ data }: { data: ProfileProposalData }) {
  const [status, setStatus] = useState<ProfileCardStatus>('pending');
  const [effect, setEffect] = useState<string | undefined>(undefined);
  return (
    <ProfileUpdateCard
      data={data}
      status={status}
      effect={effect}
      onResolve={async (action) => {
        if (action === 'apply') setStatus('applying');
        try {
          const resp = await fetch(APPLY_PROFILE_UPDATE_ENDPOINT, {
            method: 'POST',
            headers: await getAuthHeaders(),
            body: JSON.stringify({ proposal_id: data.proposal_id, action }),
          });
          const body = await resp.json();
          if (!resp.ok) throw new Error(body?.error || `Failed (${resp.status})`);
          setEffect(typeof body?.effect === 'string' ? body.effect : undefined);
          setStatus(action === 'apply' ? 'applied' : 'declined');
        } catch {
          setStatus('error');
        }
      }}
    />
  );
}
