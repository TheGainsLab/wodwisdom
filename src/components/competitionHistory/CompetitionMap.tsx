/**
 * CompetitionMap — the "All"-scope grid: every competition workout ever,
 * filled cells = ones the athlete has a result for (gold, tappable into the
 * workout detail), unfilled = the rest (faint/dashed, tappable into a "you
 * haven't done this" card). The collect-them-all map. v1: no per-stage
 * collapse — renders everything; revisit if it's too dense.
 */

import type {
  NormalizedCatalog,
  CatalogWorkoutSummary,
} from '../../lib/competitionHistory';

const STAGE_LABEL: Record<string, string> = {
  open: 'Open',
  quarterfinals: 'Quarterfinals',
  semifinals: 'Semifinals',
  regional: 'Regionals',
  games: 'Games',
};

function Cell({
  w,
  filled,
  onClick,
}: {
  w: CatalogWorkoutSummary;
  filled: boolean;
  onClick: () => void;
}) {
  const isGames = w.stage === 'games';
  const numbered = w.ordinal != null;
  const label = numbered ? String(w.ordinal) : w.workout_name;
  const moves = w.movements.join(', ');
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${w.workout_name}${moves ? ` — ${moves}` : ''}${filled ? '' : ' (not done)'}`}
      style={{
        height: 38,
        ...(numbered ? { width: 38, padding: 0 } : { padding: '0 10px', maxWidth: 180 }),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: numbered ? 14 : 12,
        fontWeight: 600,
        background: 'var(--surface2)',
        border: `1px ${filled ? 'solid' : 'dashed'} ${filled && isGames ? 'rgba(212,175,55,0.5)' : 'var(--border)'}`,
        borderRadius: 6,
        color: 'var(--text)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        opacity: filled ? 1 : 0.4,
        boxShadow: filled && isGames ? 'inset 0 2px 0 rgba(212,175,55,0.55)' : undefined,
      }}
    >
      {label}
    </button>
  );
}

export default function CompetitionMap({
  catalog,
  filledIds,
  onSelectFilled,
  onSelectUnfilled,
  matchWorkout,
}: {
  catalog: NormalizedCatalog;
  filledIds: Set<string>;
  onSelectFilled: (id: string) => void;
  onSelectUnfilled: (w: CatalogWorkoutSummary) => void;
  matchWorkout?: (w: CatalogWorkoutSummary) => boolean;
}) {
  if (catalog.total === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Couldn't load the workout catalog.</div>;
  }

  const filledCount = catalog.seasons
    .flatMap((s) => s.stages)
    .flatMap((st) => st.workouts)
    .filter((w) => filledIds.has(w.competition_workout_id)).length;

  const seasons = matchWorkout
    ? catalog.seasons
        .map((s) => ({
          ...s,
          stages: s.stages
            .map((st) => ({ ...st, workouts: st.workouts.filter(matchWorkout) }))
            .filter((st) => st.workouts.length > 0),
        }))
        .filter((s) => s.stages.length > 0)
    : catalog.seasons;

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
        {filledCount} of {catalog.total} workouts done · {Math.round((filledCount / catalog.total) * 100)}%
      </div>

      {seasons.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No workouts match that filter.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {seasons.map((season) => (
            <div key={season.season}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
                {season.season}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {season.stages.map((stage) => (
                  <div key={stage.stage} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
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
                      {stage.workouts.map((w) => {
                        const filled = filledIds.has(w.competition_workout_id);
                        return (
                          <Cell
                            key={w.competition_workout_id}
                            w={w}
                            filled={filled}
                            onClick={() => (filled ? onSelectFilled(w.competition_workout_id) : onSelectUnfilled(w))}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
