import { useEffect, useState } from 'react';
import { X, Loader2, Minus, Plus, Star } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Serving {
  serving_id: string;
  serving_description: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  calories: string;
  protein: string;
  carbohydrate: string;
  fat: string;
  fiber: string;
  sugar: string;
  sodium: string;
}

export default function FoodDetailSheet({
  foodId,
  foodName,
  prefillServingId,
  prefillAmount,
  mealType,
  dateStr,
  onClose,
  onLogged,
  onAddToMeal,
}: {
  foodId: string;
  foodName: string;
  prefillServingId?: string;
  prefillAmount?: number;
  mealType: string;
  dateStr: string;
  onClose: () => void;
  onLogged: () => void;
  onAddToMeal?: (item: { food_id: string; food_name: string; serving_id: string; serving_description: string; number_of_units: number; calories: number; protein: number; carbohydrate: number; fat: number; fiber: number; sugar: number; sodium: number }) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [servings, setServings] = useState<Serving[]>([]);
  const [selectedServingIdx, setSelectedServingIdx] = useState(0);
  const [quantity, setQuantity] = useState(prefillAmount ?? 1);
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState('');
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [savedFavorite, setSavedFavorite] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data, error: err } = await supabase.functions.invoke('nutrition-food', {
          body: { foodId },
        });
        if (err || !data?.success || !data?.data?.food) {
          setError('Could not load food details');
          setLoading(false);
          return;
        }
        const raw = data.data.food.servings?.serving;
        const list: Serving[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
        setServings(list);

        // Pre-select serving if specified
        if (prefillServingId && list.length > 0) {
          const idx = list.findIndex(s => s.serving_id === prefillServingId);
          if (idx >= 0) setSelectedServingIdx(idx);
        }
      } catch {
        setError('Failed to load food details');
      }
      setLoading(false);
    })();
  }, [foodId]);

  const serving = servings[selectedServingIdx];

  const cal = serving ? parseFloat(serving.calories || '0') * quantity : 0;
  const prot = serving ? parseFloat(serving.protein || '0') * quantity : 0;
  const carbs = serving ? parseFloat(serving.carbohydrate || '0') * quantity : 0;
  const fat = serving ? parseFloat(serving.fat || '0') * quantity : 0;
  const fiber = serving ? parseFloat(serving.fiber || '0') * quantity : 0;
  const sugar = serving ? parseFloat(serving.sugar || '0') * quantity : 0;
  const sodium = serving ? parseFloat(serving.sodium || '0') * quantity : 0;

  const buildEntry = () => ({
    food_id: foodId,
    food_name: foodName,
    serving_id: serving.serving_id || '0',
    serving_description: serving.serving_description || '',
    number_of_units: quantity,
    calories: Math.round(cal * 100) / 100,
    protein: Math.round(prot * 100) / 100,
    carbohydrate: Math.round(carbs * 100) / 100,
    fat: Math.round(fat * 100) / 100,
    fiber: Math.round(fiber * 100) / 100,
    sugar: Math.round(sugar * 100) / 100,
    sodium: Math.round(sodium * 100) / 100,
  });

  const handleLog = async () => {
    if (!serving) return;
    setLogging(true);
    setError('');
    try {
      const { error: logErr } = await supabase.functions.invoke('food-log', {
        body: {
          ...buildEntry(),
          meal_type: mealType,
          logged_at: new Date(dateStr + 'T12:00:00.000Z').toISOString(),
        },
      });
      if (logErr) { setError(`Failed to log: ${logErr.message}`); setLogging(false); return; }
      onLogged();
    } catch (e: any) {
      setError(`Failed to log: ${e.message || 'Network error'}`);
      setLogging(false);
    }
  };

  const handleAddToMeal = () => {
    if (!serving || !onAddToMeal) return;
    onAddToMeal(buildEntry());
    onClose();
  };

  const handleSaveFavorite = async () => {
    if (!serving || savingFavorite) return;
    setSavingFavorite(true);
    try {
      await supabase.functions.invoke('favorites-manage', {
        body: {
          action: 'add_food',
          food_id: foodId,
          food_name: foodName,
          serving_id: serving.serving_id,
          serving_description: serving.serving_description,
          default_amount: quantity,
          default_unit: 'serving',
          raw_serving_calories: parseFloat(serving.calories || '0'),
          raw_serving_protein: parseFloat(serving.protein || '0'),
          raw_serving_carbs: parseFloat(serving.carbohydrate || '0'),
          raw_serving_fat: parseFloat(serving.fat || '0'),
        },
      });
      setSavedFavorite(true);
    } catch {
      // Ignore — may already be favorited
      setSavedFavorite(true);
    }
    setSavingFavorite(false);
  };

  const adjustQuantity = (delta: number) => {
    setQuantity(prev => {
      const next = Math.round((prev + delta) * 10) / 10;
      return next < 0.1 ? 0.1 : next;
    });
  };

  return (
    <div className="nutrition-overlay">
      <div className="nutrition-overlay-header">
        <button className="menu-btn" onClick={onClose}><X size={20} /></button>
        <h2>{foodName}</h2>
      </div>

      <div className="nutrition-overlay-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ marginTop: 8, fontSize: 14 }}>Loading nutrition data...</p>
          </div>
        ) : error && servings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--accent)' }}>
            <p>{error}</p>
          </div>
        ) : (
          <>
            {/* Serving size selector */}
            {servings.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  Serving Size
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {servings.map((s, idx) => (
                    <button
                      key={s.serving_id}
                      onClick={() => setSelectedServingIdx(idx)}
                      className={`nutrition-serving-row ${idx === selectedServingIdx ? 'active' : ''}`}
                    >
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{s.serving_description}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {Math.round(parseFloat(s.calories || '0'))} cal
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Quantity
              </div>
              <div className="nutrition-qty-stepper">
                <button className="nutrition-qty-btn" onClick={() => adjustQuantity(-0.5)}>
                  <Minus size={18} />
                </button>
                <input
                  type="number"
                  className="nutrition-qty-input"
                  value={quantity}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v > 0) setQuantity(v);
                  }}
                  min="0.1"
                  step="0.5"
                />
                <button className="nutrition-qty-btn" onClick={() => adjustQuantity(0.5)}>
                  <Plus size={18} />
                </button>
              </div>
            </div>

            {/* Macro breakdown */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Nutrition
              </div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0 14px' }}>
                <div className="nutrition-macro-row">
                  <span className="nutrition-macro-label">Calories</span>
                  <span className="nutrition-macro-value">{Math.round(cal)}</span>
                </div>
                <div className="nutrition-macro-row">
                  <span className="nutrition-macro-label">Protein</span>
                  <span className="nutrition-macro-value">{Math.round(prot * 10) / 10}g</span>
                </div>
                <div className="nutrition-macro-row">
                  <span className="nutrition-macro-label">Carbs</span>
                  <span className="nutrition-macro-value">{Math.round(carbs * 10) / 10}g</span>
                </div>
                <div className="nutrition-macro-row">
                  <span className="nutrition-macro-label">Fat</span>
                  <span className="nutrition-macro-value">{Math.round(fat * 10) / 10}g</span>
                </div>
                <div className="nutrition-macro-row">
                  <span className="nutrition-macro-label">Fiber</span>
                  <span className="nutrition-macro-value">{Math.round(fiber * 10) / 10}g</span>
                </div>
                <div className="nutrition-macro-row">
                  <span className="nutrition-macro-label">Sugar</span>
                  <span className="nutrition-macro-value">{Math.round(sugar * 10) / 10}g</span>
                </div>
                <div className="nutrition-macro-row">
                  <span className="nutrition-macro-label">Sodium</span>
                  <span className="nutrition-macro-value">{Math.round(sodium)}mg</span>
                </div>
              </div>
            </div>

            {/* Save as favorite */}
            <button
              onClick={handleSaveFavorite}
              disabled={savingFavorite || savedFavorite}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                width: '100%',
                padding: '10px 14px',
                background: savedFavorite ? 'rgba(255,58,58,0.08)' : 'var(--surface2)',
                border: savedFavorite ? '1px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: savedFavorite ? 'var(--accent)' : 'var(--text-dim)',
                fontSize: 13,
                fontWeight: 500,
                cursor: savedFavorite ? 'default' : 'pointer',
                marginBottom: 12,
              }}
            >
              <Star size={14} fill={savedFavorite ? 'var(--accent)' : 'none'} />
              {savedFavorite ? 'Saved to Favorites' : 'Save to Favorites'}
            </button>

            {error && <p style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 8, textAlign: 'center' }}>{error}</p>}
          </>
        )}
      </div>

      {servings.length > 0 && (
        <div className="nutrition-overlay-footer">
          <div style={{ display: 'flex', gap: 8 }}>
            {onAddToMeal && (
              <button
                className="engine-btn engine-btn-secondary"
                style={{ flex: 1 }}
                onClick={handleAddToMeal}
              >
                Add to Meal
              </button>
            )}
            <button
              className="engine-btn engine-btn-primary"
              style={{ flex: 1 }}
              onClick={handleLog}
              disabled={logging}
            >
              {logging ? 'Logging...' : `Log Food — ${Math.round(cal)} cal`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
