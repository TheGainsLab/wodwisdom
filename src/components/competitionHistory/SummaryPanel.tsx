/**
 * SummaryPanel — the "Summary" tab of /competition-history. A brief overview
 * (name · seasons · workout count · profile ↗) plus a few key data points:
 *   - Across durations (Short / Mid / Long): count + share, bar = the athlete's
 *     avg age-cohort percentile in that bucket
 *   - Across modalities (Gymnastics / Weightlifting / Monostructural / Mixed /
 *     Odd-object): same treatment
 *   - Top Movements (top 3 by the headline-stage percentile — the deepest
 *     stage with ≥2 workouts including the movement — shown per stage, e.g.
 *     "Snatch — Open 92 · 5 wkts · QF 88 · 2"; a rough proxy [avg cohort
 *     percentile on workouts INCLUDING the movement, not the movement itself],
 *     never pooled across stages. The Movements tab has the full list.)
 *   - Best results (top 3 finishes by age-cohort percentile; tap → workout
 *     detail)
 *
 * Each block self-hides when its data isn't there. "Across durations" is
 * bucketed from the normalized `all_results` history (so its counts match the
 * Map's time filter exactly); "Across modalities" reads
 * `signature.stimulus_breakdown` (fetched via ?include=signature); the rest
 * comes from `all_results`.
 */

import { useMemo, useState } from 'react';
import type { NormalizedCompetitionHistory, CompetitionWorkoutEntry } from '../../lib/competitionHistory';
import { movementPerformance, timeDomainBreakdown, STAGE_ABBR, STAGE_ORDER_LIST, prettyMovementName } from '../../lib/competitionHistory';
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

// "Across durations" bucket → display label, in display order.
const TIME_DOMAIN_LABELS: Record<'short' | 'medium' | 'long', string> = {
  short: 'Short',
  medium: 'Mid',
  long: 'Long',
};
// stimulus_breakdown modality bucket key → display label, in display order.
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
  const timeRows: BreakdownRow[] = useMemo(
    () =>
      timeDomainBreakdown(history)
        .filter((b) => b.n > 0)
        .map((b) => ({ label: TIME_DOMAIN_LABELS[b.bucket], n: b.n, pct: b.avgPct ?? 0 })),
    [history],
  );
  const modalityRows = bucketRows(MODALITY_ROWS, sb?.modality);

  // Top movements AT EACH LEVEL — never pooled across stages, because Open's
  // ~300k field makes high percentiles structurally easier than QF/Games. So we
  // group by stage and show the top 3 within each (avg cohort percentile, ≥2
  // workouts for a read), in competition order.
  const topByStage = useMemo(() => {
    const byStage = new Map<string, { name: string; avgPct: number; n: number }[]>();
    for (const m of movementPerformance(history)) {
      for (const s of m.byStage) {
        if (s.n >= 2 && s.avgPct != null) {
          const arr = byStage.get(s.stage) ?? [];
          arr.push({ name: m.name, avgPct: s.avgPct, n: s.n, logged: s.logged });
          byStage.set(s.stage, arr);
        }
      }
    }
    const ordered = [
      ...STAGE_ORDER_LIST.filter((s) => byStage.has(s)),
      ...Array.from(byStage.keys()).filter((s) => !(STAGE_ORDER_LIST as string[]).includes(s)),
    ];
    return ordered.map((stage) => ({
      stage,
      movements: byStage.get(stage)!
        .sort((a, b) => b.avgPct - a.avgPct || a.name.localeCompare(b.name))
        .slice(0, 3),
    }));
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

      {topByStage.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionLabel>Top Movements</SectionLabel>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, marginBottom: 8 }}>
            avg percentile on workouts including each movement (2+ for a score)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {topByStage.map((grp) => (
              <div key={grp.stage}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-muted)', marginBottom: 3 }}>
                  {STAGE_ABBR[grp.stage] ?? grp.stage}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {grp.movements.map((m) => {
                    const inner = (
                      <>
                        <span style={{ fontWeight: 600 }}>{prettyMovementName(m.name)} ({m.n})</span>
                        <span style={{ color: 'var(--text-dim)' }}> {ordinal(Math.round(m.avgPct))} percentile</span>
                        {m.logged && <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 3, padding: '0 4px', textTransform: 'uppercase', letterSpacing: '.3px' }}>logged</span>}
                        {onPickMovement && <span style={{ color: 'var(--text-dim)' }}> →</span>}
                      </>
                    );
                    return onPickMovement ? (
                      <button
                        key={`${grp.stage}-${m.name}`}
                        type="button"
                        onClick={() => onPickMovement(m.name)}
                        style={{ textAlign: 'left', padding: '1px 0', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
                      >
                        {inner}
                      </button>
                    ) : (
                      <div key={`${grp.stage}-${m.name}`} style={{ fontSize: 13, color: 'var(--text)' }}>{inner}</div>
                    );
                  })}
                </div>
              </div>
            ))}
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
