interface DailyNutrition {
  total_calories: number;
  total_protein: number;
  total_carbohydrate: number;
  total_fat: number;
  tdee_estimate?: number | null;
  surplus_deficit?: number | null;
}

export type { DailyNutrition };

export default function DailySummary({ daily }: { daily: DailyNutrition | null }) {
  const cals = daily?.total_calories ?? 0;
  const prot = daily?.total_protein ?? 0;
  const carbs = daily?.total_carbohydrate ?? 0;
  const fats = daily?.total_fat ?? 0;
  const tdee = daily?.tdee_estimate ?? null;
  const surplus = daily?.surplus_deficit ?? null;

  return (
    <div className="engine-card">
      <div className="engine-grid nutrition-macro-grid">
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

      {tdee != null && (
        <div className="nutrition-surplus-row">
          <div className="nutrition-surplus-bar-track">
            <div
              className="nutrition-surplus-bar-fill"
              style={{ width: `${Math.min((cals / tdee) * 100, 100)}%` }}
            />
          </div>
          <div className="nutrition-surplus-labels">
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {Math.round(cals).toLocaleString()} / {Math.round(tdee).toLocaleString()} cal
            </span>
            {surplus != null && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: surplus >= 0 ? '#2ec486' : '#ff3a3a',
                }}
              >
                {surplus >= 0 ? 'Surplus' : 'Deficit'}: {surplus >= 0 ? '+' : ''}{Math.round(surplus).toLocaleString()} cal
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
