/**
 * PowerPanel — the "Power" tab. Two views of every workout the athlete has a
 * power read for, under one short/medium/long time-domain filter:
 *   - Historical Power: W/kg in competition order (year, stage, workout), the
 *     year-over-year view. Moved here from the Training Log's Metcons tab,
 *     which is program training only.
 *   - A ranking by personalized W/kg, highest first.
 *
 * Power is personalized client-side via personalizedPower() (rescaled to the
 * athlete's real body mass for competed results, computed at real mass for
 * logged throwbacks). Workouts whose movements have no power model are absent
 * — surfaced as a coverage line so the list never reads as complete when it
 * isn't. Tapping a row opens the same WorkoutDetail modal used everywhere else.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CompetitionWorkoutEntry, NormalizedCompetitionHistory } from '../../lib/competitionHistory';
import { personalizedPower, p99WPerKg, STAGE_ORDER_LIST } from '../../lib/competitionHistory';
import WorkoutDetail from './WorkoutDetail';
import { BucketLegend, Stat, WkgBarChart } from '../WkgBarChart';

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

  // Historical Power: the same rows in competition order (year, then stage,
  // then workout number), so improvement reads left to right across years.
  // Self-logged workouts sit at their competition year (entries carry no
  // performed date) and are marked "logged".
  const chronological = useMemo(() => {
    const stageIdx = (st: string) => {
      const i = STAGE_ORDER_LIST.indexOf(st as (typeof STAGE_ORDER_LIST)[number]);
      return i < 0 ? 99 : i;
    };
    return [...rows].sort((a, b) =>
      a.entry.year - b.entry.year
      || stageIdx(a.entry.stage) - stageIdx(b.entry.stage)
      || (a.entry.ordinal ?? 99) - (b.entry.ordinal ?? 99)
      || a.entry.workout_name.localeCompare(b.entry.workout_name));
  }, [rows]);
  const avgWPerKg = rows.length > 0 ? rows.reduce((sum, r) => sum + r.wPerKg, 0) / rows.length : null;

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

      {chronological.length > 0 && (
        <div style={{ padding: 14, marginBottom: 16, background: 'var(--surface2)', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.8, color: 'var(--text)', textTransform: 'uppercase', marginBottom: 10 }}>
            Historical Power
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat label="Workouts" value={chronological.length.toString()} />
            <Stat label="Average" value={avgWPerKg != null ? `${avgWPerKg.toFixed(2)} W/kg` : '—'} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Competition workouts, oldest → newest
          </div>
          <BucketLegend />
          <div style={{ height: 8 }} />
          <WkgBarChart
            items={chronological.map((r) => ({
              key: r.entry.competition_workout_id,
              label: `${r.entry.year} ${STAGE_LABEL[r.entry.stage] ?? r.entry.stage} ${r.entry.workout_name}${r.entry.source === 'logged' ? ' (logged)' : ''}`,
              value: r.wPerKg,
              bucket: r.entry.workout.time_domain?.bucket ?? undefined,
            }))}
            referenceValue={avgWPerKg}
            selectedKey={selected?.competition_workout_id ?? null}
            onSelect={(k) => {
              const hit = chronological.find((r) => r.entry.competition_workout_id === k);
              if (hit) setSelected(hit.entry);
            }}
          />
        </div>
      )}

      {/* Coverage — power only exists for movements with a power model. */}
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
        {withPower.length} of {history.total} workout{history.total === 1 ? '' : 's'} have a power read · ranked by W/kg
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '12px 0' }}>
          {withPower.length === 0
            ? (
              <>
                No personalized power yet — power needs your gender and bodyweight.{' '}
                <Link to="/profile" style={{ color: 'var(--accent)', fontWeight: 600 }}>Complete Tier 1 of your profile →</Link>
                {' '}(power is calculated when you log a workout, so log again after completing your profile.)
              </>
            )
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
