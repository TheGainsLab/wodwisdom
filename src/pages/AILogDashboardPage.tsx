import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import AILogPaywall from '../components/ailog/AILogPaywall';
import { useEntitlements } from '../hooks/useEntitlements';
import { supabase } from '../lib/supabase';
import { Brain, Plus, Upload, Building2 } from 'lucide-react';
import '../ailog.css';

interface ExternalProgram {
  id: string;
  name: string;
  gym_name: string | null;
  committed: boolean;
  created_at: string;
  workout_count: number;
}

export default function AILogDashboardPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [programs, setPrograms] = useState<ExternalProgram[]>([]);
  const { hasFeature, loading: entLoading } = useEntitlements(session.user.id);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('programs')
        .select('id, name, gym_name, committed, created_at, program_workouts(count)')
        .eq('user_id', session.user.id)
        .eq('source', 'external')
        .eq('committed', false)
        .order('created_at', { ascending: false });

      if (data) {
        setPrograms(data.map((p: any) => ({
          id: p.id,
          name: p.name,
          gym_name: p.gym_name,
          committed: p.committed ?? false,
          created_at: p.created_at,
          workout_count: p.program_workouts?.[0]?.count ?? 0,
        })));
      }
      setLoading(false);
    })();
  }, [session.user.id]);

  const hasAccess = hasFeature('ailog');

  if (!loading && !entLoading && !hasAccess) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <header className="page-header">
            <button className="menu-btn" onClick={() => setNavOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            <h1>AI Log</h1>
          </header>
          <AILogPaywall />
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
          <h1>AI Log</h1>
        </header>

        <div className="ailog-page">
          {loading ? (
            <div className="loading-pulse" />
          ) : programs.length === 0 ? (
            <div className="ailog-card">
              <div className="ailog-empty">
                <Brain size={48} className="ailog-empty-icon" />
                <h2 className="ailog-header">No drafts</h2>
                <p className="ailog-subheader">
                  Upload your gym's programming to analyze it and fill gaps
                  before committing to My Programs.
                </p>
                <button
                  className="ailog-btn ailog-btn-primary"
                  onClick={() => navigate('/ailog/upload')}
                >
                  <Upload size={18} /> Upload Programming
                </button>
              </div>
            </div>
          ) : (
            <div className="ailog-section" style={{ gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="ailog-header">Your Programs</h2>
                <button
                  className="ailog-btn ailog-btn-secondary ailog-btn-sm"
                  style={{ padding: '8px 14px', fontSize: 13, borderRadius: 6 }}
                  onClick={() => navigate('/ailog/upload')}
                >
                  <Plus size={14} /> Add Program
                </button>
              </div>

              {programs.map((p) => (
                <button
                  key={p.id}
                  className="ailog-program"
                  onClick={() => navigate(`/ailog/${p.id}`)}
                >
                  <Building2 size={20} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ailog-program-name">{p.name}</div>
                    {p.gym_name && <div className="ailog-program-gym">{p.gym_name}</div>}
                    <div className="ailog-program-meta">
                      {p.workout_count} workout{p.workout_count !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span className="ailog-badge ailog-badge--ongoing">Draft</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
