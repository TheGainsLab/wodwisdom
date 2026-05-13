/**
 * MovementsPanel — the "Movements" tab of /competition-history. Every movement
 * the athlete has competed with, with a performance read: the avg cohort
 * percentile of the workouts that included it, broken out by stage (an Open
 * workout's field is ~300k, a Games event's ~40 — not comparable, so per-stage,
 * never pooled). The headline is the deepest stage the athlete faced it in with
 * enough data — usually the Open, the most discriminating field — with a
 * red / yellow / green dot (<50 / 50–80 / 80+).
 *
 * It's a proxy ("on workouts including X", not "your snatch percentile") — a
 * snatch + five other movements still counts toward "snatch" — noisy per-workout
 * but it evens out over enough workouts. We don't show a dot or number for a
 * stage with fewer than 2 such workouts, so one bad day doesn't read as a
 * weakness.
 *
 * Default sort = weakest first (floats the red dots up — the point is finding
 * weaknesses); toggle to by-frequency. Tap a row to reveal the higher-stage
 * numbers + a link to the Map filtered to that movement.
 */

import { useMemo, useState } from 'react';
import type { NormalizedCompetitionHistory, MovementStageStat } from '../../lib/competitionHistory';
import { movementPerformance, STAGE_ABBR } from '../../lib/competitionHistory';

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

function stageText(s: MovementStageStat): string {
  const label = STAGE_ABBR[s.stage] ?? s.stage;
  const p = readPct(s);
  const pctPart = p != null ? ` ${Math.round(p)}` : '';
  return `${label}${pctPart} · ${s.n} workout${s.n === 1 ? '' : 's'}`;
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Per movement: pick the deepest stage with a usable read as the headline;
  // if none qualifies, fall back to the deepest stage (shown without a number).
  const rows = useMemo(() => {
    return movementPerformance(history).map((m) => {
      const headline = m.byStage.find((s) => readPct(s) != null) ?? m.byStage[0] ?? null;
      const headlinePct = headline ? readPct(headline) : null;
      const rest = headline ? m.byStage.filter((s) => s.stage !== headline.stage) : [];
      return { name: m.name, totalWorkouts: m.totalWorkouts, headline, headlinePct, rest };
    });
  }, [history]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sortMode === 'frequency') {
      copy.sort((a, b) => b.totalWorkouts - a.totalWorkouts || a.name.localeCompare(b.name));
    } else {
      copy.sort((a, b) => {
        const ap = a.headlinePct ?? Number.POSITIVE_INFINITY;
        const bp = b.headlinePct ?? Number.POSITIVE_INFINITY;
        return ap - bp || b.totalWorkouts - a.totalWorkouts || a.name.localeCompare(b.name);
      });
    }
    return copy;
  }, [rows, sortMode]);

  if (rows.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No movement data yet.</div>;
  }

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {rows.length} movement{rows.length === 1 ? '' : 's'} — % is your avg cohort percentile on workouts that include it ({MIN_WORKOUTS_FOR_READ}+ for a read).
        </span>
        <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button type="button" onClick={() => setSortMode('weakest')} style={sortBtnStyle(sortMode === 'weakest')}>Weakest first</button>
          <button type="button" onClick={() => setSortMode('frequency')} style={sortBtnStyle(sortMode === 'frequency')}>By frequency</button>
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sorted.map((m) => {
          const isOpen = expanded.has(m.name);
          const h = m.headline;
          const headlineText = h
            ? `${STAGE_ABBR[h.stage] ?? h.stage}${m.headlinePct != null ? ` ${Math.round(m.headlinePct)}` : ''} · ${h.n} wkt${h.n === 1 ? '' : 's'}`
            : `${m.totalWorkouts} workout${m.totalWorkouts === 1 ? '' : 's'}`;
          return (
            <div key={m.name} style={{ borderBottom: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => toggle(m.name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 6px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  textAlign: 'left',
                }}
              >
                <Dot pct={m.headlinePct} />
                <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                <span style={{ color: 'var(--text-dim)', flexShrink: 0, fontSize: 12 }}>{headlineText}</span>
                <span style={{ color: 'var(--text-dim)', flexShrink: 0, fontSize: 12, width: 12, textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div style={{ padding: '0 6px 10px 24px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {m.rest.map((s) => (
                    <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-dim)' }}>
                      <Dot pct={readPct(s)} />
                      <span>{stageText(s)}</span>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => onPick(m.name)}
                    style={{ marginTop: 4, alignSelf: 'flex-start', fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    View {m.name} workouts on the map →
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
