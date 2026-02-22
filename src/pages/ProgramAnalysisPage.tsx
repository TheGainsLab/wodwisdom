import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { ANALYZE_PROGRAM_ENDPOINT, INCORPORATE_ENDPOINT } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface ProgramAnalysis {
  modal_balance: Record<string, number>;
  time_domains: Record<string, number>;
  workout_structure: Record<string, number>;
  workout_formats: Record<string, number>;
  movement_frequency: { name: string; count: number; modality: string; load: string }[];
  notices: string[];
  not_programmed: Record<string, string[]>;
  consecutive_overlaps: { week: number; days: string; movements: string[] }[];
}

function BarChart({ data, max }: { data: Record<string, number>; max?: number }) {
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  const ceiling = max ?? Math.max(...entries.map(([, v]) => v), 1);
  return (
    <div className="analysis-bar-chart">
      {entries.map(([label, value]) => (
        <div key={label} className="analysis-bar-row">
          <span className="analysis-bar-label">{label}</span>
          <div className="analysis-bar-track">
            <div className="analysis-bar-fill" style={{ width: `${(value / ceiling) * 100}%` }} />
          </div>
          <span className="analysis-bar-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

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
      .select('modal_balance, time_domains, workout_structure, workout_formats, movement_frequency, notices, not_programmed, consecutive_overlaps')
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

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <InviteBanner session={session} />
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>{programName ? `${programName} – Analysis` : 'Program Analysis'}</h1>
        </header>
        <div className="page-body">
          <div className="program-detail-wrap">
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : !analysis ? (
              <div className="empty-state">
                <p>Could not load analysis.</p>
                <button className="auth-btn" onClick={() => loadData()}>Retry</button>
              </div>
            ) : (
              <>
                <div className="analysis-toolbar">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={handleRefresh}
                    disabled={refreshing}
                  >
                    {refreshing ? 'Refreshing...' : 'Refresh analysis'}
                  </button>
                  {refreshError && <span className="error-msg" style={{ marginLeft: 12 }}>{refreshError}</span>}
                </div>
                <div className="analysis-section">
                  <h2 className="analysis-section-title">Modal balance</h2>
                  <BarChart data={analysis.modal_balance} />
                </div>
                <div className="analysis-section">
                  <h2 className="analysis-section-title">Time domains</h2>
                  <BarChart data={analysis.time_domains} />
                </div>
                <div className="analysis-section">
                  <h2 className="analysis-section-title">Workout structure</h2>
                  <BarChart data={analysis.workout_structure} />
                </div>
                <div className="analysis-section">
                  <h2 className="analysis-section-title">Workout formats</h2>
                  <BarChart data={analysis.workout_formats} />
                </div>
                <div className="analysis-section">
                  <h2 className="analysis-section-title">Movement frequency</h2>
                  <div className="analysis-movement-table-wrap">
                    <table className="program-workouts-table">
                      <thead>
                        <tr>
                          <th>Movement</th>
                          <th>Count</th>
                          <th>Modality</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.movement_frequency.slice(0, 30).map((m, i) => (
                          <tr key={i}>
                            <td>{m.name}</td>
                            <td>{m.count}</td>
                            <td>{m.modality === 'W' ? 'Weightlifting' : m.modality === 'G' ? 'Gymnastics' : 'Monostructural'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {analysis.notices.length > 0 && (
                  <div className="analysis-section">
                    <h2 className="analysis-section-title">Notices</h2>
                    <ul className="analysis-notices">
                      {analysis.notices.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysis.consecutive_overlaps.length > 0 && (
                  <div className="analysis-section">
                    <h2 className="analysis-section-title">Consecutive day overlaps</h2>
                    <ul className="analysis-overlaps">
                      {analysis.consecutive_overlaps.map((o, i) => (
                        <li key={i}>Week {o.week} {o.days}: {o.movements.join(', ')}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="analysis-section analysis-incorporate">
                  <h2 className="analysis-section-title">Incorporate movements</h2>
                  <p className="analysis-incorporate-desc">Select movements from the CrossFit canon that are not yet programmed. AI will suggest placements.</p>
                  <div className="analysis-not-programmed">
                    {(['Weightlifting', 'Gymnastics', 'Monostructural'] as const).map(cat => {
                      const items = analysis.not_programmed[cat] || [];
                      if (items.length === 0) return null;
                      return (
                        <div key={cat} className="analysis-category">
                          <div className="analysis-category-label">{cat}</div>
                          <div className="analysis-movement-chips">
                            {items.map(m => (
                              <button
                                key={m}
                                type="button"
                                className={'analysis-movement-chip' + (selectedMovements.has(m) ? ' selected' : '')}
                                onClick={() => toggleMovement(m)}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {selectedMovements.size > 0 && (
                    <div className="analysis-incorporate-actions">
                      <span className="analysis-selected-count">{selectedMovements.size} selected</span>
                      <button
                        className="auth-btn"
                        onClick={handleIncorporate}
                        disabled={incorporating}
                      >
                        {incorporating ? 'Incorporating...' : 'Incorporate selected'}
                      </button>
                    </div>
                  )}
                  {incorporateError && <div className="error-msg" style={{ marginTop: 8 }}>{incorporateError}</div>}
                </div>
                <div className="program-detail-actions" style={{ marginTop: 24 }}>
                  <button className="auth-btn" style={{ background: 'var(--surface2)', color: 'var(--text)' }} onClick={() => navigate(`/programs/${id}`)}>
                    Back to program
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
