import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatMarkdown } from '../lib/formatMarkdown';
import Nav from '../components/Nav';

// ── Types ────────────────────────────────────────────────────────────

interface RatedMessage {
  rating_id: string;
  rating: 1 | -1;
  rated_at: string;
  rated_updated_at: string;
  user_id: string;
  user_email: string | null;
  user_full_name: string | null;
  message_id: string;
  question: string | null;
  answer: string | null;
  context_type: string | null;
  context_id: string | null;
  message_created_at: string;
}

interface Totals {
  total: number;
  up: number;
  down: number;
}

type Filter = 'all' | 'up' | 'down';
type Sort = 'created_at' | 'rating' | 'user';

const LIMIT = 50;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminRatingsPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const filter = (searchParams.get('filter') as Filter) || 'all';
  const sort = (searchParams.get('sort') as Sort) || 'created_at';

  const [navOpen, setNavOpen] = useState(false);
  const [adminCheck, setAdminCheck] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<RatedMessage[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [offset, setOffset] = useState(0);
  const [expandedQ, setExpandedQ] = useState<Record<string, boolean>>({});
  const [expandedA, setExpandedA] = useState<Record<string, boolean>>({});

  // Admin gate
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

  // Load ratings
  useEffect(() => {
    if (adminCheck !== 'allowed') return;
    (async () => {
      setLoading(true);
      setError('');
      const { data, error: err } = await supabase.rpc('admin_list_rated_messages', {
        p_filter: filter,
        p_sort: sort,
        p_limit: LIMIT,
        p_offset: offset,
      });
      if (err) {
        setError(err.message);
      } else if (data) {
        const next: RatedMessage[] = data.ratings ?? [];
        if (offset === 0) setRows(next);
        else setRows(prev => [...prev, ...next]);
        setTotals(data.totals ?? null);
        setTotalFiltered(data.total_filtered ?? 0);
      }
      setLoading(false);
    })();
  }, [adminCheck, filter, sort, offset]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
    setOffset(0);
  }

  if (adminCheck === 'denied') {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <header className="page-header">
            <button className="menu-btn" onClick={() => setNavOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            <h1>Ratings</h1>
          </header>
          <div className="page-body">
            <div className="empty-state"><p>Access denied. Admin role required.</p></div>
          </div>
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
          <h1>Chat Ratings</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <button
              onClick={() => navigate('/admin')}
              style={{
                background: 'none', border: 'none', color: 'var(--text-dim)',
                cursor: 'pointer', fontSize: 14, fontFamily: "'Outfit', sans-serif",
                padding: '4px 0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              Back to Admin
            </button>

            {/* Totals */}
            {totals && (
              <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                <Stat label="Total Ratings" value={totals.total} />
                <Stat label="👍 Up" value={totals.up} color="#2ec486" />
                <Stat label="👎 Down" value={totals.down} color="#e74c3c" />
              </div>
            )}

            {/* Filter chips */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Filter</span>
              {(['all', 'up', 'down'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setParam('filter', f === 'all' ? null : f)}
                  style={{
                    background: filter === f ? 'var(--accent-glow)' : 'var(--surface)',
                    border: '1px solid var(--border)',
                    color: filter === f ? 'var(--accent)' : 'var(--text-dim)',
                    padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    fontFamily: "'Outfit', sans-serif", fontWeight: 500,
                  }}
                >
                  {f === 'all' ? 'All' : f === 'up' ? '👍 Up only' : '👎 Down only'}
                </button>
              ))}
            </div>

            {/* Sort chips */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Sort</span>
              {(['created_at', 'rating', 'user'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setParam('sort', s === 'created_at' ? null : s)}
                  style={{
                    background: sort === s ? 'var(--accent-glow)' : 'var(--surface)',
                    border: '1px solid var(--border)',
                    color: sort === s ? 'var(--accent)' : 'var(--text-dim)',
                    padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    fontFamily: "'Outfit', sans-serif", fontWeight: 500,
                  }}
                >
                  {s === 'created_at' ? 'Newest' : s === 'rating' ? 'Rating (👎 first)' : 'User'}
                </button>
              ))}
            </div>

            {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

            {loading && offset === 0 && <div className="page-loading"><div className="loading-pulse" /></div>}

            {!loading && rows.length === 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                No ratings yet.
              </div>
            )}

            {/* Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rows.map(r => {
                const qOpen = !!expandedQ[r.rating_id];
                const aOpen = !!expandedA[r.rating_id];
                return (
                  <div key={r.rating_id} style={{
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 12, padding: 16,
                  }}>
                    {/* Top row: timestamp + rating + user + context */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {formatDateTime(r.rated_at)}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {r.rating === 1 ? (
                          <ThumbsUp size={14} fill="#2ec486" stroke="#2ec486" strokeWidth={2} />
                        ) : (
                          <ThumbsDown size={14} fill="#e74c3c" stroke="#e74c3c" strokeWidth={2} />
                        )}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {r.user_email || r.user_id}
                      </span>
                      {r.context_type && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                          color: 'var(--text-dim)', background: 'var(--border)',
                          padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap',
                        }}>
                          {r.context_type}
                        </span>
                      )}
                    </div>

                    {/* Question */}
                    {r.question && (
                      <div style={{ marginBottom: 12 }}>
                        <button
                          onClick={() => setExpandedQ(prev => ({ ...prev, [r.rating_id]: !qOpen }))}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
                            textTransform: 'uppercase', letterSpacing: 0.5, padding: 0, marginBottom: 4,
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          {qOpen ? '▾' : '▸'} Question
                        </button>
                        <div style={{
                          fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap',
                          ...(qOpen ? {} : {
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }),
                        }}>
                          {r.question}
                        </div>
                      </div>
                    )}

                    {/* Answer */}
                    {r.answer && (
                      <div>
                        <button
                          onClick={() => setExpandedA(prev => ({ ...prev, [r.rating_id]: !aOpen }))}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--accent)', fontSize: 11, fontWeight: 600,
                            textTransform: 'uppercase', letterSpacing: 0.5, padding: 0, marginBottom: 4,
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          {aOpen ? '▾' : '▸'} Answer
                        </button>
                        {aOpen ? (
                          <div
                            className="workout-review-content"
                            style={{ fontSize: 14 }}
                            dangerouslySetInnerHTML={{ __html: formatMarkdown(r.answer) }}
                          />
                        ) : (
                          <div style={{
                            fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}>
                            {r.answer}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {rows.length < totalFiltered && (
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={loading}
                style={{
                  display: 'block', margin: '16px auto', padding: '8px 20px',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer',
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                {loading ? 'Loading…' : `Load ${Math.min(LIMIT, totalFiltered - rows.length)} more`}
              </button>
            )}

            <div style={{ height: 40 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: color || 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}
