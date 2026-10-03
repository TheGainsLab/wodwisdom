import { useState } from 'react';
import type { GridRowData, SkillCostRow } from '../lib/performanceGrid';

// Renders the 4×3 performance grid and the skill-cost table (founder spec,
// 2026-10-03): every cell a percentile + its count, counts always visible,
// nothing suppressed. Shared by the admin card now; athlete analytics next.

const COL_LABELS = ['Short', 'Medium', 'Long', 'All'];

function fmtPct(p: number | null): string {
  return p === null ? '—' : String(Math.round(p));
}

/** The weakest time-domain column in the All row, flagged red when it sits
 *  meaningfully (≥10pp) under the row's All cell. Deterministic, no prose. */
function weakColumn(rows: GridRowData[]): number | null {
  const all = rows.find((r) => r.key === 'all');
  if (!all) return null;
  const overall = all.cells[3]?.pct;
  if (overall == null) return null;
  let worst: number | null = null;
  for (let i = 0; i < 3; i++) {
    const c = all.cells[i];
    if (c.pct == null) continue;
    if (worst === null || c.pct < (all.cells[worst].pct as number)) worst = i;
  }
  if (worst !== null && (all.cells[worst].pct as number) <= overall - 10) return worst;
  return null;
}

export function PerformanceGrid({ title, subtitle, rows }: {
  title: string;
  subtitle: string;
  rows: GridRowData[];
}) {
  const hot = weakColumn(rows);
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 16px 12px', flex: '1 1 320px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 10 }}>{subtitle}</div>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 5 }}>
        <thead>
          <tr>
            <td />
            {COL_LABELS.map((c) => (
              <td key={c} style={{ textAlign: 'center', fontSize: 10.5, color: 'var(--text-muted)', paddingBottom: 1 }}>{c}</td>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td style={{ fontSize: 11.5, color: 'var(--text-dim)', fontWeight: 600, width: 76 }}>{row.label}</td>
              {row.cells.map((cell, i) => {
                const isAllCol = i === 3;
                const isHot = hot === i && cell.pct != null;
                return (
                  <td key={i} style={{
                    background: isAllCol ? 'var(--surface2, rgba(255,255,255,0.06))' : 'var(--bg, #101013)',
                    border: isHot ? '1px solid var(--accent)' : isAllCol ? '1px solid var(--border)' : '1px solid transparent',
                    borderRadius: 7, padding: '7px 4px', textAlign: 'center',
                  }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14.5, fontWeight: 700, color: isHot ? 'var(--accent)' : 'var(--text)' }}>
                      {fmtPct(cell.pct)}
                    </div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{cell.n > 0 ? `${cell.n} ev` : ''}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkillCostTable({ rows, overallLabel }: { rows: SkillCostRow[]; overallLabel: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (rows.length === 0) return null;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px 10px', marginTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 }}>Skill cost</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 10 }}>
        Percentile when the movement appears vs {overallLabel} · ranked by cost · tap a row for the workouts
      </div>
      {rows.map((r) => {
        const isOpen = open.has(r.skill);
        const costly = r.delta <= -10;
        const mild = r.delta < -5 && !costly;
        const deltaColor = costly ? 'var(--accent)' : mild ? '#e8a33d' : 'var(--text-muted)';
        return (
          <div key={r.skill}>
            <div
              onClick={() => setOpen((prev) => {
                const next = new Set(prev);
                if (next.has(r.skill)) next.delete(r.skill); else next.add(r.skill);
                return next;
              })}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                background: 'var(--bg, #101013)', border: costly ? '1px solid var(--accent)' : '1px solid transparent',
                borderRadius: 7, padding: '7px 12px', marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>{r.skill}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13.5, fontWeight: 700, color: costly ? 'var(--accent)' : 'var(--text)' }}>{Math.round(r.pct)}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {r.n} ev</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: deltaColor, width: 44, textAlign: 'right' }}>
                {r.delta > 0 ? '+' : '−'}{Math.abs(Math.round(r.delta))}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{isOpen ? '▴' : '▾'}</span>
            </div>
            {isOpen && (
              <div style={{ margin: '2px 0 8px', padding: '6px 12px 6px 14px', borderLeft: '2px solid var(--border)' }}>
                {r.events.map((e, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.7, fontFamily: "'JetBrains Mono', monospace" }}>
                    {e.label} · {Math.round(e.pct)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
