import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

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
  const [hasProfile, setHasProfile] = useState(false);
  const [hasEvaluation, setHasEvaluation] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  useEffect(() => {
    loadAll();
  }, [session.user.id]);

  const loadAll = async () => {
    setLoading(true);
    const [progData, profileRes, evalRes] = await Promise.all([
      supabase
        .from('programs')
        .select('id, name, created_at')
        .eq('user_id', session.user.id)
        .neq('committed', false)
        .order('created_at', { ascending: false }),
      supabase
        .from('athlete_profiles')
        .select('lifts, skills, conditioning')
        .eq('user_id', session.user.id)
        .maybeSingle(),
      supabase
        .from('profile_evaluations')
        .select('id')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

    // Check profile has meaningful data
    if (profileRes.data) {
      const d = profileRes.data;
      const hasLifts = d.lifts && Object.values(d.lifts).some((v: any) => v > 0);
      const hasSkills = d.skills && Object.values(d.skills).some((v: any) => v && v !== 'none');
      const hasConditioning = d.conditioning && Object.values(d.conditioning).some((v: any) => v);
      setHasProfile(!!(hasLifts || hasSkills || hasConditioning));
    }

    setHasEvaluation(!!(evalRes.data && evalRes.data.length > 0));

    if (progData.data) {
      const withCount = await Promise.all(
        progData.data.map(async p => {
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

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError('');
    try {
      const { data, error } = await supabase.functions.invoke('generate-program', {
        body: {},
      });
      if (error) throw new Error(error.message || 'Failed to generate program');
      if (data?.error) throw new Error(data.error || 'Failed to generate program');
      const jobId = data?.job_id;
      if (!jobId) throw new Error('No job ID returned');

      let delay = 3000;
      const maxDelay = 8000;
      const maxAttempts = 80;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, delay));
        const { data: status, error: statusErr } = await supabase.functions.invoke('program-job-status', {
          body: { job_id: jobId },
        });
        if (statusErr) throw new Error(statusErr.message || 'Failed to check job status');
        if (status?.error && status?.status !== 'failed') throw new Error(status.error);

        if (status?.status === 'complete') {
          if (status.program_id) {
            navigate(`/programs/${status.program_id}`);
            return;
          }
          throw new Error('Program completed but no ID returned');
        }
        if (status?.status === 'failed') {
          throw new Error(status.error || 'Program generation failed');
        }
        delay = Math.min(delay + 1000, maxDelay);
      }
      throw new Error('Program generation timed out');
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate program');
    } finally {
      setGenerating(false);
    }
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
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>My Programs</h1>
        </header>
        <div className="page-body">
          <div className="programs-list-wrap">
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : programs.length === 0 ? (
              <div className="empty-state">
                {!hasProfile ? (
                  <>
                    <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Set up your athlete profile</p>
                    <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>Add your lifts, skills, and benchmarks so the AI can build a program tailored to you.</p>
                    <button className="auth-btn" onClick={() => navigate('/profile')}>Go to Profile</button>
                  </>
                ) : !hasEvaluation ? (
                  <>
                    <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Get your profile evaluated</p>
                    <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>Your profile is set up. Run an AI evaluation to unlock program generation.</p>
                    <button className="auth-btn" onClick={() => navigate('/profile')}>Go to Evaluation</button>
                  </>
                ) : (
                  <>
                    <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Ready to generate your program</p>
                    <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>Your evaluation is complete. Generate a personalized program based on your profile and analysis.</p>
                    {generateError && <div className="error-msg" style={{ marginBottom: 12 }}>{generateError}</div>}
                    <button className="auth-btn" onClick={handleGenerate} disabled={generating}>
                      {generating ? 'Generating...' : 'Generate Program'}
                    </button>
                  </>
                )}
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
                      <span className="history-time">
                        {p.workout_count} workout{p.workout_count !== 1 ? 's' : ''}
                      </span>
                      <div className="program-list-actions" onClick={e => e.stopPropagation()}>
                        <button type="button" className="program-list-btn" onClick={() => navigate(`/programs/${p.id}/edit`)} title="Edit">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button type="button" className="program-list-btn program-list-btn-delete" onClick={e => handleDelete(e, p.id)} title="Delete">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                        </button>
                      </div>
                    </div>
                    <div className="history-answer" style={{ padding: '8px 18px 14px', fontSize: 12, color: 'var(--text-dim)' }}>
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
