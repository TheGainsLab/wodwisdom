import { useState } from 'react';

interface WorkoutCalendarProps {
  /** Map of "YYYY-MM-DD" → number of workouts that day */
  workoutCounts: Record<string, number>;
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

export default function WorkoutCalendar({ workoutCounts }: WorkoutCalendarProps) {
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

  // Count workouts this month
  const monthWorkouts = Array.from({ length: daysInMonth }, (_, i) => {
    const key = toKey(year, month, i + 1);
    return workoutCounts[key] || 0;
  });
  const totalThisMonth = monthWorkouts.reduce((s, n) => s + n, 0);
  const activeDays = monthWorkouts.filter(n => n > 0).length;

  // Calculate streak (consecutive days ending at today or most recent workout day)
  let streak = 0;
  if (isCurrentMonth) {
    for (let d = today.getDate(); d >= 1; d--) {
      const key = toKey(year, month, d);
      if (workoutCounts[key]) streak++;
      else if (d < today.getDate()) break; // allow today to be missing (day not over yet)
      else break;
    }
  }

  return (
    <div className="wc-container">
      <div className="wc-header">
        <button className="wc-nav-btn" onClick={prevMonth} aria-label="Previous month">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="wc-month-label">{MONTHS[month]} {year}</span>
        <button className="wc-nav-btn" onClick={nextMonth} aria-label="Next month" disabled={isCurrentMonth}>
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
          return (
            <div
              key={day}
              className={`wc-cell wc-cell--i${intensity}${isToday ? ' wc-cell--today' : ''}`}
              title={count ? `${count} workout${count > 1 ? 's' : ''}` : 'Rest day'}
            >
              <span className="wc-cell-num">{day}</span>
            </div>
          );
        })}
      </div>

      <div className="wc-stats">
        <div className="wc-stat">
          <span className="wc-stat-value">{totalThisMonth}</span>
          <span className="wc-stat-label">workouts</span>
        </div>
        <div className="wc-stat">
          <span className="wc-stat-value">{activeDays}</span>
          <span className="wc-stat-label">active days</span>
        </div>
        {isCurrentMonth && streak > 0 && (
          <div className="wc-stat">
            <span className="wc-stat-value">{streak}</span>
            <span className="wc-stat-label">day streak</span>
          </div>
        )}
      </div>
    </div>
  );
}
