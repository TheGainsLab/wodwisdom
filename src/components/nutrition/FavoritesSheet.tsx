import { useState } from 'react';
import { X, Trash2, Search, Star } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { FavoriteFoodItem } from './FoodSearchPanel';

export default function FavoritesSheet({
  favorites,
  onClose,
  onSelectFavorite,
  onFavoritesChanged,
}: {
  favorites: FavoriteFoodItem[];
  onClose: () => void;
  onSelectFavorite: (fav: FavoriteFoodItem) => void;
  onFavoritesChanged: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = filter.trim()
    ? favorites.filter(f => f.food_name.toLowerCase().includes(filter.toLowerCase()))
    : favorites;

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await supabase.functions.invoke('favorites-manage', {
        body: { action: 'delete_food', id },
      });
      onFavoritesChanged();
    } catch {
      // ignore
    }
    setDeletingId(null);
  };

  return (
    <div className="nutrition-overlay">
      <div className="nutrition-overlay-header">
        <button className="menu-btn" onClick={onClose}><X size={20} /></button>
        <h2>Favorites</h2>
      </div>

      <div className="nutrition-overlay-body">
        {/* Search filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter favorites..."
              style={{
                width: '100%',
                padding: '10px 14px 10px 36px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                fontSize: 14,
              }}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="nutrition-empty">
            <Star size={32} />
            <div className="nutrition-empty-title">
              {favorites.length === 0 ? 'No favorites yet' : 'No matches'}
            </div>
            <div className="nutrition-empty-desc">
              {favorites.length === 0
                ? 'Foods you log frequently will appear here automatically, or save them from the food detail screen.'
                : 'Try a different search term.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(fav => (
              <button
                key={fav.id}
                onClick={() => onSelectFavorite(fav)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--text)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fav.food_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                    {fav.serving_description || 'Default serving'}
                    {fav.raw_serving_calories ? ` — ${Math.round(fav.raw_serving_calories)} cal` : ''}
                    {fav.raw_serving_protein ? ` | ${Math.round(fav.raw_serving_protein)}g P` : ''}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(fav.id, e)}
                  disabled={deletingId === fav.id}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 4,
                    opacity: deletingId === fav.id ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
