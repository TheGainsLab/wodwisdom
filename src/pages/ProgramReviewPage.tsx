import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import InviteBanner from '../components/InviteBanner';
import WorkoutBlocksDisplay from '../components/WorkoutBlocksDisplay';

interface ModifiedWorkoutRow {
  id: string;
  original_workout_id: string;
  modified_text: string;
  change_summary: string | null;
  rationale: string | null;
  status: 'pending' | 'approved' | 'rejected';
  sort_order: number;
  original_text: string;
}

export default function ProgramReviewPage({ session }: { session: Session }) {
  const { id, modificationId } = useParams<{ id: string; modificationId: string }>();
  const navigate = useNavigate();
  const [programName, setProgramName] = useState('');
  const [items, setItems] = useState<ModifiedWorkoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState('');
  const [navOpen, setNavOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!id || !modificationId) return;
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

    const { data: mw } = await supabase
      .from('modified_workouts')
      .select('id, original_workout_id, modified_text, change_summary, rationale, status')
      .eq('modification_id', modificationId);

    const workoutIds = (mw || []).map((m: { original_workout_id: string }) => m.original_workout_id);
    const { data: orig } = await supabase
      .from('program_workouts')
      .select('id, sort_order, workout_text')
      .in('id', workoutIds);

    const origMap = new Map((orig || []).map((w: { id: string; sort_order: number; workout_text: string }) => [w.id, w]));
    type MwRow = { id: string; original_workout_id: string; modified_text: string; change_summary: string | null; rationale: string | null; status: string };
    const rows: ModifiedWorkoutRow[] = (mw || []).map((m: MwRow) => {
      const o = origMap.get(m.original_workout_id);
      return {
        ...m,
        sort_order: o?.sort_order ?? 0,
        original_text: o?.workout_text ?? '',
      } as ModifiedWorkoutRow;
    }).sort((a, b) => a.sort_order - b.sort_order);

    setItems(rows);
    setLoading(false);
  }, [id, modificationId, session.user.id, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setStatus = async (mwId: string, status: 'approved' | 'rejected') => {
    const { error } = await supabase
      .from('modified_workouts')
      .update({ status })
      .eq('id', mwId);
    if (!error) {
      setItems(prev => prev.map(i => (i.id === mwId ? { ...i, status } : i)));
    }
  };

  const handleFinalize = async () => {
    if (!modificationId) return;
    setFinalizing(true);
    setFinalizeError('');
    try {
      const { data, error } = await supabase.functions.invoke('finalize-modification', {
        body: { modification_id: modificationId },
      });
      if (error) throw new Error(error.message || 'Finalize failed');
      if (data?.error) throw new Error(data.error || 'Finalize failed');
      navigate(`/programs/${id}`);
    } catch (err: unknown) {
      setFinalizeError(err instanceof Error ? err.message : 'Finalize failed');
    } finally {
      setFinalizing(false);
    }
  };

  const approved = items.filter(i => i.status === 'approved').length;
  const rejected = items.filter(i => i.status === 'rejected').length;
  const pending = items.filter(i => i.status === 'pending').length;

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
          <h1>{programName ? `${programName} – Review` : 'Review changes'}</h1>
        </header>
        <div className="page-body">
          <div className="program-detail-wrap">
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : (
              <>
                <div className="review-progress-bar">
                  <span className="review-progress-label">
                    {approved} approved · {rejected} kept original · {pending} pending
                  </span>
                </div>
                <div className="review-cards">
                  {items.map(item => (
                    <div key={item.id} className={'review-card' + (item.status !== 'pending' ? ` review-card-${item.status}` : '')}>
                      <div className="review-card-header">
                        <span className="review-card-title">Day {item.sort_order + 1}</span>
                        {item.change_summary && (
                          <span className="review-card-summary">{item.change_summary}</span>
                        )}
                      </div>
                      <div className="review-card-body">
                        <div className="review-card-original">
                          <div className="review-card-label">Original</div>
                          <div className="review-card-text">
                            <WorkoutBlocksDisplay text={item.original_text} />
                          </div>
                        </div>
                        <div className="review-card-modified">
                          <div className="review-card-label">Modified</div>
                          <div className="review-card-text">
                            <WorkoutBlocksDisplay text={item.modified_text} />
                          </div>
                        </div>
                        {item.rationale && (
                          <div className="review-card-rationale">{item.rationale}</div>
                        )}
                      </div>
                      {item.status === 'pending' ? (
                        <div className="review-card-actions">
                          <button
                            type="button"
                            className="auth-btn"
                            style={{ flex: 1, background: 'var(--accent)' }}
                            onClick={() => setStatus(item.id, 'approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="auth-btn"
                            style={{ flex: 1, background: 'var(--surface2)', color: 'var(--text)' }}
                            onClick={() => setStatus(item.id, 'rejected')}
                          >
                            Keep original
                          </button>
                        </div>
                      ) : (
                        <div className="review-card-status">
                          {item.status === 'approved' ? '✓ Approved' : 'Kept original'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="program-detail-actions" style={{ marginTop: 24 }}>
                  <button
                    className="auth-btn"
                    style={{ background: 'var(--surface2)', color: 'var(--text)' }}
                    onClick={() => navigate(`/programs/${id}/modify/${modificationId}/compare`)}
                  >
                    Back to compare
                  </button>
                  <button
                    className="auth-btn"
                    onClick={handleFinalize}
                    disabled={finalizing || items.filter(i => i.status === 'pending').length > 0}
                  >
                    {finalizing ? 'Finalizing...' : 'Apply approved changes'}
                  </button>
                </div>
                {finalizeError && <div className="error-msg" style={{ marginTop: 12 }}>{finalizeError}</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
