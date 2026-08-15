import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import ProgramSelection from '../components/engine/ProgramSelection';
import EnginePaywall from '../components/engine/EnginePaywall';
import {
  loadUserProgress,
  getWorkoutsForProgram,
  loadCompletedSessions,
  saveEngineGoal,
  type EngineWorkout,
  type EngineUserProgress,
  calculateWorkDurationMinutes,
} from '../lib/engineService';
import { useEntitlements } from '../hooks/useEntitlements';
import { ChevronLeft, Lock, Check, Play, Settings, BarChart3, Calendar, Trophy, Target } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────

function dayTypeBadge(dayType: string): string {
  switch (dayType) {
    case 'endurance': case 'endurance_long': case 'interval': case 'max_aerobic_power': case 'hybrid_aerobic':
      return 'engine-badge--endurance';
    case 'threshold': case 'threshold_stepped': case 'anaerobic': case 'descending_devour': case 'ascending':
      return 'engine-badge--strength';
    case 'polarized': case 'flux': case 'flux_stages': case 'rocket_races_a': case 'rocket_races_b': case 'afterburner':
      return 'engine-badge--power';
    case 'time_trial': case 'devour': case 'ascending_devour': case 'infinity': case 'towers': case 'synthesis': case 'atomic': case 'hybrid_anaerobic':
      return 'engine-badge--hypertrophy';
    default:
      return 'engine-badge--default';
  }
}

function groupByMonth(workouts: EngineWorkout[]): Map<number, EngineWorkout[]> {
  // Input is already in program sequence order (see getWorkoutsForProgram),
  // so iteration order naturally preserves the program's intended within-
  // month ordering. For YoE where catalog day == sequence, this matches the
  // old day_number-sorted behavior. For specialty programs where catalog
  // days jump around, preserving sequence order gives the user the correct
  // in-program progression instead of a random catalog-order shuffle.
  const map = new Map<number, EngineWorkout[]>();
  for (const w of workouts) {
    const m = w.month ?? 1;
    if (!map.has(m)) map.set(m, []);
    map.get(m)!.push(w);
  }
  return map;
}

type DayStatus = 'completed' | 'current' | 'available' | 'locked';

function getDayStatus(
  dayNumber: number,
  currentDay: number,
  completedDays: Set<number>,
  dayMonth: number,
  monthsUnlocked: number,
): DayStatus {
  // Month lock wins over everything: a locked month's days are never playable,
  // even when the current-day pointer has advanced into that month (a lapsed
  // subscriber or a user at their payment ceiling).
  if (dayMonth > monthsUnlocked) return 'locked';
  if (completedDays.has(dayNumber)) return 'completed';
  if (dayNumber === currentDay) return 'current';
  return 'available';
}

// ── Component ────────────────────────────────────────────────────────

export default function EngineDashboardPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<EngineUserProgress | null>(null);
  const [workouts, setWorkouts] = useState<EngineWorkout[]>([]);
  const [completedDays, setCompletedDays] = useState<Set<number>>(new Set());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [showSwitcher, setShowSwitcher] = useState(false);
  // Goal row: one quiet line between the stat tiles and Start. Tap to edit
  // inline; blank clears. The sequencer + chat read engine_goal — unset means
  // they behave exactly as before the feature existed.
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');
  const [goalSaving, setGoalSaving] = useState(false);
  const { hasFeature, hasEngineAccess, isAdmin, loading: entLoading } = useEntitlements(session.user.id);

  const load = async () => {
    setLoading(true);
    try {
      const p = await loadUserProgress();
      setProgress(p);
      if (p?.engine_program_version) {
        const [wk, sessions] = await Promise.all([
          getWorkoutsForProgram(p.engine_program_version),
          loadCompletedSessions(p.engine_program_version),
        ]);
        setWorkouts(wk);
        // Sequence identity: completion is tracked by SEQUENCE position.
        // Fallback for sessions without one (written by pre-refactor bundles
        // in the deploy window): earliest position matching their catalog day.
        const seqByCatalog = new Map<number, number>();
        for (const w of wk) {
          if (w.sequence_position != null && !seqByCatalog.has(w.day_number)) {
            seqByCatalog.set(w.day_number, w.sequence_position);
          }
        }
        setCompletedDays(
          new Set(
            sessions
              .map((s) => s.sequence_position ?? (s.program_day_number != null ? seqByCatalog.get(s.program_day_number) : null))
              .filter((n): n is number => n != null),
          ),
        );
      }
    } catch {
      // silently degrade — user sees empty state
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [session.user.id]);

  // ── No subscription → show paywall ──

  const hasAccess = hasEngineAccess;

  if (entLoading) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <div className="page-loading"><div className="loading-pulse" /></div>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <header className="page-header">
            <button className="menu-btn" onClick={() => setNavOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            <h1>Engine</h1>
          </header>
          <EnginePaywall hasFeature={hasFeature} />
        </div>
      </div>
    );
  }

  // ── No program version → show selection ──

  if (!loading && (!progress || !progress.engine_program_version)) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <header className="page-header">
            <button className="menu-btn" onClick={() => setNavOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            <h1>Engine</h1>
          </header>
          <ProgramSelection onSelected={() => load()} />
        </div>
      </div>
    );
  }

  // ── Program switcher view ──

  if (showSwitcher) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <header className="page-header">
            <button className="menu-btn" onClick={() => setShowSwitcher(false)}>
              <ChevronLeft size={20} />
            </button>
            <h1>Engine</h1>
          </header>
          <ProgramSelection
            currentProgram={progress?.engine_program_version}
            onSelected={() => { setShowSwitcher(false); load(); }}
          />
        </div>
      </div>
    );
  }

  // ── Derived data ──

  // Sequence identity: the pointer IS the athlete-facing sequence position.
  const currentDay = progress?.engine_current_day ?? 1;
  const currentSeq = currentDay;
  const totalDays = workouts.length;

  // Use engine_months_unlocked from the database — incremented by payment webhooks
  const monthsUnlocked = progress?.engine_months_unlocked ?? 1;
  const completedCount = completedDays.size;
  const pct = totalDays > 0 ? Math.round((completedCount / totalDays) * 100) : 0;
  const monthMap = groupByMonth(workouts);
  const months = Array.from(monthMap.keys()).sort((a, b) => a - b).filter(m => m <= monthsUnlocked);

  // Month of the current day (mapping month, not day/20). When the pointer sits
  // in a month beyond the user's entitlement, the start button becomes a lock.
  const currentDayMonth = workouts.find((w) => w.sequence_position === currentDay)?.month ?? 1;
  const currentDayLocked = currentDayMonth > monthsUnlocked;

  // Month-level data (when drilled in)
  const monthDays = selectedMonth != null ? (monthMap.get(selectedMonth) ?? []) : [];
  const monthCompletedCount =
    selectedMonth != null
      ? monthDays.filter((d) => d.sequence_position != null && completedDays.has(d.sequence_position)).length
      : 0;

  // ── Render ──

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1 style={{ flex: 1, textAlign: 'center' }}>Engine</h1>
          <button
            className="menu-btn engine-settings-btn"
            onClick={() => setShowSwitcher(true)}
            title="Program settings"
          >
            <Settings size={20} />
          </button>
        </header>

        {loading ? (
          <div className="page-loading"><div className="loading-pulse" /></div>
        ) : selectedMonth != null ? (
          /* ──────── Month View ──────── */
          <div className="engine-page">
            <div className="engine-section">
              {/* Month header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  className="engine-btn engine-btn-secondary engine-btn-sm"
                  onClick={() => setSelectedMonth(null)}
                >
                  <ChevronLeft size={16} /> Back
                </button>
                <h2 className="engine-header" style={{ flex: 1 }}>Month {selectedMonth}</h2>
                <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  {monthCompletedCount}/{monthDays.length} completed
                </span>
              </div>

              {/* Month progress */}
              <div className="engine-progress">
                <div className="engine-progress-bar">
                  <div
                    className="engine-progress-fill"
                    style={{ width: monthDays.length > 0 ? `${(monthCompletedCount / monthDays.length) * 100}%` : '0%' }}
                  />
                </div>
              </div>

              {/* Day list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {monthDays.map((day) => {
                  const status = getDayStatus(day.sequence_position ?? day.day_number, currentDay, completedDays, selectedMonth, monthsUnlocked);
                  const isLocked = status === 'locked';

                  return (
                    <button
                      key={day.day_number}
                      className="engine-exercise"
                      onClick={() => !isLocked && navigate(`/engine/training/${day.sequence_position ?? day.day_number}`)}
                      disabled={isLocked}
                      style={{
                        opacity: isLocked ? 0.4 : 1,
                        cursor: isLocked ? 'not-allowed' : 'pointer',
                        color: 'var(--text)',
                        border: status === 'current' ? '1px solid var(--accent)' : '1px solid transparent',
                        background: status === 'current' ? 'var(--accent-glow)' : 'transparent',
                      }}
                    >
                      {/* Status icon */}
                      <span style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        fontSize: 12,
                        fontWeight: 700,
                        background: status === 'completed' ? 'rgba(34,197,94,.15)' : status === 'current' ? 'var(--accent)' : 'var(--surface2)',
                        color: status === 'completed' ? '#4ade80' : status === 'current' ? 'white' : 'var(--text-muted)',
                      }}>
                        {status === 'completed' ? <Check size={14} /> : status === 'locked' ? <Lock size={12} /> : (day.sequence_position ?? day.day_number)}
                      </span>

                      <span className="engine-exercise-name">Day {day.sequence_position ?? day.day_number}</span>

                      <span className={'engine-badge ' + dayTypeBadge(day.day_type)}>
                        {day.day_type.replace(/_/g, ' ')}
                      </span>

                      <span className="engine-exercise-detail">{calculateWorkDurationMinutes(day)}min work</span>

                      {status === 'current' && (
                        <Play size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* ──────── Overview ──────── */
          <div className="engine-page">
            <div className="engine-section">
              {/* Progress bar */}
              <div className="engine-progress">
                <div className="engine-progress-header">
                  <span className="engine-progress-label">Overall Progress</span>
                  <span className="engine-progress-count">{completedCount}/{totalDays} days ({pct}%)</span>
                </div>
                <div className="engine-progress-bar">
                  <div className="engine-progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>

              {/* Stats */}
              <div className="engine-grid">
                <div className="engine-stat">
                  <div className="engine-stat-value">{currentSeq}</div>
                  <div className="engine-stat-label">Current Day</div>
                </div>
                <div className="engine-stat">
                  <div className="engine-stat-value">{completedCount}</div>
                  <div className="engine-stat-label">Completed</div>
                </div>
              </div>

              {/* Goal row — one quiet line, never a fifth red bar. Unset copy
                  doubles as the sequencer's announcement to existing users. */}
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setGoalDraft(progress?.engine_goal ?? '');
                    setGoalEditing(v => !v);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '2px 4px', background: 'none', border: 'none', fontFamily: 'inherit', fontSize: 14, textAlign: 'left', cursor: 'pointer', color: progress?.engine_goal ? 'var(--text)' : 'var(--text-muted)' }}
                >
                  <Target size={17} style={{ flex: 'none', color: progress?.engine_goal ? 'var(--accent)' : 'currentColor' }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {progress?.engine_goal || 'Set a goal — your AI sequencer will train toward it'}
                  </span>
                  <span style={{ flex: 'none', color: 'var(--text-muted)', fontSize: 13 }}>{progress?.engine_goal ? '✎' : '→'}</span>
                </button>
                {goalEditing && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 2px 4px' }}>
                    <textarea
                      className="lift-input"
                      rows={2}
                      maxLength={500}
                      placeholder='e.g. "Row a 10k under 40:00" · "Sub-20 5k" · "Improve my mile"'
                      value={goalDraft}
                      onChange={e => setGoalDraft(e.target.value)}
                      style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', textAlign: 'left', fontSize: 14 }}
                    />
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Your AI sequencer weighs upcoming days toward this. General is fine — specific is better. Leave blank any time.
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="engine-btn engine-btn-secondary engine-btn-sm"
                        disabled={goalSaving}
                        onClick={async () => {
                          setGoalSaving(true);
                          try {
                            await saveEngineGoal(goalDraft);
                            setProgress(p => (p ? { ...p, engine_goal: goalDraft.trim() || null } : p));
                            setGoalEditing(false);
                          } catch {
                            // leave the editor open; user can retry
                          }
                          setGoalSaving(false);
                        }}
                      >
                        {goalSaving ? 'Saving…' : 'Save Goal'}
                      </button>
                      <button type="button" onClick={() => setGoalEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Start button — locked when the pointer sits in a month beyond entitlement */}
              {currentDayLocked ? (
                <div
                  className="engine-card"
                  style={{ width: '100%', textAlign: 'center', padding: '16px 20px', borderStyle: 'dashed' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 700 }}>
                    <Lock size={16} /> Day {currentSeq} is in Month {currentDayMonth}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                    You have {monthsUnlocked} {monthsUnlocked === 1 ? 'month' : 'months'} unlocked. Month {currentDayMonth} unlocks
                    with your next monthly payment.
                  </div>
                </div>
              ) : (
                <button
                  className="engine-btn engine-btn-primary"
                  onClick={() => navigate(`/engine/training/${currentDay}`)}
                  style={{ width: '100%' }}
                >
                  <Play size={18} /> Start Day {currentSeq}
                </button>
              )}

              {/* Analytics button */}
              <button
                className="engine-btn engine-btn-primary"
                onClick={() => navigate('/engine/analytics')}
                style={{ width: '100%' }}
              >
                <BarChart3 size={18} /> Engine Analytics
              </button>

              {/* Leaderboard button — admin-gated for Tier-1 testing */}
              {isAdmin && (
                <button
                  className="engine-btn engine-btn-primary"
                  onClick={() => navigate('/engine/leaderboard')}
                  style={{ width: '100%' }}
                >
                  <Trophy size={18} /> Leaderboard
                </button>
              )}

              {/* Training Log button */}
              <button
                className="engine-btn engine-btn-primary"
                onClick={() => navigate('/training-log')}
                style={{ width: '100%' }}
              >
                <Calendar size={18} /> Training Log
              </button>

              <hr className="engine-divider" />

              {/* Month grid */}
              <h3 className="engine-header">Months</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {months.map((m) => {
                  const days = monthMap.get(m) ?? [];
                  const done = days.filter((d) => d.sequence_position != null && completedDays.has(d.sequence_position)).length;
                  const isLocked = m > monthsUnlocked;
                  const isCurrent = days.some((d) => d.sequence_position === currentDay);
                  const isComplete = done === days.length && days.length > 0;

                  return (
                    <button
                      key={m}
                      className="engine-card"
                      onClick={() => !isLocked && setSelectedMonth(m)}
                      disabled={isLocked}
                      style={{
                        cursor: isLocked ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        transition: 'all .2s',
                        color: 'var(--text)',
                        background: isLocked ? 'var(--bg)' : undefined,
                        borderColor: isCurrent
                          ? 'var(--accent)'
                          : isComplete
                            ? 'rgba(34,197,94,.3)'
                            : isLocked
                              ? 'var(--border)'
                              : undefined,
                        borderStyle: isLocked ? 'dashed' : undefined,
                        boxShadow: isCurrent ? '0 0 20px var(--accent-glow)' : undefined,
                        padding: '14px 16px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isLocked ? 0 : 8 }}>
                        <span style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: isLocked ? 'var(--text-muted)' : undefined,
                        }}>
                          Month {m}
                        </span>
                        {isLocked && <Lock size={14} color="var(--text-dim)" />}
                        {isComplete && <Check size={14} color="#4ade80" />}
                      </div>
                      {!isLocked && (
                        <>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
                            {done}/{days.length} days
                          </div>
                          <div className="engine-progress-bar" style={{ height: 4 }}>
                            <div
                              className="engine-progress-fill"
                              style={{
                                width: days.length > 0 ? `${(done / days.length) * 100}%` : '0%',
                                background: isComplete ? '#4ade80' : undefined,
                              }}
                            />
                          </div>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
