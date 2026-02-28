import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import NutritionPaywall from '../components/nutrition/NutritionPaywall';
import { useEntitlements } from '../hooks/useEntitlements';
import { ChevronLeft, ChevronRight, Plus, Search, X, Camera, ScanBarcode, UtensilsCrossed } from 'lucide-react';
import DailySummary from '../components/nutrition/DailySummary';
import type { DailyNutrition } from '../components/nutrition/DailySummary';
import FoodEntryList from '../components/nutrition/FoodEntryList';
import type { FoodEntry } from '../components/nutrition/FoodEntryList';
import FoodSearchPanel from '../components/nutrition/FoodSearchPanel';
import type { SearchResult, FavoriteFoodItem } from '../components/nutrition/FoodSearchPanel';
import PhotoPanel from '../components/nutrition/PhotoPanel';
import BarcodePanel from '../components/nutrition/BarcodePanel';
import MealTypeSelector from '../components/nutrition/MealTypeSelector';
import FoodDetailSheet from '../components/nutrition/FoodDetailSheet';
import FavoritesSheet from '../components/nutrition/FavoritesSheet';
import MealTemplatesSheet from '../components/nutrition/MealTemplatesSheet';
import MealBuilderSheet from '../components/nutrition/MealBuilderSheet';

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

type InputMode = 'search' | 'photo' | 'barcode';

// ── Component ──

export default function NutritionDashboardPage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const { hasFeature, loading: entLoading } = useEntitlements(session.user.id);

  // Date navigation
  const [currentDate, setCurrentDate] = useState(new Date());
  const dateStr = formatDate(currentDate);

  // Data
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [daily, setDaily] = useState<DailyNutrition | null>(null);

  // Panel state
  const [showPanel, setShowPanel] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('search');
  const [selectedMealType, setSelectedMealType] = useState<string>('snack');

  // Favorites
  const [favorites, setFavorites] = useState<FavoriteFoodItem[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);

  // Meal templates
  const [mealTemplates, setMealTemplates] = useState<any[]>([]);

  // Overlay sheets
  const [foodDetailTarget, setFoodDetailTarget] = useState<{ foodId: string; foodName: string; prefill?: { servingId?: string; amount?: number } } | null>(null);
  const [showFavoritesSheet, setShowFavoritesSheet] = useState(false);
  const [showTemplatesSheet, setShowTemplatesSheet] = useState(false);
  const [showMealBuilder, setShowMealBuilder] = useState(false);

  // Error
  const [logError, setLogError] = useState('');

  // Load entries for current date
  const loadDay = async () => {
    setLoading(true);
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

  // Load favorites when panel opens
  const loadFavorites = async () => {
    const { data } = await supabase.functions.invoke('favorites-manage', {
      body: { action: 'get_all' },
    });
    if (data?.success) {
      setFavorites(data.data.foods || []);
      setMealTemplates(data.data.meals || []);
    }
    setFavoritesLoaded(true);
  };

  useEffect(() => {
    if (showPanel && !favoritesLoaded) {
      loadFavorites();
    }
  }, [showPanel, favoritesLoaded]);

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

  const closePanel = () => {
    setShowPanel(false);
    setLogError('');
  };

  const handleFoodLogged = () => {
    closePanel();
    loadDay();
    setFavoritesLoaded(false); // Refresh favorites on next open (auto-favorite may have triggered)
  };

  // Delete entry
  const deleteEntry = async (id: string) => {
    await supabase.from('food_entries').delete().eq('id', id).eq('user_id', session.user.id);
    loadDay();
  };

  // Open food detail sheet for a search result
  const handleSelectFood = (food: SearchResult) => {
    setFoodDetailTarget({ foodId: food.food_id, foodName: food.food_name });
  };

  // Open food detail sheet for a favorite (pre-filled)
  const handleSelectFavorite = (fav: FavoriteFoodItem) => {
    setFoodDetailTarget({
      foodId: fav.food_id,
      foodName: fav.food_name,
      prefill: { servingId: fav.serving_id || undefined, amount: fav.default_amount || 1 },
    });
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
          <DailySummary daily={daily} />

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="engine-btn engine-btn-primary"
              style={{ flex: 1 }}
              onClick={() => showPanel ? closePanel() : setShowPanel(true)}
            >
              {showPanel ? <><X size={18} /> Close</> : <><Plus size={18} /> Add Food</>}
            </button>
            <button
              className="engine-btn engine-btn-secondary"
              style={{ flexShrink: 0, padding: '14px 16px' }}
              onClick={() => { if (!favoritesLoaded) loadFavorites(); setShowTemplatesSheet(true); }}
            >
              <UtensilsCrossed size={18} />
            </button>
          </div>

          {/* ── Add Food Panel ── */}
          {showPanel && (
            <div className="engine-card">
              <div className="engine-section">

                {/* Input mode tabs */}
                <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
                  {([
                    { mode: 'search' as InputMode, icon: <Search size={16} />, label: 'Search' },
                    { mode: 'photo' as InputMode, icon: <Camera size={16} />, label: 'Photo' },
                    { mode: 'barcode' as InputMode, icon: <ScanBarcode size={16} />, label: 'Barcode' },
                  ]).map(({ mode, icon, label }) => (
                    <button
                      key={mode}
                      onClick={() => setInputMode(mode)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        padding: '10px 0',
                        background: 'none',
                        border: 'none',
                        borderBottom: inputMode === mode ? '2px solid var(--accent)' : '2px solid transparent',
                        color: inputMode === mode ? 'var(--text)' : 'var(--text-muted)',
                        fontSize: 13,
                        fontWeight: inputMode === mode ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'color 0.15s, border-color 0.15s',
                      }}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>

                {/* Meal type selector */}
                <MealTypeSelector selected={selectedMealType} onChange={setSelectedMealType} />

                {/* Tab content */}
                {inputMode === 'search' && (
                  <FoodSearchPanel
                    favorites={favorites}
                    onSelectFood={handleSelectFood}
                    onSelectFavorite={handleSelectFavorite}
                    onShowAllFavorites={() => setShowFavoritesSheet(true)}
                    logError={logError}
                  />
                )}

                {inputMode === 'photo' && (
                  <PhotoPanel
                    mealType={selectedMealType}
                    dateStr={dateStr}
                    onLogged={handleFoodLogged}
                  />
                )}

                {inputMode === 'barcode' && (
                  <BarcodePanel
                    mealType={selectedMealType}
                    dateStr={dateStr}
                    onLogged={handleFoodLogged}
                  />
                )}

              </div>
            </div>
          )}

          {/* Food entries grouped by meal */}
          <FoodEntryList
            entries={entries}
            loading={loading}
            dateLabel={displayDate(currentDate).toLowerCase()}
            onDelete={deleteEntry}
          />
        </div>
      </div>

      {/* ── Overlay Sheets ── */}

      {foodDetailTarget && (
        <FoodDetailSheet
          foodId={foodDetailTarget.foodId}
          foodName={foodDetailTarget.foodName}
          prefillServingId={foodDetailTarget.prefill?.servingId}
          prefillAmount={foodDetailTarget.prefill?.amount}
          mealType={selectedMealType}
          dateStr={dateStr}
          onClose={() => setFoodDetailTarget(null)}
          onLogged={handleFoodLogged}
        />
      )}

      {showFavoritesSheet && (
        <FavoritesSheet
          favorites={favorites}
          onClose={() => setShowFavoritesSheet(false)}
          onSelectFavorite={(fav) => {
            setShowFavoritesSheet(false);
            handleSelectFavorite(fav);
          }}
          onFavoritesChanged={() => setFavoritesLoaded(false)}
        />
      )}

      {showTemplatesSheet && (
        <MealTemplatesSheet
          templates={mealTemplates}
          mealType={selectedMealType}
          dateStr={dateStr}
          onClose={() => setShowTemplatesSheet(false)}
          onLogged={handleFoodLogged}
          onTemplatesChanged={() => setFavoritesLoaded(false)}
          onOpenBuilder={() => { setShowTemplatesSheet(false); setShowMealBuilder(true); }}
        />
      )}

      {showMealBuilder && (
        <MealBuilderSheet
          mealType={selectedMealType}
          dateStr={dateStr}
          onClose={() => setShowMealBuilder(false)}
          onLogged={handleFoodLogged}
          onTemplateSaved={() => { setFavoritesLoaded(false); setShowMealBuilder(false); }}
        />
      )}
    </div>
  );
}
