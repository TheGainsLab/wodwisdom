import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import WorkoutBlocksDisplay from '../components/WorkoutBlocksDisplay';

interface ProgramWorkout {
  id: string;
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order: number;
}

const SUMMARY_LABELS = ['skills', 'strength', 'metcon', 'accessory'] as const;

/** Extract a one-line summary like "Muscle-ups · Back Squat · 5 RFT" from workout text. */
function workoutSummary(text: string): string {
  if (!text?.trim()) return '';
  const lower = text.toLowerCase();
  const allLabels = ['warm-up', 'skills', 'strength', 'metcon', 'cool down', 'accessory', 'mobility'];
  const parts: string[] = [];

  for (const label of SUMMARY_LABELS) {
    const needle = label + ':';
    const start = lower.indexOf(needle);
    if (start < 0) continue;
    const contentStart = start + needle.length;
    // Find the next block label to know where this block ends
    let end = text.length;
    for (const other of allLabels) {
      const otherNeedle = other + ':';
      const idx = lower.indexOf(otherNeedle, contentStart);
      if (idx >= 0 && idx < end) end = idx;
    }
    const content = text.slice(contentStart, end).trim();
    const firstLine = content.split('\n')[0].trim();
    if (firstLine) parts.push(firstLine.length > 30 ? firstLine.slice(0, 28) + '…' : firstLine);
  }

  return parts.join(' · ');
}

export default function ProgramDetailPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [program, setProgram] = useState<{ id: string; name: string } | null>(null);
  const [allWorkouts, setAllWorkouts] = useState<ProgramWorkout[]>([]);
  const [completedWorkoutIds, setCompletedWorkoutIds] = useState<Set<string>>(new Set());
  const [inProgressWorkouts, setInProgressWorkouts] = useState<Map<string, { logId: string; savedCount: number; totalBlocks: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const toggleDay = useCallback((workoutId: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(workoutId)) next.delete(workoutId);
      else next.add(workoutId);
      return next;
    });
  }, []);

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
      const ipMap = new Map<string, { logId: string; savedCount: number; totalBlocks: number }>();
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const { data: logs } = await supabase
          .from('workout_logs')
          .select('id, source_id, status')
          .eq('user_id', session.user.id)
          .in('source_id', batch);
        for (const l of logs || []) {
          if (!l.source_id) continue;
          if (l.status === 'completed') {
            allCompleted.add(l.source_id);
          } else if (l.status === 'in_progress') {
            // Count saved blocks for this in-progress log (exclude warm-up/cool-down)
            const { count } = await supabase
              .from('workout_log_blocks')
              .select('id', { count: 'exact', head: true })
              .eq('log_id', l.id)
              .not('block_type', 'in', '("warm-up","mobility","cool-down")');
            // Count total blocks for this workout (exclude warm-up/cool-down)
            const { count: totalCount } = await supabase
              .from('program_workout_blocks')
              .select('id', { count: 'exact', head: true })
              .eq('program_workout_id', l.source_id)
              .not('block_type', 'in', '("warm-up","mobility","cool-down")');
            ipMap.set(l.source_id, {
              logId: l.id,
              savedCount: count ?? 0,
              totalBlocks: totalCount ?? 0,
            });
          }
        }
      }
      setCompletedWorkoutIds(allCompleted);
      setInProgressWorkouts(ipMap);
    } else {
      setCompletedWorkoutIds(new Set());
      setInProgressWorkouts(new Map());
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

  const workouts = allWorkouts;
  const completedCount = workouts.filter(w => completedWorkoutIds.has(w.id)).length;

  if (!id) return null;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
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
                    <div className="program-progress-header">
                      <span className="program-progress-label">Progress</span>
                      <span className="program-progress-count">{completedCount} / {workouts.length} days</span>
                    </div>
                    <div className="program-progress-bar">
                      <div
                        className="program-progress-fill"
                        style={{ width: `${(completedCount / workouts.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="program-days-accordion">
                  {(() => {
                    // Group workouts into weeks of 5
                    const weeks: { weekNum: number; days: ProgramWorkout[] }[] = [];
                    workouts.forEach((w, i) => {
                      const weekIndex = Math.floor(i / 5);
                      if (!weeks[weekIndex]) weeks[weekIndex] = { weekNum: weekIndex + 1, days: [] };
                      weeks[weekIndex].days.push(w);
                    });
                    return weeks.map((week, wi) => (
                      <div key={wi} className="program-week-group">
                        <div className="program-week-label">Week {week.weekNum}</div>
                        {week.days.map((w) => {
                          const done = completedWorkoutIds.has(w.id);
                          const ip = inProgressWorkouts.get(w.id);
                          const dayNum = w.sort_order + 1;
                          const isExpanded = expandedDays.has(w.id);
                          return (
                            <div key={w.id} className={`program-day-row${done ? ' program-day-completed' : ip ? ' program-day-in-progress' : ''}`}>
                              <button
                                className="program-day-header"
                                onClick={() => toggleDay(w.id)}
                                aria-expanded={isExpanded}
                              >
                                <div className="program-day-left">
                                  {done ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                  ) : ip ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning, #f39c12)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                  ) : (
                                    <span className="program-day-dot" />
                                  )}
                                  <span className="program-day-label">Day {dayNum}</span>
                                  {done && <span className="program-completed-badge">Done</span>}
                                  {ip && <span className="program-in-progress-badge">{ip.savedCount}/{ip.totalBlocks} blocks</span>}
                                  {!isExpanded && <span className="program-day-summary">{workoutSummary(w.workout_text)}</span>}
                                </div>
                                <svg
                                  className={`program-day-chevron${isExpanded ? ' expanded' : ''}`}
                                  width="16" height="16" viewBox="0 0 24 24"
                                  fill="none" stroke="currentColor" strokeWidth="2"
                                  strokeLinecap="round" strokeLinejoin="round"
                                >
                                  <polyline points="6 9 12 15 18 9" />
                                </svg>
                              </button>
                              {isExpanded && (
                                <div className="program-day-body">
                                  <div className="program-day-blocks">
                                    <WorkoutBlocksDisplay text={w.workout_text} />
                                  </div>
                                  <div className="program-day-actions">
                                    <button
                                      className="auth-btn"
                                      onClick={() => navigate('/workout-review', { state: { workout_text: w.workout_text, source_id: w.id, program_id: id, week_num: week.weekNum, day_num: (w.sort_order % 5) + 1 } })}
                                      style={{ padding: '8px 14px', fontSize: 13, background: 'var(--surface2)', color: done ? 'var(--text-dim)' : 'var(--text)' }}
                                    >
                                      Coach
                                    </button>
                                    {!done && (
                                      <button
                                        className="auth-btn"
                                        onClick={() => navigate('/workout/start', { state: { workout_text: w.workout_text, source_id: w.id } })}
                                        style={{ padding: '8px 14px', fontSize: 13 }}
                                      >
                                        {ip ? 'Resume' : 'Start'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()}
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
