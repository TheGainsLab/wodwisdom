interface DailyNutrition {
  total_calories: number;
  total_protein: number;
  total_carbohydrate: number;
  total_fat: number;
}

export type { DailyNutrition };

export default function DailySummary({ daily }: { daily: DailyNutrition | null }) {
  const cals = daily?.total_calories ?? 0;
  const prot = daily?.total_protein ?? 0;
  const carbs = daily?.total_carbohydrate ?? 0;
  const fats = daily?.total_fat ?? 0;

  return (
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
  );
}
