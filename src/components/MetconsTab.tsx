/**
 * MetconsTab — the Metcons tab inside the Training Log. Program training
 * only: metcons logged from programs. Competition history (including the
 * year-over-year Historical Power chart) lives on Athlete Data.
 *
 * Hierarchy of importance, top→bottom:
 *   1. Performance grid + skill cost (training percentiles)
 *   2. Power stats + power-vs-duration chart + power by time domain
 *   3. Heatmap (collapsed by default)
 *   4. Chronological history list with search
 *
 * W/kg is recomputed using the athlete's actual bodyweight from
 * athlete_profiles.bodyweight (converted to kg). When bodyweight is missing,
 * fall back to the cohort-default avg_w_per_kg already on the block (which
 * assumes the 84M/64W population basis).
 */
import { useMemo, useState } from 'react';
import MetconHeatmap from './MetconHeatmap';
import { bucketByTimeDomain, type WkgBucketStat } from '../lib/competitionHistory';
import { PerformanceGrid, SkillCostTable } from './PerformanceGrid';
import { computeGrid, computeSkillCost, hasBarbellMovementNames, skillsInMovementNames, type GridSourceRow } from '../lib/performanceGrid';
import { BucketLegend, Stat, WkgBarChart } from './WkgBarChart';
import { BUCKET_COLOR, BUCKET_LABEL } from '../lib/powerBuckets';

interface MetconBlockLite {
  id: string;
  log_id: string;
  block_label: string | null;
  block_text: string;
  score: string | null;
  rx: boolean;
  avg_power_watts: number | null;
  avg_w_per_kg: number | null;
  joules: number | null;
  work_seconds: number | null;
  time_domain: string | null;
  capped: boolean | null;
  percentile: number | null;
  notes: string | null;
  faults: Array<{ movement: string; faults: string[] }>;
  movements: string[];
  workout_date: string;
}

interface Props {
  userId: string;
  bodyweightKg: number | null;
  metconBlocks: MetconBlockLite[];
}

const SECTION_BG = 'var(--surface2)';

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

function fmtSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Detail card shown under a chart when a bar is clicked. */
function MetconDetailCard({
  title, sub, stats, body, notes, faults, onClose,
}: {
  title: string;
  sub?: string;
  stats: Array<{ label: string; value: string }>;
  body?: string;
  notes?: string | null;
  faults?: Array<{ movement: string; faults: string[] }>;
  onClose: () => void;
}) {
  const hasBelow = !!(body || (faults && faults.length > 0) || notes);
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: hasBelow ? 8 : 0 }}>
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
      {faults && faults.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Faults observed</div>
          {faults.map((f, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--danger, #e74c3c)', marginBottom: 2 }}>
              <span style={{ fontWeight: 600 }}>{f.movement}:</span> {f.faults.join(', ')}
            </div>
          ))}
        </div>
      )}
      {notes && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic', marginTop: 8 }}>
          {notes}
        </div>
      )}
    </div>
  );
}

/** Program avg W/kg per time-domain bucket, as horizontal bars scaled to the
 *  highest bucket. "N of M" = metcons with a power reading / metcons logged. */
function TimeDomainBreakdown({ program }: { program: WkgBucketStat[] }) {
  const max = program.reduce((m, p) => Math.max(m, p.avgWkg ?? 0), 0);
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.8, color: 'var(--text)', textTransform: 'uppercase', marginBottom: 10 }}>
        Power by time domain
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {program.map((p) => (
          <div key={p.bucket} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 76, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: BUCKET_COLOR[p.bucket] }} />
              {BUCKET_LABEL[p.bucket]}
            </span>
            <div style={{ flex: 1, height: 8, background: 'var(--surface)', borderRadius: 4, overflow: 'hidden' }}>
              {p.avgWkg != null && max > 0 && (
                <div style={{ height: '100%', width: `${(p.avgWkg / max) * 100}%`, background: 'var(--accent)' }} />
              )}
            </div>
            <span style={{ width: 82, flexShrink: 0, textAlign: 'right', fontFamily: 'JetBrains Mono', color: 'var(--text)' }}>
              {p.avgWkg != null ? <>{p.avgWkg.toFixed(2)}<span style={{ fontSize: 10, color: 'var(--text-muted)' }}> W/kg</span></> : '—'}
            </span>
            <span style={{ width: 56, flexShrink: 0, textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
              {p.n > 0 ? `${p.nWithPower} of ${p.n}` : ''}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        Average across metcons with a power reading — &ldquo;N of M&rdquo; means power could be calculated for N of the M metcons you logged in that time domain.
      </div>
    </div>
  );
}

export default function MetconsTab({ userId, bodyweightKg, metconBlocks }: Props) {
  const [historySearch, setHistorySearch] = useState('');
  // Which chart bar (if any) is expanded into a detail card below the chart.
  const [selected, setSelected] = useState<string | null>(null);

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

  // ── Program power-duration points — one per metcon with a power read.
  // Duration is recovered exactly as joules / avg_power_watts (metcons don't
  // persist work_seconds; the power calc's time is implicit in that ratio). ──
  const programCurvePoints = useMemo(() => {
    return metconBlocks
      .map(b => {
        const w = wPerKg(b.avg_power_watts, b.avg_w_per_kg, bodyweightKg);
        if (w == null || !Number.isFinite(w)) return null;
        if (b.joules == null || b.avg_power_watts == null || b.avg_power_watts <= 0) return null;
        const durationSec = b.joules / b.avg_power_watts;
        if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
        return { key: b.id, durationSec, wkg: w, bucket: b.time_domain ?? undefined, label: formatDate(b.workout_date), subLabel: b.score ?? undefined };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [metconBlocks, bodyweightKg]);

  // Bars ordered short → long by duration, so the power-duration shape reads
  // left-to-right (high W/kg at short, falling off as duration grows). Label is
  // the workout's duration; the date/score ride along as the tooltip sub-label.
  const programDurationBars = useMemo(() =>
    [...programCurvePoints]
      .sort((a, b) => a.durationSec - b.durationSec)
      .map(p => ({ key: p.key, label: fmtSeconds(p.durationSec), subLabel: p.subLabel, value: p.wkg, bucket: p.bucket })),
    [programCurvePoints]);

  // ── Per-time-domain power rollups (shared helper) ──
  const programBuckets = useMemo(
    () => bucketByTimeDomain(
      metconBlocks,
      b => b.time_domain,
      b => wPerKg(b.avg_power_watts, b.avg_w_per_kg, bodyweightKg),
    ),
    [metconBlocks, bodyweightKg],
  );
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

  // ── Performance grid: duration × barbell presence, counts on every
  // cell, from logged program metcons. Same construction as the admin card.
  const trainingGridSource = useMemo((): GridSourceRow[] =>
    metconBlocks
      .filter(b => b.percentile != null)
      .map(b => ({
        timeDomain: b.time_domain === 'short' || b.time_domain === 'medium' || b.time_domain === 'long' ? b.time_domain : null,
        percentile: b.percentile as number,
        hasBarbell: hasBarbellMovementNames(b.movements),
        skills: skillsInMovementNames(b.movements),
        label: `${b.workout_date}${b.block_label ? ` · ${b.block_label}` : ''}`,
      })), [metconBlocks]);
  const trainingGrid = useMemo(() => computeGrid(trainingGridSource), [trainingGridSource]);
  const trainingSkills = useMemo(() => computeSkillCost(trainingGridSource), [trainingGridSource]);
  const trainingScored = trainingGridSource.filter(r => r.timeDomain !== null).length;

  return (
    <div>
      {trainingScored > 0 && (
        <CollapsibleSection title="Performance Grid" defaultOpen>
          <PerformanceGrid
            title="In training"
            subtitle={`Open-field percentile · logged metcons — ${trainingScored} scored`}
            rows={trainingGrid}
          />
          <SkillCostTable rows={trainingSkills} overallLabel="your training overall" />
        </CollapsibleSection>
      )}
      {/* ── Power charts — each chart sits directly under its own stats ── */}
      <CollapsibleSection title="Power Charts" defaultOpen>
        {/* Program group: program stats, then the program chart. */}
        <div style={{ padding: 14, marginBottom: 12, background: SECTION_BG, borderRadius: 8 }}>
          <div style={{
            fontSize: 13, fontWeight: 800, letterSpacing: 0.8,
            color: 'var(--text)', textTransform: 'uppercase', marginBottom: 10,
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
          {bodyweightKg == null && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Add bodyweight to your profile for personalized W/kg. Currently using a cohort estimate.
            </div>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Power vs Duration
        </div>
        <BucketLegend />
        <div style={{ height: 10 }} />
        <WkgBarChart
          items={programDurationBars}
          referenceValue={programStats.avgWkg}
          selectedKey={selected}
          onSelect={(k) => setSelected(prev => (prev === k ? null : k))}
        />
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 2 }}>
          shorter ← duration → longer
        </div>
        {selected != null && (() => {
          const b = metconBlocks.find(x => x.id === selected);
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
          return <MetconDetailCard title={title} sub={sub} stats={stats} body={b.block_text} notes={b.notes} faults={b.faults} onClose={() => setSelected(null)} />;
        })()}
        <div style={{ borderTop: '1px solid var(--border)', margin: '28px 0 0' }} />
        <TimeDomainBreakdown program={programBuckets} />
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
