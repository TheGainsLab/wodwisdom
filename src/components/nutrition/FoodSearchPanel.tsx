import { useState } from 'react';
import { Search } from 'lucide-react';
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
      {/* Search input — first thing the user sees */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          className="engine-input"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search foods..."
          style={{ flex: 1, padding: '10px 14px' }}
        />
        <button className="engine-btn engine-btn-primary" style={{ padding: '10px 14px' }} onClick={handleSearch} disabled={searching}>
          <Search size={18} />
        </button>
      </div>

      {/* Favorites quick-add (shown when idle) */}
      {favorites.length > 0 && !searchQuery && searchResults.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="engine-label" style={{ marginBottom: 2 }}>Favorites</span>
          {favorites.slice(0, 5).map(fav => (
            <button
              key={fav.id}
              className="nutrition-serving-row"
              onClick={() => onSelectFavorite(fav)}
              style={{ cursor: 'pointer' }}
            >
              <span style={{ fontSize: 13, fontWeight: 500 }}>{fav.food_name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {fav.raw_serving_calories ? `${Math.round(fav.raw_serving_calories)} cal` : ''}
              </span>
            </button>
          ))}
          {favorites.length > 5 && (
            <button className="nutrition-quick-link" onClick={onShowAllFavorites} style={{ marginTop: 4 }}>
              See all {favorites.length} favorites
            </button>
          )}
        </div>
      )}

      {searching && <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Searching...</p>}
      {searchError && <p className="error-msg" style={{ fontSize: 13 }}>{searchError}</p>}
      {logError && <p className="error-msg" style={{ fontSize: 13 }}>{logError}</p>}

      {searchResults.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {searchResults.map((food) => {
            const parsed = parseFoodDescription(food.food_description);
            return (
              <button
                key={food.food_id}
                className="nutrition-serving-row"
                onClick={() => onSelectFood(food)}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, cursor: 'pointer' }}
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
