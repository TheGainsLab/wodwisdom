/**
 * PowerPanel — the "Power" tab. A flat ranking of every workout the athlete has
 * a power read for, sorted by personalized W/kg (highest first), with a
 * short/medium/long time-domain filter.
 *
 * Power is personalized client-side via personalizedPower() (rescaled to the
 * athlete's real body mass for competed results, computed at real mass for
 * logged throwbacks). Workouts whose movements have no power model are absent
 * — surfaced as a coverage line so the list never reads as complete when it
 * isn't. Tapping a row opens the same WorkoutDetail modal used everywhere else.
 */

import { useMemo, useState } from 'react';
import type { CompetitionWorkoutEntry, NormalizedCompetitionHistory } from '../../lib/competitionHistory';
import { personalizedPower, p99WPerKg } from '../../lib/competitionHistory';
import WorkoutDetail from './WorkoutDetail';

const STAGE_LABEL: Record<string, string> = {
  open: 'Open',
  quarterfinals: 'Quarterfinals',
  semifinals: 'Semifinals',
  regional: 'Regionals',
  games: 'Games',
};

type DomainFilter = 'any' | 'short' | 'medium' | 'long';
const DOMAIN_FILTERS: { id: DomainFilter; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
];

interface PowerRow {
  entry: CompetitionWorkoutEntry;
  watts: number;
  wPerKg: number;
  estimated: boolean;
  /** Top-1% (p99) W/kg for this workout, same basis as wPerKg. Null when not estimable. */
  topWPerKg: number | null;
}

export default function PowerPanel({
  history,
  userKg,
  onLogAgain,
}: {
  history: NormalizedCompetitionHistory;
  userKg?: number | null;
  onLogAgain?: (entry: CompetitionWorkoutEntry) => void;
}) {
  const [domain, setDomain] = useState<DomainFilter>('any');
  const [selected, setSelected] = useState<CompetitionWorkoutEntry | null>(null);

  // Every workout that has a personalized W/kg, regardless of the active filter
  // — the denominator for the coverage line.
  const withPower = useMemo<PowerRow[]>(() => {
    const rows: PowerRow[] = [];
    for (const entry of Object.values(history.byId)) {
      const p = personalizedPower(entry, userKg);
      if (p && p.wPerKg != null) {
        rows.push({ entry, watts: p.watts, wPerKg: p.wPerKg, estimated: p.estimated, topWPerKg: p99WPerKg(entry, p.wPerKg) });
      }
    }
    return rows;
  }, [history, userKg]);

  const rows = useMemo(() => {
    return withPower
      .filter((r) => domain === 'any' || r.entry.workout.time_domain?.bucket === domain)
      .sort((a, b) => b.wPerKg - a.wPerKg);
  }, [withPower, domain]);

  return (
    <div>
      {/* Time-domain filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {DOMAIN_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setDomain(f.id)}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: domain === f.id ? 700 : 500,
              color: domain === f.id ? 'var(--accent)' : 'var(--text-dim)',
              background: domain === f.id ? 'var(--accent-glow)' : 'var(--surface2)',
              border: `1px solid ${domain === f.id ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Coverage — power only exists for movements with a power model. */}
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
        {withPower.length} of {history.total} workout{history.total === 1 ? '' : 's'} have a power read · ranked by W/kg
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '12px 0' }}>
          {withPower.length === 0
            ? 'No power reads yet — the movements in these workouts don’t have a power model.'
            : 'No workouts in this time domain.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r) => {
            const e = r.entry;
            const stageLabel = STAGE_LABEL[e.stage] ?? e.stage;
            const bucket = e.workout.time_domain?.bucket;
            const atOrAbove = r.topWPerKg != null && r.wPerKg >= r.topWPerKg;
            return (
              <button
                key={e.competition_workout_id}
                type="button"
                onClick={() => setSelected(e)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: 'var(--text)',
                  width: '100%',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.year} {stageLabel} {e.workout_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {Math.round(r.watts).toLocaleString()} W
                    {bucket ? ` · ${bucket} time domain` : ''}
                    {r.estimated ? ' · est.' : ''}
                    {e.source === 'logged' ? ' · logged' : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      display: 'inline-block',
                      ...(atOrAbove
                        ? { border: '1.5px solid #2ec486', borderRadius: 6, padding: '2px 8px', color: '#2ec486' }
                        : {}),
                    }}
                  >
                    {r.wPerKg.toFixed(1)}
                    <span style={{ fontSize: 11, fontWeight: 500, color: atOrAbove ? '#2ec486' : 'var(--text-dim)' }}> W/kg</span>
                  </div>
                  {r.topWPerKg != null && (
                    <div style={{ fontSize: 11, color: '#e5484d', fontWeight: 600, marginTop: 4 }}>
                      Top 1% · {r.topWPerKg.toFixed(1)}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <WorkoutDetail
          entry={selected}
          userKg={userKg}
          onClose={() => setSelected(null)}
          onLogAgain={onLogAgain}
        />
      )}
    </div>
  );
}
