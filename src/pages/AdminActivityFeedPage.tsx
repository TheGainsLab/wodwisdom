import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import {
  TIMELINE_GROUPS, eventColor, eventTitle, eventDetail, eventLink, formatEventTime,
  type TimelineEvent,
} from '../components/admin/timelineEvents';

// ── Page ─────────────────────────────────────────────────────────────
//
// Cross-user activity feed (/admin/activity): every event from every user
// over the last N days (admin_activity_feed RPC, window clamped server-side
// to 1–30 days), newest first, with the acting user on each row. Same event
// vocabulary and deep links as the per-user timeline; the user chip jumps to
// that user's detail page.

interface FeedEvent extends TimelineEvent {
  user_id: string;
  user_name: string | null;
  user_email: string | null;
}

const LIMIT = 50;
const DAY_OPTIONS = [1, 3, 5, 7] as const;

export default function AdminActivityFeedPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const days = parseInt(searchParams.get('days') || '3', 10) || 3;
  const group = searchParams.get('group') || 'all';

  const [navOpen, setNavOpen] = useState(false);
  const [adminCheck, setAdminCheck] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [activeUsers, setActiveUsers] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [before, setBefore] = useState<string | null>(null);

  // Admin gate (mirrors AdminRatingsPage)
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
      const types = group === 'all'
        ? null
        : TIMELINE_GROUPS.find((g) => g.key === group)?.types ?? null;
      const { data, error: err } = await supabase.rpc('admin_activity_feed', {
        p_days: days,
        p_limit: LIMIT,
        p_before: before,
        p_types: types,
      });
      if (err) setError(err.message);
      else if (data) {
        if (before === null) setEvents(data.events ?? []);
        else setEvents((prev) => [...prev, ...(data.events ?? [])]);
        setCounts(data.counts ?? {});
        setActiveUsers(data.active_users ?? 0);
        setHasMore(!!data.has_more);
      }
      setLoading(false);
    })();
  }, [adminCheck, days, group, before]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
    setBefore(null);
  }

  const groupCount = (key: string) =>
    TIMELINE_GROUPS.find((g) => g.key === key)!.types.reduce((n, t) => n + (counts[t] ?? 0), 0);
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Activity Feed</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <button
              onClick={() => navigate('/admin')}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, fontFamily: "'Outfit', sans-serif", padding: '4px 0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              Back to Admin
            </button>

            {adminCheck === 'denied' && (
              <div className="auth-error" style={{ display: 'block' }}>Not authorized.</div>
            )}

            {adminCheck === 'allowed' && (
              <>
                {/* Window + summary */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {DAY_OPTIONS.map((d) => (
                      <button
                        key={d}
                        onClick={() => setParam('days', d === 3 ? null : String(d))}
                        style={{
                          background: days === d ? 'var(--accent-glow)' : 'var(--surface)',
                          border: '1px solid var(--border)',
                          color: days === d ? 'var(--accent)' : 'var(--text-dim)',
                          padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                          fontFamily: "'Outfit', sans-serif", fontWeight: 500,
                        }}
                      >
                        {d === 1 ? 'Today' : `${d} days`}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {totalCount} events · {activeUsers} active {activeUsers === 1 ? 'user' : 'users'}
                  </span>
                </div>

                {/* Category chips */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
                  <Chip label={`All (${totalCount})`} active={group === 'all'} onClick={() => setParam('group', null)} />
                  {TIMELINE_GROUPS.map((g) => {
                    const n = groupCount(g.key);
                    if (n === 0) return null;
                    return (
                      <Chip
                        key={g.key}
                        label={`${g.label} (${n})`}
                        active={group === g.key}
                        dot={eventColor(g.types[0])}
                        onClick={() => setParam('group', g.key)}
                      />
                    );
                  })}
                </div>

                {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

                {loading && before === null && <div className="page-loading"><div className="loading-pulse" /></div>}

                {!loading && events.length === 0 && (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No activity in this window.
                  </div>
                )}

                {events.length > 0 && (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '4px 16px' }}>
                    {events.map((ev, i) => (
                      <FeedRow key={`${ev.type}-${ev.event_at}-${ev.user_id}-${i}`} ev={ev} onNavigate={navigate} />
                    ))}
                  </div>
                )}

                {hasMore && events.length > 0 && (
                  <button
                    onClick={() => setBefore(events[events.length - 1].event_at)}
                    disabled={loading}
                    style={{
                      display: 'block', margin: '16px auto', padding: '8px 20px',
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer',
                      fontFamily: "'Outfit', sans-serif",
                    }}
                  >
                    {loading ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function FeedRow({ ev, onNavigate }: { ev: FeedEvent; onNavigate: (path: string) => void }) {
  const link = eventLink(ev, ev.user_id);
  const detail = eventDetail(ev);
  const who = ev.user_name || ev.user_email || 'Unknown user';

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: eventColor(ev.type), marginTop: 6 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => onNavigate(`/admin/users/${ev.user_id}`)}
            title={ev.user_email ?? undefined}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: 13, fontWeight: 700, color: 'var(--accent)', fontFamily: 'inherit',
            }}
          >
            {who}
          </button>
          {link ? (
            <button
              onClick={() => onNavigate(link)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: 'var(--text)', fontWeight: 500, fontFamily: 'inherit', textAlign: 'left' }}
            >
              {eventTitle(ev)}
            </button>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{eventTitle(ev)}</span>
          )}
        </div>
        {detail && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {detail}
          </div>
        )}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>
        {formatEventTime(ev.event_at)}
      </span>
    </div>
  );
}

function Chip({ label, active, dot, onClick }: { label: string; active: boolean; dot?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: active ? 'var(--accent-glow)' : 'var(--surface)',
        border: '1px solid var(--border)',
        color: active ? 'var(--accent)' : 'var(--text-dim)',
        padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
        fontFamily: "'Outfit', sans-serif", fontWeight: 500,
      }}
    >
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />}
      {label}
    </button>
  );
}
