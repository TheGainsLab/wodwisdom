import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface ProgramWorkout {
  id: string;
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order: number;
}

const DAY_LABELS: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};

export default function ProgramDetailPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [program, setProgram] = useState<{ id: string; name: string } | null>(null);
  const [workouts, setWorkouts] = useState<ProgramWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadProgram();
  }, [id, session.user.id]);

  const loadProgram = async () => {
    if (!id) return;
    setLoading(true);
    const { data: prog, error: progErr } = await supabase
      .from('programs')
      .select('id, name')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();
    if (progErr || !prog) {
      setProgram(null);
      setWorkouts([]);
      setLoading(false);
      return;
    }
    setProgram(prog);
    const { data: wk } = await supabase
      .from('program_workouts')
      .select('id, week_num, day_num, workout_text, sort_order')
      .eq('program_id', id)
      .order('sort_order');
    setWorkouts(wk || []);
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!id || !program) return;
    if (!window.confirm('Delete this program? This cannot be undone.')) return;
    const { error } = await supabase.from('programs').delete().eq('id', id).eq('user_id', session.user.id);
    if (error) {
      console.error('Delete failed:', error);
      return;
    }
    navigate('/programs');
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
          <h1>{program?.name || 'Program'}</h1>
        </header>
        <div className="page-body">
          <div className="program-detail-wrap">
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : !program ? (
              <div className="empty-state">
                <p>Program not found.</p>
                <button className="auth-btn" onClick={() => navigate('/programs')}>Back to programs</button>
              </div>
            ) : (
              <>
                <div className="program-workouts-table-wrap">
                  <table className="program-workouts-table">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Day</th>
                        <th>Workout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workouts.map(w => (
                        <tr key={w.id}>
                          <td>{w.week_num}</td>
                          <td>{DAY_LABELS[w.day_num] || w.day_num}</td>
                          <td className="workout-text-cell">{w.workout_text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="program-detail-actions" style={{ marginTop: 24 }}>
                  <button className="auth-btn" style={{ background: 'var(--surface2)', color: 'var(--text)' }} onClick={() => navigate('/programs')}>
                    Back
                  </button>
                  <button className="auth-btn" style={{ background: 'var(--surface2)', color: 'var(--text)' }} onClick={() => navigate(`/programs/${id}/edit`)}>
                    Edit
                  </button>
                  <button className="auth-btn" style={{ background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)' }} onClick={handleDelete}>
                    Delete
                  </button>
                  <button className="auth-btn" disabled style={{ opacity: 0.6 }} title="Coming soon">
                    Analyze program
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
