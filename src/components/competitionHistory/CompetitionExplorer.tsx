/**
 * CompetitionExplorer — the interactive layer over the competition map:
 * a filter bar (movement / time domain / year), a "your movements" panel
 * (each movement clickable to filter), the filtered grid, and the
 * workout-detail modal. Self-contained so it can later be lifted to a
 * dedicated /competition-history route.
 */

import { useMemo, useState } from 'react';
import type {
  NormalizedCompetitionHistory,
  CompetitionWorkoutEntry,
} from '../../lib/competitionHistory';
import { movementExposure } from '../../lib/competitionHistory';
import CompetitionGrid from './CompetitionGrid';
import WorkoutDetail from './WorkoutDetail';

type TimeDomain = 'short' | 'mid' | 'long';

interface Filter {
  movement?: string;
  timeDomain?: TimeDomain;
  year?: number;
}

const TIME_DOMAINS: TimeDomain[] = ['short', 'mid', 'long'];

export default function CompetitionExplorer({ history }: { history: NormalizedCompetitionHistory }) {
  const [filter, setFilter] = useState<Filter>({});
  const [selectedWorkout, setSelectedWorkout] = useState<CompetitionWorkoutEntry | null>(null);
  const [showAllMovements, setShowAllMovements] = useState(false);

  const movements = useMemo(() => movementExposure(history), [history]);

  const isFiltered = !!(filter.movement || filter.timeDomain || filter.year != null);

  const matchEntry = useMemo(() => {
    if (!isFiltered) return undefined;
    return (e: CompetitionWorkoutEntry): boolean => {
      if (filter.year != null && e.year !== filter.year) return false;
      if (filter.timeDomain && e.workout.time_domain?.bucket !== filter.timeDomain) return false;
      if (filter.movement && !e.workout.movements.some((m) => m.name === filter.movement)) return false;
      return true;
    };
  }, [isFiltered, filter.year, filter.timeDomain, filter.movement]);

  const matchedCount = useMemo(() => {
    if (!matchEntry) return history.total;
    let n = 0;
    for (const s of history.seasons) for (const st of s.stages) for (const e of st.entries) if (matchEntry(e)) n++;
    return n;
  }, [matchEntry, history]);

  const visibleMovements = showAllMovements ? movements : movements.slice(0, 12);

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select
          className="lift-input"
          value={filter.movement ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, movement: e.target.value || undefined }))}
          style={{ flex: '0 1 auto', maxWidth: 220 }}
        >
          <option value="">All movements</option>
          {movements.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} ({m.workoutCount})
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 4 }}>
          {(['', ...TIME_DOMAINS] as Array<'' | TimeDomain>).map((td) => {
            const active = (filter.timeDomain ?? '') === td;
            return (
              <button
                key={td || 'all'}
                type="button"
                onClick={() => setFilter((f) => ({ ...f, timeDomain: td || undefined }))}
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--accent)' : 'var(--surface2)',
                  color: active ? '#fff' : 'var(--text)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {td === '' ? 'Any time' : td}
              </button>
            );
          })}
        </div>

        <select
          className="lift-input"
          value={filter.year ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, year: e.target.value ? Number(e.target.value) : undefined }))}
          style={{ flex: '0 0 auto' }}
        >
          <option value="">All years</option>
          {history.yearsCompeted.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        {isFiltered && (
          <button
            type="button"
            onClick={() => setFilter({})}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Clear
          </button>
        )}

        <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 'auto' }}>
          {isFiltered ? `showing ${matchedCount} of ${history.total}` : `${history.total} workouts`}
        </span>
      </div>

      {/* Your movements */}
      {movements.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            Your movements
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {visibleMovements.map((m) => {
              const active = filter.movement === m.name;
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => setFilter((f) => ({ ...f, movement: active ? undefined : m.name }))}
                  style={{
                    fontSize: 12,
                    padding: '3px 9px',
                    borderRadius: 999,
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--accent)' : 'var(--surface2)',
                    color: active ? '#fff' : 'var(--text)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {m.name} <span style={{ opacity: 0.7 }}>· {m.workoutCount}</span>
                </button>
              );
            })}
            {movements.length > 12 && (
              <button
                type="button"
                onClick={() => setShowAllMovements((v) => !v)}
                style={{
                  fontSize: 12,
                  padding: '3px 9px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'none',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {showAllMovements ? 'show fewer' : `+${movements.length - 12} more`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* The map */}
      <CompetitionGrid history={history} onSelectWorkout={setSelectedWorkout} matchEntry={matchEntry} />

      {selectedWorkout && (
        <WorkoutDetail entry={selectedWorkout} onClose={() => setSelectedWorkout(null)} />
      )}
    </div>
  );
}
