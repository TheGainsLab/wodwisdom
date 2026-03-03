import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface HeatmapCell {
  movement: string;
  time_domain: 'short' | 'medium' | 'long';
  avg_percentile: number;
  workout_count: number;
}

interface DrillDownItem {
  block_label: string | null;
  score: string | null;
  percentile: number;
  performance_tier: string | null;
  workout_date: string;
}

const TIME_DOMAINS = ['short', 'medium', 'long'] as const;
const TD_LABELS: Record<string, string> = { short: 'Short', medium: 'Medium', long: 'Long' };

function percentileColor(p: number): string {
  // Red (low) → Yellow (mid) → Green (high)
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
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [drillDown, setDrillDown] = useState<{ movement: string; td: string } | null>(null);
  const [drillItems, setDrillItems] = useState<DrillDownItem[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('get_metcon_heatmap', { p_user_id: userId });
      if (!error && data) setCells(data as HeatmapCell[]);
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
    const { data } = await supabase
      .from('workout_log_entries')
      .select(`
        block_id,
        workout_log_blocks!inner (
          block_label,
          score,
          percentile,
          performance_tier,
          time_domain,
          workout_logs!inner ( workout_date, user_id )
        )
      `)
      .eq('movement', movement)
      .eq('workout_log_blocks.block_type', 'metcon')
      .eq('workout_log_blocks.time_domain', td)
      .not('workout_log_blocks.percentile', 'is', null)
      .eq('workout_log_blocks.workout_logs.user_id', userId)
      .order('block_id', { ascending: false });

    if (data) {
      const seen = new Set<string>();
      const items: DrillDownItem[] = [];
      for (const row of data as any[]) {
        const b = row.workout_log_blocks;
        if (!b || seen.has(row.block_id)) continue;
        seen.add(row.block_id);
        items.push({
          block_label: b.block_label,
          score: b.score,
          percentile: b.percentile,
          performance_tier: b.performance_tier,
          workout_date: b.workout_logs?.workout_date ?? '',
        });
      }
      items.sort((a, b) => b.workout_date.localeCompare(a.workout_date));
      setDrillItems(items);
    }
    setDrillLoading(false);
  }

  if (loading) {
    return <div className="page-loading"><div className="loading-pulse" /></div>;
  }

  if (movements.length === 0) {
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
                  return (
                    <td
                      key={td}
                      onClick={() => openDrillDown(movement, td)}
                      style={{
                        textAlign: 'center',
                        padding: '10px 12px',
                        borderRadius: 6,
                        background: percentileColor(cell.avg_percentile),
                        cursor: 'pointer',
                        transition: 'opacity .15s',
                      }}
                    >
                      <div style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 15,
                        fontWeight: 700,
                        color: percentileTextColor(cell.avg_percentile),
                      }}>
                        {cell.avg_percentile}
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
    </div>
  );
}
