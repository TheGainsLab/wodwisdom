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
import { bucketByTimeDomain, type WkgBucketStat } from '../lib/competitionHistory';

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

/** Subset of the all_results entry shape we read: the power fields (bundle
 *  1.7.0) plus the workout spec + score/percentile for the click-to-expand
 *  detail card. The bundle carries more; we type only what we render. */
interface HistoricalMovement {
  name: string;
  reps_scheme?: string | null;
  load_lbs?: number | null;
  load_descriptor?: string | null;
  calories?: number | null;
  distance_value?: number | null;
  distance_unit?: string | null;
}
interface HistoricalResult {
  year: number;
  workout_name: string;
  stage?: string;
  scaled_tier?: string;
  workout?: {
    description?: string;
    time_cap_seconds?: number | null;
    time_domain?: { bucket?: string | null };
    movements?: HistoricalMovement[];
  };
  result: {
    valid: boolean;
    raw_score_text?: string | null;
    cohort_percentile?: number | null;
    avg_power_watts?: number | null;
    avg_w_per_kg?: number | null;
    joules?: number | null;
  };
}

/** Build a readable movements list when a historical workout has no prose
 *  description (fallback only — description is preferred). */
function fmtHistoricalMovements(movements?: HistoricalMovement[]): string {
  if (!movements?.length) return '';
  return movements.map(m => {
    const parts: string[] = [];
    if (m.reps_scheme) parts.push(m.reps_scheme);
    parts.push(m.name);
    if (m.load_lbs != null) parts.push(`@ ${m.load_lbs} lbs`);
    else if (m.load_descriptor) parts.push(`@ ${m.load_descriptor}`);
    if (m.calories != null) parts.push(`${m.calories} cal`);
    if (m.distance_value != null) parts.push(`${m.distance_value}${m.distance_unit ?? ''}`);
    return parts.join(' ');
  }).join('\n');
}

const SECTION_BG = 'var(--surface2)';
const PROGRAM_WINDOW_DAYS = 90;

// Time-domain bucketing — buckets are ours (same boundaries on program +
// competition), so program and historical can share one color language.
const BUCKET_ORDER: Array<'short' | 'medium' | 'long'> = ['short', 'medium', 'long'];
const BUCKET_LABEL: Record<'short' | 'medium' | 'long', string> = {
  short: 'Short', medium: 'Medium', long: 'Long',
};
const BUCKET_COLOR: Record<string, string> = {
  short: '#f5a524',   // amber
  medium: '#2ec486',  // green
  long: '#5b8def',    // blue
};

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

/** Vertical bar chart with date/label axis. Hover/title tooltips show value.
 *  When onSelect is provided, the whole column is a click target; the selected
 *  bar keeps full color + a ring while the rest dim. */
function WkgBarChart({
  items, valueLabel = 'W/kg', onSelect, selectedKey,
}: {
  items: Array<{ key: string; label: string; subLabel?: string; value: number; bucket?: string }>;
  valueLabel?: string;
  onSelect?: (key: string) => void;
  selectedKey?: string | null;
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
  const clickable = !!onSelect;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100 }}>
        {items.map((it, i) => {
          const isSel = selectedKey != null && selectedKey === it.key;
          const dim = selectedKey != null && !isSel;
          return (
            <button
              key={`${it.key}-${i}`}
              type="button"
              onClick={clickable ? () => onSelect!(it.key) : undefined}
              title={`${it.label}: ${it.value.toFixed(2)} ${valueLabel}${it.subLabel ? ` · ${it.subLabel}` : ''}`}
              style={{
                flex: 1, minWidth: 4, height: '100%', padding: 0, border: 'none',
                background: 'transparent', cursor: clickable ? 'pointer' : 'default',
                display: 'flex', alignItems: 'flex-end',
              }}
            >
              <div style={{
                width: '100%',
                height: `${maxVal > 0 ? Math.max((it.value / maxVal) * 100, 4) : 4}%`,
                background: (it.bucket && BUCKET_COLOR[it.bucket]) || 'var(--accent)', borderRadius: 2,
                opacity: dim ? 0.4 : 1,
                outline: isSel ? '2px solid var(--text)' : 'none', outlineOffset: 1,
              }} />
            </button>
          );
        })}
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

function fmtSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Detail card shown under a chart when a bar is clicked. */
function MetconDetailCard({
  title, sub, stats, body, onClose,
}: {
  title: string;
  sub?: string;
  stats: Array<{ label: string; value: string }>;
  body?: string;
  onClose: () => void;
}) {
  return (
    <div style={{
      marginTop: 8, padding: 12, background: 'var(--surface)',
      borderRadius: 6, border: '1px solid var(--accent)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
        {sub && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</span>}
        <button
          type="button" onClick={onClose} aria-label="Close"
          style={{
            marginLeft: 'auto', background: 'transparent', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0,
          }}
        >×</button>
      </div>
      {stats.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: body ? 8 : 0 }}>
          {stats.map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'JetBrains Mono' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}
      {body && (
        <div style={{
          fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'pre-wrap',
          borderTop: '1px solid var(--border)', paddingTop: 8,
        }}>
          {body}
        </div>
      )}
    </div>
  );
}

/** Color key for the time-domain bucket palette shared by the bars + breakdown. */
function BucketLegend() {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '8px 0 2px' }}>
      {BUCKET_ORDER.map(b => (
        <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: BUCKET_COLOR[b] }} />
          {BUCKET_LABEL[b]}
        </span>
      ))}
    </div>
  );
}

/** Side-by-side program vs competition avg W/kg per time-domain bucket. The
 *  comparison answers "am I training the time domains I'm weak in competition?"
 *  — but program W/kg is personalized while competition is a population estimate
 *  at default body mass, so we caveat the absolute numbers. */
function TimeDomainBreakdown({
  program, historical, showHistorical,
}: {
  program: WkgBucketStat[];
  historical: WkgBucketStat[];
  showHistorical: boolean;
}) {
  const histByBucket = new Map(historical.map(s => [s.bucket, s]));
  const cell = (s: WkgBucketStat | undefined) => (s && s.avgWkg != null ? `${s.avgWkg.toFixed(2)}` : '—');
  const count = (s: WkgBucketStat | undefined) => (s && s.n > 0 ? `${s.nWithPower}/${s.n}` : '');
  const header = (label: string) => (
    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
  );
  const valueCell = (s: WkgBucketStat | undefined, key: string) => (
    <div key={key} style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'JetBrains Mono' }}>
      {cell(s)}{cell(s) !== '—' && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}> W/kg</span>}
      {count(s) && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}> ({count(s)})</span>}
    </div>
  );
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Power by time domain
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: showHistorical ? '72px 1fr 1fr' : '72px 1fr', gap: '6px 10px', alignItems: 'center' }}>
        <div />
        {header('Program')}
        {showHistorical && header('Competition')}
        {program.flatMap((p) => {
          const h = histByBucket.get(p.bucket);
          const out = [
            <div key={`${p.bucket}-lbl`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: BUCKET_COLOR[p.bucket] }} />
              {BUCKET_LABEL[p.bucket]}
            </div>,
            valueCell(p, `${p.bucket}-prog`),
          ];
          if (showHistorical) out.push(valueCell(h, `${p.bucket}-hist`));
          return out;
        })}
      </div>
      {showHistorical && (
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Competition power is a population estimate at default body mass (84M/64W), not your actual output — compare the shape across buckets, not the absolute numbers. Counts show workouts with power / total.
        </div>
      )}
    </div>
  );
}

export default function MetconsTab({ userId, bodyweightKg, competitionAthleteId, metconBlocks }: Props) {
  const [historical, setHistorical] = useState<HistoricalResult[]>([]);
  const [historicalLoaded, setHistoricalLoaded] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  // Which chart bar (if any) is expanded into a detail card below the chart.
  const [selected, setSelected] = useState<{ source: 'program' | 'historical'; key: string } | null>(null);

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
          ? { key: b.id, label: formatDate(b.workout_date), subLabel: b.score ?? undefined, value: w, bucket: b.time_domain ?? undefined }
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
          ? { key: `${r.year}-${r.workout_name}-${i}`, label: `${r.year} ${r.workout_name}`, value: w, bucket: r.workout?.time_domain?.bucket ?? undefined }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [historical, bodyweightKg]);

  // ── Per-time-domain power rollups (shared helper → can't drift from the
  //    competition-side breakdown on Athlete Data) ──
  const programBuckets = useMemo(
    () => bucketByTimeDomain(
      metconBlocks,
      b => b.time_domain,
      b => wPerKg(b.avg_power_watts, b.avg_w_per_kg, bodyweightKg),
    ),
    [metconBlocks, bodyweightKg],
  );
  const historicalBuckets = useMemo(
    () => bucketByTimeDomain(
      historical.filter(r => r.result.valid),
      r => r.workout?.time_domain?.bucket,
      r => wPerKg(r.result.avg_power_watts ?? null, r.result.avg_w_per_kg ?? null, bodyweightKg),
    ),
    [historical, bodyweightKg],
  );

  // key → full HistoricalResult, mirroring historicalChart's filter+index so the
  // detail card can resolve a clicked historical bar back to its source row.
  const historicalByKey = useMemo(() => {
    const m = new Map<string, HistoricalResult>();
    historical
      .filter(r => r.result.valid && r.result.avg_power_watts != null)
      .forEach((r, i) => { m.set(`${r.year}-${r.workout_name}-${i}`, r); });
    return m;
  }, [historical]);

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
        <BucketLegend />
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Program — last 90 days (chronological)
        </div>
        <WkgBarChart
          items={programChart}
          selectedKey={selected?.source === 'program' ? selected.key : null}
          onSelect={(k) => setSelected(prev => prev?.source === 'program' && prev.key === k ? null : { source: 'program', key: k })}
        />
        {selected?.source === 'program' && (() => {
          const b = metconBlocks.find(x => x.id === selected.key);
          if (!b) return null;
          const w = wPerKg(b.avg_power_watts, b.avg_w_per_kg, bodyweightKg);
          const stats: Array<{ label: string; value: string }> = [];
          if (w != null) stats.push({ label: 'Power', value: `${w.toFixed(2)} W/kg` });
          if (b.score) stats.push({ label: 'Score', value: b.score });
          if (b.time_domain) stats.push({ label: 'Time domain', value: b.time_domain });
          if (b.work_seconds != null) stats.push({ label: 'Work time', value: fmtSeconds(b.work_seconds) });
          if (b.percentile != null) stats.push({ label: 'Percentile', value: `${Math.round(b.percentile)}th` });
          const title = new Date(b.workout_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          const sub = [b.block_label, b.rx ? 'Rx' : null].filter(Boolean).join(' · ') || undefined;
          return <MetconDetailCard title={title} sub={sub} stats={stats} body={b.block_text} onClose={() => setSelected(null)} />;
        })()}
        {competitionAthleteId && historicalLoaded && historicalChart.length > 0 && (
          <>
            <div style={{
              fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase',
              letterSpacing: 0.5, margin: '14px 0 6px',
            }}>
              Historical — competition workouts (chronological)
            </div>
            <WkgBarChart
              items={historicalChart}
              selectedKey={selected?.source === 'historical' ? selected.key : null}
              onSelect={(k) => setSelected(prev => prev?.source === 'historical' && prev.key === k ? null : { source: 'historical', key: k })}
            />
            {selected?.source === 'historical' && (() => {
              const r = historicalByKey.get(selected.key);
              if (!r) return null;
              const w = wPerKg(r.result.avg_power_watts ?? null, r.result.avg_w_per_kg ?? null, bodyweightKg);
              const stats: Array<{ label: string; value: string }> = [];
              if (r.result.raw_score_text) stats.push({ label: 'Score', value: r.result.raw_score_text });
              if (r.result.cohort_percentile != null) stats.push({ label: 'Percentile', value: `${Math.round(r.result.cohort_percentile)}th` });
              if (w != null) stats.push({ label: 'Power', value: `${w.toFixed(2)} W/kg` });
              if (r.result.avg_power_watts != null) stats.push({ label: 'Avg power', value: `${Math.round(r.result.avg_power_watts)} W` });
              if (r.result.joules != null) stats.push({ label: 'Total work', value: `${Math.round(r.result.joules / 1000)} kJ` });
              if (r.workout?.time_cap_seconds != null) stats.push({ label: 'Time cap', value: fmtSeconds(r.workout.time_cap_seconds) });
              const body = r.workout?.description?.trim() || fmtHistoricalMovements(r.workout?.movements) || undefined;
              const sub = [String(r.year), r.stage].filter(Boolean).join(' · ');
              return <MetconDetailCard title={r.workout_name} sub={sub} stats={stats} body={body} onClose={() => setSelected(null)} />;
            })()}
          </>
        )}
        <TimeDomainBreakdown
          program={programBuckets}
          historical={historicalBuckets}
          showHistorical={!!competitionAthleteId && historicalLoaded && historicalBuckets.some(b => b.n > 0)}
        />
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
