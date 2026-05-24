/**
 * MetconsTab — the Metcons tab inside the Training Log.
 *
 * Hierarchy of importance, top→bottom:
 *   1. Power stats card (count + average W/kg, plus historical from Tier 4 when linked)
 *   2. Power charts — chronological bars of W/kg per metcon (program + historical)
 *   3. Heatmap (collapsed by default)
 *   4. Chronological history list with search
 *
 * W/kg is recomputed using the athlete's actual bodyweight from
 * athlete_profiles.bodyweight (converted to kg). When bodyweight is missing,
 * fall back to the cohort-default avg_w_per_kg already on the block (which
 * assumes the 84M/64W population basis).
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import MetconHeatmap from './MetconHeatmap';

interface MetconBlockLite {
  id: string;
  log_id: string;
  block_label: string | null;
  block_text: string;
  score: string | null;
  rx: boolean;
  avg_power_watts: number | null;
  avg_w_per_kg: number | null;
  work_seconds: number | null;
  time_domain: string | null;
  capped: boolean | null;
  percentile: number | null;
  workout_date: string;
}

interface Props {
  userId: string;
  bodyweightKg: number | null;
  competitionAthleteId: string | null;
  metconBlocks: MetconBlockLite[];
}

/** Lazily-imported all_results entry shape — we only read the new
 *  power fields (bundle 1.7.0). Cast at the read site to avoid a noisy
 *  type extension across the codebase. */
interface HistoricalResult {
  year: number;
  workout_name: string;
  result: {
    valid: boolean;
    avg_power_watts?: number | null;
    avg_w_per_kg?: number | null;
    joules?: number | null;
  };
}

const SECTION_BG = 'var(--surface2)';
const PROGRAM_WINDOW_DAYS = 90;

/** Personalized W/kg using the athlete's bodyweight. Falls back to the
 *  cohort-default `avg_w_per_kg` (population basis) when bodyweight is
 *  missing on the profile. */
function wPerKg(avgWatts: number | null, fallbackWperKg: number | null, bwKg: number | null): number | null {
  if (avgWatts != null && Number.isFinite(avgWatts) && avgWatts > 0 && bwKg && bwKg > 0) {
    return avgWatts / bwKg;
  }
  if (fallbackWperKg != null && Number.isFinite(fallbackWperKg) && fallbackWperKg > 0) {
    return fallbackWperKg;
  }
  return null;
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CollapsibleSection({
  title, defaultOpen, children,
}: { title: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 12, background: SECTION_BG, borderRadius: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: 12, background: 'transparent', border: 'none',
          color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
          letterSpacing: 0.5, textTransform: 'uppercase',
        }}
      >
        <span>{title}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 12px 12px' }}>{children}</div>}
    </div>
  );
}

/** Vertical bar chart with date/label axis. Hover/title tooltips show value. */
function WkgBarChart({
  items, valueLabel = 'W/kg',
}: {
  items: Array<{ key: string; label: string; subLabel?: string; value: number }>;
  valueLabel?: string;
}) {
  if (items.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>
        No data yet.
      </div>
    );
  }
  const maxVal = items.reduce((m, it) => Math.max(m, it.value), 0);
  const first = items[0];
  const last = items[items.length - 1];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100 }}>
        {items.map((it, i) => (
          <div
            key={`${it.key}-${i}`}
            title={`${it.label}: ${it.value.toFixed(2)} ${valueLabel}${it.subLabel ? ` · ${it.subLabel}` : ''}`}
            style={{
              flex: 1, minWidth: 4,
              height: `${maxVal > 0 ? Math.max((it.value / maxVal) * 100, 4) : 4}%`,
              background: 'var(--accent)', borderRadius: 2,
            }}
          />
        ))}
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 4,
        fontSize: 10, color: 'var(--text-muted)',
      }}>
        <span>{first.label}</span>
        <span>{last.label}</span>
      </div>
    </div>
  );
}

export default function MetconsTab({ userId, bodyweightKg, competitionAthleteId, metconBlocks }: Props) {
  const [historical, setHistorical] = useState<HistoricalResult[]>([]);
  const [historicalLoaded, setHistoricalLoaded] = useState(false);
  const [historySearch, setHistorySearch] = useState('');

  // Fetch Tier-4 historical metcons when an athlete is linked. We only need
  // all_results for the per-workout power figures (bundle 1.7.0+).
  useEffect(() => {
    if (!competitionAthleteId) { setHistorical([]); setHistoricalLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke<{ bundle: { all_results?: HistoricalResult[] }; error?: string }>(
        'verify-competition-athlete',
        { body: { competition_athlete_id: competitionAthleteId, include: ['all_results'] } },
      );
      if (cancelled) return;
      if (error || !data?.bundle?.all_results) { setHistorical([]); setHistoricalLoaded(true); return; }
      setHistorical(data.bundle.all_results);
      setHistoricalLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [competitionAthleteId]);

  // ── Program stats — every logged metcon (lifetime within the 200-log fetch) ──
  const programStats = useMemo(() => {
    let nWithPower = 0;
    let sumWkg = 0;
    for (const b of metconBlocks) {
      const w = wPerKg(b.avg_power_watts, b.avg_w_per_kg, bodyweightKg);
      if (w != null && Number.isFinite(w)) {
        nWithPower++;
        sumWkg += w;
      }
    }
    return {
      total: metconBlocks.length,
      nWithPower,
      avgWkg: nWithPower > 0 ? sumWkg / nWithPower : null,
    };
  }, [metconBlocks, bodyweightKg]);

  // ── Historical stats from Tier-4 (lifetime competition record) ──
  const historicalStats = useMemo(() => {
    const valid = historical.filter(r =>
      r.result.valid && r.result.avg_power_watts != null && Number.isFinite(r.result.avg_power_watts)
    );
    let nWithPower = 0;
    let sumWkg = 0;
    for (const r of valid) {
      const w = wPerKg(r.result.avg_power_watts!, r.result.avg_w_per_kg ?? null, bodyweightKg);
      if (w != null && Number.isFinite(w)) {
        nWithPower++;
        sumWkg += w;
      }
    }
    return {
      total: historical.length,
      nWithPower,
      avgWkg: nWithPower > 0 ? sumWkg / nWithPower : null,
    };
  }, [historical, bodyweightKg]);

  // ── Program chart series — chronological, last 90 days ──
  const programChart = useMemo(() => {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - PROGRAM_WINDOW_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const items = metconBlocks
      .filter(b => b.workout_date >= cutoffStr)
      .map(b => {
        const w = wPerKg(b.avg_power_watts, b.avg_w_per_kg, bodyweightKg);
        return w != null && Number.isFinite(w)
          ? { key: b.id, label: formatDate(b.workout_date), subLabel: b.score ?? undefined, value: w }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
    // Sort by underlying date (label is "Jan 5" — string sort breaks). Resort using original date.
    items.sort((a, b) => {
      const da = metconBlocks.find(x => x.id === a.key)?.workout_date ?? '';
      const db = metconBlocks.find(x => x.id === b.key)?.workout_date ?? '';
      return da.localeCompare(db);
    });
    return items;
  }, [metconBlocks, bodyweightKg]);

  // ── Historical chart series — chronological, label = workout name ──
  const historicalChart = useMemo(() => {
    return historical
      .filter(r => r.result.valid && r.result.avg_power_watts != null)
      .map((r, i) => {
        const w = wPerKg(r.result.avg_power_watts!, r.result.avg_w_per_kg ?? null, bodyweightKg);
        return w != null && Number.isFinite(w)
          ? { key: `${r.year}-${r.workout_name}-${i}`, label: `${r.year} ${r.workout_name}`, value: w }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [historical, bodyweightKg]);

  // ── Filtered history list ──
  const historyList = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return [...metconBlocks]
      .sort((a, b) => b.workout_date.localeCompare(a.workout_date))
      .filter(b => {
        if (!q) return true;
        const hay = `${b.block_text} ${b.block_label ?? ''} ${b.score ?? ''}`.toLowerCase();
        return hay.includes(q);
      });
  }, [metconBlocks, historySearch]);

  return (
    <div>
      {/* ── Top stats card ── */}
      <div style={{
        marginTop: 12, marginBottom: 12, padding: 14,
        background: SECTION_BG, borderRadius: 8,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8,
        }}>
          Power
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Stat label="MetCons completed" value={programStats.total.toString()} />
          <Stat
            label="Average"
            value={programStats.avgWkg != null ? `${programStats.avgWkg.toFixed(2)} W/kg` : '—'}
            sub={programStats.nWithPower < programStats.total
              ? `${programStats.nWithPower}/${programStats.total} with power`
              : undefined}
          />
        </div>
        {competitionAthleteId && historicalLoaded && historicalStats.total > 0 && (
          <div style={{
            marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)',
            display: 'flex', gap: 24, flexWrap: 'wrap',
          }}>
            <Stat label="Historical MetCons" value={historicalStats.total.toString()} />
            <Stat
              label="Historical Average"
              value={historicalStats.avgWkg != null ? `${historicalStats.avgWkg.toFixed(2)} W/kg` : '—'}
              sub={historicalStats.nWithPower < historicalStats.total
                ? `${historicalStats.nWithPower}/${historicalStats.total} with power`
                : undefined}
            />
          </div>
        )}
        {bodyweightKg == null && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Add bodyweight to your profile for personalized W/kg. Currently using a cohort estimate.
          </div>
        )}
      </div>

      {/* ── Power charts — expanded by default ── */}
      <CollapsibleSection title="Power Charts" defaultOpen>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Program — last 90 days (chronological)
        </div>
        <WkgBarChart items={programChart} />
        {competitionAthleteId && historicalLoaded && historicalChart.length > 0 && (
          <>
            <div style={{
              fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase',
              letterSpacing: 0.5, margin: '14px 0 6px',
            }}>
              Historical — competition workouts (chronological)
            </div>
            <WkgBarChart items={historicalChart} />
          </>
        )}
      </CollapsibleSection>

      {/* ── Heatmap — collapsed by default ── */}
      <CollapsibleSection title="Heatmap (Movement × Time Domain)" defaultOpen={false}>
        <MetconHeatmap userId={userId} />
      </CollapsibleSection>

      {/* ── History list ── */}
      <div style={{ marginTop: 16 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8,
        }}>
          History
        </div>
        <input
          className="tl-search"
          type="text"
          placeholder="Search history (movement, workout text)..."
          value={historySearch}
          onChange={e => setHistorySearch(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        {historyList.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>
            {historySearch ? 'No matches.' : 'No metcons logged yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {historyList.map(b => {
              const w = wPerKg(b.avg_power_watts, b.avg_w_per_kg, bodyweightKg);
              const wkgLabel = w != null ? `${w.toFixed(2)} W/kg` : null;
              return (
                <div key={b.id} style={{
                  padding: 10, background: 'var(--surface)', borderRadius: 6,
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text)' }}>
                      {new Date(b.workout_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    {b.block_label && <span>·</span>}
                    {b.block_label && <span>{b.block_label}</span>}
                    {b.score && (
                      <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--text)' }}>· {b.score}</span>
                    )}
                    {b.rx && (
                      <span style={{ fontSize: 10, background: 'var(--accent-glow)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 4 }}>Rx</span>
                    )}
                    {wkgLabel && (
                      <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono', color: 'var(--accent)', fontWeight: 600 }}>
                        {wkgLabel}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>
                    {b.block_text}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: 'JetBrains Mono' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
