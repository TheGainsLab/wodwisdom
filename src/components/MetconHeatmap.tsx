import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface HeatmapCell {
  movement: string;
  time_domain: 'short' | 'medium' | 'long';
  avg_percentile: number | null;
  workout_count: number;
}

interface DrillDownItem {
  block_label: string | null;
  score: string | null;
  percentile: number;
  performance_tier: string | null;
  workout_date: string;
}

type Layer = 'frequency' | 'performance';

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

function countColor(count: number): string {
  if (count >= 10) return 'rgba(99,102,241,.6)';
  if (count >= 5) return 'rgba(99,102,241,.35)';
  if (count >= 3) return 'rgba(99,102,241,.2)';
  return 'rgba(99,102,241,.1)';
}

function countTextColor(count: number): string {
  if (count >= 10) return '#a5b4fc';
  if (count >= 5) return '#818cf8';
  return '#6366f1';
}

export default function MetconHeatmap({ userId }: { userId: string }) {
  const [layer, setLayer] = useState<Layer>('frequency');
  const [freqCells, setFreqCells] = useState<HeatmapCell[]>([]);
  const [perfCells, setPerfCells] = useState<HeatmapCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [drillDown, setDrillDown] = useState<{ movement: string; td: string } | null>(null);
  const [drillItems, setDrillItems] = useState<DrillDownItem[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const [freqResult, perfResult] = await Promise.all([
        supabase.rpc('get_metcon_frequency', { p_user_id: userId }),
        supabase.rpc('get_metcon_heatmap', { p_user_id: userId }),
      ]);
      if (freqResult.error) console.error('get_metcon_frequency error:', freqResult.error);
      if (!freqResult.error && freqResult.data) setFreqCells(freqResult.data as HeatmapCell[]);
      if (perfResult.error) console.error('get_metcon_heatmap error:', perfResult.error);
      if (!perfResult.error && perfResult.data) setPerfCells(perfResult.data as HeatmapCell[]);
      setLoading(false);
    })();
  }, [userId]);

  const cells = layer === 'frequency' ? freqCells : perfCells;

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
        block_label: row.block_label,
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

  if (freqCells.length === 0 && perfCells.length === 0) {
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
            {drillItems.map((item, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
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
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Heat map grid
  return (
    <div className="engine-section">
      {/* Layer toggle */}
      <div className="source-toggle" style={{ marginBottom: 12 }}>
        <button
          className={'source-btn' + (layer === 'frequency' ? ' active' : '')}
          onClick={() => setLayer('frequency')}
        >
          Frequency
        </button>
        <button
          className={'source-btn' + (layer === 'performance' ? ' active' : '')}
          onClick={() => setLayer('performance')}
        >
          Performance
        </button>
      </div>

      {movements.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
          {layer === 'performance'
            ? 'No scored metcon data yet. Switch to Frequency to see all logged metcons.'
            : 'No metcon data for this view.'}
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
                    minWidth: 80,
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
                    padding: '10px 12px',
                    whiteSpace: 'nowrap',
                  }}>
                    {movement}
                  </td>
                  {TIME_DOMAINS.map(td => {
                    const cell = cellMap.get(`${movement}|${td}`);
                    if (!cell) {
                      return (
                        <td key={td} style={{
                          textAlign: 'center',
                          padding: '10px 12px',
                          borderRadius: 6,
                          background: 'var(--surface2)',
                        }}>
                          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</span>
                        </td>
                      );
                    }

                    if (layer === 'frequency') {
                      return (
                        <td
                          key={td}
                          onClick={() => cell.avg_percentile != null ? openDrillDown(movement, td) : undefined}
                          style={{
                            textAlign: 'center',
                            padding: '10px 12px',
                            borderRadius: 6,
                            background: countColor(cell.workout_count),
                            cursor: cell.avg_percentile != null ? 'pointer' : 'default',
                            transition: 'opacity .15s',
                          }}
                        >
                          <div style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 15,
                            fontWeight: 700,
                            color: countTextColor(cell.workout_count),
                          }}>
                            {cell.workout_count}
                          </div>
                          {cell.avg_percentile != null && (
                            <div style={{
                              fontSize: 11,
                              color: percentileTextColor(cell.avg_percentile),
                              marginTop: 2,
                            }}>
                              {cell.avg_percentile}th %ile
                            </div>
                          )}
                        </td>
                      );
                    }

                    // Performance layer
                    return (
                      <td
                        key={td}
                        onClick={() => openDrillDown(movement, td)}
                        style={{
                          textAlign: 'center',
                          padding: '10px 12px',
                          borderRadius: 6,
                          background: cell.avg_percentile != null ? percentileColor(cell.avg_percentile) : 'var(--surface2)',
                          cursor: 'pointer',
                          transition: 'opacity .15s',
                        }}
                      >
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 15,
                          fontWeight: 700,
                          color: cell.avg_percentile != null ? percentileTextColor(cell.avg_percentile) : 'var(--text-muted)',
                        }}>
                          {cell.avg_percentile ?? '—'}
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
