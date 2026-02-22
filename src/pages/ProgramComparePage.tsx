import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';

const DAY_LABELS: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};

interface ProgramWorkout {
  id: string;
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order: number;
}

interface ModifiedWorkout {
  id: string;
  original_workout_id: string;
  modified_text: string;
  change_summary: string | null;
  rationale: string | null;
}

export default function ProgramComparePage({ session }: { session: Session }) {
  const { id, modificationId } = useParams<{ id: string; modificationId: string }>();
  const navigate = useNavigate();
  const [programName, setProgramName] = useState('');
  const [workouts, setWorkouts] = useState<ProgramWorkout[]>([]);
  const [modifiedMap, setModifiedMap] = useState<Map<string, ModifiedWorkout>>(new Map());
  const [showModified, setShowModified] = useState(true);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!id || !modificationId) return;
    (async () => {
      setLoading(true);
      const { data: prog } = await supabase
        .from('programs')
        .select('name')
        .eq('id', id)
        .eq('user_id', session.user.id)
        .single();
      if (prog) setProgramName(prog.name);

      const { data: mod } = await supabase
        .from('program_modifications')
        .select('id, status')
        .eq('id', modificationId)
        .single();
      if (!mod || mod.status === 'finalized') {
        navigate(`/programs/${id}`);
        return;
      }

      const { data: wk } = await supabase
        .from('program_workouts')
        .select('id, week_num, day_num, workout_text, sort_order')
        .eq('program_id', id)
        .order('sort_order');
      setWorkouts(wk || []);

      const { data: mw } = await supabase
        .from('modified_workouts')
        .select('id, original_workout_id, modified_text, change_summary, rationale')
        .eq('modification_id', modificationId);
      const map = new Map<string, ModifiedWorkout>();
      (mw || []).forEach((m: ModifiedWorkout) => map.set(m.original_workout_id, m));
      setModifiedMap(map);
      setLoading(false);
    })();
  }, [id, modificationId, session.user.id, navigate]);

  const displayWorkouts = workouts.map(w => {
    const mod = modifiedMap.get(w.id);
    const text = showModified && mod ? mod.modified_text : w.workout_text;
    const isModified = !!mod;
    return { ...w, displayText: text, isModified };
  });

  if (!id || !modificationId) return null;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <InviteBanner session={session} />
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>{programName ? `${programName} – Compare` : 'Compare'}</h1>
          <div className="source-toggle" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className={'source-btn' + (!showModified ? ' active' : '')}
              onClick={() => setShowModified(false)}
            >
              Original
            </button>
            <button
              type="button"
              className={'source-btn' + (showModified ? ' active' : '')}
              onClick={() => setShowModified(true)}
            >
              Modified
            </button>
          </div>
        </header>
        <div className="page-body">
          <div className="program-detail-wrap">
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : (
              <>
                <div className="program-workouts-table-wrap">
                  <table className="program-workouts-table">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Day</th>
                        <th>Workout</th>
                        {showModified && <th>Change</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {displayWorkouts.map(w => {
                        const mod = modifiedMap.get(w.id);
                        return (
                          <tr key={w.id} className={w.isModified ? 'compare-row-modified' : ''}>
                            <td>{w.week_num}</td>
                            <td>{DAY_LABELS[w.day_num] || w.day_num}</td>
                            <td className="workout-text-cell">{w.displayText}</td>
                            {showModified && (
                              <td className="compare-change-cell">
                                {mod?.change_summary || (w.isModified ? mod?.rationale : '') || '—'}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="program-detail-actions" style={{ marginTop: 24 }}>
                  <button
                    className="auth-btn"
                    style={{ background: 'var(--surface2)', color: 'var(--text)' }}
                    onClick={() => navigate(`/programs/${id}`)}
                  >
                    Back
                  </button>
                  <button
                    className="auth-btn"
                    style={{ background: 'var(--surface2)', color: 'var(--text)' }}
                    onClick={() => navigate(`/programs/${id}/analyze`)}
                  >
                    Analysis
                  </button>
                  <button
                    className="auth-btn"
                    onClick={() => navigate(`/programs/${id}/modify/${modificationId}/review`)}
                  >
                    Review changes
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
