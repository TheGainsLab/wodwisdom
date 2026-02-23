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
  score: string | null;
  rx: boolean;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  for_time: 'For Time',
  amrap: 'AMRAP',
  emom: 'EMOM',
  strength: 'Strength',
  other: 'Other',
};

export default function TrainingLogPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('workout_logs')
        .select('id, workout_date, workout_text, workout_type, score, rx, created_at')
        .eq('user_id', session.user.id)
        .order('workout_date', { ascending: false })
        .limit(50);
      setLogs((data as WorkoutLog[]) || []);
      setLoading(false);
    })();
  }, [session.user.id]);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
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
                {logs.map(log => (
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
                        {log.rx && <span style={{ marginLeft: 8, fontSize: 11, background: 'var(--accent-glow)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4 }}>Rx</span>}
                      </div>
                      {log.score && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 14, color: 'var(--text-dim)' }}>{log.score}</span>}
                    </div>
                    {expandedId === log.id && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--text-dim)' }}>
                        {log.workout_text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
