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
  other: 'Other',
};

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
        const { data: blocks } = await supabase
          .from('workout_log_blocks')
          .select('log_id, block_type, block_label, block_text, score, rx, sort_order')
          .in('log_id', logIds);

        const grouped: Record<string, WorkoutLogBlock[]> = {};
        for (const b of (blocks as WorkoutLogBlock[]) || []) {
          if (!grouped[b.log_id]) grouped[b.log_id] = [];
          grouped[b.log_id].push(b);
        }
        // Sort each group by sort_order
        for (const logId of Object.keys(grouped)) {
          grouped[logId].sort((a, b) => a.sort_order - b.sort_order);
        }
        setBlocksByLog(grouped);
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

                      {expandedId === log.id && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                          {logBlocks.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {logBlocks.map((block, i) => (
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
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-dim)' }}>
                              {log.workout_text}
                            </div>
                          )}
                        </div>
                      )}
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
