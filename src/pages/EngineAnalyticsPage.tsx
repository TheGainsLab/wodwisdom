import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import {
  loadCompletedSessions,
  loadTimeTrialBaselines,
  loadAllTimeTrials,
  loadUserProgress,
  type EngineWorkoutSession,
  type EngineTimeTrial,
} from '../lib/engineService';
import EnginePaywall from '../components/engine/EnginePaywall';
import { useEntitlements } from '../hooks/useEntitlements';
import { ChevronLeft, Clock, Activity, ArrowLeft } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────

type View =
  | 'menu'
  | 'overview'
  | 'history'
  | 'comparisons'
  | 'time-trials'
  | 'targets'
  | 'records'
  | 'heart-rate'
  | 'work-rest';

// ── Helpers ──────────────────────────────────────────────────────────

function dayTypeBadge(dayType: string): string {
  switch (dayType) {
    case 'endurance': case 'endurance_long': case 'interval': case 'max_aerobic_power': case 'hybrid_aerobic': return 'engine-badge--endurance';
    case 'threshold': case 'threshold_stepped': case 'anaerobic': case 'descending_devour': case 'ascending': return 'engine-badge--strength';
    case 'polarized': case 'flux': case 'flux_stages': case 'rocket_races_a': case 'rocket_races_b': case 'afterburner': return 'engine-badge--power';
    case 'time_trial': case 'devour': case 'ascending_devour': case 'infinity': case 'towers': case 'synthesis': case 'atomic': case 'hybrid_anaerobic': return 'engine-badge--hypertrophy';
    default: return 'engine-badge--default';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

function formatModality(mod: string): string {
  return mod.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDayType(dt: string): string {
  return dt.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function calculatePace(s: EngineWorkoutSession): number | null {
  if (s.actual_pace) return s.actual_pace;
  const wd = s.workout_data as Record<string, unknown> | null;
  if (s.total_output && wd?.total_work_seconds) {
    return s.total_output / ((wd.total_work_seconds as number) / 60);
  }
  return null;
}

function formatWorkRestRatio(decimal: number): string {
  if (decimal >= 2.7) return '3:1';
  if (decimal >= 1.7) return '2:1';
  if (decimal >= 1.3) return '3:2';
  if (decimal >= 0.9) return '1:1';
  if (decimal >= 0.6) return '2:3';
  if (decimal >= 0.4) return '1:2';
  return '1:3';
}

// ── Shared components ────────────────────────────────────────────────

function PillSelector({ items, selected, onSelect, label }: {
  items: string[];
  selected: string;
  onSelect: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="engine-card" style={{ padding: 16 }}>
      {label && <div className="ea-pill-label">{label}</div>}
      <div className="ea-pills">
        {items.map(item => (
          <button
            key={item}
            className={'ea-pill' + (selected === item ? ' active' : '')}
            onClick={() => onSelect(item)}
          >
            {formatModality(item)}
          </button>
        ))}
      </div>
    </div>
  );
}

function PillMultiSelector({ items, selected, onToggle, label }: {
  items: string[];
  selected: string[];
  onToggle: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="engine-card" style={{ padding: 16 }}>
      {label && <div className="ea-pill-label">{label}</div>}
      <div className="ea-pills">
        {items.map(item => (
          <button
            key={item}
            className={'ea-pill' + (selected.includes(item) ? ' active' : '')}
            onClick={() => onToggle(item)}
          >
            {formatDayType(item)}
          </button>
        ))}
      </div>
    </div>
  );
}

function HorizontalBarChart({ data, labels, maxValue, unit = '' }: {
  data: number[];
  labels: string[];
  maxValue: number;
  unit?: string;
}) {
  return (
    <div>
      {data.map((value, i) => {
        const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
        return (
          <div key={i} className="ea-bar-row">
            <span className="ea-bar-label" title={labels[i]}>{labels[i]}</span>
            <div className="ea-bar-track">
              <div className="ea-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="ea-bar-value">{Math.round(value)}{unit}</span>
          </div>
        );
      })}
    </div>
  );
}

function ViewHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="ea-view-header">
      <button
        className="engine-btn engine-btn-secondary engine-btn-sm"
        onClick={onBack}
      >
        <ArrowLeft size={14} /> Back
      </button>
      <h3 className="engine-header" style={{ margin: 0 }}>{title}</h3>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export default function EngineAnalyticsPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('menu');

  // Data
  const [sessions, setSessions] = useState<EngineWorkoutSession[]>([]);
  const [baselines, setBaselines] = useState<EngineTimeTrial[]>([]);
  const [allTrials, setAllTrials] = useState<EngineTimeTrial[]>([]);
  const [currentDay, setCurrentDay] = useState(1);
  const { hasFeature } = useEntitlements(session.user.id);
  const hasAccess = hasFeature('engine');

  // View-level state
  const [selModality, setSelModality] = useState('');
  const [selDayType, setSelDayType] = useState('');
  const [selDayTypes, setSelDayTypes] = useState<string[]>([]);
  const [selMetric, setSelMetric] = useState<string>('output');
  const [selRatios, setSelRatios] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const [sessResult, blResult, allTrialResult, progressResult] = await Promise.allSettled([
        loadCompletedSessions(),
        loadTimeTrialBaselines(),
        loadAllTimeTrials(),
        loadUserProgress(),
      ]);
      if (sessResult.status === 'fulfilled') setSessions(sessResult.value);
      if (blResult.status === 'fulfilled') setBaselines(blResult.value);
      if (allTrialResult.status === 'fulfilled') setAllTrials(allTrialResult.value);
      if (progressResult.status === 'fulfilled') setCurrentDay(progressResult.value?.engine_current_day ?? 1);
      setLoading(false);
    })();
  }, [session.user.id]);

  // Reset sub-selectors when switching views
  function goTo(v: View) {
    setSelModality('');
    setSelDayType('');
    setSelDayTypes([]);
    setSelMetric('output');
    setSelRatios([]);
    setView(v);
  }

  // ── Derived data ──

  const totalSessions = sessions.length;
  const regularSessions = useMemo(() => sessions.filter(s => s.day_type !== 'time_trial'), [sessions]);

  const sessionsWithRatio = regularSessions.filter(s => s.performance_ratio != null && s.performance_ratio > 0);
  const avgRatio = sessionsWithRatio.length > 0
    ? sessionsWithRatio.reduce((sum, s) => sum + (s.performance_ratio ?? 0), 0) / sessionsWithRatio.length
    : 0;
  const avgRPE = regularSessions.length > 0
    ? regularSessions.filter(s => s.perceived_exertion != null && s.perceived_exertion > 0).reduce((sum, s) => sum + (s.perceived_exertion ?? 0), 0) /
      regularSessions.filter(s => s.perceived_exertion != null && s.perceived_exertion > 0).length
    : 0;

  // Unique modalities/day types from sessions
  const availableModalities = useMemo(() => {
    const set = new Set<string>();
    regularSessions.forEach(s => { if (s.modality) set.add(s.modality); });
    return Array.from(set).sort();
  }, [regularSessions]);

  const availableDayTypes = useMemo(() => {
    const set = new Set<string>();
    regularSessions.forEach(s => {
      if (s.day_type && (!selModality || s.modality === selModality)) set.add(s.day_type);
    });
    return Array.from(set).sort();
  }, [regularSessions, selModality]);

  // Group sessions by day type & modality
  const byDayType = useMemo(() => {
    const map = new Map<string, EngineWorkoutSession[]>();
    for (const s of regularSessions) {
      const dt = s.day_type ?? 'unknown';
      if (!map.has(dt)) map.set(dt, []);
      map.get(dt)!.push(s);
    }
    return map;
  }, [regularSessions]);

  const byModality = useMemo(() => {
    const map = new Map<string, EngineWorkoutSession[]>();
    for (const s of regularSessions) {
      const mod = s.modality ?? 'unknown';
      if (!map.has(mod)) map.set(mod, []);
      map.get(mod)!.push(s);
    }
    return map;
  }, [regularSessions]);

  const dayTypes = Array.from(byDayType.keys()).sort();
  const modalities = Array.from(byModality.keys()).sort();

  // ── Summary: Energy System Ratios ──

  const summaryRatios = useMemo(() => {
    if (!selModality) return { glycolytic: null as number | null, aerobic: null as number | null, systems: null as number | null };

    const anaerobicSessions = regularSessions.filter(s => s.day_type === 'anaerobic' && s.modality === selModality && s.actual_pace && s.actual_pace > 0);
    const anaerobicAvg = anaerobicSessions.length > 0 ? anaerobicSessions.reduce((sum, s) => sum + (s.actual_pace ?? 0), 0) / anaerobicSessions.length : null;

    const maxAerobicSessions = regularSessions.filter(s => s.day_type === 'max_aerobic_power' && s.modality === selModality && s.actual_pace && s.actual_pace > 0);
    const maxAerobicAvg = maxAerobicSessions.length > 0 ? maxAerobicSessions.reduce((sum, s) => sum + (s.actual_pace ?? 0), 0) / maxAerobicSessions.length : null;

    const modalTrials = allTrials.filter(t => t.modality === selModality && t.calculated_rpm && t.calculated_rpm > 0).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const ttPace = modalTrials.length > 0 ? modalTrials[0].calculated_rpm : null;

    return {
      glycolytic: anaerobicAvg && ttPace ? anaerobicAvg / ttPace : null,
      aerobic: maxAerobicAvg && ttPace ? maxAerobicAvg / ttPace : null,
      systems: anaerobicAvg && maxAerobicAvg ? anaerobicAvg / maxAerobicAvg : null,
    };
  }, [regularSessions, allTrials, selModality]);

  // ── Summary: Pace Stats ──

  const paceStats = useMemo(() => {
    if (!selModality) return { peak: null as number | null, average: null as number | null, units: '' };
    const modSessions = regularSessions.filter(s => s.modality === selModality && s.actual_pace && s.actual_pace > 0);
    const modTrials = allTrials.filter(t => t.modality === selModality && t.calculated_rpm && t.calculated_rpm > 0);
    const allPaces = [
      ...modSessions.map(s => s.actual_pace ?? 0),
      ...modTrials.map(t => t.calculated_rpm ?? 0),
    ].filter(p => p > 0);
    if (allPaces.length === 0) return { peak: null, average: null, units: '' };
    return {
      peak: Math.max(...allPaces),
      average: allPaces.reduce((a, b) => a + b, 0) / allPaces.length,
      units: modSessions[0]?.units ?? modTrials[0]?.units ?? 'cal',
    };
  }, [regularSessions, allTrials, selModality]);

  // ── Render: Menu (landing) ──

  function renderMenu() {
    const options: { id: View; title: string; desc: string }[] = [
      { id: 'overview', title: 'Overview', desc: 'Summary stats, breakdowns, ratios' },
      { id: 'history', title: 'My History', desc: 'Filtered trends by modality & type' },
      { id: 'comparisons', title: 'Comparisons', desc: 'Side-by-side day type analysis' },
      { id: 'time-trials', title: 'Time Trials', desc: 'Baseline progression charts' },
      { id: 'targets', title: 'Targets vs Actual', desc: 'Performance against targets' },
      { id: 'records', title: 'Personal Records', desc: 'Best pace per day type' },
      { id: 'heart-rate', title: 'HR Analytics', desc: 'Heart rate & efficiency' },
      { id: 'work-rest', title: 'Work:Rest Ratio', desc: 'Interval structure analysis' },
    ];

    return (
      <div className="engine-section">
        {/* Quick summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
          <div className="engine-stat" style={{ textAlign: 'center' }}>
            <div className="engine-stat-value">{regularSessions.length}</div>
            <div className="engine-stat-label">Workouts</div>
          </div>
          <div className="engine-stat" style={{ textAlign: 'center' }}>
            <div className="engine-stat-value">{allTrials.length}</div>
            <div className="engine-stat-label">Time Trials</div>
          </div>
          <div className="engine-stat" style={{ textAlign: 'center' }}>
            <div className="engine-stat-value" style={{ color: avgRatio > 0 ? pctColor(avgRatio) : undefined }}>
              {avgRatio > 0 ? `${(avgRatio * 100).toFixed(0)}%` : '—'}
            </div>
            <div className="engine-stat-label">Avg Perf</div>
          </div>
          <div className="engine-stat" style={{ textAlign: 'center' }}>
            <div className="engine-stat-value">{currentDay}</div>
            <div className="engine-stat-label">Current Day</div>
          </div>
        </div>

        {/* Analytics menu */}
        <h3 className="engine-header">Analytics</h3>
        <div className="ea-menu-grid">
          {options.map(opt => (
            <button key={opt.id} className="ea-menu-card" onClick={() => goTo(opt.id)}>
              <span className="ea-menu-card-title">{opt.title}</span>
              <span className="ea-menu-card-desc">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Render: Overview ──

  function renderOverview() {
    return (
      <div className="engine-section">
        <ViewHeader title="Overview" onBack={() => goTo('menu')} />

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
                      <div className="engine-progress-fill" style={{ width: barWidth(count, totalSessions), borderRadius: 4 }} />
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
                    {formatModality(mod)}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="engine-progress-bar" style={{ height: 8 }}>
                      <div className="engine-progress-fill" style={{ width: barWidth(count, totalSessions), borderRadius: 4 }} />
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

        {/* Energy System Ratios + Pace Stats */}
        <h3 className="engine-header">Energy System Ratios</h3>
        {availableModalities.length > 0 ? (
          <>
            <PillSelector items={availableModalities} selected={selModality} onSelect={setSelModality} label="Select Modality" />
            {selModality && (summaryRatios.glycolytic !== null || summaryRatios.aerobic !== null || summaryRatios.systems !== null) && (
              <div className="engine-card">
                <div className="ea-ratio-bars">
                  {summaryRatios.glycolytic !== null && (
                    <div className="ea-ratio-col">
                      <div className="ea-ratio-value">{summaryRatios.glycolytic.toFixed(2)}</div>
                      <div className="ea-ratio-bar-bg">
                        <div className="ea-ratio-bar-fill" style={{ height: `${Math.min(summaryRatios.glycolytic * 100, 100)}%` }} />
                      </div>
                      <div className="ea-ratio-label">Glycolytic</div>
                    </div>
                  )}
                  {summaryRatios.aerobic !== null && (
                    <div className="ea-ratio-col">
                      <div className="ea-ratio-value">{summaryRatios.aerobic.toFixed(2)}</div>
                      <div className="ea-ratio-bar-bg">
                        <div className="ea-ratio-bar-fill" style={{ height: `${Math.min(summaryRatios.aerobic * 100, 100)}%` }} />
                      </div>
                      <div className="ea-ratio-label">Aerobic</div>
                    </div>
                  )}
                  {summaryRatios.systems !== null && (
                    <div className="ea-ratio-col">
                      <div className="ea-ratio-value">{summaryRatios.systems.toFixed(2)}</div>
                      <div className="ea-ratio-bar-bg">
                        <div className="ea-ratio-bar-fill" style={{ height: `${Math.min(summaryRatios.systems * 100, 100)}%` }} />
                      </div>
                      <div className="ea-ratio-label">Systems</div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {selModality && summaryRatios.glycolytic === null && summaryRatios.aerobic === null && summaryRatios.systems === null && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                Need anaerobic, max aerobic power, or time trial data for this modality to calculate ratios.
              </div>
            )}
            {selModality && paceStats.peak !== null && (
              <div className="engine-card" style={{ display: 'flex', gap: 24, justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div className="engine-stat-value" style={{ fontSize: 22 }}>{Math.round(paceStats.peak!)}</div>
                  <div className="engine-stat-label">Peak Pace ({paceStats.units}/min)</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className="engine-stat-value" style={{ fontSize: 22 }}>{Math.round(paceStats.average!)}</div>
                  <div className="engine-stat-label">Avg Pace ({paceStats.units}/min)</div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Complete workouts to see energy system ratios.</div>
        )}
      </div>
    );
  }

  // ── Render: Filtered History ──

  function renderHistory() {
    const filteredSessions = (!selDayType || !selModality) ? [] :
      regularSessions.filter(s =>
        s.day_type === selDayType && s.modality === selModality
      ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (regularSessions.length === 0) {
      return (
        <div className="engine-section">
          <ViewHeader title="My History" onBack={() => goTo('menu')} />
          <div className="engine-empty">
            <Clock size={32} />
            <div className="engine-empty-title">No Sessions Yet</div>
            <div className="engine-empty-desc">Complete a training day to see your workout history here.</div>
          </div>
        </div>
      );
    }

    return (
      <div className="engine-section">
        <ViewHeader title="My History" onBack={() => goTo('menu')} />

        <PillSelector items={availableModalities} selected={selModality} onSelect={(v) => { setSelModality(v); setSelDayType(''); }} label="Select Modality" />

        {selModality && (
          <PillSelector
            items={availableDayTypes}
            selected={selDayType}
            onSelect={setSelDayType}
            label="Select Day Type"
          />
        )}

        {selDayType && selModality && filteredSessions.length > 0 && (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
            </div>

            {/* Metric toggle */}
            <div className="engine-card" style={{ padding: 12 }}>
              <div className="ea-pills">
                <button className={'ea-pill' + (selMetric === 'output' ? ' active' : '')} onClick={() => setSelMetric('output')}>Output</button>
                <button className={'ea-pill' + (selMetric === 'pace' ? ' active' : '')} onClick={() => setSelMetric('pace')}>Pace</button>
              </div>
            </div>

            {/* Chart */}
            <div className="engine-card">
              <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 14, textAlign: 'center' }}>
                {selMetric === 'output' ? 'Output Over Time' : 'Pace Over Time'}
              </h4>
              {(() => {
                const sorted = [...filteredSessions].sort((a, b) => {
                  const aVal = selMetric === 'output' ? (a.total_output ?? 0) : (calculatePace(a) ?? 0);
                  const bVal = selMetric === 'output' ? (b.total_output ?? 0) : (calculatePace(b) ?? 0);
                  return bVal - aVal;
                });
                const vals = sorted.map(s => selMetric === 'output' ? (s.total_output ?? 0) : (calculatePace(s) ?? 0));
                const labels = sorted.map(s => formatDateShort(s.date));
                const unit = selMetric === 'output' ? ` ${sorted[0]?.units ?? ''}` : ` ${sorted[0]?.units ?? ''}/min`;
                return <HorizontalBarChart data={vals} labels={labels} maxValue={Math.max(...vals, 1)} unit={unit} />;
              })()}
            </div>
          </>
        )}

        {selDayType && selModality && filteredSessions.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
            No sessions found for this combination.
          </div>
        )}
      </div>
    );
  }

  // ── Render: Comparisons ──

  function renderComparisons() {
    const comparisonData = (!selModality || selDayTypes.length === 0) ? [] :
      (selDayTypes.map(dt => {
        const dtSessions = regularSessions.filter(s => s.modality === selModality && s.day_type === dt && s.total_output);
        if (dtSessions.length === 0) return null;
        const avgOutput = dtSessions.reduce((sum, s) => sum + (s.total_output ?? 0), 0) / dtSessions.length;
        const withPace = dtSessions.filter(s => s.actual_pace && s.actual_pace > 0);
        const avgPace = withPace.length > 0 ? withPace.reduce((sum, s) => sum + (s.actual_pace ?? 0), 0) / withPace.length : 0;
        return { dayType: dt, count: dtSessions.length, avgOutput: Math.round(avgOutput), avgPace: Math.round(avgPace), units: dtSessions[0].units ?? '' };
      }).filter(Boolean) as { dayType: string; count: number; avgOutput: number; avgPace: number; units: string }[]);

    const sorted = [...comparisonData].sort((a, b) => {
      const aVal = selMetric === 'output' ? a.avgOutput : a.avgPace;
      const bVal = selMetric === 'output' ? b.avgOutput : b.avgPace;
      return bVal - aVal;
    });

    return (
      <div className="engine-section">
        <ViewHeader title="Comparisons" onBack={() => goTo('menu')} />

        <PillSelector items={availableModalities} selected={selModality} onSelect={(v) => { setSelModality(v); setSelDayTypes([]); }} label="Select Modality" />

        {selModality && (
          <PillMultiSelector
            items={availableDayTypes}
            selected={selDayTypes}
            onToggle={dt => setSelDayTypes(prev => prev.includes(dt) ? prev.filter(x => x !== dt) : [...prev, dt])}
            label="Select Day Types to Compare"
          />
        )}

        {sorted.length > 0 && (
          <>
            <div className="engine-card" style={{ padding: 12 }}>
              <div className="ea-pills">
                <button className={'ea-pill' + (selMetric === 'output' ? ' active' : '')} onClick={() => setSelMetric('output')}>Avg Output</button>
                <button className={'ea-pill' + (selMetric === 'pace' ? ' active' : '')} onClick={() => setSelMetric('pace')}>Avg Pace</button>
              </div>
            </div>

            <div className="engine-card">
              <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 14, textAlign: 'center' }}>
                {selMetric === 'output' ? 'Average Output Comparison' : 'Average Pace Comparison'}
              </h4>
              <HorizontalBarChart
                data={sorted.map(d => selMetric === 'output' ? d.avgOutput : d.avgPace)}
                labels={sorted.map(d => `${formatDayType(d.dayType)} (${d.count})`)}
                maxValue={Math.max(...sorted.map(d => selMetric === 'output' ? d.avgOutput : d.avgPace), 1)}
                unit={selMetric === 'output' ? ` ${sorted[0]?.units ?? ''}` : ` ${sorted[0]?.units ?? ''}/min`}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Render: Time Trials ──

  function renderTimeTrials() {
    const trialModalities = (() => {
      const set = new Set<string>();
      allTrials.forEach(t => { if (t.modality) set.add(t.modality); });
      return Array.from(set).sort();
    })();

    const filteredTrials = !selModality ? [] :
      allTrials.filter(t => t.modality === selModality && t.total_output > 0)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (allTrials.length === 0) {
      return (
        <div className="engine-section">
          <ViewHeader title="Time Trials" onBack={() => goTo('menu')} />
          <div className="engine-empty">
            <Activity size={32} />
            <div className="engine-empty-title">No Time Trials</div>
            <div className="engine-empty-desc">Complete a time trial to establish pace baselines for each piece of equipment.</div>
          </div>
        </div>
      );
    }

    return (
      <div className="engine-section">
        <ViewHeader title="Time Trials" onBack={() => goTo('menu')} />

        <PillSelector items={trialModalities} selected={selModality} onSelect={setSelModality} label="Select Modality" />

        {selModality && filteredTrials.length > 0 && (
          <>
            <div className="engine-card">
              <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 14, textAlign: 'center' }}>
                Output Over Time ({filteredTrials.length} trial{filteredTrials.length !== 1 ? 's' : ''})
              </h4>
              <HorizontalBarChart
                data={filteredTrials.map(t => t.total_output)}
                labels={filteredTrials.map(t => formatDateShort(t.date))}
                maxValue={Math.max(...filteredTrials.map(t => t.total_output), 1)}
                unit={` ${filteredTrials[0]?.units ?? ''}`}
              />
            </div>

            {/* Current baseline card */}
            {baselines.filter(b => b.modality === selModality).map(bl => (
              <div key={bl.id} className="engine-card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Current Baseline
                </div>
                <div className="engine-stat-value" style={{ fontSize: 28 }}>{bl.total_output}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{bl.units ?? 'cal'} in 10 min</div>
                {bl.calculated_rpm != null && (
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                    {bl.calculated_rpm.toFixed(1)} {bl.units ?? 'cal'}/min
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  // ── Render: Targets vs Actual ──

  function renderTargets() {
    const filteredSessions = (!selDayType || !selModality) ? [] :
      regularSessions.filter(s =>
        s.day_type === selDayType && s.modality === selModality && s.target_pace && s.actual_pace
      ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return (
      <div className="engine-section">
        <ViewHeader title="Targets vs Actual" onBack={() => goTo('menu')} />

        <PillSelector items={availableModalities} selected={selModality} onSelect={(v) => { setSelModality(v); setSelDayType(''); }} label="Select Modality" />

        {selModality && (
          <PillSelector items={availableDayTypes} selected={selDayType} onSelect={setSelDayType} label="Select Day Type" />
        )}

        {filteredSessions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredSessions.map((s, i) => {
              const target = s.target_pace ?? 0;
              const actual = s.actual_pace ?? 0;
              const maxPace = Math.max(target, actual, 1);
              return (
                <div key={s.id ?? i} className="engine-card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{formatDate(s.date)}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Day {s.program_day_number}</span>
                  </div>
                  <div className="ea-dual-bar">
                    <div className="ea-dual-row">
                      <span className="ea-dual-label" style={{ color: '#3b82f6' }}>Target</span>
                      <div className="ea-dual-track">
                        <div className="ea-dual-fill-target" style={{ width: `${(target / maxPace) * 100}%` }} />
                      </div>
                      <span className="ea-dual-value">{Math.round(target)}</span>
                    </div>
                    <div className="ea-dual-row">
                      <span className="ea-dual-label" style={{ color: 'var(--accent)' }}>Actual</span>
                      <div className="ea-dual-track">
                        <div className="ea-dual-fill-actual" style={{ width: `${(actual / maxPace) * 100}%` }} />
                      </div>
                      <span className="ea-dual-value">{Math.round(actual)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {selDayType && selModality && filteredSessions.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
            No sessions with both target and actual pace for this combination.
          </div>
        )}
      </div>
    );
  }

  // ── Render: Personal Records ──

  function renderRecords() {
    const records = (() => {
      if (!selModality) return [];
      const best: Record<string, EngineWorkoutSession> = {};
      regularSessions.forEach(s => {
        if (s.modality !== selModality || !s.day_type || !s.total_output) return;
        const dt = s.day_type;
        if (!best[dt] || (s.total_output ?? 0) > (best[dt].total_output ?? 0)) {
          best[dt] = s;
        }
      });
      return Object.values(best)
        .map(r => ({ ...r, pace: calculatePace(r) ?? 0 }))
        .sort((a, b) => b.pace - a.pace);
    })();

    return (
      <div className="engine-section">
        <ViewHeader title="Personal Records" onBack={() => goTo('menu')} />

        <PillSelector items={availableModalities} selected={selModality} onSelect={setSelModality} label="Select Modality" />

        {selModality && records.length > 0 && (
          <div className="engine-card">
            <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 14, textAlign: 'center' }}>
              Best Pace by Day Type
            </h4>
            <HorizontalBarChart
              data={records.map(r => r.pace)}
              labels={records.map(r => formatDayType(r.day_type ?? ''))}
              maxValue={Math.max(...records.map(r => r.pace), 1)}
              unit={` ${records[0]?.units ?? ''}/min`}
            />
          </div>
        )}

        {selModality && records.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
            No sessions with output data for this modality.
          </div>
        )}
      </div>
    );
  }

  // ── Render: HR Analytics ──

  function renderHeartRate() {
    const hrModalities = (() => {
      const set = new Set<string>();
      regularSessions.forEach(s => {
        if (s.modality && (s.average_heart_rate || s.peak_heart_rate)) set.add(s.modality);
      });
      return Array.from(set).sort();
    })();

    const hrMetrics = [
      { id: 'sessions', label: 'Sessions', unit: '' },
      { id: 'avg_hr', label: 'Avg HR', unit: ' bpm' },
      { id: 'avg_peak_hr', label: 'Avg Peak HR', unit: ' bpm' },
      { id: 'max_peak_hr', label: 'Max Peak HR', unit: ' bpm' },
      { id: 'efficiency', label: 'Efficiency', unit: '' },
      { id: 'training_load', label: 'Load', unit: '' },
    ];

    // Get latest baseline pace per modality (for training load calc)
    const baselinePaces = (() => {
      const map: Record<string, number> = {};
      const byMod: Record<string, EngineTimeTrial[]> = {};
      allTrials.forEach(t => {
        if (!byMod[t.modality]) byMod[t.modality] = [];
        byMod[t.modality].push(t);
      });
      Object.entries(byMod).forEach(([mod, trials]) => {
        const latest = [...trials].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        if (latest?.calculated_rpm) map[mod] = latest.calculated_rpm;
      });
      return map;
    })();

    const hrDayTypes = (() => {
      const set = new Set<string>();
      regularSessions.forEach(s => {
        if (s.day_type && (!selModality || s.modality === selModality) && (s.average_heart_rate || s.peak_heart_rate)) {
          set.add(s.day_type);
        }
      });
      return Array.from(set).sort();
    })();

    const chartData = (() => {
      const items = hrDayTypes.map(dt => {
        const dtSessions = regularSessions.filter(s =>
          s.day_type === dt && (!selModality || s.modality === selModality) && (s.average_heart_rate || s.peak_heart_rate)
        );
        if (dtSessions.length === 0) return null;

        const avgHRs = dtSessions.filter(s => s.average_heart_rate).map(s => s.average_heart_rate!);
        const peakHRs = dtSessions.filter(s => s.peak_heart_rate).map(s => s.peak_heart_rate!);
        const efficiencies: number[] = [];
        const loads: number[] = [];

        dtSessions.forEach(s => {
          const pace = calculatePace(s);
          const avgHR = s.average_heart_rate;
          const wd = s.workout_data as Record<string, unknown> | null;
          const durMin = wd?.total_work_seconds ? (wd.total_work_seconds as number) / 60 : 0;
          const baseline = baselinePaces[s.modality ?? ''];

          if (pace && avgHR && avgHR > 0) {
            efficiencies.push((pace / avgHR) * 1000);
            const intensity = baseline && baseline > 0 ? pace / baseline : 1;
            loads.push(Math.pow(intensity, 3) * avgHR * Math.sqrt(durMin || 1));
          }
        });

        const stats: Record<string, number> = {
          sessions: dtSessions.length,
          avg_hr: avgHRs.length > 0 ? avgHRs.reduce((a, b) => a + b, 0) / avgHRs.length : 0,
          avg_peak_hr: peakHRs.length > 0 ? peakHRs.reduce((a, b) => a + b, 0) / peakHRs.length : 0,
          max_peak_hr: peakHRs.length > 0 ? Math.max(...peakHRs) : 0,
          efficiency: efficiencies.length > 0 ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length : 0,
          training_load: loads.length > 0 ? loads.reduce((a, b) => a + b, 0) / loads.length : 0,
        };

        return { dayType: dt, value: stats[selMetric] || 0 };
      }).filter(Boolean) as { dayType: string; value: number }[];

      return items.filter(i => i.value > 0).sort((a, b) => b.value - a.value);
    })();

    const currentMetric = hrMetrics.find(m => m.id === selMetric);

    return (
      <div className="engine-section">
        <ViewHeader title="HR Analytics" onBack={() => goTo('menu')} />

        {hrModalities.length === 0 ? (
          <div className="engine-empty">
            <Activity size={32} />
            <div className="engine-empty-title">No Heart Rate Data</div>
            <div className="engine-empty-desc">Log heart rate during workouts to see analytics here.</div>
          </div>
        ) : (
          <>
            <PillSelector items={hrModalities} selected={selModality} onSelect={setSelModality} label="Select Modality" />

            <div className="engine-card" style={{ padding: 12 }}>
              <div className="ea-pill-label">Select Metric</div>
              <div className="ea-pills">
                {hrMetrics.map(m => (
                  <button key={m.id} className={'ea-pill' + (selMetric === m.id ? ' active' : '')} onClick={() => setSelMetric(m.id)}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {chartData.length > 0 ? (
              <div className="engine-card">
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 14, textAlign: 'center' }}>
                  {currentMetric?.label} by Day Type
                </h4>
                <HorizontalBarChart
                  data={chartData.map(d => d.value)}
                  labels={chartData.map(d => formatDayType(d.dayType))}
                  maxValue={Math.max(...chartData.map(d => d.value), 1)}
                  unit={currentMetric?.unit ?? ''}
                />
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                No heart rate data for this selection.
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Render: Work:Rest Ratio ──

  function renderWorkRest() {
    const wrModalities = (() => {
      const set = new Set<string>();
      regularSessions.forEach(s => {
        const wd = s.workout_data as Record<string, unknown> | null;
        if (s.modality && wd?.avg_work_rest_ratio) set.add(s.modality);
      });
      return Array.from(set).sort();
    })();

    const availableRatios = (() => {
      if (!selModality) return [];
      const set = new Set<string>();
      regularSessions.forEach(s => {
        const wd = s.workout_data as Record<string, unknown> | null;
        if (s.modality === selModality && wd?.avg_work_rest_ratio) {
          set.add(formatWorkRestRatio(wd.avg_work_rest_ratio as number));
        }
      });
      return Array.from(set).sort();
    })();

    const chartData = (() => {
      if (!selModality || selRatios.length === 0) return null;
      const groups: Record<string, EngineWorkoutSession[]> = {};
      regularSessions.forEach(s => {
        const wd = s.workout_data as Record<string, unknown> | null;
        if (s.modality === selModality && wd?.avg_work_rest_ratio && s.actual_pace) {
          const label = formatWorkRestRatio(wd.avg_work_rest_ratio as number);
          if (selRatios.includes(label)) {
            if (!groups[label]) groups[label] = [];
            groups[label].push(s);
          }
        }
      });

      const stats = Object.entries(groups).map(([ratio, sesList]) => ({
        ratio,
        count: sesList.length,
        avgPace: sesList.reduce((sum, s) => sum + (s.actual_pace ?? 0), 0) / sesList.length,
        units: sesList[0].units ?? '',
      })).sort((a, b) => b.avgPace - a.avgPace);

      return stats;
    })();

    return (
      <div className="engine-section">
        <ViewHeader title="Work:Rest Ratio" onBack={() => goTo('menu')} />

        {wrModalities.length === 0 ? (
          <div className="engine-empty">
            <Activity size={32} />
            <div className="engine-empty-title">No Work:Rest Data</div>
            <div className="engine-empty-desc">Work:rest data is recorded during interval workouts.</div>
          </div>
        ) : (
          <>
            <PillSelector items={wrModalities} selected={selModality} onSelect={(v) => { setSelModality(v); setSelRatios([]); }} label="Select Modality" />

            {selModality && availableRatios.length > 0 && (
              <div className="engine-card" style={{ padding: 16 }}>
                <div className="ea-pill-label">Select Ratio(s) to Compare</div>
                <div className="ea-pills">
                  {availableRatios.map(r => (
                    <button
                      key={r}
                      className={'ea-pill' + (selRatios.includes(r) ? ' active' : '')}
                      onClick={() => setSelRatios(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chartData && chartData.length > 0 && (
              <div className="engine-card">
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 14, textAlign: 'center' }}>
                  Average Pace by Ratio
                </h4>
                <HorizontalBarChart
                  data={chartData.map(d => d.avgPace)}
                  labels={chartData.map(d => `${d.ratio} (${d.count})`)}
                  maxValue={Math.max(...chartData.map(d => d.avgPace), 1)}
                  unit={` ${chartData[0]?.units ?? ''}/min`}
                />
              </div>
            )}
          </>
        )}
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
              {/* Back link to dashboard */}
              <button
                className="engine-btn engine-btn-secondary engine-btn-sm"
                onClick={() => navigate('/engine')}
                style={{ alignSelf: 'flex-start' }}
              >
                <ChevronLeft size={16} /> Dashboard
              </button>

              {view === 'menu' && renderMenu()}
              {view === 'overview' && renderOverview()}
              {view === 'history' && renderHistory()}
              {view === 'comparisons' && renderComparisons()}
              {view === 'time-trials' && renderTimeTrials()}
              {view === 'targets' && renderTargets()}
              {view === 'records' && renderRecords()}
              {view === 'heart-rate' && renderHeartRate()}
              {view === 'work-rest' && renderWorkRest()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
