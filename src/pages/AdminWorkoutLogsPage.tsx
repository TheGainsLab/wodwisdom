import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

// ── Types ────────────────────────────────────────────────────────────

interface LogRow {
  id: string;
  workout_date: string;
  workout_type: string;
  workout_text: string;
  source_type: string;
  source_id: string | null;
  status: string;
  created_at: string;
  block_count: number;
  block_types: string[] | null;
  top_score: string | null;
  entry_summary: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

function humanize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminWorkoutLogsPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const sourceType = searchParams.get('source_type') || '';
  const blockType = searchParams.get('block_type') || '';
  const since = searchParams.get('since') || 'all'; // 'all' | '7d' | '30d'

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [totals, setTotals] = useState<{ total_logs: number; logs_7d: number; logs_30d: number } | null>(null);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [filterOptions, setFilterOptions] = useState<{ source_types: string[]; block_types: string[] }>({ source_types: [], block_types: [] });
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;

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
      const { data, error: err } = await supabase.rpc('admin_list_workout_logs', {
        target_user_id: id,
        p_limit: LIMIT,
        p_offset: offset,
        p_source_type: sourceType || null,
        p_block_type: blockType || null,
        p_since: sinceIso,
      });
      if (err) setError(err.message);
      else if (data) {
        if (offset === 0) setLogs(data.logs ?? []);
        else setLogs(prev => [...prev, ...(data.logs ?? [])]);
        setTotals(data.totals);
        setTotalFiltered(data.total_filtered ?? 0);
        setFilterOptions(data.filter_options ?? { source_types: [], block_types: [] });
      }
      setLoading(false);
    })();
  }, [id, sourceType, blockType, since, offset]);

  useEffect(() => { setOffset(0); }, [sourceType, blockType, since]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Training Log">
      {totals && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <Stat label="Total" value={totals.total_logs} />
          <Stat label="Last 7 Days" value={totals.logs_7d} />
          <Stat label="Last 30 Days" value={totals.logs_30d} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Select label="Source" value={sourceType} options={['', ...filterOptions.source_types]} onChange={v => setParam('source_type', v)} format={v => v ? humanize(v) : 'All'} />
        <Select label="Block" value={blockType} options={['', ...filterOptions.block_types]} onChange={v => setParam('block_type', v)} format={v => v ? humanize(v) : 'All'} />
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

      {!loading && logs.length === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          No workout logs match these filters.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {logs.map(l => (
          <button
            key={l.id}
            onClick={() => navigate(`/admin/users/${id}/workouts/${l.id}`)}
            style={{
              textAlign: 'left', cursor: 'pointer',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 14, fontFamily: "'Outfit', sans-serif",
              color: 'var(--text)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {formatShortDate(l.workout_date)}
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8, fontWeight: 400 }}>
                  · {humanize(l.workout_type)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {l.status === 'in_progress' && (
                  <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, background: 'var(--border)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 4 }}>
                    In Progress
                  </span>
                )}
                <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, background: 'var(--accent-glow)', color: 'var(--accent)', padding: '2px 6px', borderRadius: 4 }}>
                  {l.source_type}
                </span>
              </div>
            </div>
            {l.entry_summary && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
                {l.entry_summary}
              </div>
            )}
            {l.top_score && (
              <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
                Score: {l.top_score}
              </div>
            )}
            {(!l.entry_summary && l.workout_text) && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.workout_text}
              </div>
            )}
          </button>
        ))}
      </div>

      {logs.length < totalFiltered && (
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
          {loading ? 'Loading…' : `Load ${Math.min(LIMIT, totalFiltered - logs.length)} more`}
        </button>
      )}
    </AdminSubPageLayout>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

function Select({ label, value, options, onChange, format }: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void; format: (v: string) => string;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
      <span>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: "'Outfit', sans-serif",
        }}
      >
        {options.map(o => (
          <option key={o || '_all_'} value={o}>{format(o)}</option>
        ))}
      </select>
    </label>
  );
}
