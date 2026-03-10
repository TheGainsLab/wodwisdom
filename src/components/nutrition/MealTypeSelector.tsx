const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout', 'other'] as const;

export function mealLabel(type: string | null): string {
  if (!type) return 'Other';
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Returns a sensible default meal type based on time of day. */
export function defaultMealType(): string {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 17) return 'snack';
  return 'dinner';
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
    <div className="nutrition-meal-chips">
      {MEAL_TYPES.map(mt => (
        <button
          key={mt}
          className={`nutrition-meal-chip ${selected === mt ? 'active' : ''}`}
          onClick={() => onChange(mt)}
        >
          {mealLabel(mt)}
        </button>
      ))}
    </div>
  );
}
