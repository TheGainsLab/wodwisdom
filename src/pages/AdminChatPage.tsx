import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { formatMarkdown } from '../lib/formatMarkdown';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

// ── Types ────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  user_id: string;
  question: string | null;
  answer: string | null;
  created_at: string;
  summary?: string | null;
  context_type?: string | null;
  context_id?: string | null;
  sources?: any;
  bookmarked?: boolean | null;
  [key: string]: any;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminChatPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const searchInput = searchParams.get('q') || '';
  const since = searchParams.get('since') || 'all'; // 'all' | '7d' | '30d'

  const [searchDraft, setSearchDraft] = useState(searchInput);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [totals, setTotals] = useState<{ total_messages: number; messages_7d: number; messages_30d: number } | null>(null);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const LIMIT = 20;

  // Load messages
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setError('');
      const sinceIso = since === '7d'
        ? new Date(Date.now() - 7 * 864e5).toISOString()
        : since === '30d'
        ? new Date(Date.now() - 30 * 864e5).toISOString()
        : null;
      const { data, error: err } = await supabase.rpc('admin_list_chat_messages', {
        target_user_id: id,
        p_limit: LIMIT,
        p_offset: offset,
        p_search: searchInput || null,
        p_since: sinceIso,
      });
      if (err) setError(err.message);
      else if (data) {
        if (offset === 0) setMessages(data.messages ?? []);
        else setMessages(prev => [...prev, ...(data.messages ?? [])]);
        setTotals(data.totals);
        setTotalFiltered(data.total_filtered ?? 0);
      }
      setLoading(false);
    })();
  }, [id, searchInput, since, offset]);

  // Reset pagination when filters change
  useEffect(() => { setOffset(0); }, [searchInput, since]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParam('q', searchDraft.trim() || null);
  }

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Chat Transcripts">
      {/* Totals */}
      {totals && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <Stat label="Total" value={totals.total_messages} />
          <Stat label="Last 7 Days" value={totals.messages_7d} />
          <Stat label="Last 30 Days" value={totals.messages_30d} />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <form onSubmit={handleSearchSubmit} style={{ flex: 1, minWidth: 200, display: 'flex', gap: 6 }}>
          <input
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
            placeholder="Search question or answer…"
            style={{
              flex: 1, background: 'var(--surface)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '8px 12px', fontSize: 13, fontFamily: "'Outfit', sans-serif",
            }}
          />
          <button
            type="submit"
            style={{
              background: 'var(--accent-glow)', color: 'var(--accent)',
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'Outfit', sans-serif",
            }}
          >
            Search
          </button>
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchDraft(''); setParam('q', null); }}
              style={{
                background: 'var(--surface)', color: 'var(--text-dim)',
                border: '1px solid var(--border)', borderRadius: 6,
                padding: '8px 12px', fontSize: 12, cursor: 'pointer',
                fontFamily: "'Outfit', sans-serif",
              }}
            >
              Clear
            </button>
          )}
        </form>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', '7d', '30d'] as const).map(r => (
            <button
              key={r}
              onClick={() => setParam('since', r === 'all' ? null : r)}
              style={{
                background: since === r ? 'var(--accent-glow)' : 'var(--surface)',
                border: '1px solid var(--border)',
                color: since === r ? 'var(--accent)' : 'var(--text-dim)',
                padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                fontFamily: "'Outfit', sans-serif", fontWeight: 500,
              }}
            >
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

      {loading && offset === 0 && <div className="page-loading"><div className="loading-pulse" /></div>}

      {!loading && messages.length === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          {searchInput ? 'No messages match this search.' : 'No chat messages yet.'}
        </div>
      )}

      {/* Message list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map(m => {
          const isExpanded = !!expanded[m.id];
          const hasContext = m.context_type || m.context_id || m.sources;
          return (
            <div key={m.id} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 16,
            }}>
              {/* Timestamp */}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                {formatDateTime(m.created_at)}
                {m.bookmarked && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>★ bookmarked</span>}
              </div>

              {/* User message */}
              {m.question && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                    User
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                    {m.question}
                  </div>
                </div>
              )}

              {/* AI response */}
              {m.answer && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                    Coach
                  </div>
                  <div
                    className="workout-review-content"
                    style={{ fontSize: 14 }}
                    dangerouslySetInnerHTML={{ __html: formatMarkdown(m.answer) }}
                  />
                </div>
              )}

              {/* Context expand */}
              {hasContext && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <button
                    onClick={() => setExpanded(prev => ({ ...prev, [m.id]: !isExpanded }))}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-dim)', fontSize: 11, fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: 0.5, padding: 0,
                    }}
                  >
                    {isExpanded ? '▾' : '▸'} Context {m.context_type ? `(${m.context_type})` : ''}
                  </button>

                  {isExpanded && (
                    <div style={{ marginTop: 8 }}>
                      {m.context_type && (
                        <Row label="Context Type" value={m.context_type} />
                      )}
                      {m.context_id && (
                        <Row label="Context ID" value={m.context_id} />
                      )}
                      {m.sources && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                            Sources
                          </div>
                          <pre style={{
                            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                            padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                            overflowX: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap',
                          }}>
                            {JSON.stringify(m.sources, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Summary (optional) */}
              {m.summary && (
                <div style={{
                  marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)',
                  fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic',
                }}>
                  Summary: {m.summary}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {messages.length < totalFiltered && (
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
          {loading ? 'Loading…' : `Load ${Math.min(LIMIT, totalFiltered - messages.length)} more`}
        </button>
      )}
    </AdminSubPageLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '4px 0', fontSize: 12,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-dim)' }}>{value ?? '—'}</span>
    </div>
  );
}
