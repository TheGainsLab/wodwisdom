import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';
import WorkoutBlocksDisplay from '../components/WorkoutBlocksDisplay';

interface ProgramWorkout {
  id: string;
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order: number;
}

const PHASE_SIZE = 20;

export default function ProgramDetailPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [program, setProgram] = useState<{ id: string; name: string; phase: number; total_phases: number } | null>(null);
  const [allWorkouts, setAllWorkouts] = useState<ProgramWorkout[]>([]);
  const [completedWorkoutIds, setCompletedWorkoutIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadProgram();
  }, [id, session.user.id]);

  const loadProgram = async () => {
    if (!id) return;
    setLoading(true);
    const { data: prog, error: progErr } = await supabase
      .from('programs')
      .select('id, name, phase, total_phases')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();
    if (progErr || !prog) {
      setProgram(null);
      setAllWorkouts([]);
      setLoading(false);
      return;
    }
    setProgram(prog);
    const { data: wk } = await supabase
      .from('program_workouts')
      .select('id, week_num, day_num, workout_text, sort_order')
      .eq('program_id', id)
      .order('sort_order');
    setAllWorkouts(wk || []);

    if (wk?.length) {
      const ids = wk.map((w) => w.id);
      // Query in batches of 100 to avoid URL length limits
      const allCompleted = new Set<string>();
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const { data: logs } = await supabase
          .from('workout_logs')
          .select('source_id')
          .eq('user_id', session.user.id)
          .in('source_id', batch);
        (logs || []).forEach((l) => { if (l.source_id) allCompleted.add(l.source_id); });
      }
      setCompletedWorkoutIds(allCompleted);
    } else {
      setCompletedWorkoutIds(new Set());
    }

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

  const handleNameChange = async (newName: string) => {
    const trimmed = newName.trim() || 'Untitled Program';
    if (!id || !program || trimmed === program.name) return;
    const { error } = await supabase.from('programs').update({ name: trimmed }).eq('id', id).eq('user_id', session.user.id);
    if (!error) setProgram(p => p ? { ...p, name: trimmed } : null);
  };

  // Filter workouts to current phase
  const isMultiPhase = program != null && program.total_phases > 1;
  const phase = program?.phase ?? 1;
  const phaseStart = (phase - 1) * PHASE_SIZE;
  const workouts = isMultiPhase
    ? allWorkouts.slice(phaseStart, phaseStart + PHASE_SIZE)
    : allWorkouts;

  const phaseCompletedCount = workouts.filter(w => completedWorkoutIds.has(w.id)).length;

  const handleAdvancePhase = async () => {
    if (!program || !id || phase >= program.total_phases) return;
    setAdvancing(true);
    const nextPhase = phase + 1;
    const { error } = await supabase
      .from('programs')
      .update({ phase: nextPhase })
      .eq('id', id)
      .eq('user_id', session.user.id);
    if (!error) {
      setProgram(p => p ? { ...p, phase: nextPhase } : null);
    }
    setAdvancing(false);
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
          {program ? (
            <input
              type="text"
              className="program-detail-name-input"
              value={program.name}
              onChange={e => setProgram(p => p ? { ...p, name: e.target.value } : null)}
              onBlur={e => handleNameChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
            />
          ) : (
            <h1>Program</h1>
          )}
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
                {workouts.length > 0 && (
                  <div className="program-progress">
                    {isMultiPhase && (
                      <div className="program-phase-indicator" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>Month {phase} of {program!.total_phases}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {Array.from({ length: program!.total_phases }, (_, i) => (
                            <div
                              key={i}
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: i < phase ? 'var(--accent)' : 'var(--surface2)',
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="program-progress-header">
                      <span className="program-progress-label">Progress</span>
                      <span className="program-progress-count">{phaseCompletedCount} / {workouts.length} days</span>
                    </div>
                    <div className="program-progress-bar">
                      <div
                        className="program-progress-fill"
                        style={{ width: `${(phaseCompletedCount / workouts.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="program-workouts-table-wrap">
                  <table className="program-workouts-table">
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>Day</th>
                        <th>Workout</th>
                        <th style={{ width: 150 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workouts.map(w => {
                        const done = completedWorkoutIds.has(w.id);
                        return (
                          <tr key={w.id} className={done ? 'program-row-completed' : ''}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {done ? (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                ) : (
                                  <span className="program-day-dot" />
                                )}
                                <span>{isMultiPhase ? w.sort_order - phaseStart + 1 : w.sort_order + 1}</span>
                              </div>
                            </td>
                            <td className="workout-text-cell">
                              <WorkoutBlocksDisplay text={w.workout_text} />
                            </td>
                            <td>
                              {done ? (
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                  <span className="program-completed-badge">Done</span>
                                  <button
                                    className="auth-btn"
                                    onClick={() => navigate('/workout-review', { state: { workout_text: w.workout_text, source_id: w.id, program_id: id } })}
                                    style={{ padding: '6px 12px', fontSize: 12, background: 'var(--surface2)', color: 'var(--text-dim)' }}
                                  >
                                    Coach
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button
                                    className="auth-btn"
                                    onClick={() => navigate('/workout-review', { state: { workout_text: w.workout_text, source_id: w.id, program_id: id } })}
                                    style={{ padding: '8px 14px', fontSize: 13, background: 'var(--surface2)', color: 'var(--text)' }}
                                  >
                                    Coach
                                  </button>
                                  <button
                                    className="auth-btn"
                                    onClick={() => navigate('/workout/start', { state: { workout_text: w.workout_text, source_id: w.id } })}
                                    style={{ padding: '8px 14px', fontSize: 13 }}
                                  >
                                    Start
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {isMultiPhase && phase < program!.total_phases && (
                  <div style={{ marginTop: 24, padding: 16, background: 'var(--surface2)', borderRadius: 8 }}>
                    <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--text-dim)' }}>
                      {phaseCompletedCount === workouts.length
                        ? 'All workouts complete! Ready for the next month.'
                        : `${workouts.length - phaseCompletedCount} workouts remaining this month.`}
                    </div>
                    <button
                      className="auth-btn"
                      disabled={advancing}
                      onClick={handleAdvancePhase}
                      style={{ fontSize: 13 }}
                    >
                      {advancing ? 'Advancing...' : `Start Month ${phase + 1}`}
                    </button>
                  </div>
                )}
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
                  <button className="auth-btn" onClick={() => navigate(`/programs/${id}/analyze`)}>
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
