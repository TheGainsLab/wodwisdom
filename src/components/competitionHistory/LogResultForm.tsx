/**
 * LogResultForm — log a result for a competition workout you did outside
 * competition (a "throwback"). Invokes the log-throwback edge function, which
 * writes the competition_workout_results row and best-effort computes power.
 *
 * The form shows the field(s) the workout actually uses (no dynamic schema —
 * just conditional visibility):
 *   - dual-scoring (time-capped): a "Did you finish under the cap?" checkbox →
 *     checked = time field (must be < cap), unchecked = reps field.
 *   - pure for-time (Games etc.): just the time field.
 *   - AMRAP / for-reps: just the reps field.
 *   - for-load: just the weight (lbs) field.
 * RX-only for v1 (no scaling picker). The "where you'd have landed" placement
 * is shown by the caller after onLogged (v2 piece — needs the workout's
 * percentile curve).
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { ScoringUnit, PlacementResult } from '../../lib/competitionHistory';

export interface LogResultWorkout {
  competition_workout_id: string;
  label: string; // e.g. "2014 Open 14.4"
  scoring_unit: ScoringUnit;
  is_dual_scoring: boolean;
  time_cap_seconds: number | null;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtCap(seconds: number | null): string {
  if (seconds == null) return 'the cap';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}:00 cap` : `${m}:${String(s).padStart(2, '0')} cap`;
}

function fmtScore(type: ScoringUnit, value: number): string {
  switch (type) {
    case 'time': { const m = Math.floor(value / 60); const s = Math.round(value % 60); return `${m}:${String(s).padStart(2, '0')}`; }
    case 'reps': return `${value} reps`;
    case 'load_lbs': return `${value} lb`;
    case 'distance': return `${value} m`;
    default: return String(value);
  }
}

const AGE_BAND_LABEL: Record<string, string> = {
  under_18: 'under-18s',
  open_18_34: '18–34s',
  masters_35_39: '35–39s',
  masters_40_44: '40–44s',
  masters_45_49: '45–49s',
  masters_50_54: '50–54s',
  masters_55_plus: '55+',
};

export default function LogResultForm({
  workout,
  ageBand,
  onLogged,
  onClose,
}: {
  workout: LogResultWorkout;
  ageBand?: string;
  onLogged: (competitionWorkoutId: string) => void;
  onClose: () => void;
}) {
  const dual = workout.is_dual_scoring;
  // For dual-scoring, the checkbox decides time vs reps. For non-dual, the
  // workout's scoring_unit decides which single field shows.
  const [finishedUnderCap, setFinishedUnderCap] = useState(true);
  const showTime = dual ? finishedUnderCap : workout.scoring_unit === 'time';
  const showReps = dual ? !finishedUnderCap : workout.scoring_unit === 'reps';
  const showLoad = !dual && workout.scoring_unit === 'load_lbs';
  const showDistance = !dual && workout.scoring_unit === 'distance';

  const [min, setMin] = useState('');
  const [sec, setSec] = useState('');
  const [reps, setReps] = useState('');
  const [load, setLoad] = useState('');
  const [distance, setDistance] = useState('');
  const [performedAt, setPerformedAt] = useState(todayISO());
  // Standards are assumed enforced — the explicit "I judged it to competition
  // standards" toggle was removed; we always record the result as standards-met.
  const standardsMet = true;
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Post-submit: the logged score + the placement payoff.
  const [logged, setLogged] = useState<
    { type: ScoringUnit; value: number; watts: number | null; wPerKg: number | null } | null
  >(null);
  const [placement, setPlacement] = useState<PlacementResult | null>(null);
  const [placementLoading, setPlacementLoading] = useState(false);
  const [placementUnavailable, setPlacementUnavailable] = useState(false);
  const [prescription, setPrescription] = useState<string | null>(null);

  // Pull the workout's prescription (description) so the athlete sees what
  // they're about to log — Try-It is, by definition, a workout they haven't
  // done. Best-effort: the form works fine without it.
  useEffect(() => {
    let cancelled = false;
    supabase.functions
      .invoke<{ workout?: { description?: string } }>('competition-catalog', {
        body: { workout_id: workout.competition_workout_id },
      })
      .then(({ data }) => {
        if (cancelled) return;
        const d = data?.workout?.description;
        if (typeof d === 'string' && d.trim()) setPrescription(d.trim());
      });
    return () => { cancelled = true; };
  }, [workout.competition_workout_id]);

  const buildRow = (): { score_type: ScoringUnit; score_value: number; finished: boolean | null } | string => {
    if (showTime) {
      const m = min === '' ? 0 : parseInt(min, 10);
      const s = sec === '' ? 0 : parseInt(sec, 10);
      if (isNaN(m) || isNaN(s) || s < 0 || s > 59 || m < 0) return 'Enter a valid time.';
      const total = m * 60 + s;
      if (total <= 0) return 'Enter a valid time.';
      if (dual && finishedUnderCap && workout.time_cap_seconds != null && total >= workout.time_cap_seconds) {
        return `If you finished, your time must be under the ${fmtCap(workout.time_cap_seconds)}.`;
      }
      return { score_type: 'time', score_value: total, finished: dual ? true : null };
    }
    if (showReps) {
      const r = parseInt(reps, 10);
      if (isNaN(r) || r <= 0 || r > 100000) return 'Enter a valid rep count.';
      return { score_type: 'reps', score_value: r, finished: dual ? false : null };
    }
    if (showLoad) {
      const l = parseFloat(load);
      if (isNaN(l) || l <= 0 || l > 2000) return 'Enter a valid weight (lb).';
      return { score_type: 'load_lbs', score_value: l, finished: null };
    }
    if (showDistance) {
      const d = parseFloat(distance);
      if (isNaN(d) || d <= 0 || d > 1000000) return 'Enter a valid distance (m).';
      return { score_type: 'distance', score_value: d, finished: null };
    }
    return "This workout's scoring isn't supported for logging yet.";
  };

  const onSubmit = async () => {
    setError(null);
    if (!performedAt || performedAt > todayISO()) { setError('Pick a date — not in the future.'); return; }
    const built = buildRow();
    if (typeof built === 'string') { setError(built); return; }
    setSaving(true);
    const { data: logData, error: logErr } = await supabase.functions.invoke<
      { result?: { id: string; avg_power_watts: number | null; avg_w_per_kg: number | null }; error?: string }
    >('log-throwback', {
      body: {
        competition_workout_id: workout.competition_workout_id,
        score_type: built.score_type,
        score_value: built.score_value,
        finished: built.finished,
        performed_at: performedAt,
        standards_met: standardsMet,
        notes: notes.trim() || null,
      },
    });
    setSaving(false);
    if (logErr || !logData?.result || logData.error) {
      setError("Couldn't save your result. Try again.");
      return;
    }
    const rowId = logData.result.id;

    // Saved — mark the cell filled, then fetch "where you'd have landed".
    onLogged(workout.competition_workout_id);
    setLogged({
      type: built.score_type,
      value: built.score_value,
      watts: logData.result.avg_power_watts ?? null,
      wPerKg: logData.result.avg_w_per_kg ?? null,
    });
    setPlacementLoading(true);
    const { data, error: plErr } = await supabase.functions.invoke<PlacementResult & { error?: string }>(
      'competition-placement',
      {
        body: {
          competition_workout_id: workout.competition_workout_id,
          score_value: built.score_value,
          score_type: built.score_type,
          ...(built.finished != null ? { finished: built.finished } : {}),
          ...(ageBand ? { age_band: ageBand } : {}),
        },
      },
    );
    setPlacementLoading(false);
    if (plErr || !data || (data as { error?: string }).error || typeof data.worldwide_percentile !== 'number') {
      setPlacementUnavailable(true);
      return;
    }
    setPlacement(data);

    // Persist the placement onto the logged row so it survives reloads and
    // feeds "Your workouts" + the movement list (throwbacks build out your
    // history). Best-effort — RLS allows update-own; a failure (or columns not
    // yet migrated) just leaves the percentile null, placement still shows.
    await supabase
      .from('competition_workout_results')
      .update({
        cohort_percentile: data.cohort?.cohort_percentile ?? null,
        worldwide_percentile: data.worldwide_percentile,
        worldwide_rank: data.worldwide_rank,
        field_size: data.field_size,
        cohort_size: data.cohort?.cohort_size ?? null,
      })
      .eq('id', rowId);
  };

  const inputStyle = { fontFamily: 'inherit' as const };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '24px 16px', overflowY: 'auto', zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, maxWidth: 460, width: '100%', padding: 20 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Log your result — {workout.label}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4 }}>×</button>
        </div>

        {!logged ? (
          <>
            {prescription && (
              <div style={{
                marginTop: 12, padding: '10px 12px',
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 8, fontSize: 13, color: 'var(--text-dim)',
                whiteSpace: 'pre-wrap',
              }}>
                {prescription}
              </div>
            )}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {dual && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={finishedUnderCap} onChange={(e) => setFinishedUnderCap(e.target.checked)} />
                  I finished under the {fmtCap(workout.time_cap_seconds)}
                </label>
              )}

              {showTime && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Your time</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input className="lift-input" style={{ ...inputStyle, width: 64 }} type="number" min={0} placeholder="min" value={min} onChange={(e) => setMin(e.target.value)} />
                    <span>:</span>
                    <input className="lift-input" style={{ ...inputStyle, width: 64 }} type="number" min={0} max={59} placeholder="sec" value={sec} onChange={(e) => setSec(e.target.value)} />
                  </div>
                </div>
              )}

              {showReps && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>{dual ? 'Reps completed at the cap' : 'Total reps'}</div>
                  <input className="lift-input" style={{ ...inputStyle, width: 120 }} type="number" min={1} placeholder="reps" value={reps} onChange={(e) => setReps(e.target.value)} />
                </div>
              )}

              {showLoad && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Heaviest load (lb)</div>
                  <input className="lift-input" style={{ ...inputStyle, width: 120 }} type="number" min={1} placeholder="lb" value={load} onChange={(e) => setLoad(e.target.value)} />
                </div>
              )}

              {showDistance && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Distance (m)</div>
                  <input className="lift-input" style={{ ...inputStyle, width: 120 }} type="number" min={1} placeholder="m" value={distance} onChange={(e) => setDistance(e.target.value)} />
                </div>
              )}

              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Date</div>
                <input className="lift-input" style={inputStyle} type="date" max={todayISO()} value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} />
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Notes <span style={{ color: 'var(--text-muted)' }}>(optional)</span></div>
                <textarea className="lift-input" rows={2} style={{ ...inputStyle, width: '100%', resize: 'vertical', textAlign: 'left' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>

            {error && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--danger, #d33)' }}>{error}</div>}

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button type="button" className="auth-btn" style={{ padding: '8px 16px', fontSize: 13, background: 'var(--surface2)', color: 'var(--text)' }} onClick={onClose} disabled={saving}>Cancel</button>
              <button type="button" className="auth-btn" style={{ padding: '8px 16px', fontSize: 13 }} onClick={onSubmit} disabled={saving}>{saving ? 'Saving…' : 'Log result'}</button>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Logged</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 2 }}>{fmtScore(logged.type, logged.value)}</div>
            {logged.watts != null && (
              <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-dim)' }}>
                {Math.round(logged.watts)} W{logged.wPerKg != null ? ` · ${logged.wPerKg.toFixed(2)} W/kg` : ''}
              </div>
            )}

            {placementLoading && (
              <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-dim)' }}>Working out where you'd have landed…</div>
            )}
            {placement && (
              <div style={{ marginTop: 14, fontSize: 13 }}>
                <div style={{ color: 'var(--text-dim)' }}>If you'd done this in competition:</div>
                <div style={{ marginTop: 4 }}>
                  <strong>{placement.worldwide_percentile.toFixed(1)}th</strong> percentile
                  <span style={{ color: 'var(--text-dim)' }}> · ~{Math.round(placement.worldwide_rank).toLocaleString()} of {placement.field_size.toLocaleString()}</span>
                </div>
                {placement.cohort && placement.cohort.cohort_percentile != null && (
                  <div style={{ marginTop: 4 }}>
                    <strong>{placement.cohort.cohort_percentile.toFixed(1)}th</strong> percentile among {AGE_BAND_LABEL[placement.cohort.age_band] ?? placement.cohort.age_band}
                    {placement.cohort.cohort_rank != null && (
                      <span style={{ color: 'var(--text-dim)' }}> · ~{Math.round(placement.cohort.cohort_rank).toLocaleString()} of {placement.cohort.cohort_size.toLocaleString()}</span>
                    )}
                  </div>
                )}
              </div>
            )}
            {placementUnavailable && (
              <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-dim)' }}>Saved — but we couldn't work out a placement for this one (field data isn't available yet).</div>
            )}

            <div style={{ marginTop: 16 }}>
              <button type="button" className="auth-btn" style={{ padding: '8px 16px', fontSize: 13 }} onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
