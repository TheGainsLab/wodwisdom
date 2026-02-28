const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout', 'other'] as const;

export function mealLabel(type: string | null): string {
  if (!type) return 'Other';
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export { MEAL_TYPES };

export default function MealTypeSelector({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (type: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {MEAL_TYPES.map(mt => (
        <button
          key={mt}
          className={`engine-btn engine-btn-sm ${selected === mt ? 'engine-btn-primary' : ''}`}
          onClick={() => onChange(mt)}
          style={{ fontSize: 12 }}
        >
          {mealLabel(mt)}
        </button>
      ))}
    </div>
  );
}
