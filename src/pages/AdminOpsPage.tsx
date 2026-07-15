import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

// ── Page ─────────────────────────────────────────────────────────────
//
// Ops health (/admin/ops): the reconciliation audit trail surfaced from
// programming_reconciliations via admin_list_reconciliations. Two sweeps
// write there daily (kind='programming': paid-vs-delivered program months;
// kind='engine': paid-vs-unlocked engine months, including over_entitled
// flags). No rows for a day = that sweep didn't run — which is itself the
// signal this page exists to make visible.

interface ReconRun {
  id: number;
  ran_at: string;
  kind: 'programming' | 'engine';
  dry_run: boolean;
  checked: number;
  healthy: number;
  healed: any[];
  flagged: any[];
  errors: any[];
}

type KindFilter = 'all' | 'programming' | 'engine';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function AdminOpsPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = (searchParams.get('kind') as KindFilter) || 'all';

  const [navOpen, setNavOpen] = useState(false);
  const [adminCheck, setAdminCheck] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<ReconRun[]>([]);
  const [lastRunAt, setLastRunAt] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
      const { data, error: err } = await supabase.rpc('admin_list_reconciliations', {
        p_limit: 30,
        p_kind: kind === 'all' ? null : kind,
      });
      if (err) setError(err.message);
      else if (data) {
        setRuns(data.runs ?? []);
        setLastRunAt(data.last_run_at ?? {});
      }
      setLoading(false);
    })();
  }, [adminCheck, kind]);

  function setKind(k: KindFilter) {
    const next = new URLSearchParams(searchParams);
    if (k === 'all') next.delete('kind');
    else next.set('kind', k);
    setSearchParams(next, { replace: true });
  }

  // Staleness: a sweep that hasn't written a row in >36h is presumed broken.
  function staleness(k: string): 'ok' | 'stale' | 'never' {
    const at = lastRunAt[k];
    if (!at) return 'never';
    return Date.now() - new Date(at).getTime() > 36 * 3600 * 1000 ? 'stale' : 'ok';
  }

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Ops Health</h1>
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
                {/* Sweep freshness */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  {(['programming', 'engine'] as const).map((k) => {
                    const s = staleness(k);
                    const color = s === 'ok' ? '#22c55e' : s === 'stale' ? '#f59e0b' : '#ef4444';
                    return (
                      <div key={k} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', minWidth: 200 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>
                          {k} sweep
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                          <span style={{ fontSize: 13 }}>
                            {s === 'never' ? 'never ran' : `last run ${formatDateTime(lastRunAt[k])}`}
                            {s === 'stale' && ' — stale (>36h)'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Kind filter */}
                <div className="source-toggle" style={{ marginBottom: 16 }}>
                  {(['all', 'programming', 'engine'] as const).map((k) => (
                    <button
                      key={k}
                      className={'source-btn ' + (kind === k ? 'active' : '')}
                      onClick={() => setKind(k)}
                    >
                      {k.charAt(0).toUpperCase() + k.slice(1)}
                    </button>
                  ))}
                </div>

                {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}
                {loading && <div className="page-loading"><div className="loading-pulse" /></div>}

                {!loading && runs.length === 0 && (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No reconciliation runs recorded.
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {runs.map((r) => {
                    const flaggedN = r.flagged?.length ?? 0;
                    const healedN = r.healed?.length ?? 0;
                    const errorsN = r.errors?.length ?? 0;
                    const key = String(r.id);
                    const isOpen = !!expanded[key];
                    const hasDetail = flaggedN + healedN + errorsN > 0;
                    return (
                      <div key={r.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                            color: r.kind === 'engine' ? '#f0a050' : 'var(--accent)',
                            background: (r.kind === 'engine' ? '#f0a050' : 'var(--accent)') + '20',
                            padding: '2px 8px', borderRadius: 4,
                          }}>
                            {r.kind}
                          </span>
                          {r.dry_run && (
                            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', border: '1px dashed var(--border)', padding: '2px 8px', borderRadius: 4 }}>
                              dry run
                            </span>
                          )}
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace" }}>
                            {formatDateTime(r.ran_at)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, flexWrap: 'wrap' }}>
                          <span>checked <b>{r.checked}</b></span>
                          <span style={{ color: '#4ade80' }}>healthy <b>{r.healthy}</b></span>
                          <span style={{ color: healedN > 0 ? '#60a5fa' : 'var(--text-muted)' }}>healed <b>{healedN}</b></span>
                          <span style={{ color: flaggedN > 0 ? '#f59e0b' : 'var(--text-muted)' }}>flagged <b>{flaggedN}</b></span>
                          <span style={{ color: errorsN > 0 ? '#ef4444' : 'var(--text-muted)' }}>errors <b>{errorsN}</b></span>
                        </div>
                        {hasDetail && (
                          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                            <button
                              onClick={() => setExpanded(prev => ({ ...prev, [key]: !isOpen }))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: 0 }}
                            >
                              {isOpen ? '▾' : '▸'} Details
                            </button>
                            {isOpen && (
                              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {([['healed', r.healed], ['flagged', r.flagged], ['errors', r.errors]] as const).map(([label, rows]) =>
                                  (rows?.length ?? 0) > 0 ? (
                                    <div key={label}>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
                                      <pre style={{
                                        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                                        padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                                        overflowX: 'auto', maxHeight: 260, whiteSpace: 'pre-wrap', margin: 0,
                                      }}>
                                        {JSON.stringify(rows, null, 2)}
                                      </pre>
                                    </div>
                                  ) : null
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
