import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import NutritionPaywall from '../components/nutrition/NutritionPaywall';
import { useEntitlements } from '../hooks/useEntitlements';
import { ChevronLeft, ChevronRight, Plus, Search, Trash2, X } from 'lucide-react';

// ── Types ──

interface FoodEntry {
  id: string;
  food_name: string;
  calories: number | null;
  protein: number | null;
  carbohydrate: number | null;
  fat: number | null;
  meal_type: string | null;
  number_of_units: number;
  serving_description: string | null;
  logged_at: string;
}

interface DailyNutrition {
  total_calories: number;
  total_protein: number;
  total_carbohydrate: number;
  total_fat: number;
}

interface SearchResult {
  food_id: string;
  food_name: string;
  food_description: string;
  brand_name?: string;
}

// ── Helpers ──

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function displayDate(date: Date): string {
  const today = new Date();
  const todayStr = formatDate(today);
  const dateStr = formatDate(date);
  if (dateStr === todayStr) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === formatDate(yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function parseFoodDescription(desc: string): { calories: string; fat: string; carbs: string; protein: string } {
  const match = desc?.match(/Calories:\s*([\d.]+).*Fat:\s*([\d.]+)g.*Carbs:\s*([\d.]+)g.*Protein:\s*([\d.]+)g/);
  if (match) return { calories: match[1], fat: match[2], carbs: match[3], protein: match[4] };
  return { calories: '0', fat: '0', carbs: '0', protein: '0' };
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout', 'other'] as const;

function mealLabel(type: string | null): string {
  if (!type) return 'Other';
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Component ──

export default function NutritionDashboardPage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const { hasFeature, loading: entLoading } = useEntitlements(session.user.id);

  // Date navigation
  const [currentDate, setCurrentDate] = useState(new Date());

  // Data
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [daily, setDaily] = useState<DailyNutrition | null>(null);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMealType, setSelectedMealType] = useState<string>('snack');

  // Load entries for current date
  const loadDay = async () => {
    setLoading(true);
    const dateStr = formatDate(currentDate);
    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;

    const [entriesRes, dailyRes] = await Promise.all([
      supabase
        .from('food_entries')
        .select('id, food_name, calories, protein, carbohydrate, fat, meal_type, number_of_units, serving_description, logged_at')
        .eq('user_id', session.user.id)
        .gte('logged_at', startOfDay)
        .lte('logged_at', endOfDay)
        .order('logged_at', { ascending: true }),
      supabase
        .from('daily_nutrition')
        .select('total_calories, total_protein, total_carbohydrate, total_fat')
        .eq('user_id', session.user.id)
        .eq('date', dateStr)
        .single(),
    ]);

    setEntries(entriesRes.data || []);
    setDaily(dailyRes.data || null);
    setLoading(false);
  };

  useEffect(() => { loadDay(); }, [currentDate, session.user.id]);

  const prevDay = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };

  const nextDay = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };

  // Search
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('nutrition-search', {
        body: { query: searchQuery.trim(), maxResults: 20 },
      });
      if (!error && data?.success) {
        setSearchResults(data.data.foods || []);
      }
    } catch {
      // silently fail
    }
    setSearching(false);
  };

  // Log a food from search results
  const logFood = async (food: SearchResult) => {
    try {
      // Get detailed nutrition
      const { data: detail } = await supabase.functions.invoke('nutrition-food', {
        body: { foodId: food.food_id },
      });

      if (!detail?.success || !detail?.data?.food) return;

      const serving = detail.data.food.servings?.serving?.[0];
      if (!serving) return;

      await supabase.functions.invoke('food-log', {
        body: {
          food_id: food.food_id,
          food_name: food.food_name,
          serving_id: serving.serving_id || '0',
          serving_description: serving.serving_description || '',
          number_of_units: 1,
          calories: parseFloat(serving.calories || '0'),
          protein: parseFloat(serving.protein || '0'),
          carbohydrate: parseFloat(serving.carbohydrate || '0'),
          fat: parseFloat(serving.fat || '0'),
          fiber: parseFloat(serving.fiber || '0'),
          sugar: parseFloat(serving.sugar || '0'),
          sodium: parseFloat(serving.sodium || '0'),
          meal_type: selectedMealType,
          logged_at: new Date(formatDate(currentDate) + 'T12:00:00.000Z').toISOString(),
        },
      });

      setShowSearch(false);
      setSearchQuery('');
      setSearchResults([]);
      loadDay();
    } catch {
      // silently fail
    }
  };

  // Delete entry
  const deleteEntry = async (id: string) => {
    await supabase.from('food_entries').delete().eq('id', id).eq('user_id', session.user.id);
    loadDay();
  };

  // ── Paywall ──

  const hasAccess = hasFeature('nutrition');

  if (!loading && !entLoading && !hasAccess) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content">
          <header className="page-header">
            <button className="menu-btn" onClick={() => setNavOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            <h1>Nutrition</h1>
          </header>
          <NutritionPaywall />
        </div>
      </div>
    );
  }

  // ── Main render ──

  const cals = daily?.total_calories ?? 0;
  const prot = daily?.total_protein ?? 0;
  const carbs = daily?.total_carbohydrate ?? 0;
  const fats = daily?.total_fat ?? 0;

  // Group entries by meal type
  const grouped = new Map<string, FoodEntry[]>();
  for (const e of entries) {
    const key = e.meal_type || 'other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(e);
  }

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Nutrition</h1>
        </header>
        <div className="page-body">

          {/* Date nav */}
          <div className="engine-card" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button className="engine-btn engine-btn-sm" onClick={prevDay}><ChevronLeft size={18} /></button>
              <span style={{ fontWeight: 600, fontSize: 16 }}>{displayDate(currentDate)}</span>
              <button className="engine-btn engine-btn-sm" onClick={nextDay}><ChevronRight size={18} /></button>
            </div>
          </div>

          {/* Macro summary */}
          <div className="engine-card">
            <div className="engine-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="engine-stat" style={{ textAlign: 'center' }}>
                <div className="engine-stat-value">{Math.round(cals)}</div>
                <div className="engine-stat-label">Calories</div>
              </div>
              <div className="engine-stat" style={{ textAlign: 'center' }}>
                <div className="engine-stat-value">{Math.round(prot)}g</div>
                <div className="engine-stat-label">Protein</div>
              </div>
              <div className="engine-stat" style={{ textAlign: 'center' }}>
                <div className="engine-stat-value">{Math.round(carbs)}g</div>
                <div className="engine-stat-label">Carbs</div>
              </div>
              <div className="engine-stat" style={{ textAlign: 'center' }}>
                <div className="engine-stat-value">{Math.round(fats)}g</div>
                <div className="engine-stat-label">Fat</div>
              </div>
            </div>
          </div>

          {/* Add food button */}
          <button
            className="engine-btn engine-btn-primary"
            style={{ width: '100%' }}
            onClick={() => setShowSearch(!showSearch)}
          >
            {showSearch ? <><X size={18} /> Close Search</> : <><Plus size={18} /> Add Food</>}
          </button>

          {/* Search panel */}
          {showSearch && (
            <div className="engine-card">
              <div className="engine-section">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    placeholder="Search foods..."
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      background: 'var(--surface2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      color: 'var(--text)',
                      fontSize: 14,
                    }}
                  />
                  <button className="engine-btn engine-btn-primary" onClick={handleSearch} disabled={searching}>
                    <Search size={18} />
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {MEAL_TYPES.map(mt => (
                    <button
                      key={mt}
                      className={`engine-btn engine-btn-sm ${selectedMealType === mt ? 'engine-btn-primary' : ''}`}
                      onClick={() => setSelectedMealType(mt)}
                      style={{ fontSize: 12 }}
                    >
                      {mealLabel(mt)}
                    </button>
                  ))}
                </div>

                {searching && <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 12 }}>Searching...</p>}

                {searchResults.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {searchResults.map((food) => {
                      const parsed = parseFoodDescription(food.food_description);
                      return (
                        <button
                          key={food.food_id}
                          onClick={() => logFood(food)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            padding: '10px 14px',
                            background: 'var(--surface2)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius)',
                            color: 'var(--text)',
                            textAlign: 'left',
                            cursor: 'pointer',
                            width: '100%',
                          }}
                        >
                          <span style={{ fontWeight: 500, fontSize: 14 }}>
                            {food.food_name}
                            {food.brand_name && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — {food.brand_name}</span>}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                            {parsed.calories} cal | {parsed.protein}g P | {parsed.carbs}g C | {parsed.fat}g F
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Food entries grouped by meal */}
          {loading ? (
            <div className="engine-card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
              Loading...
            </div>
          ) : entries.length === 0 ? (
            <div className="engine-card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
              No food logged for {displayDate(currentDate).toLowerCase()}. Tap "Add Food" to get started.
            </div>
          ) : (
            Array.from(grouped.entries()).map(([mealType, foods]) => (
              <div key={mealType} className="engine-card">
                <div className="engine-section">
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    {mealLabel(mealType)}
                  </h3>
                  {foods.map(entry => (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 0',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>{entry.food_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                          {entry.number_of_units} {entry.serving_description || 'serving'}
                          {' — '}
                          {Math.round(entry.calories ?? 0)} cal | {Math.round(entry.protein ?? 0)}g P | {Math.round(entry.carbohydrate ?? 0)}g C | {Math.round(entry.fat ?? 0)}g F
                        </div>
                      </div>
                      <button
                        onClick={() => deleteEntry(entry.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: 4,
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
