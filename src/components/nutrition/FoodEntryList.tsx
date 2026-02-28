import { Trash2 } from 'lucide-react';
import { mealLabel } from './MealTypeSelector';

export interface FoodEntry {
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

export default function FoodEntryList({
  entries,
  loading,
  dateLabel,
  onDelete,
}: {
  entries: FoodEntry[];
  loading: boolean;
  dateLabel: string;
  onDelete: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="engine-card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
        Loading...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="engine-card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
        No food logged for {dateLabel}. Tap "Add Food" to get started.
      </div>
    );
  }

  const grouped = new Map<string, FoodEntry[]>();
  for (const e of entries) {
    const key = e.meal_type || 'other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(e);
  }

  return (
    <>
      {Array.from(grouped.entries()).map(([mealType, foods]) => (
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
                  onClick={() => onDelete(entry.id)}
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
      ))}
    </>
  );
}
