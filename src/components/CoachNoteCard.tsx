/**
 * The Coach's note card (founder, 2026-11-12): the AI drafts a "tell your
 * coach" note from conversation; the athlete taps Save or Not now. Nothing is
 * saved otherwise. Mirrors ProfileUpdateCard.
 */
export interface NoteProposalData {
  proposal_id: string;
  text: string;
  horizon: 'next_week' | 'until_removed';
  rationale: string;
}
export type NoteCardStatus = 'pending' | 'saving' | 'saved' | 'declined' | 'error';

export default function CoachNoteCard({ data, status, onResolve }: {
  data: NoteProposalData;
  status: NoteCardStatus;
  onResolve: (action: 'save' | 'decline') => void;
}) {
  const done = status === 'saved' || status === 'declined';
  return (
    <div style={{ border: '1px solid var(--accent)', borderRadius: 12, background: 'var(--surface)', padding: '14px 16px', margin: '6px 0', opacity: status === 'declined' ? 0.6 : 1 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8 }}>
        Note for your coach?
      </div>
      <div style={{ fontSize: 14, color: 'var(--text)', borderLeft: '2px solid var(--border)', paddingLeft: 10, marginBottom: 6 }}>
        {data.text}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        {data.horizon === 'until_removed' ? 'Until you remove it.' : 'For your next week.'} {data.rationale}
      </div>
      {done ? (
        <div style={{ fontSize: 12.5, color: status === 'saved' ? '#2ec486' : 'var(--text-muted)' }}>
          {status === 'saved' ? 'Saved — read before your next days are written.' : 'Not saved.'}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="auth-btn" onClick={() => onResolve('save')} disabled={status === 'saving'} style={{ padding: '8px 14px', fontSize: 13, width: 'auto' }}>
            {status === 'saving' ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => onResolve('decline')} disabled={status === 'saving'}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-dim)', cursor: 'pointer' }}>
            Not now
          </button>
          {status === 'error' && <span style={{ fontSize: 12, color: 'var(--accent)', alignSelf: 'center' }}>Could not save — try again.</span>}
        </div>
      )}
    </div>
  );
}
