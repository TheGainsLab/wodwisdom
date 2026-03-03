import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import WorkoutCalendar from '../components/WorkoutCalendar';

interface WorkoutLog {
  id: string;
  workout_date: string;
  workout_text: string;
  workout_type: string;
  created_at: string;
}

interface WorkoutLogBlock {
  id: string;
  log_id: string;
  block_type: string;
  block_label: string | null;
  block_text: string;
  score: string | null;
  rx: boolean;
  sort_order: number;
  percentile: number | null;
  performance_tier: string | null;
  median_benchmark: string | null;
  excellent_benchmark: string | null;
}

interface WorkoutLogEntry {
  log_id: string;
  movement: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  weight_unit: string;
  rpe: number | null;
  scaling_note: string | null;
  block_id: string | null;
  block_label: string | null;
  set_number: number | null;
  reps_completed: number | null;
  hold_seconds: number | null;
  distance: number | null;
  distance_unit: string | null;
  quality: string | null;
  variation: string | null;
  sort_order: number;
}

const TYPE_LABELS: Record<string, string> = {
  for_time: 'For Time',
  amrap: 'AMRAP',
  emom: 'EMOM',
  strength: 'Strength',
  other: 'Other',
};

const BLOCK_TYPE_LABELS: Record<string, string> = {
  'warm-up': 'Warm-up',
  skills: 'Skills',
  strength: 'Strength',
  metcon: 'Metcon',
  'cool-down': 'Cool-down',
  accessory: 'Accessory',
};

function formatMovementName(canonical: string): string {
  return canonical.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getMetconTypeLabel(text: string): string {
  const t = text.toUpperCase();
  if (/AMRAP|AS MANY ROUNDS/.test(t)) return 'AMRAP';
  if (/EMOM|E\d+MOM/.test(t)) return 'EMOM';
  return 'For Time';
}

export default function TrainingLogPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [blocksByLog, setBlocksByLog] = useState<Record<string, WorkoutLogBlock[]>>({});
  const [entriesByLog, setEntriesByLog] = useState<Record<string, WorkoutLogEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [blockFilter, setBlockFilter] = useState<string>('all');
  const [tab, setTab] = useState<'overview' | 'strength' | 'skills' | 'history'>('overview');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [strengthSearch, setStrengthSearch] = useState('');
  const [strengthSort, setStrengthSort] = useState<'weight' | 'date'>('weight');
  const [skillsSearch, setSkillsSearch] = useState('');
  const [skillsSort, setSkillsSort] = useState<'date' | 'name'>('date');

  const [allEntries, setAllEntries] = useState<(WorkoutLogEntry & { workout_date: string })[]>([]);
  const [blockTypeMap, setBlockTypeMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('workout_logs')
        .select('id, workout_date, workout_text, workout_type, created_at')
        .eq('user_id', session.user.id)
        .order('workout_date', { ascending: false })
        .limit(200);
      const logRows = (data as WorkoutLog[]) || [];
      setLogs(logRows);

      if (logRows.length > 0) {
        const logIds = logRows.map(l => l.id);
        const [{ data: blocks }, { data: entries }] = await Promise.all([
          supabase
            .from('workout_log_blocks')
            .select('id, log_id, block_type, block_label, block_text, score, rx, sort_order, percentile, performance_tier, median_benchmark, excellent_benchmark')
            .in('log_id', logIds),
          supabase
            .from('workout_log_entries')
            .select('log_id, movement, sets, reps, weight, weight_unit, rpe, scaling_note, block_id, block_label, set_number, reps_completed, hold_seconds, distance, distance_unit, quality, variation, sort_order')
            .in('log_id', logIds),
        ]);

        const grouped: Record<string, WorkoutLogBlock[]> = {};
        for (const b of (blocks as WorkoutLogBlock[]) || []) {
          if (!grouped[b.log_id]) grouped[b.log_id] = [];
          grouped[b.log_id].push(b);
        }
        for (const logId of Object.keys(grouped)) {
          grouped[logId].sort((a, b) => a.sort_order - b.sort_order);
        }
        setBlocksByLog(grouped);

        const btMap = new Map<string, string>();
        for (const b of (blocks as WorkoutLogBlock[]) || []) {
          btMap.set(b.id, b.block_type);
        }
        setBlockTypeMap(btMap);

        const groupedEntries: Record<string, WorkoutLogEntry[]> = {};
        const dateMap = new Map(logRows.map(l => [l.id, l.workout_date]));
        const flatEntries: (WorkoutLogEntry & { workout_date: string })[] = [];
        for (const e of (entries as WorkoutLogEntry[]) || []) {
          if (!groupedEntries[e.log_id]) groupedEntries[e.log_id] = [];
          groupedEntries[e.log_id].push(e);
          flatEntries.push({ ...e, workout_date: dateMap.get(e.log_id) || '' });
        }
        for (const logId of Object.keys(groupedEntries)) {
          groupedEntries[logId].sort((a, b) => a.sort_order - b.sort_order);
        }
        setEntriesByLog(groupedEntries);
        setAllEntries(flatEntries);
      }

      setLoading(false);
    })();
  }, [session.user.id]);

  // ── Derived data for overview tab ──

  const workoutCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const log of logs) {
      const key = log.workout_date; // already YYYY-MM-DD from supabase
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [logs]);

  const logsByDate = useMemo(() => {
    const map: Record<string, WorkoutLog[]> = {};
    for (const log of logs) {
      if (!map[log.workout_date]) map[log.workout_date] = [];
      map[log.workout_date].push(log);
    }
    return map;
  }, [logs]);

  // ── Strength data: group entries by movement ──
  const strengthByMovement = useMemo(() => {
    const map = new Map<string, { entries: (WorkoutLogEntry & { workout_date: string })[]; best: number; bestUnit: string }>();
    for (const e of allEntries) {
      if (!e.block_id || blockTypeMap.get(e.block_id) !== 'strength') continue;
      if (e.weight == null || e.weight <= 0) continue;
      const existing = map.get(e.movement);
      if (existing) {
        existing.entries.push(e);
        if (e.weight > existing.best) { existing.best = e.weight; existing.bestUnit = e.weight_unit; }
      } else {
        map.set(e.movement, { entries: [e], best: e.weight, bestUnit: e.weight_unit });
      }
    }
    return map;
  }, [allEntries, blockTypeMap]);

  // ── Skills data: group entries by movement ──
  const skillsByMovement = useMemo(() => {
    const map = new Map<string, (WorkoutLogEntry & { workout_date: string })[]>();
    for (const e of allEntries) {
      if (!e.block_id || blockTypeMap.get(e.block_id) !== 'skills') continue;
      const list = map.get(e.movement) || [];
      list.push(e);
      map.set(e.movement, list);
    }
    return map;
  }, [allEntries, blockTypeMap]);

  // ── Helpers ──

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getBlockLabel = (block: WorkoutLogBlock) => {
    if (block.block_type === 'metcon') return getMetconTypeLabel(block.block_text);
    return BLOCK_TYPE_LABELS[block.block_type] || block.block_type;
  };

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Training Log</h1>
          <button
            className="auth-btn"
            onClick={() => navigate('/workout/start')}
            style={{ marginLeft: 'auto', maxWidth: 160, padding: '10px 16px', fontSize: 14 }}
          >
            Log Workout
          </button>
        </header>

        <div className="page-body">
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 0' }}>
            {/* Tab switcher */}
            <div className="tl-tabs">
              {([['overview', 'Overview'], ['strength', 'Strength'], ['skills', 'Skills'], ['history', 'History']] as const).map(([id, label]) => (
                <button
                  key={id}
                  className={`tl-tab${tab === id ? ' active' : ''}`}
                  onClick={() => setTab(id as typeof tab)}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : logs.length === 0 ? (
              <div className="workout-review-section" style={{ textAlign: 'center', padding: 40 }}>
                <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>No workouts logged yet.</p>
                <button className="auth-btn" onClick={() => navigate('/workout/start')} style={{ maxWidth: 200 }}>
                  Log your first workout
                </button>
              </div>
            ) : tab === 'overview' ? (
              /* ── Overview Tab ── */
              <div>
                <WorkoutCalendar
                  workoutCounts={workoutCounts}
                  selectedDate={selectedDate}
                  onDayClick={(key) => setSelectedDate(selectedDate === key ? null : key)}
                />

                {/* Day detail panel */}
                {selectedDate && logsByDate[selectedDate] && (
                  <div className="wc-day-detail" style={{ marginBottom: 16 }}>
                    <div className="wc-day-detail-header">
                      <span className="wc-day-detail-date">
                        {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </span>
                      <button className="wc-day-detail-close" onClick={() => setSelectedDate(null)} aria-label="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                    {logsByDate[selectedDate].map(log => {
                      const logBlocks = blocksByLog[log.id] || [];
                      return logBlocks.length > 0 ? (
                        logBlocks.map((block, i) => (
                          <div key={`${log.id}-${i}`} className="wc-day-detail-block">
                            <div className="wc-day-detail-block-header">
                              <span className="wc-day-detail-type">{getBlockLabel(block)}</span>
                              {block.score && <span className="wc-day-detail-score">{block.score}</span>}
                              {block.rx && <span style={{ fontSize: 11, background: 'var(--accent-glow)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4 }}>Rx</span>}
                              {block.percentile != null && (
                                <span style={{
                                  fontSize: 11, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                                  background: block.percentile >= 75 ? 'rgba(34,197,94,0.15)' : block.percentile >= 40 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                                  color: block.percentile >= 75 ? '#22c55e' : block.percentile >= 40 ? '#eab308' : '#ef4444',
                                }}>{block.percentile}th %ile</span>
                              )}
                            </div>
                            <div className="wc-day-detail-text">{block.block_text}</div>
                          </div>
                        ))
                      ) : (
                        <div key={log.id} className="wc-day-detail-block">
                          <div className="wc-day-detail-block-header">
                            <span className="wc-day-detail-type">{TYPE_LABELS[log.workout_type] || log.workout_type}</span>
                          </div>
                          <div className="wc-day-detail-text">{log.workout_text}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>
            ) : tab === 'strength' ? (
              /* ── Strength Tab ── */
              <div>
                <input
                  className="tl-search"
                  type="text"
                  placeholder="Search movements..."
                  value={strengthSearch}
                  onChange={e => setStrengthSearch(e.target.value)}
                />
                <div className="tl-sort-bar">
                  <span>Sort:</span>
                  <button className={`tl-sort-btn${strengthSort === 'weight' ? ' active' : ''}`} onClick={() => setStrengthSort('weight')}>By Weight</button>
                  <button className={`tl-sort-btn${strengthSort === 'date' ? ' active' : ''}`} onClick={() => setStrengthSort('date')}>By Date</button>
                </div>
                {(() => {
                  const q = strengthSearch.toLowerCase();
                  let movements = [...strengthByMovement.entries()]
                    .filter(([m]) => !q || formatMovementName(m).toLowerCase().includes(q));
                  if (strengthSort === 'weight') {
                    movements.sort((a, b) => b[1].best - a[1].best);
                  } else {
                    movements.sort((a, b) => {
                      const latestA = a[1].entries.reduce((d, e) => e.workout_date > d ? e.workout_date : d, '');
                      const latestB = b[1].entries.reduce((d, e) => e.workout_date > d ? e.workout_date : d, '');
                      return latestB.localeCompare(latestA);
                    });
                  }
                  if (movements.length === 0) {
                    return (
                      <div className="tl-empty">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11" /><path d="M6.5 17.5h11" /><path d="M12 2v20" /><path d="M2 12h4" /><path d="M18 12h4" /><circle cx="4.5" cy="6.5" r="2.5" /><circle cx="4.5" cy="17.5" r="2.5" /><circle cx="19.5" cy="6.5" r="2.5" /><circle cx="19.5" cy="17.5" r="2.5" /></svg>
                        <div className="tl-empty-title">{q ? 'No matching movements' : 'No Strength Data'}</div>
                        <div className="tl-empty-desc">{q ? 'Try a different search term.' : 'Log a workout with strength blocks to see your lifts here.'}</div>
                      </div>
                    );
                  }
                  return movements.map(([movement, data]) => {
                    const sorted = [...data.entries].sort((a, b) =>
                      strengthSort === 'weight'
                        ? (b.weight ?? 0) - (a.weight ?? 0)
                        : b.workout_date.localeCompare(a.workout_date)
                    );
                    const recent = sorted.slice(0, 8);
                    return (
                      <div key={movement} className="tl-movement-card">
                        <div className="tl-movement-header">
                          <span className="tl-movement-name">{formatMovementName(movement)}</span>
                          <span className="tl-pr-badge">PR: {data.best}{data.bestUnit}</span>
                        </div>
                        <div className="tl-session-count">{data.entries.length} set{data.entries.length !== 1 ? 's' : ''} logged</div>
                        <div style={{ marginTop: 8 }}>
                          {recent.map((e, i) => (
                            <div key={i} className="tl-set-row">
                              <span className="tl-set-date">{new Date(e.workout_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              <span className="tl-set-value">
                                {e.weight}{e.weight_unit}
                                {(e.reps_completed ?? e.reps) != null && ` x${e.reps_completed ?? e.reps}`}
                              </span>
                              {e.set_number != null && <span className="tl-set-detail">Set {e.set_number}</span>}
                              {e.rpe != null && <span className="tl-set-detail">RPE {e.rpe}</span>}
                            </div>
                          ))}
                          {sorted.length > 8 && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 6 }}>
                              +{sorted.length - 8} more
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : tab === 'skills' ? (
              /* ── Skills Tab ── */
              <div>
                <input
                  className="tl-search"
                  type="text"
                  placeholder="Search movements..."
                  value={skillsSearch}
                  onChange={e => setSkillsSearch(e.target.value)}
                />
                <div className="tl-sort-bar">
                  <span>Sort:</span>
                  <button className={`tl-sort-btn${skillsSort === 'date' ? ' active' : ''}`} onClick={() => setSkillsSort('date')}>By Date</button>
                  <button className={`tl-sort-btn${skillsSort === 'name' ? ' active' : ''}`} onClick={() => setSkillsSort('name')}>By Name</button>
                </div>
                {(() => {
                  const q = skillsSearch.toLowerCase();
                  let movements = [...skillsByMovement.entries()]
                    .filter(([m]) => !q || formatMovementName(m).toLowerCase().includes(q));
                  if (skillsSort === 'name') {
                    movements.sort((a, b) => a[0].localeCompare(b[0]));
                  } else {
                    movements.sort((a, b) => {
                      const latestA = a[1].reduce((d, e) => e.workout_date > d ? e.workout_date : d, '');
                      const latestB = b[1].reduce((d, e) => e.workout_date > d ? e.workout_date : d, '');
                      return latestB.localeCompare(latestA);
                    });
                  }
                  if (movements.length === 0) {
                    return (
                      <div className="tl-empty">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                        <div className="tl-empty-title">{q ? 'No matching movements' : 'No Skills Data'}</div>
                        <div className="tl-empty-desc">{q ? 'Try a different search term.' : 'Log a workout with skills blocks to track your progress here.'}</div>
                      </div>
                    );
                  }
                  return movements.map(([movement, entries]) => {
                    const sorted = [...entries].sort((a, b) => b.workout_date.localeCompare(a.workout_date));
                    const recent = sorted.slice(0, 8);
                    const uniqueDates = new Set(entries.map(e => e.workout_date));
                    return (
                      <div key={movement} className="tl-movement-card">
                        <div className="tl-movement-header">
                          <span className="tl-movement-name">{formatMovementName(movement)}</span>
                        </div>
                        <div className="tl-session-count">{uniqueDates.size} session{uniqueDates.size !== 1 ? 's' : ''}</div>
                        <div style={{ marginTop: 8 }}>
                          {recent.map((e, i) => (
                            <div key={i} className="tl-set-row">
                              <span className="tl-set-date">{new Date(e.workout_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              <span className="tl-set-value">
                                {e.sets != null && `${e.sets} sets`}
                                {e.reps_completed != null && ` x${e.reps_completed}`}
                                {e.hold_seconds != null && ` ${e.hold_seconds}s hold`}
                              </span>
                              {e.rpe != null && <span className="tl-set-detail">RPE {e.rpe}</span>}
                              {e.quality && <span className="tl-set-detail">{e.quality}</span>}
                              {e.scaling_note && <span className="tl-set-detail" style={{ fontStyle: 'italic' }}>{e.scaling_note}</span>}
                            </div>
                          ))}
                          {sorted.length > 8 && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 6 }}>
                              +{sorted.length - 8} more
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              /* ── History Tab ── */
              <>
                <div className="source-toggle" style={{ marginBottom: 16 }}>
                  {(['all', 'strength', 'skills', 'metcon', 'accessory'] as const).map(f => (
                    <button
                      key={f}
                      className={'source-btn' + (blockFilter === f ? ' active' : '')}
                      onClick={() => { setBlockFilter(f); setExpandedId(null); }}
                    >
                      {f === 'all' ? 'All' : BLOCK_TYPE_LABELS[f] || f}
                    </button>
                  ))}
                </div>
                {(() => {
                  const filtered = blockFilter === 'all'
                    ? logs
                    : logs.filter(log => (blocksByLog[log.id] || []).some(b => b.block_type === blockFilter));
                  return filtered.length === 0 ? (
                    <div className="workout-review-section" style={{ textAlign: 'center', padding: 40 }}>
                      <p style={{ color: 'var(--text-dim)' }}>No {BLOCK_TYPE_LABELS[blockFilter]?.toLowerCase() || ''} workouts found.</p>
                    </div>
                  ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {filtered.map(log => {
                      const allBlocks = blocksByLog[log.id] || [];
                      const logBlocks = blockFilter === 'all'
                        ? allBlocks
                        : allBlocks.filter(b => b.block_type === blockFilter);
                      const hasScores = logBlocks.some(b => b.score);
                      const hasRx = logBlocks.some(b => b.rx);

                      return (
                        <div
                          key={log.id}
                          className="workout-review-section"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                            <div>
                              <span style={{ fontWeight: 700, fontSize: 15 }}>{formatDate(log.workout_date)}</span>
                              <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--accent)', textTransform: 'uppercase' }}>
                                {TYPE_LABELS[log.workout_type] || log.workout_type}
                              </span>
                              {hasRx && <span style={{ marginLeft: 8, fontSize: 11, background: 'var(--accent-glow)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4 }}>Rx</span>}
                            </div>
                            {hasScores && (
                              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 14, color: 'var(--text-dim)' }}>
                                {logBlocks.find(b => b.score)!.score}
                                {logBlocks.filter(b => b.score).length > 1 && ` +${logBlocks.filter(b => b.score).length - 1}`}
                              </span>
                            )}
                          </div>

                          {logBlocks.filter(b => b.score).length > 1 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                              {logBlocks.filter(b => b.score).map((block, i) => (
                                <span
                                  key={i}
                                  style={{
                                    fontSize: 12,
                                    color: 'var(--text-dim)',
                                    background: 'var(--surface2)',
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    fontFamily: 'JetBrains Mono',
                                  }}
                                >
                                  {getBlockLabel(block)}: {block.score}{block.rx ? ' Rx' : ''}
                                </span>
                              ))}
                            </div>
                          )}

                          {expandedId === log.id && (() => {
                            const logEntries = entriesByLog[log.id] || [];
                            return (
                              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                                {logBlocks.length > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {logBlocks.map((block, i) => {
                                      const blockEntries = logEntries.filter(e => e.block_id ? e.block_id === block.id : e.block_label === block.block_label);
                                      const isSkills = block.block_type === 'skills';
                                      return (
                                        <div key={i}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', textTransform: 'uppercase' }}>
                                              {getBlockLabel(block)}
                                            </span>
                                            {block.score && (
                                              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: 'var(--text-dim)' }}>
                                                {block.score}
                                              </span>
                                            )}
                                            {block.rx && (
                                              <span style={{ fontSize: 11, background: 'var(--accent-glow)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4 }}>Rx</span>
                                            )}
                                            {block.percentile != null && (
                                              <span style={{
                                                fontSize: 11,
                                                padding: '1px 6px',
                                                borderRadius: 4,
                                                fontWeight: 600,
                                                background: block.percentile >= 75 ? 'rgba(34,197,94,0.15)' : block.percentile >= 40 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                                                color: block.percentile >= 75 ? '#22c55e' : block.percentile >= 40 ? '#eab308' : '#ef4444',
                                              }}>
                                                {block.percentile}th %ile
                                              </span>
                                            )}
                                          </div>
                                          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-dim)', paddingLeft: 8 }}>
                                            {block.block_text}
                                          </div>

                                          {block.block_type === 'strength' && blockEntries.length > 0 && (() => {
                                            const hasPerSet = blockEntries.some(e => e.set_number != null);
                                            if (!hasPerSet) {
                                              return (
                                                <div style={{ paddingLeft: 8, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                  {blockEntries.map((entry, ei) => (
                                                    <div key={ei} style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                                                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{formatMovementName(entry.movement)}</span>
                                                      {entry.sets != null && entry.reps != null && <span> {entry.sets}x{entry.reps}</span>}
                                                      {entry.weight != null && <span> @{entry.weight}{entry.weight_unit}</span>}
                                                      {entry.rpe != null && <span> RPE {entry.rpe}</span>}
                                                    </div>
                                                  ))}
                                                </div>
                                              );
                                            }
                                            const byMovement = new Map<string, WorkoutLogEntry[]>();
                                            for (const e of blockEntries) {
                                              const list = byMovement.get(e.movement) || [];
                                              list.push(e);
                                              byMovement.set(e.movement, list);
                                            }
                                            return (
                                              <div style={{ paddingLeft: 8, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {[...byMovement.entries()].map(([movement, rows]) => (
                                                  <div key={movement}>
                                                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{formatMovementName(movement)}</div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                      {rows.map((r, ri) => (
                                                        <span key={ri} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'var(--surface2)', padding: '3px 8px', borderRadius: 4, fontFamily: 'JetBrains Mono' }}>
                                                          S{r.set_number}: {r.reps ?? '?'}@{r.weight ?? '?'}{r.weight_unit}{r.rpe != null ? ` RPE ${r.rpe}` : ''}
                                                        </span>
                                                      ))}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            );
                                          })()}

                                          {isSkills && blockEntries.length > 0 && (
                                            <div style={{ paddingLeft: 8, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                              {blockEntries.map((entry, ei) => (
                                                <div key={ei} style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                                                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{formatMovementName(entry.movement)}</span>
                                                  {entry.sets != null && <span> {entry.sets} sets</span>}
                                                  {entry.reps_completed != null && <span> x{entry.reps_completed} reps</span>}
                                                  {entry.hold_seconds != null && <span> {entry.hold_seconds}s hold</span>}
                                                  {entry.rpe != null && <span> RPE {entry.rpe}</span>}
                                                  {entry.quality && <span style={{ fontSize: 11, marginLeft: 4, background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>{entry.quality}</span>}
                                                  {entry.variation && <span style={{ fontStyle: 'italic' }}> — {entry.variation}</span>}
                                                </div>
                                              ))}
                                            </div>
                                          )}

                                          {block.block_type === 'metcon' && blockEntries.length > 0 && (
                                            <div style={{ paddingLeft: 8, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                              {blockEntries.map((entry, ei) => (
                                                <span key={ei} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'var(--surface2)', padding: '3px 8px', borderRadius: 4 }}>
                                                  {formatMovementName(entry.movement)}
                                                  {entry.reps != null && ` x${entry.reps}`}
                                                  {entry.weight != null && ` @${entry.weight}${entry.weight_unit}`}
                                                  {entry.distance != null && ` ${entry.distance}${entry.distance_unit || 'm'}`}
                                                  {entry.scaling_note && ` (${entry.scaling_note})`}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-dim)' }}>
                                    {log.workout_text}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
