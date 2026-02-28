import { useEffect, useState, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import NutritionPaywall from '../components/nutrition/NutritionPaywall';
import { useEntitlements } from '../hooks/useEntitlements';
import { ChevronLeft, ChevronRight, Plus, Search, Trash2, X, Camera, ScanBarcode, Star, Check, Loader2 } from 'lucide-react';

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

interface FavoriteFoodItem {
  id: string;
  food_id: string;
  food_name: string;
  serving_id: string | null;
  serving_description: string | null;
  default_amount: number;
  default_unit: string;
  raw_serving_calories: number | null;
  raw_serving_protein: number | null;
  raw_serving_carbs: number | null;
  raw_serving_fat: number | null;
}

interface ImageFoodResult {
  identified: { food_name: string; serving_size: string; description: string };
  found: boolean;
  entry_data?: {
    food_id: string;
    food_name: string;
    serving_id: string;
    serving_description: string | null;
    number_of_units: number;
    calories: number;
    protein: number;
    carbohydrate: number;
    fat: number;
    fiber: number;
    sugar: number;
    sodium: number;
  };
  selected?: boolean;
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

type InputMode = 'search' | 'photo' | 'barcode';

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

  // Panel state
  const [showPanel, setShowPanel] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('search');
  const [selectedMealType, setSelectedMealType] = useState<string>('snack');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Image recognition state
  const [imageProcessing, setImageProcessing] = useState(false);
  const [imageResults, setImageResults] = useState<ImageFoodResult[]>([]);
  const [imageLogging, setImageLogging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Barcode state
  const [barcodeValue, setBarcodeValue] = useState('');
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeResult, setBarcodeResult] = useState<any>(null);
  const [barcodeError, setBarcodeError] = useState('');

  // Favorites state
  const [favorites, setFavorites] = useState<FavoriteFoodItem[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);

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

  // Load favorites when panel opens
  useEffect(() => {
    if (showPanel && !favoritesLoaded) {
      supabase.functions.invoke('favorites-manage', {
        body: { action: 'get_all' },
      }).then(({ data }) => {
        if (data?.success) {
          setFavorites(data.data.foods || []);
        }
        setFavoritesLoaded(true);
      });
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
    setSearchQuery('');
    setSearchResults([]);
    setImageResults([]);
    setBarcodeResult(null);
    setBarcodeError('');
    setBarcodeValue('');
  };

  // ── Search ──

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

      closePanel();
      loadDay();
    } catch {
      // silently fail
    }
  };

  // ── Favorites quick-log ──

  const logFavorite = async (fav: FavoriteFoodItem) => {
    try {
      const { data: detail } = await supabase.functions.invoke('nutrition-food', {
        body: { foodId: fav.food_id },
      });

      if (!detail?.success || !detail?.data?.food) return;

      const servings = detail.data.food.servings?.serving || [];
      const serving = (fav.serving_id && servings.find((s: any) => s.serving_id === fav.serving_id)) || servings[0];
      if (!serving) return;

      const units = fav.default_amount || 1;

      await supabase.functions.invoke('food-log', {
        body: {
          food_id: fav.food_id,
          food_name: fav.food_name,
          serving_id: serving.serving_id || '0',
          serving_description: serving.serving_description || '',
          number_of_units: units,
          calories: parseFloat(serving.calories || '0') * units,
          protein: parseFloat(serving.protein || '0') * units,
          carbohydrate: parseFloat(serving.carbohydrate || '0') * units,
          fat: parseFloat(serving.fat || '0') * units,
          fiber: parseFloat(serving.fiber || '0') * units,
          sugar: parseFloat(serving.sugar || '0') * units,
          sodium: parseFloat(serving.sodium || '0') * units,
          meal_type: selectedMealType,
          logged_at: new Date(formatDate(currentDate) + 'T12:00:00.000Z').toISOString(),
        },
      });

      closePanel();
      loadDay();
    } catch {
      // silently fail
    }
  };

  // ── Image recognition ──

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageProcessing(true);
    setImageResults([]);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const imageType = file.type.includes('png') ? 'png' : 'jpeg';

      const { data, error } = await supabase.functions.invoke('nutrition-image-complete', {
        body: { imageBase64: base64, imageType },
      });

      if (!error && data?.success && data.data.foods?.length > 0) {
        setImageResults(
          data.data.foods.map((f: any) => ({ ...f, selected: f.found }))
        );
      } else {
        setImageResults([]);
      }
    } catch {
      // silently fail
    }
    setImageProcessing(false);
    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleImageResult = (idx: number) => {
    setImageResults(prev =>
      prev.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r)
    );
  };

  const logImageResults = async () => {
    const selected = imageResults.filter(r => r.found && r.selected && r.entry_data);
    if (selected.length === 0) return;

    setImageLogging(true);
    try {
      await Promise.all(
        selected.map(r =>
          supabase.functions.invoke('food-log', {
            body: {
              ...r.entry_data,
              meal_type: selectedMealType,
              logged_at: new Date(formatDate(currentDate) + 'T12:00:00.000Z').toISOString(),
            },
          })
        )
      );
      closePanel();
      loadDay();
    } catch {
      // silently fail
    }
    setImageLogging(false);
  };

  // ── Barcode ──

  const handleBarcodeLookup = async () => {
    const code = barcodeValue.trim();
    if (!code) return;

    setBarcodeLoading(true);
    setBarcodeResult(null);
    setBarcodeError('');

    try {
      const { data, error } = await supabase.functions.invoke('nutrition-barcode', {
        body: { barcode: code },
      });

      if (error || !data?.success) {
        setBarcodeError(data?.message || data?.error || 'Product not found');
      } else {
        setBarcodeResult(data.data);
      }
    } catch {
      setBarcodeError('Failed to look up barcode');
    }
    setBarcodeLoading(false);
  };

  const logBarcodeResult = async () => {
    if (!barcodeResult?.entry_data) return;

    try {
      await supabase.functions.invoke('food-log', {
        body: {
          ...barcodeResult.entry_data,
          meal_type: selectedMealType,
          logged_at: new Date(formatDate(currentDate) + 'T12:00:00.000Z').toISOString(),
        },
      });
      closePanel();
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

  const selectedImageCount = imageResults.filter(r => r.found && r.selected).length;

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
            onClick={() => showPanel ? closePanel() : setShowPanel(true)}
          >
            {showPanel ? <><X size={18} /> Close</> : <><Plus size={18} /> Add Food</>}
          </button>

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
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
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

                {/* ── Search Tab ── */}
                {inputMode === 'search' && (
                  <>
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

                    {/* Favorites quick-add */}
                    {favorites.length > 0 && !searchQuery && searchResults.length === 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Star size={12} /> Favorites
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {favorites.slice(0, 8).map(fav => (
                            <button
                              key={fav.id}
                              onClick={() => logFavorite(fav)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 12px',
                                background: 'var(--surface2)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius)',
                                color: 'var(--text)',
                                textAlign: 'left',
                                cursor: 'pointer',
                                width: '100%',
                              }}
                            >
                              <span style={{ fontSize: 13, fontWeight: 500 }}>{fav.food_name}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                                {fav.raw_serving_calories ? `${Math.round(fav.raw_serving_calories)} cal` : ''}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

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
                  </>
                )}

                {/* ── Photo Tab ── */}
                {inputMode === 'photo' && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleImageSelect}
                      style={{ display: 'none' }}
                    />

                    {!imageProcessing && imageResults.length === 0 && (
                      <button
                        className="engine-btn engine-btn-secondary"
                        style={{ width: '100%', padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Camera size={32} />
                        <span>Take or upload a food photo</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>AI will identify foods and estimate nutrition</span>
                      </button>
                    )}

                    {imageProcessing && (
                      <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-dim)' }}>
                        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
                        <p style={{ marginTop: 8, fontSize: 14 }}>Analyzing your food photo...</p>
                      </div>
                    )}

                    {imageResults.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Identified Foods — tap to select
                        </div>
                        {imageResults.map((result, idx) => (
                          <button
                            key={idx}
                            onClick={() => result.found && toggleImageResult(idx)}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 10,
                              padding: '10px 12px',
                              background: result.selected ? 'rgba(255,58,58,0.08)' : 'var(--surface2)',
                              border: result.selected ? '1px solid var(--accent)' : '1px solid var(--border)',
                              borderRadius: 'var(--radius)',
                              color: 'var(--text)',
                              textAlign: 'left',
                              cursor: result.found ? 'pointer' : 'default',
                              width: '100%',
                              opacity: result.found ? 1 : 0.5,
                            }}
                          >
                            <div style={{
                              width: 20, height: 20, borderRadius: 4, flexShrink: 0, marginTop: 1,
                              border: result.selected ? '2px solid var(--accent)' : '2px solid var(--border)',
                              background: result.selected ? 'var(--accent)' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {result.selected && <Check size={14} color="white" />}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 500, fontSize: 14 }}>
                                {result.found ? result.entry_data!.food_name : result.identified.food_name}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                                {result.found ? (
                                  <>
                                    {result.entry_data!.number_of_units} {result.entry_data!.serving_description || 'serving'}
                                    {' — '}
                                    {Math.round(result.entry_data!.calories)} cal | {Math.round(result.entry_data!.protein)}g P | {Math.round(result.entry_data!.carbohydrate)}g C | {Math.round(result.entry_data!.fat)}g F
                                  </>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>Not found in database</span>
                                )}
                              </div>
                            </div>
                          </button>
                        ))}

                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <button
                            className="engine-btn engine-btn-secondary"
                            style={{ flex: 1 }}
                            onClick={() => { setImageResults([]); fileInputRef.current?.click(); }}
                          >
                            Retake
                          </button>
                          <button
                            className="engine-btn engine-btn-primary"
                            style={{ flex: 1 }}
                            onClick={logImageResults}
                            disabled={selectedImageCount === 0 || imageLogging}
                          >
                            {imageLogging ? 'Logging...' : `Log ${selectedImageCount} item${selectedImageCount !== 1 ? 's' : ''}`}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Barcode Tab ── */}
                {inputMode === 'barcode' && (
                  <>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={barcodeValue}
                        onChange={e => setBarcodeValue(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleBarcodeLookup()}
                        placeholder="Enter barcode number..."
                        inputMode="numeric"
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
                      <button className="engine-btn engine-btn-primary" onClick={handleBarcodeLookup} disabled={barcodeLoading}>
                        <ScanBarcode size={18} />
                      </button>
                    </div>

                    {barcodeLoading && (
                      <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-dim)' }}>
                        <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} />
                        <p style={{ marginTop: 6, fontSize: 13 }}>Looking up barcode...</p>
                      </div>
                    )}

                    {barcodeError && (
                      <p style={{ color: 'var(--accent)', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{barcodeError}</p>
                    )}

                    {barcodeResult && (
                      <div style={{ marginTop: 12 }}>
                        <button
                          onClick={logBarcodeResult}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            padding: '12px 14px',
                            background: 'var(--surface2)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius)',
                            color: 'var(--text)',
                            textAlign: 'left',
                            cursor: 'pointer',
                            width: '100%',
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 14 }}>
                            {barcodeResult.entry_data.food_name}
                          </span>
                          {barcodeResult.product_info?.brand && (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{barcodeResult.product_info.brand}</span>
                          )}
                          <span style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                            {barcodeResult.entry_data.serving_description}
                            {' — '}
                            {Math.round(barcodeResult.entry_data.calories)} cal | {Math.round(barcodeResult.entry_data.protein)}g P | {Math.round(barcodeResult.entry_data.carbohydrate)}g C | {Math.round(barcodeResult.entry_data.fat)}g F
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, fontWeight: 500 }}>Tap to log</span>
                        </button>
                      </div>
                    )}
                  </>
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
