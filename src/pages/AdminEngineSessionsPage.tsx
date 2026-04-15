import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

// ── Types ────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  date: string;
  created_at: string;
  program_day: number | null;
  program_day_number: number | null;
  day_type: string | null;
  modality: string | null;
  units: string | null;
  target_pace: number | null;
  actual_pace: number | null;
  total_output: number | null;
  performance_ratio: number | null;
  calculated_rpm: number | null;
  perceived_exertion: number | null;
  average_heart_rate: number | null;
  peak_heart_rate: number | null;
  completed: boolean;
  program_version: string | null;
}

interface TimeTrialRow {
  id: string;
  date: string;
  modality: string | null;
  total_output: number | null;
  calculated_rpm: number | null;
  units: string | null;
  is_current: boolean | null;
  created_at: string;
}

type Tab = 'sessions' | 'time-trials';

// ── Helpers ──────────────────────────────────────────────────────────

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs < 1) return value.toFixed(3);
  if (abs < 10) return value.toFixed(2);
  return value.toFixed(1);
}

function humanize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminEngineSessionsPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab: Tab = (searchParams.get('tab') as Tab) || 'sessions';
  const dayTypeFilter = searchParams.get('day_type') || '';
  const modalityFilter = searchParams.get('modality') || '';
  const sinceFilter = searchParams.get('since') || 'all'; // 'all' | '7d' | '30d'

  // Sessions state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [filterOptions, setFilterOptions] = useState<{ day_types: string[]; modalities: string[] }>({ day_types: [], modalities: [] });
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;

  // Time trials state
  const [tt, setTt] = useState<TimeTrialRow[] | null>(null);
  const [ttLoading, setTtLoading] = useState(false);

  // Load sessions
  useEffect(() => {
    if (!id || tab !== 'sessions') return;
    (async () => {
      setLoading(true);
      setError('');
      const since = sinceFilter === '7d'
        ? new Date(Date.now() - 7 * 864e5).toISOString()
        : sinceFilter === '30d'
        ? new Date(Date.now() - 30 * 864e5).toISOString()
        : null;
      const { data, error: err } = await supabase.rpc('admin_list_engine_sessions', {
        target_user_id: id,
        p_limit: LIMIT,
        p_offset: offset,
        p_day_type: dayTypeFilter || null,
        p_modality: modalityFilter || null,
        p_since: since,
      });
      if (err) setError(err.message);
      else if (data) {
        if (offset === 0) setSessions(data.sessions ?? []);
        else setSessions(prev => [...prev, ...(data.sessions ?? [])]);
        setTotals(data.totals);
        setFilterOptions(data.filter_options ?? { day_types: [], modalities: [] });
        setTotalFiltered(data.total_filtered ?? 0);
      }
      setLoading(false);
    })();
  }, [id, tab, dayTypeFilter, modalityFilter, sinceFilter, offset]);

  // Reset pagination whenever filters change
  useEffect(() => { setOffset(0); }, [dayTypeFilter, modalityFilter, sinceFilter]);

  // Load time trials on tab switch
  useEffect(() => {
    if (!id || tab !== 'time-trials' || tt !== null) return;
    (async () => {
      setTtLoading(true);
      const { data, error: err } = await supabase.rpc('admin_list_time_trials', { target_user_id: id });
      if (!err && Array.isArray(data)) setTt(data as TimeTrialRow[]);
      setTtLoading(false);
    })();
  }, [id, tab, tt]);

  // Sparkline data: oldest → newest for visual reading
  const sparkline = useMemo(() => {
    const vals = [...sessions]
      .filter(s => s.performance_ratio != null)
      .reverse()
      .map(s => s.performance_ratio!);
    return vals.slice(-40);
  }, [sessions]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Engine Sessions">
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {(['sessions', 'time-trials'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setParam('tab', t === 'sessions' ? null : t)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 16px', fontSize: 13, fontWeight: 600,
              color: tab === t ? 'var(--accent)' : 'var(--text-dim)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, fontFamily: "'Outfit', sans-serif",
            }}
          >
            {t === 'sessions' ? 'Sessions' : 'Time Trials'}
          </button>
        ))}
      </div>

      {tab === 'sessions' && (
        <>
          {/* Totals bar */}
          {totals && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              <Stat label="Total" value={totals.total_sessions ?? 0} />
              <Stat label="Last 30 Days" value={totals.sessions_30d ?? 0} />
              <Stat label="Avg Performance" value={totals.avg_performance_ratio ?? '—'} />
            </div>
          )}

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <Select
              label="Day Type"
              value={dayTypeFilter}
              options={['', ...filterOptions.day_types]}
              onChange={v => setParam('day_type', v)}
              format={v => v ? humanize(v) : 'All'}
            />
            <Select
              label="Modality"
              value={modalityFilter}
              options={['', ...filterOptions.modalities]}
              onChange={v => setParam('modality', v)}
              format={v => v ? humanize(v) : 'All'}
            />
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {(['all', '7d', '30d'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setParam('since', r === 'all' ? null : r)}
                  style={{
                    background: sinceFilter === r ? 'var(--accent-glow)' : 'var(--surface)',
                    border: '1px solid var(--border)',
                    color: sinceFilter === r ? 'var(--accent)' : 'var(--text-dim)',
                    padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    fontFamily: "'Outfit', sans-serif", fontWeight: 500,
                  }}
                >
                  {r === 'all' ? 'All' : r}
                </button>
              ))}
            </div>
          </div>

          {/* Sparkline */}
          {sparkline.length > 1 && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 12, marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Performance Ratio Trend
              </div>
              <Sparkline values={sparkline} />
            </div>
          )}

          {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

          {loading && offset === 0 && <div className="page-loading"><div className="loading-pulse" /></div>}

          {!loading && sessions.length === 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
              No sessions match these filters.
            </div>
          )}

          {sessions.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)', textAlign: 'left' }}>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Day Type</th>
                    <th style={thStyle}>Modality</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Target</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Actual</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Ratio</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>RPE</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/admin/users/${id}/engine-sessions/${s.id}`)}
                      style={{ cursor: 'pointer', borderTop: '1px solid var(--border)' }}
                    >
                      <td style={tdStyle}>{formatShortDate(s.date)}</td>
                      <td style={tdStyle}>{humanize(s.day_type)}</td>
                      <td style={tdStyle}>{humanize(s.modality)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatCompactNumber(s.target_pace)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatCompactNumber(s.actual_pace)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatCompactNumber(s.performance_ratio)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                        {s.perceived_exertion ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sessions.length < totalFiltered && (
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
              {loading ? 'Loading…' : `Load ${Math.min(LIMIT, totalFiltered - sessions.length)} more`}
            </button>
          )}
        </>
      )}

      {tab === 'time-trials' && (
        <>
          {ttLoading && <div className="page-loading"><div className="loading-pulse" /></div>}

          {tt && tt.length === 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
              No time trials recorded.
            </div>
          )}

          {tt && tt.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)', textAlign: 'left' }}>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Modality</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Output</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Rate</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Current</th>
                  </tr>
                </thead>
                <tbody>
                  {tt.map(t => (
                    <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={tdStyle}>{formatShortDate(t.date)}</td>
                      <td style={tdStyle}>{humanize(t.modality)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatCompactNumber(t.total_output)} {t.units}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatCompactNumber(t.calculated_rpm)} {t.units}/min
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {t.is_current ? '✓' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AdminSubPageLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const tdStyle: React.CSSProperties = { padding: '10px 14px', color: 'var(--text)' };

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

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 600;
  const h = 50;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.0001);
  const step = w / (values.length - 1);
  const points = values.map((v, i) =>
    `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`
  ).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="50" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}
