interface StrengthRecord {
  movement: string;
  weight: number;
  weight_unit: string;
  reps: number | null;
  date: string;
}

interface MetconRecord {
  block_label: string;
  score: string;
  date: string;
  block_type: string;
}

interface PersonalRecordsProps {
  strengthRecords: StrengthRecord[];
  metconRecords: MetconRecord[];
}

function formatMovementName(canonical: string): string {
  return canonical.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function PersonalRecords({ strengthRecords, metconRecords }: PersonalRecordsProps) {
  if (strengthRecords.length === 0 && metconRecords.length === 0) return null;

  return (
    <div className="pr-container">
      <h3 className="pr-title">Personal Records</h3>

      {strengthRecords.length > 0 && (
        <div className="pr-section">
          <div className="pr-section-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11" /><path d="M6.5 17.5h11" /><path d="M12 2v20" /><path d="M2 12h4" /><path d="M18 12h4" /><circle cx="4.5" cy="6.5" r="2.5" /><circle cx="4.5" cy="17.5" r="2.5" /><circle cx="19.5" cy="6.5" r="2.5" /><circle cx="19.5" cy="17.5" r="2.5" /></svg>
            Strength
          </div>
          <div className="pr-cards">
            {strengthRecords.map((r, i) => (
              <div key={i} className="pr-card">
                <div className="pr-card-movement">{formatMovementName(r.movement)}</div>
                <div className="pr-card-value">
                  {r.weight}{r.weight_unit}
                  {r.reps != null && r.reps > 1 && <span className="pr-card-reps"> x{r.reps}</span>}
                </div>
                <div className="pr-card-date">{formatDate(r.date)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {metconRecords.length > 0 && (
        <div className="pr-section">
          <div className="pr-section-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            Metcon
          </div>
          <div className="pr-cards">
            {metconRecords.map((r, i) => (
              <div key={i} className="pr-card">
                <div className="pr-card-movement">{r.block_label}</div>
                <div className="pr-card-value">{r.score}</div>
                <div className="pr-card-date">{formatDate(r.date)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
