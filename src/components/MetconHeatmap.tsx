import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface HeatmapCell {
  movement: string;
  time_domain: 'short' | 'medium' | 'long';
  avg_percentile: number | null;
  workout_count: number;
}

interface DrillDownItem {
  block_id: string;
  block_label: string | null;
  block_text: string | null;
  score: string | null;
  percentile: number;
  performance_tier: string | null;
  workout_date: string;
}

const TIME_DOMAINS = ['short', 'medium', 'long'] as const;
const TD_LABELS: Record<string, string> = { short: 'Short', medium: 'Medium', long: 'Long' };

function percentileColor(p: number): string {
  if (p >= 80) return 'rgba(34,197,94,.7)';
  if (p >= 60) return 'rgba(34,197,94,.35)';
  if (p >= 40) return 'rgba(250,204,21,.35)';
  if (p >= 20) return 'rgba(239,68,68,.3)';
  return 'rgba(239,68,68,.5)';
}

function percentileTextColor(p: number): string {
  if (p >= 80) return '#4ade80';
  if (p >= 60) return '#86efac';
  if (p >= 40) return '#facc15';
  if (p >= 20) return '#fca5a5';
  return '#f87171';
}

export default function MetconHeatmap({ userId }: { userId: string }) {
  // `get_metcon_frequency` returns every (movement × time-domain) cell with at
  // least one logged workout. `avg_percentile` is null on cells whose workouts
  // all lack a percentile (edge fn failed / EMOM / etc.) — those cells render
  // as "did the work, no benchmark" instead of being dropped.
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [drillDown, setDrillDown] = useState<{ movement: string; td: string } | null>(null);
  const [drillItems, setDrillItems] = useState<DrillDownItem[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await supabase.rpc('get_metcon_frequency', { p_user_id: userId });
      if (result.error) console.error('get_metcon_frequency error:', result.error);
      if (!result.error && result.data) setCells(result.data as HeatmapCell[]);
      setLoading(false);
    })();
  }, [userId]);

  // Build grid: unique movements as rows
  const movements = [...new Set(cells.map(c => c.movement))].sort();
  const cellMap = new Map<string, HeatmapCell>();
  for (const c of cells) {
    cellMap.set(`${c.movement}|${c.time_domain}`, c);
  }

  async function openDrillDown(movement: string, td: string) {
    setDrillDown({ movement, td });
    setDrillLoading(true);
    const { data, error } = await supabase.rpc('get_metcon_drilldown', {
      p_user_id: userId,
      p_movement: movement,
      p_time_domain: td,
    });

    if (error) {
      console.error('get_metcon_drilldown error:', error);
    } else if (data) {
      const items: DrillDownItem[] = (data as any[]).map((row) => ({
        block_id: row.block_id,
        block_label: row.block_label,
        block_text: row.block_text,
        score: row.score,
        percentile: row.percentile,
        performance_tier: row.performance_tier,
        workout_date: row.workout_date ?? '',
      }));
      items.sort((a, b) => b.workout_date.localeCompare(a.workout_date));
      setDrillItems(items);
    }
    setDrillLoading(false);
  }

  if (loading) {
    return <div className="page-loading"><div className="loading-pulse" /></div>;
  }

  if (cells.length === 0) {
    return (
      <div className="engine-empty">
        <div className="engine-empty-title">No Metcon Data Yet</div>
        <div className="engine-empty-desc">
          Log scored metcon workouts to build your heat map. It fills in over time as you train.
        </div>
      </div>
    );
  }

  // Drill-down overlay
  if (drillDown) {
    return (
      <div className="engine-section">
        <button
          className="engine-btn engine-btn-secondary engine-btn-sm"
          onClick={() => setDrillDown(null)}
          style={{ alignSelf: 'flex-start' }}
        >
          Back
        </button>
        <h3 className="engine-header">
          {drillDown.movement} — {TD_LABELS[drillDown.td]}
        </h3>
        {drillLoading ? (
          <div className="page-loading"><div className="loading-pulse" /></div>
        ) : drillItems.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No results found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {drillItems.map((item) => {
              const isExpanded = expandedBlockId === item.block_id;
              return (
                <div
                  key={item.block_id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedBlockId(isExpanded ? null : item.block_id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text)',
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 15,
                      fontWeight: 700,
                      color: percentileTextColor(item.percentile),
                      minWidth: 36,
                    }}>
                      {item.percentile}
                    </span>
                    <span style={{ flex: 1, fontSize: 14, color: 'var(--text)' }}>
                      {item.block_label || 'Metcon'}
                    </span>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                      color: 'var(--text-dim)',
                    }}>
                      {item.score || '—'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {item.workout_date ? new Date(item.workout_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div style={{
                      padding: '12px 16px',
                      borderTop: '1px solid var(--border)',
                      background: 'var(--surface2)',
                    }}>
                      {item.block_text ? (
                        <pre style={{
                          margin: 0,
                          fontFamily: 'inherit',
                          fontSize: 13,
                          lineHeight: 1.6,
                          color: 'var(--text-dim)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {item.block_text}
                        </pre>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          No workout details saved.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Heat map grid
  return (
    <div className="engine-section">
      {movements.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
          No metcon data yet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'separate',
            borderSpacing: 4,
            fontFamily: "'Outfit', sans-serif",
          }}>
            <thead>
              <tr>
                <th style={{
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '.5px',
                  padding: '8px 12px',
                }}>
                  Movement
                </th>
                {TIME_DOMAINS.map(td => (
                  <th key={td} style={{
                    textAlign: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '.5px',
                    padding: '8px 12px',
                    minWidth: 60,
                  }}>
                    {TD_LABELS[td]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {movements.map(movement => (
                <tr key={movement}>
                  <td style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text)',
                    padding: '10px 8px',
                    maxWidth: 140,
                    wordBreak: 'break-word',
                  }}>
                    {movement}
                  </td>
                  {TIME_DOMAINS.map(td => {
                    const cell = cellMap.get(`${movement}|${td}`);
                    // Three states, single layout:
                    //  1. no cell / N=0 → muted "—", no count
                    //  2. N>0, percentile null → muted "—" + count (did the work, no benchmark)
                    //  3. N>0, percentile set → colored bg, percentile big, count small
                    if (!cell || cell.workout_count <= 0) {
                      return (
                        <td key={td} style={{
                          textAlign: 'center',
                          padding: '10px 8px',
                          borderRadius: 6,
                          background: 'var(--surface2)',
                        }}>
                          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</span>
                        </td>
                      );
                    }
                    const hasPercentile = cell.avg_percentile != null;
                    return (
                      <td
                        key={td}
                        onClick={hasPercentile ? () => openDrillDown(movement, td) : undefined}
                        style={{
                          textAlign: 'center',
                          padding: '10px 8px',
                          borderRadius: 6,
                          background: hasPercentile ? percentileColor(cell.avg_percentile!) : 'var(--surface2)',
                          cursor: hasPercentile ? 'pointer' : 'default',
                          transition: 'opacity .15s',
                        }}
                      >
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 15,
                          fontWeight: 700,
                          color: hasPercentile ? percentileTextColor(cell.avg_percentile!) : 'var(--text-muted)',
                        }}>
                          {hasPercentile ? cell.avg_percentile : '—'}
                        </div>
                        <div style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          marginTop: 2,
                        }}>
                          {cell.workout_count}x
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
