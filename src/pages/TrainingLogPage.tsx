import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface WorkoutLog {
  id: string;
  workout_date: string;
  workout_text: string;
  workout_type: string;
  created_at: string;
}

interface WorkoutLogBlock {
  log_id: string;
  block_type: string;
  block_label: string | null;
  block_text: string;
  score: string | null;
  rx: boolean;
  sort_order: number;
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

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('workout_logs')
        .select('id, workout_date, workout_text, workout_type, created_at')
        .eq('user_id', session.user.id)
        .order('workout_date', { ascending: false })
        .limit(50);
      const logRows = (data as WorkoutLog[]) || [];
      setLogs(logRows);

      if (logRows.length > 0) {
        const logIds = logRows.map(l => l.id);
        const [{ data: blocks }, { data: entries }] = await Promise.all([
          supabase
            .from('workout_log_blocks')
            .select('log_id, block_type, block_label, block_text, score, rx, sort_order')
            .in('log_id', logIds),
          supabase
            .from('workout_log_entries')
            .select('log_id, movement, sets, reps, weight, weight_unit, rpe, scaling_note, block_label, set_number, reps_completed, hold_seconds, distance, distance_unit, quality, variation, sort_order')
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
        for (const e of (entries as WorkoutLogEntry[]) || []) {
          if (!groupedEntries[e.log_id]) groupedEntries[e.log_id] = [];
          groupedEntries[e.log_id].push(e);
        }
        for (const logId of Object.keys(groupedEntries)) {
          groupedEntries[logId].sort((a, b) => a.sort_order - b.sort_order);
        }
        setEntriesByLog(groupedEntries);
      }

      setLoading(false);
    })();
  }, [session.user.id]);

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
        <InviteBanner session={session} />
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
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : logs.length === 0 ? (
              <div className="workout-review-section" style={{ textAlign: 'center', padding: 40 }}>
                <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>No workouts logged yet.</p>
                <button className="auth-btn" onClick={() => navigate('/workout/start')} style={{ maxWidth: 200 }}>
                  Log your first workout
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {logs.map(log => {
                  const logBlocks = blocksByLog[log.id] || [];
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
                        {/* Show first scored block's score as preview */}
                        {hasScores && (
                          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 14, color: 'var(--text-dim)' }}>
                            {logBlocks.find(b => b.score)!.score}
                            {logBlocks.filter(b => b.score).length > 1 && ` +${logBlocks.filter(b => b.score).length - 1}`}
                          </span>
                        )}
                      </div>

                      {/* Block-level scores summary (always visible if multiple scored blocks) */}
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
                                  const blockEntries = logEntries.filter(e => e.block_label === block.block_label);
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
                                      </div>
                                      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-dim)', paddingLeft: 8 }}>
                                        {block.block_text}
                                      </div>

                                      {/* Strength: show per-set entries grouped by movement */}
                                      {block.block_type === 'strength' && blockEntries.length > 0 && (() => {
                                        const hasPerSet = blockEntries.some(e => e.set_number != null);
                                        if (!hasPerSet) {
                                          // Legacy single-row display
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
                                        // Group per-set entries by movement
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

                                      {/* Skills: simplified display */}
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

                                      {/* Metcon: show movements with load */}
                                      {block.block_type === 'metcon' && blockEntries.length > 0 && (
                                        <div style={{ paddingLeft: 8, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                          {blockEntries.map((entry, ei) => (
                                            <span key={ei} style={{ fontSize: 12, color: 'var(--text-dim)', background: 'var(--surface2)', padding: '3px 8px', borderRadius: 4 }}>
                                              {formatMovementName(entry.movement)}
                                              {entry.weight != null && ` ${entry.weight}${entry.weight_unit}`}
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
