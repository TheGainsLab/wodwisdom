import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface Program {
  id: string;
  name: string;
  created_at: string;
  workout_count?: number;
}

export default function ProgramsListPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    loadPrograms();
  }, [session.user.id]);

  const loadPrograms = async () => {
    setLoading(true);
    const { data: progData } = await supabase
      .from('programs')
      .select('id, name, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    if (progData) {
      const withCount = await Promise.all(
        progData.map(async p => {
          const { count } = await supabase
            .from('program_workouts')
            .select('id', { count: 'exact', head: true })
            .eq('program_id', p.id);
          return { ...p, workout_count: count || 0 };
        })
      );
      setPrograms(withCount);
    }
    setLoading(false);
  };

  const handleDelete = async (e: React.MouseEvent, programId: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this program? This cannot be undone.')) return;
    const { error } = await supabase.from('programs').delete().eq('id', programId).eq('user_id', session.user.id);
    if (!error) setPrograms(prev => prev.filter(p => p.id !== programId));
  };

  const formatDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
          <h1>Programs</h1>
        </header>
        <div className="page-body">
          <div className="programs-list-wrap">
            <button className="add-program-cta" onClick={() => navigate('/programs/new')}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add program
            </button>
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : programs.length === 0 ? (
              <div className="empty-state">
                <p>No programs yet.</p>
                <p>Add a program to paste or upload weeks of workouts for analysis.</p>
                <button className="auth-btn" onClick={() => navigate('/programs/new')}>Add your first program</button>
              </div>
            ) : (
              <div className="history-list">
                {programs.map(p => (
                  <div
                    key={p.id}
                    className="history-item"
                    onClick={() => navigate(`/programs/${p.id}`)}
                  >
                    <div className="history-item-header">
                      <span className="history-question">{p.name}</span>
                      <span className="history-time">{p.workout_count} workout{p.workout_count !== 1 ? 's' : ''}</span>
                      <div className="program-list-actions" onClick={e => e.stopPropagation()}>
                        <button type="button" className="program-list-btn" onClick={() => navigate(`/programs/${p.id}/edit`)} title="Edit">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button type="button" className="program-list-btn program-list-btn-delete" onClick={e => handleDelete(e, p.id)} title="Delete">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                        </button>
                      </div>
                    </div>
                    <div className="history-answer" style={{ padding: '8px 18px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                      Created {formatDate(p.created_at)}
                    </div>
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
