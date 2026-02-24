import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

interface EditableWorkout {
  workout_text: string;
  sort_order: number;
}

export default function ProgramEditPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [programName, setProgramName] = useState('');
  const [workouts, setWorkouts] = useState<EditableWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);

  const loadProgram = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data: prog, error: progErr } = await supabase
      .from('programs')
      .select('id, name')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();
    if (progErr || !prog) {
      setError('Program not found');
      setLoading(false);
      return;
    }
    setProgramName(prog.name);
    const { data: wk } = await supabase
      .from('program_workouts')
      .select('workout_text, sort_order')
      .eq('program_id', id)
      .order('sort_order');
    setWorkouts((wk || []).map((w, i) => ({ workout_text: w.workout_text, sort_order: i })));
    setError('');
    setLoading(false);
  }, [id, session.user.id]);

  useEffect(() => {
    if (!id) return;
    loadProgram();
  }, [id, loadProgram]);

  const updateWorkout = (idx: number, field: 'workout_text', value: string) => {
    setWorkouts(prev => prev.map((w, i) => i === idx ? { ...w, [field]: value } : w));
  };

  const removeWorkout = (idx: number) => {
    setWorkouts(prev => prev.filter((_, i) => i !== idx));
  };

  const saveProgram = async () => {
    if (!id) return;
    setSaving(true);
    setError('');
    try {
      const { error: progErr } = await supabase
        .from('programs')
        .update({ name: programName.trim() || 'Untitled Program' })
        .eq('id', id)
        .eq('user_id', session.user.id);
      if (progErr) throw progErr;
      const { error: delErr } = await supabase.from('program_workouts').delete().eq('program_id', id);
      if (delErr) throw delErr;
      if (workouts.length > 0) {
        const rows = workouts.map((w, i) => ({
          program_id: id,
          week_num: 1,
          day_num: i + 1,
          workout_text: w.workout_text,
          sort_order: i,
        }));
        const { error: insErr } = await supabase.from('program_workouts').insert(rows);
        if (insErr) throw insErr;
      }
      await supabase.functions.invoke('sync-program-blocks', { body: { program_id: id } });
      navigate(`/programs/${id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to save program');
    } finally {
      setSaving(false);
    }
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
          <h1>Edit program</h1>
        </header>
        <div className="page-body">
          <div className="programs-add-wrap">
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : error && workouts.length === 0 ? (
              <div className="empty-state">
                <p>{error}</p>
                <button className="auth-btn" onClick={() => navigate('/programs')}>Back to programs</button>
              </div>
            ) : (
              <>
                <div className="program-preview-header">
                  <div className="program-edit-name-row">
                    <label className="program-edit-name-label">Program name</label>
                    <input
                      type="text"
                      className="program-name-input"
                      placeholder="Program name"
                      value={programName}
                      onChange={e => setProgramName(e.target.value)}
                      style={{ flex: 1, minWidth: 200 }}
                    />
                  </div>
                  <div className="program-preview-header-right">
                    <span className="program-edit-workout-count">{workouts.length} workout{workouts.length !== 1 ? 's' : ''}</span>
                    <button type="button" className="link-btn" onClick={() => navigate(`/programs/${id}`)}>
                      Cancel
                    </button>
                  </div>
                </div>
                <div className="program-preview-table-wrap">
                  <table className="program-preview-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Workout</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {workouts.map((w, i) => (
                        <tr key={i}>
                          <td className="program-edit-day-num">{i + 1}</td>
                          <td>
                            <input
                              type="text"
                              value={w.workout_text}
                              onChange={e => updateWorkout(i, 'workout_text', e.target.value)}
                              className="program-edit-text"
                            />
                          </td>
                          <td>
                            <button type="button" className="program-remove-btn" onClick={() => removeWorkout(i)}>Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="program-actions" style={{ marginTop: 24 }}>
                  <button className="auth-btn" onClick={saveProgram} disabled={saving}>
                    {saving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </>
            )}
            {error && workouts.length > 0 && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
