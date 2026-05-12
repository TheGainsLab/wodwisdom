/**
 * MovementsPanel — the "Movements" tab of the /competition-history route.
 * The athlete's movement fingerprint: every movement that's appeared in one
 * of their competition workouts, ordered by how many of those workouts it
 * showed up in. Tap one → jump to the Map tab pre-filtered to that movement.
 */

import { useMemo } from 'react';
import type { NormalizedCompetitionHistory } from '../../lib/competitionHistory';
import { movementExposure } from '../../lib/competitionHistory';

export default function MovementsPanel({
  history,
  onPick,
}: {
  history: NormalizedCompetitionHistory;
  onPick: (movement: string) => void;
}) {
  const movements = useMemo(() => movementExposure(history), [history]);

  if (movements.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No movement data yet.</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
        {movements.length} movement{movements.length === 1 ? '' : 's'} across your competition history — tap one to see those workouts on the map.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {movements.map((m) => (
          <button
            key={m.name}
            type="button"
            onClick={() => onPick(m.name)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: '8px 6px',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              background: 'none',
              color: 'var(--text)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              textAlign: 'left',
              width: '100%',
            }}
          >
            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
              {m.workoutCount} workout{m.workoutCount === 1 ? '' : 's'} →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
