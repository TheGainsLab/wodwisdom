import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

// ── Page ─────────────────────────────────────────────────────────────
//
// Outreach worklist (/admin/outreach): "Who needs an email?" — every account
// with no evaluation (admin_outreach_list RPC), unhandled first, newest
// signups first. Clicking a row opens that user's detail page with
// ?outreach=1 so the email composer's outreach tag is pre-checked; sending
// from there logs the tagged send, which both flips the row to handled here
// and permanently excludes the user from the automated eval-reminder sweep.
// Deliberately broader than the sweep: unconfirmed accounts are listed (with
// a badge) because a human can choose to email them; automation never will.

interface OutreachRow {
  user_id: string;
  email: string;
  full_name: string | null;
  signup_date: string;
  email_confirmed: boolean;
  stage: string;
  last_email_at: string | null;
  handled: boolean;
  handled_at: string | null;
}

/** Where each athlete actually stalled (admin_outreach_list's stage CASE),
 *  in funnel order — each stage maps to a different manual-email angle. */
const STAGES: { key: string; label: string; color: string }[] = [
  { key: 'no_activity', label: 'no activity', color: 'var(--text-muted)' },
  { key: 'started_basics', label: 'started basics', color: '#6ea8fe' },
  { key: 'needs_lifts', label: 'needs lifts', color: '#b389f0' },
  { key: 'needs_conditioning', label: 'needs conditioning', color: '#ff8c5a' },
  { key: 'eval_ready', label: 'eval ready', color: '#2ec486' },
];
const stageOf = (key: string) => STAGES.find((s) => s.key === key) ?? STAGES[0];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color, border: `1px solid ${color}`, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

export default function AdminOutreachPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [adminCheck, setAdminCheck] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<OutreachRow[]>([]);
  const [filter, setFilter] = useState('');
  const [showHandled, setShowHandled] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>('all');

  // Admin gate (mirrors AdminActivityFeedPage)
  useEffect(() => {
    (async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      setAdminCheck(profile?.role === 'admin' ? 'allowed' : 'denied');
    })();
  }, [session.user.id]);

  useEffect(() => {
    if (adminCheck !== 'allowed') return;
    (async () => {
      setLoading(true);
      setError('');
      const { data, error: err } = await supabase.rpc('admin_outreach_list');
      if (err) setError(err.message);
      else setRows((data as OutreachRow[] | null) ?? []);
      setLoading(false);
    })();
  }, [adminCheck]);

  const handledCount = useMemo(() => rows.filter((r) => r.handled).length, [rows]);
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.handled) continue;
      counts[r.stage] = (counts[r.stage] ?? 0) + 1;
    }
    return counts;
  }, [rows]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showHandled && r.handled) return false;
      if (stageFilter !== 'all' && r.stage !== stageFilter) return false;
      if (!q) return true;
      return r.email.toLowerCase().includes(q) || (r.full_name ?? '').toLowerCase().includes(q);
    });
  }, [rows, filter, showHandled, stageFilter]);

  if (adminCheck === 'denied') {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <div className="page-body" style={{ textAlign: 'center', paddingTop: 60, color: 'var(--text-dim)' }}>Not authorized.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Outreach</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <button
              onClick={() => navigate('/admin')}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, fontFamily: "'Outfit', sans-serif", padding: '4px 0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              ← Admin
            </button>

            <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Accounts that never ran their free evaluation. Click a row to open the user with the
              email composer's <strong style={{ color: 'var(--text)' }}>outreach tag pre-checked</strong> — sending
              marks them handled and the automated eval reminder skips them permanently.
            </p>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by email or name"
                style={{ flex: 1, minWidth: 200, padding: '9px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: "'Outfit', sans-serif", fontSize: 13 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                Show handled
              </label>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {rows.length - handledCount} to go · {handledCount} handled
              </span>
            </div>

            {/* Stage filter chips — work one stage at a time, one email angle per stage */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setStageFilter('all')}
                style={{
                  background: stageFilter === 'all' ? 'var(--accent-glow)' : 'var(--surface)',
                  color: stageFilter === 'all' ? 'var(--accent)' : 'var(--text-dim)',
                  border: `1px solid ${stageFilter === 'all' ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600,
                  fontFamily: "'Outfit', sans-serif", cursor: 'pointer',
                }}
              >
                all
              </button>
              {STAGES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStageFilter(stageFilter === s.key ? 'all' : s.key)}
                  style={{
                    background: stageFilter === s.key ? 'var(--accent-glow)' : 'var(--surface)',
                    color: s.color,
                    border: `1px solid ${stageFilter === s.key ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600,
                    fontFamily: "'Outfit', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {s.label} · {stageCounts[s.key] ?? 0}
                </button>
              ))}
            </div>

            {error && <div className="auth-error" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : visible.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 40, fontSize: 14 }}>
                {rows.length > 0 && !showHandled ? 'List drained — everyone is handled. 🎉' : 'No matching accounts.'}
              </div>
            ) : (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {visible.map((r) => (
                  <button
                    key={r.user_id}
                    type="button"
                    onClick={() => navigate(`/admin/users/${r.user_id}?outreach=1`)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                      background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
                      padding: '12px 16px', color: 'inherit', fontFamily: 'inherit',
                      opacity: r.handled ? 0.6 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{r.email}</span>
                        {r.full_name && <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>{r.full_name}</span>}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>signed up {fmtDate(r.signup_date)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                      {r.handled ? (
                        <Badge color="#2ec486">✓ handled {fmtDate(r.handled_at)}</Badge>
                      ) : (
                        <>
                          {!r.email_confirmed && <Badge color="#e8a33d">unconfirmed</Badge>}
                          <Badge color={stageOf(r.stage).color}>{stageOf(r.stage).label}</Badge>
                          {r.last_email_at && (
                            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>last emailed {fmtDate(r.last_email_at)}</span>
                          )}
                        </>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
