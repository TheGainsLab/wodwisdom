import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import WorkoutBlocksDisplay, { BlockContent } from '../components/WorkoutBlocksDisplay';

interface ProgramBlock {
  id: string;
  program_workout_id: string;
  block_type: string;
  block_order: number;
  block_text: string;
}

interface ProgramWorkout {
  id: string;
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order: number;
  day_type?: string | null;
}

// v3 structured data shapes — fetched from program_blocks_v2 +
// program_movements_v2 when programs.program_version === 'v3'.
interface ProgramMovementV2 {
  id: string;
  block_id: string;
  movement: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  weight_unit: string | null;
  rpe: number | null;
  time_seconds: number | null;
  distance: number | null;
  distance_unit: string | null;
  scaling_note: string | null;
  target_pct_1rm: number | null;
  sort_order: number;
}

interface ProgramBlockV2 {
  id: string;
  program_workout_id: string;
  block_type: string;
  block_label: string | null;
  block_scheme: string | null;
  time_cap_seconds: number | null;
  block_notes: string | null;
  sort_order: number;
  movements: ProgramMovementV2[];
}

const DAY_TYPE_LABELS: Record<string, string> = {
  strength: 'Strength Day',
  metcon: 'Metcon Day',
  fitness: 'Fitness Day',
  skill: 'Skill Day',
  recovery: 'Recovery Day',
};

const SUMMARY_LABELS = ['skills', 'strength', 'metcon', 'accessory'] as const;

const DISPLAY_LABELS: Record<string, string> = {
  skills: 'Skill',
  strength: 'Strength',
  metcon: 'Conditioning',
  accessory: 'Accessory',
};

interface SummaryLine { label: string; text: string }

/** Extract structured summary lines from workout text. */
function workoutSummaryLines(text: string): SummaryLine[] {
  if (!text?.trim()) return [];
  const lower = text.toLowerCase();
  const allLabels = ['warm-up', 'skills', 'strength', 'metcon', 'cool down', 'accessory', 'mobility'];
  const lines: SummaryLine[] = [];

  for (const label of SUMMARY_LABELS) {
    const needle = label + ':';
    const start = lower.indexOf(needle);
    if (start < 0) continue;
    const contentStart = start + needle.length;
    let end = text.length;
    for (const other of allLabels) {
      const otherNeedle = other + ':';
      const idx = lower.indexOf(otherNeedle, contentStart);
      if (idx >= 0 && idx < end) end = idx;
    }
    const content = text.slice(contentStart, end).trim();
    const firstLine = content.split('\n')[0].trim();
    if (firstLine) {
      lines.push({
        label: DISPLAY_LABELS[label] || label,
        text: firstLine.length > 40 ? firstLine.slice(0, 38) + '…' : firstLine,
      });
    }
  }

  return lines;
}

export default function ProgramDetailPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const monthFilter = searchParams.get('month') ? parseInt(searchParams.get('month')!, 10) : null;
  const { isAdmin } = useEntitlements(session.user.id);
  const [program, setProgram] = useState<{
    id: string;
    name: string;
    source?: string;
    generated_months?: number;
    program_version?: string;
    month_plan?: unknown;
  } | null>(null);
  const [allWorkouts, setAllWorkouts] = useState<ProgramWorkout[]>([]);
  const [completedWorkoutIds, setCompletedWorkoutIds] = useState<Set<string>>(new Set());
  const [inProgressWorkouts, setInProgressWorkouts] = useState<Map<string, { logId: string; savedCount: number; totalBlocks: number }>>(new Map());
  const [workoutBlocks, setWorkoutBlocks] = useState<Map<string, ProgramBlock[]>>(new Map());
  // v3-only: structured blocks + movements per program_workout_id.
  const [v3BlocksByWorkout, setV3BlocksByWorkout] = useState<Map<string, ProgramBlockV2[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [generatingNextMonth, setGeneratingNextMonth] = useState(false);

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
      .select('id, name, source, generated_months, program_version, month_plan')
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
      .select('id, week_num, day_num, workout_text, sort_order, month_number, day_type')
      .eq('program_id', id)
      .order('sort_order');
    setAllWorkouts(wk || []);

    const isV3 = prog.program_version === 'v3';

    // v1 path: fetch prose blocks from program_workout_blocks.
    // v3 path: fetch structured blocks + movements from program_blocks_v2 + program_movements_v2.
    if (wk?.length && !isV3) {
      const ids = wk.map((w) => w.id);
      const blockMap = new Map<string, ProgramBlock[]>();
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const { data: blocks } = await supabase
          .from('program_workout_blocks')
          .select('id, program_workout_id, block_type, block_order, block_text')
          .in('program_workout_id', batch)
          .order('block_order');
        for (const b of blocks || []) {
          const existing = blockMap.get(b.program_workout_id) || [];
          existing.push(b as ProgramBlock);
          blockMap.set(b.program_workout_id, existing);
        }
      }
      setWorkoutBlocks(blockMap);
    }

    if (wk?.length && isV3) {
      const workoutIds = wk.map((w) => w.id);
      const blocksByWorkout = new Map<string, ProgramBlockV2[]>();
      // 1. Fetch all blocks for these workouts (batched).
      const allBlocks: Array<ProgramBlockV2 & { program_workout_id: string }> = [];
      for (let i = 0; i < workoutIds.length; i += 100) {
        const batch = workoutIds.slice(i, i + 100);
        const { data: blocks } = await supabase
          .from('program_blocks_v2')
          .select('id, program_workout_id, block_type, block_label, block_scheme, time_cap_seconds, block_notes, sort_order')
          .in('program_workout_id', batch)
          .order('sort_order');
        for (const b of blocks || []) {
          allBlocks.push({ ...(b as ProgramBlockV2), movements: [] });
        }
      }
      // 2. Fetch all movements for those blocks (batched).
      const movementsByBlock = new Map<string, ProgramMovementV2[]>();
      if (allBlocks.length) {
        const blockIds = allBlocks.map((b) => b.id);
        for (let i = 0; i < blockIds.length; i += 100) {
          const batch = blockIds.slice(i, i + 100);
          const { data: movements } = await supabase
            .from('program_movements_v2')
            .select('id, block_id, movement, sets, reps, weight, weight_unit, rpe, time_seconds, distance, distance_unit, scaling_note, target_pct_1rm, sort_order')
            .in('block_id', batch)
            .order('sort_order');
          for (const m of movements || []) {
            const arr = movementsByBlock.get((m as ProgramMovementV2).block_id) ?? [];
            arr.push(m as ProgramMovementV2);
            movementsByBlock.set((m as ProgramMovementV2).block_id, arr);
          }
        }
      }
      // 3. Group blocks-with-movements by program_workout_id.
      for (const b of allBlocks) {
        b.movements = movementsByBlock.get(b.id) ?? [];
        const arr = blocksByWorkout.get(b.program_workout_id) ?? [];
        arr.push(b);
        blocksByWorkout.set(b.program_workout_id, arr);
      }
      setV3BlocksByWorkout(blocksByWorkout);
    }

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
              .from(isV3 ? 'program_blocks_v2' : 'program_workout_blocks')
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

  const handleNameChange = async (newName: string) => {
    const trimmed = newName.trim() || 'Untitled Program';
    if (!id || !program || trimmed === program.name) return;
    const { error } = await supabase.from('programs').update({ name: trimmed }).eq('id', id).eq('user_id', session.user.id);
    if (!error) setProgram(p => p ? { ...p, name: trimmed } : null);
  };

  const workouts = monthFilter
    ? allWorkouts.filter((w: any) => (w.month_number || 1) === monthFilter)
    : allWorkouts;
  const completedCount = workouts.filter(w => completedWorkoutIds.has(w.id)).length;
  const isGenerated = program?.source === 'generated' || program?.name?.startsWith('Month ');

  const handleGenerateNextMonth = async () => {
    if (!program || generatingNextMonth) return;
    setGeneratingNextMonth(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-next-month', {
        body: { program_id: program.id },
      });
      if (error) throw error;
      // Poll for completion
      const pollInterval = setInterval(async () => {
        const { data: jobData } = await supabase.functions.invoke('program-job-status', {
          body: { job_id: data.job_id },
        });
        if (jobData?.status === 'complete') {
          clearInterval(pollInterval);
          setGeneratingNextMonth(false);
          // Reload program to show new workouts
          loadProgram();
        } else if (jobData?.status === 'failed') {
          clearInterval(pollInterval);
          setGeneratingNextMonth(false);
          alert('Failed to generate next month: ' + (jobData?.error || 'Unknown error'));
        }
      }, 5000);
    } catch (err) {
      console.error('Generate next month failed:', err);
      setGeneratingNextMonth(false);
      alert('Failed to start generation');
    }
  };

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
            <h1>{monthFilter ? `Month ${monthFilter}` : 'Program'}</h1>
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
                    // Group workouts by month, then into weeks of 5 within each month
                    const monthGroups = new Map<number, ProgramWorkout[]>();
                    workouts.forEach((w) => {
                      const month = (w as any).month_number || 1;
                      if (!monthGroups.has(month)) monthGroups.set(month, []);
                      monthGroups.get(month)!.push(w);
                    });
                    const sortedMonths = Array.from(monthGroups.keys()).sort((a, b) => a - b);
                    const hasMultipleMonths = sortedMonths.length > 1 || (program?.generated_months || 1) > 1;

                    return sortedMonths.map(month => {
                      const monthWorkouts = monthGroups.get(month)!;
                      // Group by week_num written by the generator (handles variable
                      // days_per_week across the new archetype-based generation).
                      const weeks: { weekNum: number; days: ProgramWorkout[] }[] = [];
                      const weekMap = new Map<number, ProgramWorkout[]>();
                      monthWorkouts.forEach((w) => {
                        const wn = w.week_num || 1;
                        if (!weekMap.has(wn)) weekMap.set(wn, []);
                        weekMap.get(wn)!.push(w);
                      });
                      Array.from(weekMap.keys()).sort((a, b) => a - b).forEach((wn) => {
                        weeks.push({ weekNum: (month - 1) * 4 + wn, days: weekMap.get(wn)!.sort((a, b) => a.day_num - b.day_num) });
                      });

                      return (
                        <div key={month}>
                          {hasMultipleMonths && (
                            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)', margin: '24px 0 12px', paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                              Month {month}
                            </div>
                          )}
                          {weeks.map((week, wi) => (
                      <div key={wi} className="program-week-group">
                        <div className="program-week-label">Week {week.weekNum}</div>
                        {week.days.map((w) => {
                          const rawIp = inProgressWorkouts.get(w.id);
                          // Treat an in-progress log whose savedCount has reached
                          // totalBlocks as completed in the UI, even if the server
                          // hasn't flipped status yet (covers existing logs from
                          // before the save-workout-block auto-complete fix).
                          const allBlocksSaved = !!rawIp && rawIp.totalBlocks > 0 && rawIp.savedCount >= rawIp.totalBlocks;
                          const done = completedWorkoutIds.has(w.id) || allBlocksSaved;
                          const ip = done ? undefined : rawIp;
                          const isExpanded = expandedDays.has(w.id);
                          return (
                            <div key={w.id} className={`program-day-row${done ? ' program-day-completed' : ip ? ' program-day-in-progress' : ''}`}>
                              <button
                                className="program-day-header"
                                onClick={() => toggleDay(w.id)}
                                aria-expanded={isExpanded}
                              >
                                <div className="program-day-left">
                                  <div className="program-day-top-row">
                                    {done ? (
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                    ) : ip ? (
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning, #f39c12)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                    ) : (
                                      <span className="program-day-dot" />
                                    )}
                                    <span className="program-day-label">Day {w.day_num}</span>
                                    {w.day_type && DAY_TYPE_LABELS[w.day_type] && (
                                      <span className="program-day-archetype" style={{
                                        fontSize: 11, color: 'var(--text-dim)', marginLeft: 6,
                                        textTransform: 'uppercase', letterSpacing: 0.5,
                                      }}>
                                        {DAY_TYPE_LABELS[w.day_type]}
                                      </span>
                                    )}
                                    {done && <span className="program-completed-badge">Done</span>}
                                    {ip && <span className="program-in-progress-badge">{ip.savedCount}/{ip.totalBlocks} blocks</span>}
                                  </div>
                                  {!isExpanded && (
                                    <div className="program-day-summary-lines">
                                      {program?.program_version === 'v3' ? (
                                        // v3: read from program_blocks_v2 (in v3BlocksByWorkout).
                                        // Show strength, metcon, skills, accessory preview lines.
                                        (v3BlocksByWorkout.get(w.id) ?? [])
                                          .filter((b) => ['strength', 'metcon', 'skills', 'accessory'].includes(b.block_type))
                                          .map((b) => {
                                            const label = BLOCK_DISPLAY[b.block_type] ?? b.block_type.charAt(0).toUpperCase() + b.block_type.slice(1);
                                            // Prefer block_label, then block_scheme, then first movement name.
                                            const text =
                                              (b.block_label && b.block_label.trim()) ||
                                              (b.block_scheme && b.block_scheme.trim()) ||
                                              (b.movements[0]?.movement ?? '');
                                            const trimmed = text.length > 40 ? text.slice(0, 38) + '…' : text;
                                            return (
                                              <div key={b.id} className="program-day-summary-line">
                                                <span className="program-day-summary-label">{label}:</span>
                                                <span className="program-day-summary-text">{trimmed}</span>
                                              </div>
                                            );
                                          })
                                      ) : workoutBlocks.has(w.id) && workoutBlocks.get(w.id)!.length > 0 ? (
                                        workoutBlocks.get(w.id)!
                                          .filter((b) => ['skills', 'strength', 'metcon', 'accessory'].includes(b.block_type))
                                          .map((b) => {
                                            const label = b.block_type === 'metcon' ? 'Conditioning' : b.block_type.charAt(0).toUpperCase() + b.block_type.slice(1);
                                            const firstLine = b.block_text.split('\n')[0].trim();
                                            const text = firstLine.length > 40 ? firstLine.slice(0, 38) + '…' : firstLine;
                                            return (
                                              <div key={b.id} className="program-day-summary-line">
                                                <span className="program-day-summary-label">{label}:</span>
                                                <span className="program-day-summary-text">{text}</span>
                                              </div>
                                            );
                                          })
                                      ) : (
                                        workoutSummaryLines(w.workout_text).map((line) => (
                                          <div key={line.label} className="program-day-summary-line">
                                            <span className="program-day-summary-label">{line.label}:</span>
                                            <span className="program-day-summary-text">{line.text}</span>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
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
                                    {program?.program_version === 'v3' ? (
                                      <V3DayView blocks={v3BlocksByWorkout.get(w.id) ?? []} />
                                    ) : workoutBlocks.has(w.id) && workoutBlocks.get(w.id)!.length > 0 ? (
                                      <div className="workout-blocks">
                                        {workoutBlocks.get(w.id)!.map((b, bi) => (
                                          <div key={bi} className="workout-block">
                                            <div className="workout-block-label" data-block={b.block_type}>{
                                              b.block_type === 'warm-up' ? 'Warm-up' :
                                              b.block_type === 'cool-down' ? 'Cool down' :
                                              b.block_type.charAt(0).toUpperCase() + b.block_type.slice(1)
                                            }</div>
                                            <div className="workout-block-content">
                                              <BlockContent label={b.block_type === 'skills' ? 'Skills' : ''} content={b.block_text} />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <WorkoutBlocksDisplay text={w.workout_text} />
                                    )}
                                  </div>
                                  <div className="program-day-actions">
                                    {(() => {
                                      // For v3, generate a v1-style prose representation from the
                                      // structured blocks so the existing Coach + Start flows work
                                      // unchanged. Include v3_blocks in state for future v3-native
                                      // log-form rendering (step 8b).
                                      const isV3 = program?.program_version === 'v3';
                                      const v3Blocks = isV3 ? (v3BlocksByWorkout.get(w.id) ?? []) : null;
                                      const text = isV3
                                        ? v3BlocksToProse(v3Blocks ?? [])
                                        : w.workout_text;
                                      const reviewState = {
                                        workout_text: text,
                                        source_id: w.id,
                                        program_id: id,
                                        week_num: week.weekNum,
                                        day_num: w.day_num,
                                        ...(isV3 ? { v3_blocks: v3Blocks, program_version: 'v3' as const } : {}),
                                      };
                                      const startState = {
                                        workout_text: text,
                                        source_id: w.id,
                                        ...(isV3 ? { v3_blocks: v3Blocks, program_version: 'v3' as const } : {}),
                                      };
                                      return (
                                        <>
                                          <button
                                            className="auth-btn"
                                            onClick={() => navigate('/workout-review', { state: reviewState })}
                                            style={{ padding: '8px 14px', fontSize: 13, background: 'var(--surface2)', color: done ? 'var(--text-dim)' : 'var(--text)' }}
                                          >
                                            Coach
                                          </button>
                                          {!done && (
                                            <button
                                              className="auth-btn"
                                              onClick={() => navigate('/workout/start', { state: startState })}
                                              style={{ padding: '8px 14px', fontSize: 13 }}
                                            >
                                              {ip ? 'Resume' : 'Start'}
                                            </button>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                          ))}
                        </div>
                      );
                    });
                  })()}
                </div>
                {isGenerated && isAdmin && (
                  <div style={{ marginTop: 24, padding: '16px', background: 'var(--surface2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                        Month {program.generated_months || 1} of training (Admin)
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        {generatingNextMonth
                          ? 'Generating next month — evaluating profile and building workouts...'
                          : 'Generate the next month to continue your program.'}
                      </div>
                    </div>
                    <button
                      className="auth-btn"
                      disabled={generatingNextMonth}
                      onClick={handleGenerateNextMonth}
                      style={{ whiteSpace: 'nowrap', opacity: generatingNextMonth ? 0.6 : 1 }}
                    >
                      {generatingNextMonth ? 'Generating...' : `Generate Month ${(program.generated_months || 1) + 1}`}
                    </button>
                  </div>
                )}
                <div className="program-detail-actions" style={{ marginTop: 24 }}>
                  <button className="auth-btn" style={{ background: 'var(--surface2)', color: 'var(--text)' }} onClick={() => navigate('/programs')}>
                    Back
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

// ============================================================
// v3BlocksToProse — bridge helper that converts v3 structured
// blocks + movements into a v1-style prose representation for the
// existing /workout-review (Coach) and /workout/start (logging)
// pages. Lets v3 days use those flows immediately; future iteration
// (step 8b) builds a v3-native log form that pre-fills typed fields.
function v3BlocksToProse(blocks: ProgramBlockV2[]): string {
  if (!blocks.length) return '';
  const fmt = (m: ProgramMovementV2) => {
    const parts: string[] = [];
    if (m.sets != null && m.reps != null) parts.push(`${m.sets}×${m.reps}`);
    else if (m.sets != null) parts.push(`${m.sets} sets`);
    else if (m.reps != null) parts.push(`${m.reps} reps`);
    if (m.weight != null) parts.push(`${m.weight}${m.weight_unit ?? 'lbs'}`);
    if (m.rpe != null) parts.push(`RPE ${m.rpe}`);
    if (m.time_seconds != null) parts.push(`${m.time_seconds}s`);
    if (m.distance != null) parts.push(`${m.distance}${m.distance_unit ?? ''}`);
    const scheme = parts.length > 0 ? ` — ${parts.join(' · ')}` : '';
    const scaling = m.scaling_note ? ` (${m.scaling_note})` : '';
    return `${m.movement}${scheme}${scaling}`;
  };

  const sections: string[] = [];
  for (const b of blocks) {
    const labelHeader = BLOCK_DISPLAY[b.block_type] ?? b.block_type;
    const lines: string[] = [];
    const headerSuffix: string[] = [];
    if (b.block_label) headerSuffix.push(b.block_label);
    if (b.block_scheme) headerSuffix.push(b.block_scheme);
    if (b.time_cap_seconds) headerSuffix.push(`cap ${Math.round(b.time_cap_seconds / 60)} min`);
    lines.push(`${labelHeader}:${headerSuffix.length ? ' ' + headerSuffix.join(' — ') : ''}`);
    if (b.block_notes) lines.push(`  ${b.block_notes}`);
    for (const m of b.movements) lines.push(`  ${fmt(m)}`);
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}

// ============================================================
// V3DayView — production day-expand UI for v3 programs.
// Mobile-first block cards: block-type chip + block_label header,
// prominent block_scheme line, time-cap pill, per-movement rows
// with clean prescription typography (sets × reps · weight · RPE),
// scaling notes inline in dim text.
// ============================================================

interface V3DayViewProps {
  blocks: ProgramBlockV2[];
}

// Block display labels — aligned with v1 prose conventions so the
// same labels work in the V3DayView UI chip + the v3BlocksToProse
// output. v1's workout-review parser keys off these substrings to
// generate per-block coaching cards, so "Metcon" and "Cool down"
// must match exactly (not "Conditioning" / "Cool-down").
const BLOCK_DISPLAY: Record<string, string> = {
  'warm-up': 'Warm-up',
  'mobility': 'Mobility',
  'skills': 'Skills',
  'strength': 'Strength',
  'accessory': 'Accessory',
  'metcon': 'Metcon',
  'active-recovery': 'Recovery',
  'cool-down': 'Cool down',
};

function V3DayView({ blocks }: V3DayViewProps) {
  if (!blocks.length) {
    return (
      <div style={{ padding: 12, fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic' }}>
        No blocks for this day.
      </div>
    );
  }
  return (
    <div className="workout-blocks">
      {blocks.map((b) => <V3BlockCard key={b.id} block={b} />)}
    </div>
  );
}

function V3BlockCard({ block }: { block: ProgramBlockV2 }) {
  const displayLabel = BLOCK_DISPLAY[block.block_type] ?? block.block_type;
  const timeCapMin = block.time_cap_seconds ? Math.round(block.time_cap_seconds / 60) : null;

  // Reuse the existing .workout-block-label[data-block="…"] CSS for
  // per-block-type colors (warm-up amber, skills purple, strength pink,
  // metcon green, cool-down teal — see src/index.css).
  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text)',
  };
  const capPillStyle: React.CSSProperties = {
    display: 'inline-block',
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    background: 'var(--surface2)',
    color: 'var(--text-dim)',
    marginLeft: 'auto',
  };
  const schemeStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--accent)',
    marginTop: 6,
    marginBottom: 4,
  };
  const notesStyle: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--text-dim)',
    marginBottom: 8,
    fontStyle: 'italic',
  };

  return (
    <div className="workout-block" data-block={block.block_type}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span className="workout-block-label" data-block={block.block_type}>{displayLabel}</span>
        {block.block_label && <span style={labelStyle}>{block.block_label}</span>}
        {timeCapMin != null && <span style={capPillStyle}>cap {timeCapMin} min</span>}
      </div>
      {block.block_scheme && <div style={schemeStyle}>{block.block_scheme}</div>}
      {block.block_notes && <div style={notesStyle}>{block.block_notes}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {block.movements.map((m) => <V3MovementRow key={m.id} movement={m} />)}
      </div>
    </div>
  );
}

function V3MovementRow({ movement }: { movement: ProgramMovementV2 }) {
  const parts: string[] = [];
  if (movement.sets != null && movement.reps != null) parts.push(`${movement.sets}×${movement.reps}`);
  else if (movement.sets != null) parts.push(`${movement.sets} sets`);
  else if (movement.reps != null) parts.push(`${movement.reps} reps`);
  if (movement.weight != null) {
    const pct = movement.target_pct_1rm != null ? ` (${Math.round(movement.target_pct_1rm)}%)` : '';
    parts.push(`${movement.weight}${movement.weight_unit ?? 'lbs'}${pct}`);
  }
  if (movement.rpe != null) parts.push(`RPE ${movement.rpe}`);
  if (movement.time_seconds != null) parts.push(`${movement.time_seconds}s`);
  if (movement.distance != null) parts.push(`${movement.distance}${movement.distance_unit ?? ''}`);
  const prescription = parts.join(' · ');

  return (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      flexWrap: 'wrap',
      gap: 8,
      padding: '4px 0',
      borderBottom: '1px dashed var(--border)',
    }}>
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', flex: '0 0 auto' }}>
        {movement.movement}
      </span>
      {prescription && (
        <span style={{
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: 'var(--text)',
          marginLeft: 'auto',
        }}>
          {prescription}
        </span>
      )}
      {movement.scaling_note && (
        <span style={{
          flex: '0 0 100%',
          fontSize: 12,
          color: 'var(--text-dim)',
          fontStyle: 'italic',
          marginTop: 2,
        }}>
          {movement.scaling_note}
        </span>
      )}
    </div>
  );
}
