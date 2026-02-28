import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import {
  loadCompletedSessions,
  getAllPerformanceMetrics,
  loadTimeTrialBaselines,
  loadUserProgress,
  type EngineWorkoutSession,
  type EnginePerformanceMetrics,
  type EngineTimeTrial,
} from '../lib/engineService';
import EnginePaywall from '../components/engine/EnginePaywall';
import { useEntitlements } from '../hooks/useEntitlements';
import { ChevronLeft, Clock, Target, Activity } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────

type Tab = 'overview' | 'performance' | 'history' | 'baselines';

function dayTypeBadge(dayType: string): string {
  switch (dayType) {
    case 'endurance': case 'endurance_long': return 'engine-badge--endurance';
    case 'threshold': case 'threshold_stepped': case 'anaerobic': return 'engine-badge--strength';
    case 'polarized': case 'flux': return 'engine-badge--power';
    case 'time_trial': return 'engine-badge--hypertrophy';
    default: return 'engine-badge--default';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function pctColor(ratio: number): string {
  if (ratio >= 1.05) return '#4ade80';
  if (ratio >= 0.95) return 'var(--text)';
  if (ratio >= 0.85) return '#facc15';
  return '#f87171';
}

function barWidth(value: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.min((value / max) * 100, 100)}%`;
}

// ── Component ────────────────────────────────────────────────────────

export default function EngineAnalyticsPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');

  // Data
  const [sessions, setSessions] = useState<EngineWorkoutSession[]>([]);
  const [metrics, setMetrics] = useState<EnginePerformanceMetrics[]>([]);
  const [baselines, setBaselines] = useState<EngineTimeTrial[]>([]);
  const [currentDay, setCurrentDay] = useState(1);
  const { hasFeature } = useEntitlements(session.user.id);
  const hasAccess = hasFeature('engine');

  useEffect(() => {
    (async () => {
      try {
        const [sess, met, bl, progress] = await Promise.all([
          loadCompletedSessions(),
          getAllPerformanceMetrics(),
          loadTimeTrialBaselines(),
          loadUserProgress(),
        ]);
        setSessions(sess);
        setMetrics(met);
        setBaselines(bl);
        setCurrentDay(progress?.engine_current_day ?? 1);
      } catch {
        // degrade gracefully
      }
      setLoading(false);
    })();
  }, [session.user.id]);

  // ── Derived stats ──

  const totalSessions = sessions.length;
  const sessionsWithRatio = sessions.filter(s => s.performance_ratio != null && s.performance_ratio > 0);
  const avgRatio = sessionsWithRatio.length > 0
    ? sessionsWithRatio.reduce((sum, s) => sum + (s.performance_ratio ?? 0), 0) / sessionsWithRatio.length
    : 0;
  const avgRPE = sessions.length > 0
    ? sessions.reduce((sum, s) => sum + (s.perceived_exertion ?? 0), 0) / sessions.length
    : 0;

  // Group sessions by day type
  const byDayType = new Map<string, EngineWorkoutSession[]>();
  for (const s of sessions) {
    const dt = s.day_type ?? 'unknown';
    if (!byDayType.has(dt)) byDayType.set(dt, []);
    byDayType.get(dt)!.push(s);
  }
  const dayTypes = Array.from(byDayType.keys()).sort();

  // Group sessions by modality
  const byModality = new Map<string, EngineWorkoutSession[]>();
  for (const s of sessions) {
    const mod = s.modality ?? 'unknown';
    if (!byModality.has(mod)) byModality.set(mod, []);
    byModality.get(mod)!.push(s);
  }
  const modalities = Array.from(byModality.keys()).sort();

  // Group metrics by day type
  const metricsByDayType = new Map<string, EnginePerformanceMetrics[]>();
  for (const m of metrics) {
    if (!metricsByDayType.has(m.day_type)) metricsByDayType.set(m.day_type, []);
    metricsByDayType.get(m.day_type)!.push(m);
  }

  // ── Render: Overview ──

  function renderOverview() {
    return (
      <div className="engine-section">
        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          <div className="engine-stat" style={{ textAlign: 'center' }}>
            <div className="engine-stat-value">{totalSessions}</div>
            <div className="engine-stat-label">Sessions</div>
          </div>
          <div className="engine-stat" style={{ textAlign: 'center' }}>
            <div className="engine-stat-value" style={{ color: avgRatio > 0 ? pctColor(avgRatio) : undefined }}>
              {avgRatio > 0 ? `${(avgRatio * 100).toFixed(0)}%` : '—'}
            </div>
            <div className="engine-stat-label">Avg Performance</div>
          </div>
          <div className="engine-stat" style={{ textAlign: 'center' }}>
            <div className="engine-stat-value">{avgRPE > 0 ? avgRPE.toFixed(1) : '—'}</div>
            <div className="engine-stat-label">Avg RPE</div>
          </div>
          <div className="engine-stat" style={{ textAlign: 'center' }}>
            <div className="engine-stat-value">{currentDay}</div>
            <div className="engine-stat-label">Current Day</div>
          </div>
        </div>

        <hr className="engine-divider" />

        {/* Sessions by day type */}
        <h3 className="engine-header">Sessions by Day Type</h3>
        {dayTypes.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sessions recorded yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dayTypes.map(dt => {
              const count = byDayType.get(dt)?.length ?? 0;
              return (
                <div key={dt} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className={'engine-badge ' + dayTypeBadge(dt)} style={{ minWidth: 90, textAlign: 'center' }}>
                    {dt.replace(/_/g, ' ')}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="engine-progress-bar" style={{ height: 8 }}>
                      <div
                        className="engine-progress-fill"
                        style={{ width: barWidth(count, totalSessions), borderRadius: 4 }}
                      />
                    </div>
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--text-dim)', minWidth: 28, textAlign: 'right' }}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <hr className="engine-divider" />

        {/* Sessions by modality */}
        <h3 className="engine-header">Sessions by Equipment</h3>
        {modalities.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sessions recorded yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {modalities.map(mod => {
              const count = byModality.get(mod)?.length ?? 0;
              return (
                <div key={mod} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', minWidth: 90, textTransform: 'capitalize' }}>
                    {mod}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="engine-progress-bar" style={{ height: 8 }}>
                      <div
                        className="engine-progress-fill"
                        style={{ width: barWidth(count, totalSessions), borderRadius: 4 }}
                      />
                    </div>
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--text-dim)', minWidth: 28, textAlign: 'right' }}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Render: Performance ──

  function renderPerformance() {
    if (metrics.length === 0) {
      return (
        <div className="engine-empty">
          <Target size={32} />
          <div className="engine-empty-title">No Performance Data</div>
          <div className="engine-empty-desc">Complete workouts to see performance metrics by day type and equipment.</div>
        </div>
      );
    }

    const allDayTypes = Array.from(metricsByDayType.keys()).sort();

    return (
      <div className="engine-section">
        {allDayTypes.map(dt => {
          const dtMetrics = metricsByDayType.get(dt) ?? [];
          return (
            <div key={dt} className="engine-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span className={'engine-badge ' + dayTypeBadge(dt)}>
                  {dt.replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {dtMetrics.reduce((s, m) => s + m.rolling_count, 0)} total sessions
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {dtMetrics.map(m => (
                  <div key={m.modality} style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '12px 14px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'capitalize' }}>
                        {m.modality}
                      </span>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 15,
                        fontWeight: 700,
                        color: m.rolling_avg_ratio ? pctColor(m.rolling_avg_ratio) : 'var(--text-dim)',
                      }}>
                        {m.rolling_avg_ratio ? `${(m.rolling_avg_ratio * 100).toFixed(0)}%` : '—'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                      <span>{m.rolling_count} session{m.rolling_count !== 1 ? 's' : ''}</span>
                      {m.learned_max_pace != null && (
                        <span>Best: {m.learned_max_pace.toFixed(1)}/min</span>
                      )}
                    </div>

                    {/* Last 5 ratios mini chart */}
                    {m.last_5_ratios && m.last_5_ratios.length > 0 && (
                      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 32, marginTop: 8 }}>
                        {m.last_5_ratios.map((r, i) => (
                          <div
                            key={i}
                            style={{
                              flex: 1,
                              height: `${Math.min(r * 100, 100) * 0.32}px`,
                              minHeight: 4,
                              background: pctColor(r),
                              borderRadius: 2,
                              opacity: 0.8,
                            }}
                            title={`${(r * 100).toFixed(0)}%`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Render: History ──

  function renderHistory() {
    if (sessions.length === 0) {
      return (
        <div className="engine-empty">
          <Clock size={32} />
          <div className="engine-empty-title">No Sessions Yet</div>
          <div className="engine-empty-desc">Complete a training day to see your workout history here.</div>
        </div>
      );
    }

    return (
      <div className="engine-section">
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} recorded
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sessions.map(s => (
            <button
              key={s.id}
              className="engine-exercise"
              onClick={() => navigate(`/engine/training/${s.program_day_number}`)}
              style={{ cursor: 'pointer' }}
            >
              {/* Day number */}
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                color: 'var(--text-muted)',
                width: 40,
                flexShrink: 0,
              }}>
                D{s.program_day_number}
              </span>

              {/* Day type badge */}
              <span className={'engine-badge ' + dayTypeBadge(s.day_type ?? '')}>
                {(s.day_type ?? '').replace(/_/g, ' ')}
              </span>

              {/* Modality */}
              <span style={{ fontSize: 13, color: 'var(--text-dim)', textTransform: 'capitalize', minWidth: 40 }}>
                {s.modality ?? ''}
              </span>

              {/* Output */}
              {s.total_output != null && (
                <span className="engine-exercise-detail">
                  {s.total_output} {s.units ?? 'cal'}
                </span>
              )}

              {/* Performance ratio */}
              {s.performance_ratio != null && s.performance_ratio > 0 && (
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                  fontWeight: 600,
                  color: pctColor(s.performance_ratio),
                  minWidth: 44,
                  textAlign: 'right',
                }}>
                  {(s.performance_ratio * 100).toFixed(0)}%
                </span>
              )}

              {/* Date */}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>
                {formatDate(s.date)}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Render: Baselines ──

  function renderBaselines() {
    if (baselines.length === 0) {
      return (
        <div className="engine-empty">
          <Activity size={32} />
          <div className="engine-empty-title">No Baselines</div>
          <div className="engine-empty-desc">Complete a time trial to establish pace baselines for each piece of equipment.</div>
        </div>
      );
    }

    return (
      <div className="engine-section">
        <div className="engine-grid">
          {baselines.map(bl => (
            <div key={bl.id} className="engine-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'capitalize', marginBottom: 8 }}>
                {bl.modality}
              </div>
              <div className="engine-stat-value" style={{ fontSize: 28 }}>
                {bl.total_output}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                {bl.units ?? 'cal'} in 10 min
              </div>
              {bl.calculated_rpm != null && (
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--accent)',
                }}>
                  {bl.calculated_rpm.toFixed(1)} {bl.units ?? 'cal'}/min
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                {formatDate(bl.date)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Main Render ──

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Analytics</h1>
        </header>

        {loading ? (
          <div className="page-loading"><div className="loading-pulse" /></div>
        ) : !hasAccess ? (
          <EnginePaywall />
        ) : (
          <div className="engine-page">
            <div className="engine-section">
              {/* Back link */}
              <button
                className="engine-btn engine-btn-secondary engine-btn-sm"
                onClick={() => navigate('/engine')}
                style={{ alignSelf: 'flex-start' }}
              >
                <ChevronLeft size={16} /> Dashboard
              </button>

              {/* Tabs */}
              <div className="engine-tabs">
                {([
                  ['overview', 'Overview'],
                  ['performance', 'Performance'],
                  ['history', 'History'],
                  ['baselines', 'Baselines'],
                ] as [Tab, string][]).map(([id, label]) => (
                  <button
                    key={id}
                    className={'engine-tab' + (tab === id ? ' active' : '')}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {tab === 'overview' && renderOverview()}
              {tab === 'performance' && renderPerformance()}
              {tab === 'history' && renderHistory()}
              {tab === 'baselines' && renderBaselines()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
