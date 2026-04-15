import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

// ── Types ────────────────────────────────────────────────────────────

interface DaySummary {
  date: string;  // 'YYYY-MM-DD'
  total_calories: number | null;
  total_protein: number | null;
  total_carbohydrate: number | null;
  total_fat: number | null;
  entry_count: number;
}

interface Totals {
  total_days_ever: number;
  days_30d: number;
  total_entries: number;
  entries_30d: number;
  avg_calories_30d: number | null;
}

interface Targets {
  tdee: number | null;
  bmr: number | null;
  adjusted_tdee: number | null;
}

interface FoodEntry {
  id: string;
  food_name: string;
  serving_description: string | null;
  number_of_units: number;
  calories: number | null;
  protein: number | null;
  carbohydrate: number | null;
  fat: number | null;
  fiber: number | null;
  sodium: number | null;
  meal_type: string | null;
  notes: string | null;
  logged_at: string;
  [key: string]: any;
}

interface DayDetail {
  date: string;
  daily: any;
  entries: FoodEntry[];
  totals: {
    calories: number | null;
    protein: number | null;
    carbohydrate: number | null;
    fat: number | null;
    fiber: number | null;
    sodium: number | null;
    entry_count: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function humanize(s: string | null | undefined): string {
  if (!s) return 'Other';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseISODate(s: string): Date {
  // Interpret 'YYYY-MM-DD' as local midnight
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatDayLabel(s: string): string {
  const d = parseISODate(s);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminNutritionPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState<DaySummary[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [targets, setTargets] = useState<Targets | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [day, setDay] = useState<DayDetail | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({});

  // Load summary (last 60 days)
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const until = new Date();
      const since = new Date(Date.now() - 60 * 864e5);
      const { data, error: err } = await supabase.rpc('admin_get_nutrition_summary', {
        target_user_id: id,
        p_since: formatISODate(since),
        p_until: formatISODate(until),
      });
      if (err) setError(err.message);
      else if (data) {
        const dayList: DaySummary[] = Array.isArray(data.days) ? data.days : [];
        setDays(dayList);
        setTotals(data.totals ?? null);
        setTargets(data.targets ?? null);
        // Auto-select most recent logged day
        if (dayList.length > 0 && !selectedDate) {
          setSelectedDate(dayList[dayList.length - 1].date);
        }
      }
      setLoading(false);
    })();
  }, [id]);

  // Load detail for selected date
  useEffect(() => {
    if (!id || !selectedDate) return;
    (async () => {
      setDayLoading(true);
      const { data } = await supabase.rpc('admin_get_nutrition_day', {
        target_user_id: id,
        p_date: selectedDate,
      });
      setDay(data as DayDetail | null);
      setDayLoading(false);
    })();
  }, [id, selectedDate]);

  // 30-day trend values
  const trend = useMemo(() => {
    const cutoff = new Date(Date.now() - 30 * 864e5);
    const map = new Map(days.map(d => [d.date, d]));
    const result: { date: string; calories: number | null; protein: number | null }[] = [];
    for (let i = 30; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      if (d < cutoff) continue;
      const iso = formatISODate(d);
      const entry = map.get(iso);
      result.push({
        date: iso,
        calories: entry?.total_calories ?? null,
        protein: entry?.total_protein ?? null,
      });
    }
    return result;
  }, [days]);

  // Entries grouped by meal
  const mealGroups = useMemo(() => {
    if (!day) return [];
    const groups = new Map<string, FoodEntry[]>();
    for (const e of day.entries) {
      const key = e.meal_type || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    const order = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];
    return order
      .filter(k => groups.has(k))
      .map(k => ({
        meal: k,
        entries: groups.get(k)!,
        total_calories: groups.get(k)!.reduce((s, e) => s + (e.calories ?? 0), 0),
      }));
  }, [day]);

  const target = targets?.adjusted_tdee ?? targets?.tdee ?? null;

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Nutrition">
      {loading && <div className="page-loading"><div className="loading-pulse" /></div>}
      {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}

      {!loading && (totals?.total_days_ever ?? 0) === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          No nutrition data logged yet.
        </div>
      )}

      {!loading && (totals?.total_days_ever ?? 0) > 0 && (
        <>
          {/* Totals strip */}
          {totals && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              <Stat label="Days Logged" value={totals.total_days_ever} />
              <Stat label="Last 30 Days" value={totals.days_30d} />
              <Stat label="Avg Calories" value={totals.avg_calories_30d ?? '—'} />
              <Stat label="TDEE Target" value={target != null ? Math.round(target) : '—'} />
            </div>
          )}

          {/* Trend bars */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Calories (30 days)
            </div>
            <TrendBars values={trend.map(t => t.calories)} target={target} />
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '12px 0 8px' }}>
              Protein (30 days)
            </div>
            <TrendBars values={trend.map(t => t.protein)} target={null} />
          </div>

          {/* Calendar + day detail layout */}
          <div className="admin-nutrition-layout" style={{
            display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start',
          }}>
            <aside style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, position: 'sticky', top: 12, maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' }}>
              <CalendarGrid days={days} selected={selectedDate} onSelect={setSelectedDate} />
            </aside>

            <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, minHeight: 300 }}>
              {dayLoading && <div className="loading-pulse" />}
              {!dayLoading && !selectedDate && (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  Pick a day on the calendar.
                </div>
              )}

              {!dayLoading && day && (
                <>
                  <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>
                      {formatDayLabel(day.date)}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                      {day.totals.calories ?? 0} cal
                      {' · '}{day.totals.protein ?? 0}g P
                      {' · '}{day.totals.carbohydrate ?? 0}g C
                      {' · '}{day.totals.fat ?? 0}g F
                      {target != null && <span style={{ marginLeft: 8, color: 'var(--text-dim)' }}>(target {Math.round(target)})</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {day.totals.entry_count} entr{day.totals.entry_count === 1 ? 'y' : 'ies'}
                    </div>
                  </div>

                  {day.entries.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      No food entries for this day.
                    </div>
                  ) : (
                    mealGroups.map(({ meal, entries, total_calories }) => (
                      <div key={meal} style={{ marginBottom: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {humanize(meal)}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                            {Math.round(total_calories)} cal
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {entries.map(e => (
                            <div key={e.id} style={{
                              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px',
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                                <div style={{ fontSize: 13, fontWeight: 500 }}>
                                  {e.food_name}
                                  {e.serving_description && (
                                    <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                                      · {e.number_of_units} × {e.serving_description}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                                  {Math.round(e.calories ?? 0)} cal
                                </div>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                                {(e.protein ?? 0)}g P · {(e.carbohydrate ?? 0)}g C · {(e.fat ?? 0)}g F
                                {e.fiber != null && ` · ${e.fiber}g fiber`}
                                {e.sodium != null && ` · ${Math.round(e.sodium)}mg Na`}
                              </div>
                              {e.notes && (
                                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, fontStyle: 'italic' }}>
                                  {e.notes}
                                </div>
                              )}
                              <button
                                onClick={() => setShowRaw(prev => ({ ...prev, [e.id]: !prev[e.id] }))}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  color: 'var(--text-muted)', fontSize: 10, padding: 0, marginTop: 6,
                                  fontFamily: "'Outfit', sans-serif",
                                }}
                              >
                                {showRaw[e.id] ? '▾' : '▸'} Raw
                              </button>
                              {showRaw[e.id] && (
                                <pre style={{
                                  marginTop: 6, background: 'var(--surface)', border: '1px solid var(--border)',
                                  borderRadius: 4, padding: 8, fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                                  overflowX: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap',
                                }}>
                                  {JSON.stringify(e, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}

      <style>{`
        @media (max-width: 720px) {
          .admin-nutrition-layout { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </AdminSubPageLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

function TrendBars({ values, target }: { values: (number | null)[]; target: number | null }) {
  if (values.length === 0) return null;
  const max = Math.max(...values.map(v => v ?? 0), target ?? 0, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 48 }}>
      {values.map((v, i) => {
        const logged = v != null && v > 0;
        const h = logged ? Math.max(3, (v! / max) * 100) : 4;
        return (
          <div
            key={i}
            title={`${values.length - 1 - i} days ago: ${logged ? Math.round(v!) : 'no data'}`}
            style={{
              flex: 1,
              height: `${h}%`,
              background: logged ? 'var(--accent)' : 'var(--border)',
              opacity: logged ? 1 : 0.5,
              borderRadius: 2,
              minHeight: 3,
            }}
          />
        );
      })}
    </div>
  );
}

function CalendarGrid({ days, selected, onSelect }: {
  days: DaySummary[];
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  const loggedSet = useMemo(() => new Set(days.map(d => d.date)), [days]);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = selected ? parseISODate(selected) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const weeks = useMemo(() => {
    const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const startDay = firstOfMonth.getDay();  // Sunday = 0
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();

    const cells: (Date | null)[] = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const w: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) w.push(cells.slice(i, i + 7));
    return w;
  }, [viewMonth]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <button
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16, padding: '2px 8px' }}
        >‹</button>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{monthLabel}</div>
        <button
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16, padding: '2px 8px' }}
        >›</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', padding: 2 }}>{d}</div>
        ))}
      </div>

      {weeks.map((week, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
          {week.map((date, j) => {
            if (!date) return <div key={j} />;
            const iso = formatISODate(date);
            const logged = loggedSet.has(iso);
            const isSel = selected === iso;
            return (
              <button
                key={j}
                onClick={() => onSelect(iso)}
                style={{
                  background: isSel ? 'var(--accent)' : logged ? 'var(--accent-glow)' : 'var(--bg)',
                  border: '1px solid ' + (isSel ? 'var(--accent)' : 'var(--border)'),
                  color: isSel ? '#000' : logged ? 'var(--accent)' : 'var(--text-muted)',
                  padding: '6px 0', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                  fontFamily: "'Outfit', sans-serif", fontWeight: logged ? 600 : 400,
                }}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
