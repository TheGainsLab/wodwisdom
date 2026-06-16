import { useState } from 'react';

type DayStatus = 'scheduled' | 'partial' | 'completed' | 'both';

interface WorkoutCalendarProps {
  /** Map of "YYYY-MM-DD" → number of workouts that day */
  workoutCounts: Record<string, number>;
  /** Currently selected date key ("YYYY-MM-DD") */
  selectedDate?: string | null;
  /** Called when a day with workouts is tapped */
  onDayClick?: (dateKey: string) => void;
  /**
   * Optional per-date status for distinct scheduled-vs-completed styling.
   * When provided, a date is clickable/styled if it has a status OR a count.
   * Omit for the original count-only behavior (existing callers unaffected).
   */
  dayStatus?: Record<string, DayStatus>;
  /** Allow navigating into future months (scheduled days live in the future). */
  allowFuture?: boolean;
  /**
   * Optional per-date count of blocks completed that day. Shown on in-progress
   * (partial) cells as a bare number — a date can hold blocks from multiple
   * workouts, so there's no denominator.
   */
  blockCounts?: Record<string, number>;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function getIntensity(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

export default function WorkoutCalendar({ workoutCounts, selectedDate, onDayClick, dayStatus, allowFuture, blockCounts }: WorkoutCalendarProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  const todayKey = toKey(today.getFullYear(), today.getMonth(), today.getDate());

  // Month stat cards: days completed vs. days scheduled (status-driven).
  let daysCompleted = 0;
  let daysScheduled = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const st = dayStatus?.[toKey(year, month, d)];
    if (st === 'completed' || st === 'both') daysCompleted++;
    if (st === 'scheduled' || st === 'both') daysScheduled++;
  }
  // Fallback for count-only callers (no dayStatus): any logged day counts as completed.
  if (!dayStatus) {
    daysCompleted = Array.from({ length: daysInMonth }, (_, i) => workoutCounts[toKey(year, month, i + 1)] || 0).filter(n => n > 0).length;
  }

  return (
    <div className="wc-container">
      <div className="wc-header">
        <button className="wc-nav-btn" onClick={prevMonth} aria-label="Previous month">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="wc-month-label">{MONTHS[month]} {year}</span>
        <button className="wc-nav-btn" onClick={nextMonth} aria-label="Next month" disabled={isCurrentMonth && !allowFuture}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      <div className="wc-grid">
        {DAYS.map(d => (
          <div key={d} className="wc-day-label">{d}</div>
        ))}
        {Array.from({ length: firstDay }, (_, i) => (
          <div key={`empty-${i}`} className="wc-cell wc-cell--empty" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const key = toKey(year, month, day);
          const count = workoutCounts[key] || 0;
          const intensity = getIntensity(count);
          const isToday = isCurrentMonth && day === today.getDate();
          const isSelected = selectedDate === key;
          const status = dayStatus?.[key];
          const hasContent = count > 0 || !!status;
          // Completed = the prominent state (solid fill + check). Driven by status
          // when provided, else by count for plain heat-map callers.
          const isCompleted = status ? (status === 'completed' || status === 'both') : count > 0;
          // With allowFuture (the calendar-first add flow), empty today-forward
          // dates are also tappable so the parent can open an "Add" panel.
          const addable = !!allowFuture && key >= todayKey;
          const clickable = hasContent || addable;
          const statusClass = status ? ` wc-cell--${status}` : '';
          const title = status === 'scheduled' ? 'Scheduled'
            : status === 'partial' ? 'In progress'
            : status === 'both' ? 'Scheduled + completed'
            : status === 'completed' ? 'Completed'
            : count ? `${count} workout${count > 1 ? 's' : ''}` : addable ? 'Add training' : 'Rest day';
          return (
            <div
              key={day}
              className={`wc-cell wc-cell--i${intensity}${statusClass}${isToday ? ' wc-cell--today' : ''}${isSelected ? ' wc-cell--selected' : ''}${clickable ? ' wc-cell--clickable' : ''}`}
              title={title}
              onClick={clickable && onDayClick ? () => onDayClick(key) : undefined}
            >
              <span className="wc-cell-num">{day}</span>
              {isCompleted ? (
                <svg className="wc-cell-check" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : status === 'partial' && (blockCounts?.[key] ?? 0) > 0 ? (
                <span className="wc-cell-blocks" title={`${blockCounts![key]} block${blockCounts![key] > 1 ? 's' : ''} done`}>{blockCounts![key]}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="wc-stats">
        <div className="wc-stat">
          <span className="wc-stat-value">{daysCompleted}</span>
          <span className="wc-stat-label">days completed</span>
        </div>
        <div className="wc-stat">
          <span className="wc-stat-value">{daysScheduled}</span>
          <span className="wc-stat-label">days scheduled</span>
        </div>
      </div>
    </div>
  );
}
