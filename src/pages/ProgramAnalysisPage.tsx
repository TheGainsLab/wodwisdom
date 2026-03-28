import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { ANALYZE_PROGRAM_ENDPOINT, INCORPORATE_ENDPOINT } from '../lib/supabase';
import Nav from '../components/Nav';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

interface ProgramAnalysis {
  modal_balance: Record<string, number>;
  time_domains: Record<string, number>;
  workout_structure: Record<string, number>;
  workout_formats: Record<string, number>;
  movement_frequency: { name: string; count: number; modality: string; loads?: string[]; load?: string }[];
  notices: string[];
  not_programmed: Record<string, string[]>;
  consecutive_overlaps: { days: string; movements: string[] }[];
  loading_ratio?: { loaded: number; bodyweight: number };
  distinct_loads?: number;
  load_bands?: Record<string, number>;
}

const MODALITY_COLORS: Record<string, string> = {
  Weightlifting: '#f87171',
  Gymnastics: '#60a5fa',
  Monostructural: '#4ade80',
};

const MODALITY_SHORT: Record<string, string> = {
  W: 'W', G: 'G', M: 'M',
  Weightlifting: 'W', Gymnastics: 'G', Monostructural: 'M',
};

export default function ProgramAnalysisPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [programName, setProgramName] = useState('');
  const [analysis, setAnalysis] = useState<ProgramAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMovements, setSelectedMovements] = useState<Set<string>>(new Set());
  const [incorporating, setIncorporating] = useState(false);
  const [incorporateError, setIncorporateError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [showAllMovements, setShowAllMovements] = useState(false);

  const getAuthHeaders = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    const token = s?.access_token;
    if (!token) throw new Error('Not logged in');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!id) return;
    const headers = await getAuthHeaders();
    const res = await fetch(ANALYZE_PROGRAM_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ program_id: id }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Analysis failed');
    return json.analysis as ProgramAnalysis;
  }, [id, getAuthHeaders]);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data: prog } = await supabase
      .from('programs')
      .select('name')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();
    if (prog) setProgramName(prog.name);

    const { data: existing } = await supabase
      .from('program_analyses')
      .select('modal_balance, time_domains, workout_structure, workout_formats, movement_frequency, notices, not_programmed, consecutive_overlaps, loading_ratio, distinct_loads, load_bands')
      .eq('program_id', id)
      .single();

    if (existing) {
      setAnalysis(existing as ProgramAnalysis);
    } else {
      try {
        const a = await runAnalysis();
        if (a) setAnalysis(a);
      } catch {
        setAnalysis(null);
      }
    }
    setLoading(false);
  }, [id, session.user.id, runAnalysis]);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id, loadData]);

  const toggleMovement = (movement: string) => {
    setSelectedMovements(prev => {
      const next = new Set(prev);
      if (next.has(movement)) next.delete(movement);
      else next.add(movement);
      return next;
    });
  };

  const handleRefresh = async () => {
    if (!id) return;
    setRefreshing(true);
    setRefreshError('');
    try {
      const a = await runAnalysis();
      if (a) setAnalysis(a);
    } catch (err: unknown) {
      setRefreshError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handleIncorporate = async () => {
    if (!id || selectedMovements.size === 0) return;
    setIncorporating(true);
    setIncorporateError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(INCORPORATE_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          program_id: id,
          selected_movements: Array.from(selectedMovements),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to incorporate');
      navigate(`/programs/${id}/modify/${data.modification_id}/compare`);
    } catch (err: unknown) {
      setIncorporateError(err instanceof Error ? err.message : 'Failed to incorporate');
    } finally {
      setIncorporating(false);
    }
  };

  if (!id) return null;

  const totalModal = analysis ? (analysis.modal_balance.Weightlifting || 0) + (analysis.modal_balance.Gymnastics || 0) + (analysis.modal_balance.Monostructural || 0) : 0;
  const topMovements = analysis?.movement_frequency?.slice(0, showAllMovements ? 30 : 10) || [];

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>{programName ? `${programName} – Analysis` : 'Program Analysis'}</h1>
        </header>
        <div className="ailog-page">
          {loading ? (
            <div className="loading-pulse" />
          ) : !analysis ? (
            <div className="ailog-card">
              <div className="ailog-empty">
                <p>Could not load analysis.</p>
                <button className="ailog-btn ailog-btn-primary" onClick={() => loadData()}>Retry</button>
              </div>
            </div>
          ) : (
            <>
              <div className="ailog-card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="ailog-btn ailog-btn-secondary"
                    style={{ padding: '8px 14px', fontSize: 13, borderRadius: 6 }}
                    onClick={handleRefresh}
                    disabled={refreshing}
                  >
                    <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                  {refreshError && <span style={{ color: 'var(--error, #ef4444)', fontSize: 13, marginLeft: 12 }}>{refreshError}</span>}
                </div>
              </div>

              {/* Modality balance */}
              <div className="ailog-card" style={{ marginBottom: 16 }}>
                <div className="ailog-section">
                  <h3 className="ailog-header">Modality Balance</h3>
                  {totalModal > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {(['Weightlifting', 'Gymnastics', 'Monostructural'] as const).map((mod) => {
                        const count = analysis.modal_balance[mod] || 0;
                        const pct = totalModal > 0 ? Math.round((count / totalModal) * 100) : 0;
                        const color = MODALITY_COLORS[mod];
                        return (
                          <div key={mod}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                              <span style={{ color: 'var(--text-dim)' }}>{mod}</span>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text)' }}>{pct}%</span>
                            </div>
                            <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .3s' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Time domains */}
              <div className="ailog-card" style={{ marginBottom: 16 }}>
                <div className="ailog-section">
                  <h3 className="ailog-header">Time Domains</h3>
                  <div className="ailog-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                    {(['short', 'medium', 'long'] as const).map((td) => (
                      <div key={td} className="ailog-stat" style={{ textAlign: 'center' }}>
                        <div className="ailog-stat-value" style={{ fontSize: 22 }}>{analysis.time_domains[td] || 0}</div>
                        <div className="ailog-stat-label">{td === 'short' ? '<8 min' : td === 'medium' ? '8-15 min' : '15+ min'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Workout structure */}
              <div className="ailog-card" style={{ marginBottom: 16 }}>
                <div className="ailog-section">
                  <h3 className="ailog-header">Workout Structure</h3>
                  <div className="ailog-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    {Object.entries(analysis.workout_structure).filter(([, v]) => v > 0).map(([label, value]) => (
                      <div key={label} className="ailog-stat" style={{ textAlign: 'center' }}>
                        <div className="ailog-stat-value" style={{ fontSize: 22 }}>{value}</div>
                        <div className="ailog-stat-label">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Workout formats */}
              <div className="ailog-card" style={{ marginBottom: 16 }}>
                <div className="ailog-section">
                  <h3 className="ailog-header">Workout Formats</h3>
                  <div className="ailog-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    {Object.entries(analysis.workout_formats).filter(([, v]) => v > 0).map(([label, value]) => (
                      <div key={label} className="ailog-stat" style={{ textAlign: 'center' }}>
                        <div className="ailog-stat-value" style={{ fontSize: 22 }}>{value}</div>
                        <div className="ailog-stat-label">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Loading analysis */}
              {(analysis.loading_ratio || analysis.load_bands) && (
                <div className="ailog-card" style={{ marginBottom: 16 }}>
                  <div className="ailog-section">
                    <h3 className="ailog-header">Loading Analysis</h3>
                    {analysis.loading_ratio && (
                      <div className="ailog-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                        <div className="ailog-stat" style={{ textAlign: 'center' }}>
                          <div className="ailog-stat-value" style={{ fontSize: 22 }}>{analysis.loading_ratio.loaded}</div>
                          <div className="ailog-stat-label">Loaded</div>
                        </div>
                        <div className="ailog-stat" style={{ textAlign: 'center' }}>
                          <div className="ailog-stat-value" style={{ fontSize: 22 }}>{analysis.loading_ratio.bodyweight}</div>
                          <div className="ailog-stat-label">Bodyweight</div>
                        </div>
                        {analysis.distinct_loads != null && (
                          <div className="ailog-stat" style={{ textAlign: 'center' }}>
                            <div className="ailog-stat-value" style={{ fontSize: 22 }}>{analysis.distinct_loads}</div>
                            <div className="ailog-stat-label">Distinct Loads</div>
                          </div>
                        )}
                      </div>
                    )}
                    {analysis.load_bands && Object.values(analysis.load_bands).some(v => v > 0) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                        {Object.entries(analysis.load_bands)
                          .filter(([, v]) => v > 0)
                          .sort((a, b) => {
                            const numA = parseInt(a[0].match(/\d+/)?.[0] || '0');
                            const numB = parseInt(b[0].match(/\d+/)?.[0] || '0');
                            return numA - numB;
                          })
                          .map(([band, count], i, arr) => {
                          const maxBand = Math.max(...Object.values(analysis.load_bands!));
                          const pct = maxBand > 0 ? Math.round((count / maxBand) * 100) : 0;
                          const t = arr.length > 1 ? i / (arr.length - 1) : 0;
                          const r = Math.round(96 + t * (248 - 96));
                          const g = Math.round(165 + t * (113 - 165));
                          const b2 = Math.round(250 + t * (143 - 250));
                          const barColor = `rgb(${r}, ${g}, ${b2})`;
                          return (
                            <div key={band}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                                <span style={{ color: 'var(--text-dim)' }}>{band} lbs</span>
                                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text)' }}>{count}</span>
                              </div>
                              <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width .3s' }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Movement frequency */}
              {topMovements.length > 0 && (
                <div className="ailog-card" style={{ marginBottom: 16 }}>
                  <div className="ailog-section">
                    <h3 className="ailog-header">Movement Frequency</h3>
                    {topMovements.map((m, i) => {
                      const modShort = MODALITY_SHORT[m.modality] || m.modality;
                      const color = modShort === 'W' ? '#f87171' : modShort === 'G' ? '#60a5fa' : '#4ade80';
                      const bgColor = modShort === 'W' ? 'rgba(239,68,68,.15)' : modShort === 'G' ? 'rgba(59,130,246,.15)' : 'rgba(34,197,94,.15)';
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
                          <span style={{ fontSize: 14, textTransform: 'capitalize' }}>{m.name}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px',
                              padding: '3px 10px', borderRadius: 4, display: 'inline-flex', alignItems: 'center',
                              background: bgColor, color,
                            }}>{modShort}</span>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, minWidth: 24, textAlign: 'right' }}>{m.count}</span>
                          </div>
                        </div>
                      );
                    })}
                    {(analysis.movement_frequency?.length || 0) > 10 && (
                      <button
                        style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '8px 0', display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => setShowAllMovements(!showAllMovements)}
                      >
                        {showAllMovements ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {showAllMovements ? 'Show less' : `Show all ${analysis.movement_frequency.length}`}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Notices */}
              {analysis.notices.length > 0 && (
                <div className="ailog-card" style={{ marginBottom: 16 }}>
                  <div className="ailog-section">
                    <h3 className="ailog-header">Notices</h3>
                    {analysis.notices.map((n, i) => (
                      <div key={i} style={{ fontSize: 14, color: 'var(--text-dim)', padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>{n}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Consecutive overlaps */}
              {analysis.consecutive_overlaps.length > 0 && (
                <div className="ailog-card" style={{ marginBottom: 16 }}>
                  <div className="ailog-section">
                    <h3 className="ailog-header">Consecutive Day Overlaps</h3>
                    {analysis.consecutive_overlaps.map((o, i) => (
                      <div key={i} style={{ fontSize: 14, color: 'var(--text-dim)', padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{o.days}:</span> {o.movements.join(', ')}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Not programmed / incorporate */}
              <div className="ailog-card" style={{ marginBottom: 16 }}>
                <div className="ailog-section">
                  <h3 className="ailog-header">Not Programmed</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 12px' }}>Select movements to incorporate into your program.</p>
                  {(['Weightlifting', 'Gymnastics', 'Monostructural'] as const).map(cat => {
                    const items = analysis.not_programmed[cat] || [];
                    if (items.length === 0) return null;
                    return (
                      <div key={cat} style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: MODALITY_COLORS[cat], textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>{cat}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {items.map(m => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => toggleMovement(m)}
                              style={{
                                fontSize: 12, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                                fontFamily: 'inherit', textTransform: 'capitalize',
                                background: selectedMovements.has(m) ? 'var(--accent)' : 'var(--surface2)',
                                color: selectedMovements.has(m) ? 'white' : 'var(--text-dim)',
                                border: selectedMovements.has(m) ? '1px solid var(--accent)' : '1px solid var(--border-light)',
                                transition: 'all .15s',
                              }}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {selectedMovements.size > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                      <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{selectedMovements.size} selected</span>
                      <button
                        className="ailog-btn ailog-btn-primary"
                        style={{ padding: '8px 14px', fontSize: 13, borderRadius: 6 }}
                        onClick={handleIncorporate}
                        disabled={incorporating}
                      >
                        {incorporating ? 'Incorporating...' : 'Incorporate selected'}
                      </button>
                    </div>
                  )}
                  {incorporateError && <div style={{ color: 'var(--error, #ef4444)', fontSize: 13, marginTop: 8 }}>{incorporateError}</div>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button
                  className="ailog-btn ailog-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => navigate(`/programs/${id}`)}
                >
                  Back to program
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
