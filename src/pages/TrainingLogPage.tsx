import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import WorkoutCalendar from '../components/WorkoutCalendar';
import PersonalRecords from '../components/PersonalRecords';

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
  const [tab, setTab] = useState<'overview' | 'history'>('overview');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Flat list of all entries for PR calculation
  const [allEntries, setAllEntries] = useState<(WorkoutLogEntry & { workout_date: string })[]>([]);

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

  const strengthRecords = useMemo(() => {
    // Find heaviest weight logged per movement (only entries that have weight)
    const best = new Map<string, { weight: number; weight_unit: string; reps: number | null; date: string }>();
    for (const e of allEntries) {
      if (e.weight == null || e.weight <= 0) continue;
      const key = e.movement;
      const existing = best.get(key);
      if (!existing || e.weight > existing.weight) {
        best.set(key, { weight: e.weight, weight_unit: e.weight_unit, reps: e.reps_completed ?? e.reps, date: e.workout_date });
      }
    }
    return [...best.entries()]
      .map(([movement, data]) => ({ movement, ...data }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);
  }, [allEntries]);

  const metconRecords = useMemo(() => {
    // Gather scored metcon blocks
    const scored: { block_label: string; score: string; date: string; block_type: string }[] = [];
    for (const log of logs) {
      const blocks = blocksByLog[log.id] || [];
      for (const block of blocks) {
        if (block.block_type === 'metcon' && block.score) {
          scored.push({
            block_label: block.block_label || getMetconTypeLabel(block.block_text),
            score: block.score,
            date: log.workout_date,
            block_type: block.block_type,
          });
        }
      }
    }
    return scored.slice(0, 6);
  }, [logs, blocksByLog]);

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
              <button className={`tl-tab${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>
                Overview
              </button>
              <button className={`tl-tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
                History
              </button>
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

                <PersonalRecords strengthRecords={strengthRecords} metconRecords={metconRecords} />
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
                                                  {entry.rpe != null && <span> RPE {entry.rpe}</span>}
                                                  {entry.scaling_note && <span style={{ fontStyle: 'italic' }}> — {entry.scaling_note}</span>}
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
