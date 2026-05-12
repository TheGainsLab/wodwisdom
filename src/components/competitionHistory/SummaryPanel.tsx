/**
 * SummaryPanel — the "Summary" tab of /competition-history. A brief overview
 * (name · seasons · workout count · profile ↗) plus a few key data points:
 *   - Across durations (Short / Mid / Long): count + share, bar = the athlete's
 *     avg age-cohort percentile in that bucket
 *   - Across modalities (Gymnastics / Weightlifting / Monostructural / Mixed /
 *     Odd-object): same treatment
 *   - Strongest movements (top 3 by avg age-cohort percentile across the
 *     workouts that include them; ≥2 workouts to qualify — a rough proxy, so
 *     it's labelled "on N workouts")
 *   - Best results (top 3 finishes by age-cohort percentile; tap → workout
 *     detail)
 *
 * Each block self-hides when its data isn't there. The duration / modality
 * blocks read `signature.stimulus_breakdown` (fetched via ?include=signature);
 * the rest comes from the normalized `all_results` history.
 */

import { useMemo, useState } from 'react';
import type { NormalizedCompetitionHistory, CompetitionWorkoutEntry } from '../../lib/competitionHistory';
import { movementExposure } from '../../lib/competitionHistory';
import WorkoutDetail from './WorkoutDetail';

interface SignatureBucket {
  n_workouts: number;
  cohort_percentile: number;
  worldwide_percentile: number;
}

export interface SignatureLite {
  stimulus_breakdown?: {
    time_domain?: Record<string, SignatureBucket>;
    modality?: Record<string, SignatureBucket>;
  };
}

const STAGE_LABEL: Record<string, string> = {
  open: 'Open', quarterfinals: 'Quarterfinals', semifinals: 'Semifinals', regional: 'Regionals', games: 'Games',
};

// stimulus_breakdown bucket key → display label, in display order.
const TIME_DOMAIN_ROWS: Array<[string, string]> = [
  ['short', 'Short'],
  ['medium', 'Mid'],
  ['long', 'Long'],
];
const MODALITY_ROWS: Array<[string, string]> = [
  ['G_dominant', 'Gymnastics'],
  ['W_dominant', 'Weightlifting'],
  ['M_dominant', 'Monostructural'],
  ['mixed', 'Mixed'],
  ['O_dominant', 'Odd-object'],
];

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

type BreakdownRow = { label: string; n: number; pct: number };

function bucketRows(
  order: Array<[string, string]>,
  buckets: Record<string, SignatureBucket> | undefined,
): BreakdownRow[] {
  if (!buckets) return [];
  const rows: BreakdownRow[] = [];
  for (const [key, label] of order) {
    const b = buckets[key];
    if (b && b.n_workouts > 0) rows.push({ label, n: b.n_workouts, pct: b.cohort_percentile });
  }
  return rows;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
      {children}
    </div>
  );
}

function BreakdownBlock({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  const totalN = rows.reduce((s, r) => s + r.n, 0);
  if (totalN === 0) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {rows.map((r) => {
          const share = Math.round((r.n / totalN) * 100);
          const fill = Math.max(0, Math.min(100, r.pct));
          return (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
              <div style={{ flex: '0 0 90px', color: 'var(--text)' }}>{r.label}</div>
              <div style={{ flex: '1 1 70px', minWidth: 50, height: 7, background: 'var(--surface2)', borderRadius: 4 }}>
                <div style={{ width: `${fill}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
              </div>
              <div style={{ flex: '0 0 auto', minWidth: 30, textAlign: 'right', color: 'var(--text)' }}>{ordinal(Math.round(r.pct))}</div>
              <div style={{ flex: '0 0 auto', color: 'var(--text-dim)', fontSize: 12 }}>
                {r.n} wkt{r.n === 1 ? '' : 's'} · {share}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SummaryPanel({
  name,
  profileUrl,
  seasonsCompeted,
  history,
  signature,
  onPickMovement,
}: {
  name: string;
  profileUrl: string | null;
  seasonsCompeted: number;
  history: NormalizedCompetitionHistory;
  signature?: SignatureLite;
  /** When provided, the strongest-movements rows become buttons that jump to
   *  the Map tab filtered to that movement. */
  onPickMovement?: (movement: string) => void;
}) {
  const [selectedWorkout, setSelectedWorkout] = useState<CompetitionWorkoutEntry | null>(null);

  const sb = signature?.stimulus_breakdown;
  const timeRows = bucketRows(TIME_DOMAIN_ROWS, sb?.time_domain);
  const modalityRows = bucketRows(MODALITY_ROWS, sb?.modality);

  const strongest = useMemo(() => {
    return movementExposure(history)
      .filter((m) => m.workoutCount >= 2)
      .map((m) => {
        const pcts: number[] = [];
        for (const id of m.workoutIds) {
          const p = history.byId[id]?.result.cohort_percentile;
          if (typeof p === 'number' && Number.isFinite(p)) pcts.push(p);
        }
        const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
        return { name: m.name, count: m.workoutCount, avg };
      })
      .filter((m): m is { name: string; count: number; avg: number } => m.avg != null)
      .sort((a, b) => b.avg - a.avg || b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 3);
  }, [history]);

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
      <div style={{ fontSize: 18, fontWeight: 700 }}>{name}</div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2 }}>
        {seasonsCompeted} season{seasonsCompeted === 1 ? '' : 's'}
        {history.total > 0 ? ` · ${history.total} competition workout${history.total === 1 ? '' : 's'}` : ''}
        {profileUrl && (
          <> · <a href={profileUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>profile ↗</a></>
        )}
      </div>

      <BreakdownBlock title="Across durations" rows={timeRows} />
      <BreakdownBlock title="Across modalities" rows={modalityRows} />

      {strongest.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionLabel>Strongest movements</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {strongest.map((m) => {
              const inner = (
                <>
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  <span style={{ color: 'var(--text-dim)' }}> — {ordinal(Math.round(m.avg))} pct · on {m.count} workout{m.count === 1 ? '' : 's'}</span>
                  {onPickMovement && <span style={{ color: 'var(--text-dim)' }}> →</span>}
                </>
              );
              return onPickMovement ? (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => onPickMovement(m.name)}
                  style={{ textAlign: 'left', padding: '2px 0', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
                >
                  {inner}
                </button>
              ) : (
                <div key={m.name} style={{ fontSize: 13, color: 'var(--text)' }}>{inner}</div>
              );
            })}
          </div>
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
