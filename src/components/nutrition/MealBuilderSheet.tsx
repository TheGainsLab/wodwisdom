import { useEffect, useState } from 'react';
import { X, ChevronLeft, Search, Trash2, Loader2, Plus, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import FoodDetailSheet from './FoodDetailSheet';

interface MealItem {
  food_id: string;
  food_name: string;
  serving_id: string;
  serving_description: string;
  number_of_units: number;
  calories: number;
  protein: number;
  carbohydrate: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
}

interface DefaultItem {
  id: string;
  name: string;
  emoji: string;
  search_term?: string;
  fatsecret_name?: string;
  category?: string;
}

type BuilderMode = 'menu' | 'ingredients' | 'restaurants' | 'brands' | 'search';

const CATEGORIES = [
  { key: 'protein', label: 'Protein', emoji: '🥩' },
  { key: 'carb', label: 'Carbs', emoji: '🍚' },
  { key: 'vegetable', label: 'Vegetables', emoji: '🥦' },
  { key: 'fat', label: 'Fats', emoji: '🥑' },
  { key: 'fruit', label: 'Fruit', emoji: '🍎' },
];

export default function MealBuilderSheet({
  mealType,
  dateStr,
  onClose,
  onLogged,
  onTemplateSaved,
}: {
  mealType: string;
  dateStr: string;
  onClose: () => void;
  onLogged: () => void;
  onTemplateSaved: () => void;
}) {
  // Builder state
  const [mode, setMode] = useState<BuilderMode>('menu');
  const [items, setItems] = useState<MealItem[]>([]);

  // Data
  const [ingredients, setIngredients] = useState<DefaultItem[]>([]);
  const [restaurants, setRestaurants] = useState<DefaultItem[]>([]);
  const [brands, setBrands] = useState<DefaultItem[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Browse/search within a source
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // Food detail
  const [foodDetailTarget, setFoodDetailTarget] = useState<{ foodId: string; foodName: string } | null>(null);

  // Save template
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [saving, setSaving] = useState(false);
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState('');

  // Load default data
  useEffect(() => {
    if (dataLoaded) return;
    (async () => {
      const [ingRes, restRes, brandRes] = await Promise.all([
        supabase.from('default_ingredients').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('default_restaurants').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('default_brands').select('*').eq('is_active', true).order('sort_order'),
      ]);
      setIngredients(ingRes.data || []);
      setRestaurants(restRes.data || []);
      setBrands(brandRes.data || []);
      setDataLoaded(true);
    })();
  }, [dataLoaded]);

  // Totals
  const totalCal = items.reduce((s, i) => s + i.calories, 0);
  const totalProtein = items.reduce((s, i) => s + i.protein, 0);
  const totalCarbs = items.reduce((s, i) => s + i.carbohydrate, 0);
  const totalFat = items.reduce((s, i) => s + i.fat, 0);

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  // Search for foods (optionally filtered by brand)
  const doSearch = async (query: string, brandName?: string) => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const body: any = { query: query.trim(), maxResults: 20 };
      if (brandName) {
        body.filterType = 'brand';
        body.brandName = brandName;
      }
      const { data } = await supabase.functions.invoke('nutrition-search', { body });
      setSearchResults(data?.data?.foods || []);
    } catch {
      setSearchResults([]);
    }
    setSearching(false);
  };

  // Select an ingredient → search for it
  const handleIngredientTap = (item: DefaultItem) => {
    setSearchQuery(item.search_term || item.name);
    doSearch(item.search_term || item.name);
  };

  // Select a restaurant/brand → set filter and show search
  const handleSourceTap = (item: DefaultItem) => {
    setActiveBrand(item.fatsecret_name || item.name);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Search result → open food detail
  const handleSelectSearchResult = (food: any) => {
    setFoodDetailTarget({ foodId: food.food_id, foodName: food.food_name });
  };

  // From food detail → add to meal items
  const handleAddToMeal = (item: MealItem) => {
    setItems(prev => [...prev, item]);
    setFoodDetailTarget(null);
  };

  // Log all items directly
  const handleLogMeal = async () => {
    if (items.length === 0) return;
    setLogging(true);
    setError('');
    try {
      const results = await Promise.all(
        items.map(item =>
          supabase.functions.invoke('food-log', {
            body: {
              ...item,
              meal_type: mealType,
              logged_at: new Date(dateStr + 'T12:00:00.000Z').toISOString(),
            },
          })
        )
      );
      const failed = results.filter(r => r.error);
      if (failed.length > 0) {
        setError(`Failed to log ${failed.length} item(s)`);
        setLogging(false);
      } else {
        onLogged();
      }
    } catch (e: any) {
      setError(`Failed to log: ${e.message || 'Network error'}`);
      setLogging(false);
    }
  };

  // Save as template
  const handleSaveTemplate = async () => {
    if (!templateName.trim() || items.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const { error: err } = await supabase.functions.invoke('favorites-manage', {
        body: {
          action: 'add_meal_template',
          template_name: templateName.trim(),
          items: items.map((item, i) => ({ ...item, sort_order: i })),
          totals: {
            calories: totalCal,
            protein: totalProtein,
            carbohydrate: totalCarbs,
            fat: totalFat,
            fiber: items.reduce((s, i) => s + i.fiber, 0),
            sodium: items.reduce((s, i) => s + i.sodium, 0),
          },
        },
      });
      if (err) { setError('Failed to save template'); setSaving(false); return; }
      onTemplateSaved();
      setShowSaveForm(false);
      setTemplateName('');
    } catch (e: any) {
      setError(`Failed to save: ${e.message || 'Network error'}`);
    }
    setSaving(false);
  };

  const goBack = () => {
    if (activeBrand) {
      setActiveBrand(null);
      setSearchQuery('');
      setSearchResults([]);
    } else if (activeCategory) {
      setActiveCategory(null);
      setSearchQuery('');
      setSearchResults([]);
    } else {
      setMode('menu');
      setSearchQuery('');
      setSearchResults([]);
    }
  };

  // parseFoodDescription helper
  const parseMacros = (desc: string) => {
    const m = desc?.match(/Calories:\s*([\d.]+).*Fat:\s*([\d.]+)g.*Carbs:\s*([\d.]+)g.*Protein:\s*([\d.]+)g/);
    return m ? { cal: m[1], fat: m[2], carbs: m[3], protein: m[4] } : { cal: '0', fat: '0', carbs: '0', protein: '0' };
  };

  // ── Render food detail sheet ──
  if (foodDetailTarget) {
    return (
      <FoodDetailSheet
        foodId={foodDetailTarget.foodId}
        foodName={foodDetailTarget.foodName}
        mealType={mealType}
        dateStr={dateStr}
        onClose={() => setFoodDetailTarget(null)}
        onLogged={onLogged}
        onAddToMeal={handleAddToMeal}
      />
    );
  }

  return (
    <div className="nutrition-overlay">
      <div className="nutrition-overlay-header">
        {mode !== 'menu' ? (
          <button className="menu-btn" onClick={goBack}><ChevronLeft size={20} /></button>
        ) : (
          <button className="menu-btn" onClick={onClose}><X size={20} /></button>
        )}
        <h2>
          {mode === 'menu' && 'Build a Meal'}
          {mode === 'ingredients' && (activeCategory ? CATEGORIES.find(c => c.key === activeCategory)?.label || 'Ingredients' : 'Ingredients')}
          {mode === 'restaurants' && (activeBrand || 'Restaurants')}
          {mode === 'brands' && (activeBrand || 'Brands')}
          {mode === 'search' && 'Search'}
        </h2>
      </div>

      <div className="nutrition-overlay-body">
        {error && <p style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</p>}

        {/* ── Main menu ── */}
        {mode === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="nutrition-serving-row" onClick={() => setMode('ingredients')}>
              <span>🥩 Build from Ingredients</span>
              <ChevronLeft size={18} style={{ transform: 'rotate(180deg)', color: 'var(--text-dim)' }} />
            </button>
            <button className="nutrition-serving-row" onClick={() => setMode('restaurants')}>
              <span>🍔 Browse Restaurants</span>
              <ChevronLeft size={18} style={{ transform: 'rotate(180deg)', color: 'var(--text-dim)' }} />
            </button>
            <button className="nutrition-serving-row" onClick={() => setMode('brands')}>
              <span>🏪 Browse Brands</span>
              <ChevronLeft size={18} style={{ transform: 'rotate(180deg)', color: 'var(--text-dim)' }} />
            </button>
            <button className="nutrition-serving-row" onClick={() => setMode('search')}>
              <span><Search size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Search Foods</span>
              <ChevronLeft size={18} style={{ transform: 'rotate(180deg)', color: 'var(--text-dim)' }} />
            </button>
          </div>
        )}

        {/* ── Ingredients: category picker ── */}
        {mode === 'ingredients' && !activeCategory && (
          <div className="nutrition-category-grid">
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                className="nutrition-category-item"
                onClick={() => setActiveCategory(cat.key)}
              >
                <span className="nutrition-category-emoji">{cat.emoji}</span>
                <span className="nutrition-category-name">{cat.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Ingredients: items in category ── */}
        {mode === 'ingredients' && activeCategory && searchResults.length === 0 && !searching && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ingredients.filter(i => i.category === activeCategory).map(item => (
              <button
                key={item.id}
                className="nutrition-serving-row"
                onClick={() => handleIngredientTap(item)}
              >
                <span>{item.emoji} {item.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Restaurant / Brand list ── */}
        {(mode === 'restaurants' || mode === 'brands') && !activeBrand && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(mode === 'restaurants' ? restaurants : brands).map(item => (
              <button
                key={item.id}
                className="nutrition-serving-row"
                onClick={() => handleSourceTap(item)}
              >
                <span>{item.emoji} {item.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Search within source (brand filter active) ── */}
        {((mode === 'ingredients' && activeCategory && (searchResults.length > 0 || searching)) ||
          ((mode === 'restaurants' || mode === 'brands') && activeBrand) ||
          mode === 'search') && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch(searchQuery, activeBrand || undefined)}
                placeholder={activeBrand ? `Search ${activeBrand}...` : 'Search foods...'}
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
              <button
                className="engine-btn engine-btn-primary"
                onClick={() => doSearch(searchQuery, activeBrand || undefined)}
                disabled={searching}
              >
                <Search size={18} />
              </button>
            </div>

            {searching && <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Searching...</p>}

            {searchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {searchResults.map((food: any) => {
                  const m = parseMacros(food.food_description);
                  return (
                    <button
                      key={food.food_id}
                      onClick={() => handleSelectSearchResult(food)}
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
                        {m.cal} cal | {m.protein}g P | {m.carbs}g C | {m.fat}g F
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Running total + items footer ── */}
      {items.length > 0 && (
        <div className="nutrition-overlay-footer">
          {/* Items list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10, maxHeight: 150, overflowY: 'auto' }}>
            {items.map((item, idx) => (
              <div key={idx} className="nutrition-builder-item">
                <span className="nutrition-builder-item-name">{item.food_name}</span>
                <span className="nutrition-builder-item-macros">{Math.round(item.calories)} cal</span>
                <button
                  onClick={() => removeItem(idx)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, flexShrink: 0 }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Running total */}
          <div className="nutrition-running-total" style={{ marginBottom: 10 }}>
            <span><span className="nutrition-running-total-value">{Math.round(totalCal)}</span> cal</span>
            <span><span className="nutrition-running-total-value">{Math.round(totalProtein)}</span>g P</span>
            <span><span className="nutrition-running-total-value">{Math.round(totalCarbs)}</span>g C</span>
            <span><span className="nutrition-running-total-value">{Math.round(totalFat)}</span>g F</span>
          </div>

          {/* Save template form */}
          {showSaveForm && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                type="text"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveTemplate()}
                placeholder="Template name..."
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
              <button
                className="engine-btn engine-btn-secondary"
                onClick={handleSaveTemplate}
                disabled={saving || !templateName.trim()}
                style={{ padding: '10px 16px' }}
              >
                {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={16} />}
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="engine-btn engine-btn-secondary"
              style={{ flex: 1 }}
              onClick={() => setShowSaveForm(!showSaveForm)}
            >
              <Save size={16} /> Save Template
            </button>
            <button
              className="engine-btn engine-btn-primary"
              style={{ flex: 1 }}
              onClick={handleLogMeal}
              disabled={logging}
            >
              {logging ? 'Logging...' : `Log Meal — ${Math.round(totalCal)} cal`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
