import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import { ArrowLeft, ChevronDown, ChevronUp, Play } from 'lucide-react';
import '../ailog.css';

interface WorkoutItem {
  id: string;
  week_num: number;
  day_num: number;
  workout_text: string | null;
  sort_order: number;
}

interface ProgramData {
  id: string;
  name: string;
  gym_name: string | null;
  is_ongoing: boolean;
  source: string;
  created_at: string;
  committed: boolean;
}

export default function AILogProgramPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin, loading: entLoading } = useEntitlements(session.user.id);
  const [navOpen, setNavOpen] = useState(false);
  const [program, setProgram] = useState<ProgramData | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutItem[]>([]);
  const [workoutCount, setWorkoutCount] = useState(0);
  const [showWorkouts, setShowWorkouts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);

  const isDraft = program ? !program.committed : true;

  if (!entLoading && !isAdmin) {
    navigate('/programs');
    return null;
  }

  const commitProgram = async () => {
    if (!id || !program || committing) return;
    setCommitting(true);
    try {
      const { error } = await supabase
        .from('programs')
        .update({ committed: true })
        .eq('id', id)
        .eq('user_id', session.user.id);
      if (error) throw error;
      setProgram({ ...program, committed: true });
      navigate('/programs');
    } catch (err) {
      console.error('Commit failed:', err);
      setCommitting(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [progRes, workoutsRes] = await Promise.all([
        supabase.from('programs').select('id, name, gym_name, is_ongoing, source, created_at, committed').eq('id', id).single(),
        supabase.from('program_workouts').select('id, week_num, day_num, workout_text, sort_order').eq('program_id', id).order('sort_order'),
      ]);
      if (progRes.data) setProgram(progRes.data as ProgramData);
      if (workoutsRes.data) {
        setWorkouts(workoutsRes.data as WorkoutItem[]);
        setWorkoutCount(workoutsRes.data.length);
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <div className="loading-pulse" />
        </div>
      </div>
    );
  }

  if (!program) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <div className="ailog-page"><p>Program not found.</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => navigate('/ailog')}>
            <ArrowLeft size={16} /> Back
          </button>
          <h1 style={{ flex: 1 }}>{program.name}</h1>
        </header>

        <div className="ailog-page">
          {/* Program info card */}
          <div className="ailog-card" style={{ marginBottom: 16 }}>
            <div className="ailog-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  {program.gym_name && <div className="ailog-program-gym">{program.gym_name}</div>}
                  <div className="ailog-program-meta">
                    {workoutCount} workout{workoutCount !== 1 ? 's' : ''} uploaded
                    {isDraft && <span style={{ marginLeft: 8, fontSize: 11, color: '#fbbf24', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Draft</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {isDraft ? (
                    <button
                      className="ailog-btn ailog-btn-primary"
                      style={{ padding: '8px 14px', fontSize: 13, borderRadius: 6 }}
                      onClick={commitProgram}
                      disabled={committing}
                    >
                      {committing ? 'Saving...' : 'Commit to My Programs'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px 0' }}>Committed</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Workouts list */}
          {workouts.length > 0 && (
            <div className="ailog-card" style={{ marginBottom: 16 }}>
              <div className="ailog-section">
                <button
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', padding: 0, width: '100%' }}
                  onClick={() => setShowWorkouts(!showWorkouts)}
                >
                  <h3 className="ailog-header">Workouts ({workoutCount})</h3>
                  {showWorkouts ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {showWorkouts && workouts.map((w) => {
                  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                  const label = `Wk${w.week_num} ${dayNames[w.day_num] || `Day ${w.day_num}`}`;
                  const preview = w.workout_text
                    ? (w.workout_text.length > 80 ? w.workout_text.slice(0, 80) + '...' : w.workout_text)
                    : '';
                  return (
                    <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
                        {preview && <div style={{ fontSize: 13, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview}</div>}
                      </div>
                      <button
                        className="ailog-btn ailog-btn-secondary"
                        style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, flexShrink: 0 }}
                        onClick={() => navigate('/workout/start', { state: { source_id: w.id, source_type: 'external' } })}
                      >
                        <Play size={12} /> Log
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
