/**
 * MovementsPanel — the "All Movements" tab of /competition-history. Every
 * movement the athlete has competed with, GROUPED BY STAGE: a movement repeats
 * under each level it appeared in (Open / QF / …) with that level's read — the
 * avg cohort percentile of the workouts including it. Never pooled across stages
 * (an Open workout's field is ~300k, a Games event's ~40 — not comparable); no
 * dot/number for a stage with <2 such workouts (one bad day ≠ a weakness).
 * Red / yellow / green dot (<50 / 50–80 / 80+).
 *
 * It's a proxy ("on workouts including X", not "your snatch percentile") — a
 * snatch + five other movements still counts toward "snatch" — noisy per-workout
 * but it evens out over enough workouts.
 *
 * Within each stage: weakest-first (floats red dots up — the point is finding
 * weaknesses) or by-frequency. Tap a row → the Map filtered to that movement.
 */

import { useMemo, useState } from 'react';
import type { NormalizedCompetitionHistory, MovementStageStat } from '../../lib/competitionHistory';
import { movementPerformance, STAGE_ABBR, STAGE_ORDER_LIST, prettyMovementName } from '../../lib/competitionHistory';

const MIN_WORKOUTS_FOR_READ = 2;

function bandColor(pct: number): string {
  if (pct < 50) return '#e5484d';
  if (pct < 80) return '#d9a40e';
  return '#2ec486';
}

function Dot({ pct }: { pct: number | null }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: pct == null ? 'var(--border)' : bandColor(pct),
        flexShrink: 0,
      }}
    />
  );
}

/** The stage's percentile, or null if the sample is too thin to call. */
function readPct(s: MovementStageStat): number | null {
  return s.n >= MIN_WORKOUTS_FOR_READ && s.avgPct != null ? s.avgPct : null;
}

/** 96 → "96th", 1 → "1st", 83 → "83rd", 11 → "11th". */
function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function sortBtnStyle(active: boolean) {
  return {
    fontSize: 12,
    padding: '3px 8px',
    borderRadius: 6,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent)' : 'var(--surface2)',
    color: active ? '#fff' : 'var(--text)',
    cursor: 'pointer',
    fontFamily: 'inherit' as const,
  };
}

export default function MovementsPanel({
  history,
  onPick,
}: {
  history: NormalizedCompetitionHistory;
  onPick: (movement: string) => void;
}) {
  const [sortMode, setSortMode] = useState<'weakest' | 'frequency'>('weakest');
  // Levels collapse by default; tap a level header to open it.
  const [openStages, setOpenStages] = useState<Set<string>>(new Set());
  const toggleStage = (stage: string) =>
    setOpenStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage); else next.add(stage);
      return next;
    });

  const movementCount = useMemo(() => movementPerformance(history).length, [history]);

  // Group every movement under each STAGE it has data for — never pooled across
  // stages (Open's ~300k field isn't comparable to a Games event's ~40). A
  // movement repeats under each level it appeared in, with that level's read.
  // Within a stage: weakest-first (floats red dots up) or by frequency.
  const sections = useMemo(() => {
    const byStage = new Map<string, Array<{ name: string; pct: number | null; n: number; logged: boolean }>>();
    for (const m of movementPerformance(history)) {
      for (const s of m.byStage) {
        const arr = byStage.get(s.stage) ?? [];
        arr.push({ name: m.name, pct: readPct(s), n: s.n, logged: s.logged });
        byStage.set(s.stage, arr);
      }
    }
    const ordered = [
      ...STAGE_ORDER_LIST.filter((s) => byStage.has(s)),
      ...Array.from(byStage.keys()).filter((s) => !(STAGE_ORDER_LIST as string[]).includes(s)),
    ];
    return ordered.map((stage) => {
      const items = [...byStage.get(stage)!];
      if (sortMode === 'frequency') {
        items.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
      } else {
        items.sort((a, b) =>
          (a.pct ?? Number.POSITIVE_INFINITY) - (b.pct ?? Number.POSITIVE_INFINITY) ||
          b.n - a.n || a.name.localeCompare(b.name));
      }
      return { stage, items };
    });
  }, [history, sortMode]);

  if (sections.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No movement data yet.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {movementCount} movement{movementCount === 1 ? '' : 's'} — % is your avg cohort percentile on workouts that include it ({MIN_WORKOUTS_FOR_READ}+ for a read), by level.
        </span>
        <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button type="button" onClick={() => setSortMode('weakest')} style={sortBtnStyle(sortMode === 'weakest')}>Weakest first</button>
          <button type="button" onClick={() => setSortMode('frequency')} style={sortBtnStyle(sortMode === 'frequency')}>By frequency</button>
        </span>
      </div>

      {sections.map((sec) => {
        const isOpen = openStages.has(sec.stage);
        return (
        <div key={sec.stage} style={{ marginBottom: 4 }}>
          <button
            type="button"
            onClick={() => toggleStage(sec.stage)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '8px 6px', background: 'none', border: 'none',
              borderBottom: '1px solid var(--border)', cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-muted)' }}>
              {STAGE_ABBR[sec.stage] ?? sec.stage}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>({sec.items.length})</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 12, width: 12, textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</span>
          </button>
          {isOpen && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sec.items.map((it) => (
              <button
                key={`${sec.stage}-${it.name}`}
                type="button"
                onClick={() => onPick(it.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '7px 6px', background: 'none', border: 'none',
                  borderBottom: '1px solid var(--border)', color: 'var(--text)',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, textAlign: 'left',
                }}
              >
                <Dot pct={it.pct} />
                <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prettyMovementName(it.name)}</span>
                <span style={{ color: 'var(--text-dim)', flexShrink: 0, fontSize: 12 }}>
                  ({it.n}) {it.pct != null ? `${ordinal(Math.round(it.pct))} percentile` : '—'}
                  {it.logged && <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 3, padding: '0 4px', textTransform: 'uppercase', letterSpacing: '.3px' }}>logged</span>}
                </span>
              </button>
            ))}
          </div>
          )}
        </div>
        );
      })}
    </div>
  );
}
