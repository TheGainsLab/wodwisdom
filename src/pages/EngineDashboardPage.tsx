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
  type EngineWorkout,
  type EngineUserProgress,
} from '../lib/engineService';
import { ChevronLeft, Lock, Check, Play } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────

function dayTypeBadge(dayType: string): string {
  switch (dayType) {
    case 'endurance':
    case 'endurance_long':
      return 'engine-badge--endurance';
    case 'threshold':
    case 'threshold_stepped':
    case 'anaerobic':
      return 'engine-badge--strength';
    case 'polarized':
    case 'flux':
      return 'engine-badge--power';
    case 'time_trial':
      return 'engine-badge--hypertrophy';
    default:
      return 'engine-badge--default';
  }
}

function groupByMonth(workouts: EngineWorkout[]): Map<number, EngineWorkout[]> {
  const map = new Map<number, EngineWorkout[]>();
  for (const w of workouts) {
    const m = w.month ?? 1;
    if (!map.has(m)) map.set(m, []);
    map.get(m)!.push(w);
  }
  for (const days of map.values()) {
    days.sort((a, b) => a.day_number - b.day_number);
  }
  return map;
}

type DayStatus = 'completed' | 'current' | 'available' | 'locked';

function getDayStatus(
  dayNumber: number,
  currentDay: number,
  completedDays: Set<number>,
): DayStatus {
  if (completedDays.has(dayNumber)) return 'completed';
  if (dayNumber === currentDay) return 'current';
  if (dayNumber < currentDay) return 'available';
  return 'locked';
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

  const load = async () => {
    setLoading(true);
    try {
      const p = await loadUserProgress();
      setProgress(p);
      if (p?.engine_program_version) {
        const [wk, sessions] = await Promise.all([
          getWorkoutsForProgram(p.engine_program_version),
          loadCompletedSessions(),
        ]);
        setWorkouts(wk);
        setCompletedDays(
          new Set(
            sessions
              .map((s) => s.program_day_number)
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

  const hasAccess = progress?.engine_subscription_status === 'active' || progress?.engine_subscription_status === 'trial';

  if (!loading && !hasAccess) {
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
          <EnginePaywall />
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

  // ── Derived data ──

  const currentDay = progress?.engine_current_day ?? 1;
  const monthsUnlocked = progress?.engine_months_unlocked ?? 1;
  const totalDays = workouts.length;
  const completedCount = completedDays.size;
  const pct = totalDays > 0 ? Math.round((completedCount / totalDays) * 100) : 0;
  const monthMap = groupByMonth(workouts);
  const months = Array.from(monthMap.keys()).sort((a, b) => a - b);

  // Month-level data (when drilled in)
  const monthDays = selectedMonth != null ? (monthMap.get(selectedMonth) ?? []) : [];
  const monthCompletedCount =
    selectedMonth != null
      ? monthDays.filter((d) => completedDays.has(d.day_number)).length
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
          <h1>Engine</h1>
          {progress && (
            <span className="usage-pill">Day {currentDay} of {totalDays}</span>
          )}
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
                  const status = getDayStatus(day.day_number, currentDay, completedDays);
                  const isLocked = status === 'locked';

                  return (
                    <button
                      key={day.day_number}
                      className="engine-exercise"
                      onClick={() => !isLocked && navigate(`/engine/training/${day.day_number}`)}
                      disabled={isLocked}
                      style={{
                        opacity: isLocked ? 0.4 : 1,
                        cursor: isLocked ? 'not-allowed' : 'pointer',
                        border: status === 'current' ? '1px solid var(--accent)' : '1px solid transparent',
                        background: status === 'current' ? 'var(--accent-glow)' : undefined,
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
                        {status === 'completed' ? <Check size={14} /> : status === 'locked' ? <Lock size={12} /> : day.day_number}
                      </span>

                      <span className="engine-exercise-name">Day {day.day_number}</span>

                      <span className={'engine-badge ' + dayTypeBadge(day.day_type)}>
                        {day.day_type.replace(/_/g, ' ')}
                      </span>

                      {day.total_duration_minutes != null && (
                        <span className="engine-exercise-detail">{day.total_duration_minutes}min</span>
                      )}

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
                  <div className="engine-stat-value">{currentDay}</div>
                  <div className="engine-stat-label">Current Day</div>
                </div>
                <div className="engine-stat">
                  <div className="engine-stat-value">{completedCount}</div>
                  <div className="engine-stat-label">Completed</div>
                </div>
              </div>

              {/* Start button */}
              <button
                className="engine-btn engine-btn-primary"
                onClick={() => navigate(`/engine/training/${currentDay}`)}
                style={{ width: '100%' }}
              >
                <Play size={18} /> Start Day {currentDay}
              </button>

              <hr className="engine-divider" />

              {/* Month grid */}
              <h3 className="engine-header">Months</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {months.map((m) => {
                  const days = monthMap.get(m) ?? [];
                  const done = days.filter((d) => completedDays.has(d.day_number)).length;
                  const isLocked = m > monthsUnlocked;
                  const isCurrent = days.some((d) => d.day_number === currentDay);
                  const isComplete = done === days.length && days.length > 0;

                  return (
                    <button
                      key={m}
                      className="engine-card"
                      onClick={() => !isLocked && setSelectedMonth(m)}
                      disabled={isLocked}
                      style={{
                        cursor: isLocked ? 'not-allowed' : 'pointer',
                        opacity: isLocked ? 0.35 : 1,
                        textAlign: 'left',
                        transition: 'all .2s',
                        borderColor: isCurrent ? 'var(--accent)' : isComplete ? 'rgba(34,197,94,.3)' : undefined,
                        boxShadow: isCurrent ? '0 0 20px var(--accent-glow)' : undefined,
                        padding: '14px 16px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>Month {m}</span>
                        {isLocked && <Lock size={14} color="var(--text-muted)" />}
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
