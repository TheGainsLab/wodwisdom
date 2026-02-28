import { useState } from 'react';
import { Search, Star } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export interface SearchResult {
  food_id: string;
  food_name: string;
  food_description: string;
  brand_name?: string;
}

export interface FavoriteFoodItem {
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

function parseFoodDescription(desc: string): { calories: string; fat: string; carbs: string; protein: string } {
  const match = desc?.match(/Calories:\s*([\d.]+).*Fat:\s*([\d.]+)g.*Carbs:\s*([\d.]+)g.*Protein:\s*([\d.]+)g/);
  if (match) return { calories: match[1], fat: match[2], carbs: match[3], protein: match[4] };
  return { calories: '0', fat: '0', carbs: '0', protein: '0' };
}

export default function FoodSearchPanel({
  favorites,
  onSelectFood,
  onSelectFavorite,
  onShowAllFavorites,
  logError,
}: {
  favorites: FavoriteFoodItem[];
  onSelectFood: (food: SearchResult) => void;
  onSelectFavorite: (fav: FavoriteFoodItem) => void;
  onShowAllFavorites: () => void;
  logError: string;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError('');
    try {
      const { data, error } = await supabase.functions.invoke('nutrition-search', {
        body: { query: searchQuery.trim(), maxResults: 20 },
      });
      if (error) {
        setSearchError(`Search failed: ${error.message || 'Unknown error'}`);
      } else if (!data?.success) {
        setSearchError(data?.error || 'Search returned no results');
      } else {
        setSearchResults(data.data.foods || []);
      }
    } catch (e: any) {
      setSearchError(`Search failed: ${e.message || 'Network error'}`);
    }
    setSearching(false);
  };

  return (
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
                onClick={() => onSelectFavorite(fav)}
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
          {favorites.length > 8 && (
            <button
              onClick={onShowAllFavorites}
              style={{
                marginTop: 8,
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                padding: '4px 0',
              }}
            >
              See all {favorites.length} favorites
            </button>
          )}
        </div>
      )}

      {searching && <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 12 }}>Searching...</p>}

      {searchError && <p style={{ color: 'var(--accent)', fontSize: 13, marginTop: 8 }}>{searchError}</p>}
      {logError && <p style={{ color: 'var(--accent)', fontSize: 13, marginTop: 8 }}>{logError}</p>}

      {searchResults.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {searchResults.map((food) => {
            const parsed = parseFoodDescription(food.food_description);
            return (
              <button
                key={food.food_id}
                onClick={() => onSelectFood(food)}
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
  );
}
