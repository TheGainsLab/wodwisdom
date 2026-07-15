import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';
import { TIMELINE_GROUPS, TimelineRow, eventColor, type TimelineEvent } from '../components/admin/timelineEvents';

// ── Page ─────────────────────────────────────────────────────────────
//
// Full activity feed for one user: every event the admin_user_timeline RPC
// unions (account, profile, evaluations, chat, engine, workouts, nutrition,
// programs, entitlements, email), newest first, keyset-paginated on event_at.
// Note: this reflects content-producing writes only — logins/browsing are not
// instrumented, so gaps mean "wrote nothing", not necessarily "wasn't here".

const LIMIT = 40;

export default function AdminUserTimelinePage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const group = searchParams.get('group') || 'all';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [hasMore, setHasMore] = useState(false);
  // Keyset cursor: event_at of the last row, null = first page.
  const [before, setBefore] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setError('');
      const types = group === 'all'
        ? null
        : TIMELINE_GROUPS.find((g) => g.key === group)?.types ?? null;
      const { data, error: err } = await supabase.rpc('admin_user_timeline', {
        target_user_id: id,
        p_limit: LIMIT,
        p_before: before,
        p_types: types,
      });
      if (err) setError(err.message);
      else if (data) {
        if (before === null) setEvents(data.events ?? []);
        else setEvents((prev) => [...prev, ...(data.events ?? [])]);
        setCounts(data.counts ?? {});
        setHasMore(!!data.has_more);
      }
      setLoading(false);
    })();
  }, [id, group, before]);

  function setGroup(key: string) {
    const next = new URLSearchParams(searchParams);
    if (key === 'all') next.delete('group');
    else next.set('group', key);
    setSearchParams(next, { replace: true });
    setBefore(null);
  }

  const groupCount = (key: string) =>
    TIMELINE_GROUPS.find((g) => g.key === key)!.types.reduce((n, t) => n + (counts[t] ?? 0), 0);
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Activity Timeline">
      {/* Group filter chips with counts */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        <GroupChip label={`All (${totalCount})`} active={group === 'all'} onClick={() => setGroup('all')} />
        {TIMELINE_GROUPS.map((g) => {
          const n = groupCount(g.key);
          if (n === 0) return null;
          return (
            <GroupChip
              key={g.key}
              label={`${g.label} (${n})`}
              active={group === g.key}
              dot={eventColor(g.types[0])}
              onClick={() => setGroup(g.key)}
            />
          );
        })}
      </div>

      {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

      {loading && before === null && <div className="page-loading"><div className="loading-pulse" /></div>}

      {!loading && events.length === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          No activity recorded{group !== 'all' ? ' for this filter' : ' yet'}.
        </div>
      )}

      {events.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '4px 16px' }}>
          {events.map((ev, i) => (
            <TimelineRow key={`${ev.type}-${ev.event_at}-${i}`} ev={ev} userId={id!} onNavigate={navigate} />
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
    </AdminSubPageLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function GroupChip({ label, active, dot, onClick }: { label: string; active: boolean; dot?: string; onClick: () => void }) {
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
