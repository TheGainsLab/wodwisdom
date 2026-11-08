/**
 * SummaryPanel — the "Summary" tab of Athlete Data (competition history only;
 * program training lives in Calendar & Analytics). An overview plus:
 *   - Competition performance grid: avg percentile by time domain (Short /
 *     Medium / Long / All) × barbell presence (All / Barbell / No barbell),
 *     with the workout count in every cell.
 *   - Skill cost: percentile on workouts containing each gated skill, vs the
 *     athlete's own overall — what pulls the average down.
 *   - Best results (top 3 finishes by age-cohort percentile; tap → workout
 *     detail).
 *
 * Source: official competition results plus self-logged throwbacks (the
 * normalized history), the same data the rest of Athlete Data uses. The grid
 * and skill cost are the same components the training side uses.
 */

import { useMemo, useState } from 'react';
import type { NormalizedCompetitionHistory, CompetitionWorkoutEntry } from '../../lib/competitionHistory';
import { PerformanceGrid, SkillCostTable } from '../PerformanceGrid';
import {
  computeGrid, computeSkillCost, hasBarbellEquipment, hasBarbellMovementNames,
  skillsInMovementNames, type GridSourceRow,
} from '../../lib/performanceGrid';
import WorkoutDetail from './WorkoutDetail';

const STAGE_LABEL: Record<string, string> = {
  open: 'Open', quarterfinals: 'Quarterfinals', semifinals: 'Semifinals', regional: 'Regionals', games: 'Games',
};

function ordinal(n: number): string {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function scoreText(e: CompetitionWorkoutEntry): string {
  const r = e.result;
  if (r.raw_score_text) return r.raw_score_text;
  if (r.scoring_unit === 'time') {
    const m = Math.floor(r.raw_score / 60);
    const s = Math.round(r.raw_score % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return String(r.raw_score);
}

function workoutLabel(e: CompetitionWorkoutEntry): string {
  return `${e.year} ${STAGE_LABEL[e.stage] ?? e.stage} ${e.workout_name}`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
      {children}
    </div>
  );
}

export default function SummaryPanel({
  name,
  seasonsCompeted,
  history,
}: {
  /** Linked athletes: their name and seasons. Unlinked athletes with logged
   *  throwbacks have neither — the header reads "N logged workouts". */
  name?: string;
  seasonsCompeted?: number;
  history: NormalizedCompetitionHistory;
}) {
  const [selectedWorkout, setSelectedWorkout] = useState<CompetitionWorkoutEntry | null>(null);

  // One grid row per competition workout with a percentile. Throwbacks carry
  // no equipment list, so barbell presence falls back to movement names.
  const gridSource = useMemo((): GridSourceRow[] =>
    Object.values(history.byId)
      .map((e): GridSourceRow | null => {
        const r = e.result;
        const pct = Number.isFinite(r?.cohort_percentile) ? r.cohort_percentile
          : Number.isFinite(r?.worldwide_percentile) ? r.worldwide_percentile
          : null;
        if (pct == null) return null;
        const bucket = e.workout.time_domain?.bucket;
        const movements = e.workout.movements ?? [];
        const names = movements.map((m) => m.name);
        return {
          timeDomain: bucket === 'short' || bucket === 'medium' || bucket === 'long' ? bucket : null,
          percentile: pct,
          hasBarbell: hasBarbellEquipment(movements.map((m) => m.equipment ?? [])) || hasBarbellMovementNames(names),
          skills: skillsInMovementNames(names),
          label: `${workoutLabel(e)}${e.source === 'logged' ? ' (logged)' : ''}`,
        };
      })
      .filter((x): x is GridSourceRow => x !== null),
    [history]);
  const grid = useMemo(() => computeGrid(gridSource), [gridSource]);
  const skills = useMemo(() => computeSkillCost(gridSource), [gridSource]);
  const scored = gridSource.filter((r) => r.timeDomain !== null).length;

  const bestResults = useMemo(() => {
    return Object.values(history.byId)
      .filter((e) => e.result && Number.isFinite(e.result.cohort_percentile))
      .sort((a, b) =>
        b.result.cohort_percentile - a.result.cohort_percentile ||
        (b.result.worldwide_percentile ?? 0) - (a.result.worldwide_percentile ?? 0) ||
        b.year - a.year)
      .slice(0, 3);
  }, [history]);

  return (
    <div>
      {/* Header line */}
      {name ? (
        <>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{name}</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>
            {seasonsCompeted ?? 0} season{seasonsCompeted === 1 ? '' : 's'}
            {history.total > 0 ? ` · ${history.total} competition workout${history.total === 1 ? '' : 's'}` : ''}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          {history.total} logged workout{history.total === 1 ? '' : 's'}
        </div>
      )}

      {scored > 0 && (
        <div style={{ marginTop: 20 }}>
          <PerformanceGrid
            title="Competition performance"
            subtitle={`Cohort percentile · ${scored} workout${scored === 1 ? '' : 's'}`}
            rows={grid}
          />
          <SkillCostTable rows={skills} overallLabel="your competition overall" />
        </div>
      )}

      {bestResults.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionLabel>Best results</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bestResults.map((e) => {
              const r = e.result;
              const finish = r.worldwide_n && r.worldwide_n > 0
                ? `${ordinal(r.workout_rank)} of ${r.worldwide_n.toLocaleString()}`
                : `${ordinal(Math.round(r.cohort_percentile))} pct`;
              return (
                <button
                  key={e.competition_workout_id}
                  type="button"
                  onClick={() => setSelectedWorkout(e)}
                  style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    width: '100%',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{workoutLabel(e)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                    {scoreText(e)} · {finish}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedWorkout && (
        <WorkoutDetail entry={selectedWorkout} onClose={() => setSelectedWorkout(null)} />
      )}
    </div>
  );
}
