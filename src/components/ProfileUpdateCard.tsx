/**
 * The chat → profile Apply card. The coach proposed a profile diff
 * (days/week, goal addition, injuries); this renders the exact change with
 * Apply / Not now. Nothing changes unless the athlete taps Apply — the tap
 * resolves through the apply-profile-update fn against the logged proposal.
 * Shared by the main AI Coach chat and the day-scoped coach.
 */

export interface ProfileProposalData {
  proposal_id: string;
  rationale: string;
  current: { days_per_week: number | null; goal: string | null; injuries_constraints: string | null };
  proposal: { days_per_week?: number; goal_append?: string; injuries_replace?: string };
}

export type ProfileCardStatus = 'pending' | 'applying' | 'applied' | 'declined' | 'error';

export default function ProfileUpdateCard({ data, status, onResolve }: {
  data: ProfileProposalData;
  status: ProfileCardStatus;
  onResolve: (action: 'apply' | 'decline') => void;
}) {
  const p = data.proposal;
  const c = data.current;
  const done = status === 'applied' || status === 'declined';
  return (
    <div style={{
      border: '1px solid var(--accent)', borderRadius: 12, background: 'var(--surface)',
      padding: '14px 16px', margin: '6px 0', opacity: status === 'declined' ? 0.6 : 1,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8 }}>
        Update your profile?
      </div>
      {data.rationale && (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 10px', lineHeight: 1.5 }}>{data.rationale}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5, lineHeight: 1.5 }}>
        {p.days_per_week !== undefined && (
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Training days/week: </span>
            <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{c.days_per_week ?? '—'}</span>
            <span style={{ fontWeight: 700 }}> → {p.days_per_week}</span>
          </div>
        )}
        {p.goal_append && (
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Adding to your goals:</span>
            <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10, marginTop: 4, color: 'var(--text)' }}>
              {p.goal_append}
            </div>
          </div>
        )}
        {p.injuries_replace && (
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Injuries / constraints becomes:</span>
            <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10, marginTop: 4, color: 'var(--text)' }}>
              {p.injuries_replace}
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        {done ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: status === 'applied' ? '#2ec486' : 'var(--text-muted)' }}>
            {status === 'applied' ? '✓ Applied — your next month builds from this' : 'Kept as-is'}
          </span>
        ) : (
          <>
            <button
              onClick={() => onResolve('apply')}
              disabled={status === 'applying'}
              style={{
                background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
                padding: '8px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {status === 'applying' ? 'Applying…' : 'Apply'}
            </button>
            <button
              onClick={() => onResolve('decline')}
              disabled={status === 'applying'}
              style={{
                background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 16px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Not now
            </button>
            {status === 'error' && <span style={{ fontSize: 12.5, color: 'var(--accent)' }}>Failed — try again</span>}
          </>
        )}
      </div>
    </div>
  );
}
