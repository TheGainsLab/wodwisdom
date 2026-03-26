import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import NutritionPaywall from '../components/nutrition/NutritionPaywall';
import { useEntitlements } from '../hooks/useEntitlements';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

interface DaySummary {
  entry_count: number;
  total_calories: number;
  total_protein: number;
}

export default function NutritionCalendarPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const { hasFeature, loading: entLoading } = useEntitlements(session.user.id);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [daySummaries, setDaySummaries] = useState<Record<string, DaySummary>>({});
  const [loading, setLoading] = useState(true);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  useEffect(() => {
    loadMonth();
  }, [year, month, session.user.id]);

  const loadMonth = async () => {
    setLoading(true);
    const startDate = toKey(year, month, 1);
    const endDate = toKey(year, month, daysInMonth);

    const { data } = await supabase
      .from('food_entries')
      .select('logged_at, calories, protein')
      .eq('user_id', session.user.id)
      .gte('logged_at', `${startDate}T00:00:00.000Z`)
      .lte('logged_at', `${endDate}T23:59:59.999Z`);

    const summaries: Record<string, DaySummary> = {};
    if (data) {
      for (const entry of data) {
        const key = entry.logged_at.slice(0, 10);
        if (!summaries[key]) {
          summaries[key] = { entry_count: 0, total_calories: 0, total_protein: 0 };
        }
        summaries[key].entry_count++;
        summaries[key].total_calories += entry.calories || 0;
        summaries[key].total_protein += entry.protein || 0;
      }
    }
    setDaySummaries(summaries);
    setLoading(false);
  };

  const getIntensity = (count: number): number => {
    if (count === 0) return 0;
    if (count <= 2) return 1;
    if (count <= 4) return 2;
    return 3;
  };

  // Stats for the month
  const daysLogged = Object.keys(daySummaries).length;
  const avgCalories = daysLogged > 0
    ? Math.round(Object.values(daySummaries).reduce((s, d) => s + d.total_calories, 0) / daysLogged)
    : 0;

  // Streak
  let streak = 0;
  if (isCurrentMonth) {
    for (let d = today.getDate(); d >= 1; d--) {
      const key = toKey(year, month, d);
      if (daySummaries[key]) streak++;
      else if (d < today.getDate()) break;
      else break;
    }
  }

  const selected = selectedDate ? daySummaries[selectedDate] : null;

  if (!entLoading && !hasFeature('nutrition')) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <header className="page-header">
            <button className="menu-btn" onClick={() => setNavOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            <h1>Nutrition Calendar</h1>
          </header>
          <div className="page-body">
            <NutritionPaywall />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Nutrition Calendar</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 520, margin: '0 auto' }}>
            {loading ? (
              <div className="page-loading"><div className="loading-pulse" /></div>
            ) : (
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
                    const summary = daySummaries[key];
                    const count = summary?.entry_count || 0;
                    const intensity = getIntensity(count);
                    const isToday = isCurrentMonth && day === today.getDate();
                    const isSelected = selectedDate === key;
                    const hasEntries = count > 0;
                    return (
                      <div
                        key={day}
                        className={`wc-cell wc-cell--i${intensity}${isToday ? ' wc-cell--today' : ''}${isSelected ? ' wc-cell--selected' : ''}${hasEntries ? ' wc-cell--clickable' : ''}`}
                        title={count ? `${count} entr${count > 1 ? 'ies' : 'y'}` : 'No entries'}
                        onClick={hasEntries ? () => setSelectedDate(isSelected ? null : key) : undefined}
                      >
                        <span className="wc-cell-num">{day}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="wc-stats">
                  <div className="wc-stat">
                    <span className="wc-stat-value">{daysLogged}</span>
                    <span className="wc-stat-label">days logged</span>
                  </div>
                  <div className="wc-stat">
                    <span className="wc-stat-value">{avgCalories}</span>
                    <span className="wc-stat-label">avg cal</span>
                  </div>
                  {isCurrentMonth && streak > 0 && (
                    <div className="wc-stat">
                      <span className="wc-stat-value">{streak}</span>
                      <span className="wc-stat-label">day streak</span>
                    </div>
                  )}
                </div>

                {/* Day detail */}
                {selectedDate && selected && (
                  <div className="wc-day-detail" style={{ marginTop: 12 }}>
                    <div className="wc-day-detail-header">
                      <span className="wc-day-detail-date">
                        {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </span>
                      <button className="wc-day-detail-close" onClick={() => setSelectedDate(null)} aria-label="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 16, padding: '12px 0', fontSize: 14 }}>
                      <div><span style={{ fontWeight: 700 }}>{Math.round(selected.total_calories)}</span> <span style={{ color: 'var(--text-dim)' }}>cal</span></div>
                      <div><span style={{ fontWeight: 700 }}>{Math.round(selected.total_protein)}g</span> <span style={{ color: 'var(--text-dim)' }}>protein</span></div>
                      <div><span style={{ fontWeight: 700 }}>{selected.entry_count}</span> <span style={{ color: 'var(--text-dim)' }}>entries</span></div>
                    </div>
                    <button
                      className="auth-btn"
                      style={{ width: '100%', marginTop: 4 }}
                      onClick={() => navigate(`/nutrition?date=${selectedDate}`)}
                    >
                      View Full Day
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
