/**
 * CompetitionGrid — the athlete's full-career competition map. Rows = seasons
 * (newest first); within a season, stages in competition order (Open →
 * Quarterfinals → Semifinals/Regionals → Games); cells = workouts the athlete
 * has a result for. Numbered workouts (Open/QF/Semis) render as small square
 * cells showing the ordinal; named workouts (Games events) render as wider
 * cells with the name. Tap a cell → onSelectWorkout.
 *
 * v1: every cell is a real-competition result. Stage is conveyed by a subtle
 * accent (Games cells get a gold top-bar). When throwback logging lands, the
 * cell will also carry a "logged" state — the colour machinery is here for it.
 */

import type {
  NormalizedCompetitionHistory,
  CompetitionWorkoutEntry,
} from '../../lib/competitionHistory';

const STAGE_LABEL: Record<string, string> = {
  open: 'Open',
  quarterfinals: 'Quarterfinals',
  semifinals: 'Semifinals',
  regional: 'Regionals',
  games: 'Games',
};

function Cell({ entry, onClick }: { entry: CompetitionWorkoutEntry; onClick: () => void }) {
  const isGames = entry.stage === 'games';
  const numbered = entry.ordinal != null;
  const label = numbered ? String(entry.ordinal) : entry.workout_name;
  const movementSummary = entry.workout.movements.map((m) => m.name).join(', ');
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${entry.workout_name}${movementSummary ? ` — ${movementSummary}` : ''}`}
      style={{
        height: 38,
        ...(numbered ? { width: 38, padding: 0 } : { padding: '0 10px', maxWidth: 180 }),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: numbered ? 14 : 12,
        fontWeight: 600,
        background: 'var(--surface2)',
        border: `1px solid ${isGames ? 'rgba(212,175,55,0.5)' : 'var(--border)'}`,
        borderRadius: 6,
        color: 'var(--text)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        boxShadow: isGames ? 'inset 0 2px 0 rgba(212,175,55,0.55)' : undefined,
      }}
    >
      {label}
    </button>
  );
}

export default function CompetitionGrid({
  history,
  onSelectWorkout,
}: {
  history: NormalizedCompetitionHistory;
  onSelectWorkout: (entry: CompetitionWorkoutEntry) => void;
}) {
  if (history.total === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
        No competition workouts found yet — your history will appear here once it's available.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {history.seasons.map((season) => (
        <div key={season.year}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
            {season.year}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {season.stages.map((stage) => (
              <div
                key={stage.stage}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-dim)',
                    minWidth: 92,
                    paddingTop: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {STAGE_LABEL[stage.stage] ?? stage.stage}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {stage.entries.map((entry) => (
                    <Cell
                      key={entry.competition_workout_id}
                      entry={entry}
                      onClick={() => onSelectWorkout(entry)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
