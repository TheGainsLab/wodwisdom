// Per-block-type logging UI that lands on the V3 day cards. Each block type is
// its own little world; BlockLog dispatches to the right one. The day page owns a
// DayLogController (in-progress log id, saved-state, save via save-workout-block);
// each world reads the prescription off the block and collects actuals.
//
// Logging-fidelity redesign:
//  - Strength / skills / accessory all log PER SET on the same prefilled grid
//    (a row is a set; prefill = the prescription, so "did it as written" is
//    just Save). Rows are shape-aware: rep-counted work gets a reps column,
//    holds get seconds (hold_seconds), distance work gets distance.
//  - Effort is ONE question per block ("how hard was this block?"), saved on
//    workout_log_blocks.rpe. Per-set RPE is gone — it was prefilled from the
//    prescription, so the stored values were the question echoed back.
//  - The Q (A-D quality) column is gone — never interpretable on touch, never
//    consumed. The fault checkboxes are the quality signal.
//  - Metcon: no Rx checkbox (personal programs — editing the prescription IS
//    scaling); capped saves the cap time as the score plus a rounds+reps
//    "how far did you get"; calorie movements save to the calories column.
import { useMemo, useState } from 'react';
import type { ProgramBlockV2, ProgramMovementV2 } from '../pages/ProgramDetailPage';
import type { ReviewBlock } from '../components/reviewCoaching';
import { scoreMetcon, deriveTimeDomain, type BenchmarkResult } from '../lib/metconScoring';
import { formatMovementName } from '../lib/movementName';

// ── Save payload (the `block` body of save-workout-block) ──
export interface LogEntry {
  movement: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  weight_unit: string;
  rpe: number | null;
  set_number: number | null;
  reps_completed: number | null;
  hold_seconds: number | null;
  distance: number | null;
  distance_unit: string | null;
  calories: number | null;
  quality: string | null;
  variation: string | null;
  faults_observed: string[] | null;
  completed: boolean;
  skip_reason: string | null;
  prescribed_weight: number | null;
  prescribed_reps: number | null;
}
export interface SaveBlockPayload {
  label: string;
  type: string;
  text: string;
  score: string | null;
  rx: boolean;
  notes: string | null;
  sort_order: number;
  entries: LogEntry[];
  capped: boolean;
  capped_reps: number | null;
  /** Block-level effort (1-10) — the one RPE signal per block. */
  rpe?: number | null;
  cardio_avg_watts?: number | null;
  cardio_work_seconds?: number | null;
  cardio_modality?: string | null;
  block_scheme?: string | null;
  time_cap_seconds?: number | null;
  percentile?: number | null;
  performance_tier?: string | null;
  median_benchmark?: string | null;
  excellent_benchmark?: string | null;
  time_domain?: string | null;
}

export interface DayLogController {
  workoutDate: string;
  userUnits: 'lbs' | 'kg';
  isSaved: (sortOrder: number) => boolean;
  saving: number | null;
  saveBlock: (block: SaveBlockPayload) => Promise<{ auto_completed?: boolean } | null>;
  reopen: (sortOrder: number) => void;
}

// ── helpers ──
const numOrNull = (s: string): number | null => { const n = parseFloat(s.trim()); return Number.isFinite(n) ? n : null; };
const intOrNull = (s: string): number | null => { const n = parseInt(s.trim(), 10); return Number.isFinite(n) ? n : null; };
const parseClock = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  if (t.includes(':')) { const [m, sec] = t.split(':'); const mm = parseInt(m, 10), ss = parseInt(sec, 10); if (!Number.isFinite(mm) || !Number.isFinite(ss)) return null; return mm * 60 + ss; }
  const n = parseInt(t, 10); return Number.isFinite(n) ? n : null;
};
export const formatClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Shape-aware per-set plan for one movement. A row is a set; the value column
 * depends on how the work is prescribed:
 *   - rep-counted (rep_scheme / reps)      → reps, prefilled per set
 *   - time-based (time_seconds, no reps)   → seconds (saved as hold_seconds)
 *   - distance-based                       → distance (saved with its unit)
 *   - sets only ("3 sets max pull-ups")    → reps, EMPTY prefill (the blank
 *     is the feature: the athlete fills their actual max)
 * Same precedence the day card's display uses, so the log form can never
 * disagree with the prescription the athlete is looking at.
 */
type SetKind = 'reps' | 'seconds' | 'distance';
export function plannedSets(m: ProgramMovementV2): { kind: SetKind; count: number; prefill: (number | null)[]; unitLabel: string } {
  const scheme = Array.isArray(m.rep_scheme) ? m.rep_scheme : null;
  if (scheme && scheme.length > 0) {
    return { kind: 'reps', count: scheme.length, prefill: scheme, unitLabel: 'reps' };
  }
  const count = m.sets ?? 1;
  if (m.reps != null) {
    return { kind: 'reps', count, prefill: Array.from({ length: count }, () => m.reps), unitLabel: 'reps' };
  }
  if (m.time_seconds != null) {
    return { kind: 'seconds', count, prefill: Array.from({ length: count }, () => m.time_seconds), unitLabel: 'sec' };
  }
  if (m.distance != null) {
    return { kind: 'distance', count, prefill: Array.from({ length: count }, () => m.distance), unitLabel: m.distance_unit || 'dist' };
  }
  return { kind: 'reps', count, prefill: Array.from({ length: count }, () => null), unitLabel: 'reps' };
}
const blockText = (b: ProgramBlockV2) => b.block_scheme || b.block_label || '';
const emptyEntry = (movement: string, extra: Partial<LogEntry>): LogEntry => ({
  movement, sets: null, reps: null, weight: null, weight_unit: 'lbs', rpe: null, set_number: null,
  reps_completed: null, hold_seconds: null, distance: null, distance_unit: null, calories: null, quality: null,
  variation: null, faults_observed: null, completed: true, skip_reason: null,
  prescribed_weight: null, prescribed_reps: null, ...extra,
});
function reshapeBenchmark(eb: unknown): BenchmarkResult | null {
  const b = eb as { median_score?: string; excellent_score?: string | null; cohort_anchors?: BenchmarkResult['cohortAnchors'] } | null | undefined;
  if (!b || !b.median_score) return null;
  return { medianScore: b.median_score, excellentScore: b.excellent_score ?? '--', cohortAnchors: b.cohort_anchors ?? [] };
}
function inferMetconType(block: ProgramBlockV2): string {
  const combined = [block.block_scheme, block.block_label].filter(Boolean).join('\n').toUpperCase();
  if (/AMRAP|AS MANY ROUNDS/.test(combined)) return 'amrap';
  if (/EMOM|E\d+MOM/.test(combined)) return 'emom';
  return 'for_time';
}

/**
 * Reps in one round of this metcon, when the shape supports rounds (every
 * movement carries a uniform rep_scheme). Used to convert a capped athlete's
 * "4+7" into total reps. Null when rounds aren't well-defined (chippers,
 * mixed schemes) — those athletes enter a plain total instead.
 */
export function metconRoundSize(block: ProgramBlockV2): number | null {
  let size = 0;
  for (const m of block.movements) {
    const scheme = Array.isArray(m.rep_scheme) ? m.rep_scheme : null;
    if (!scheme || scheme.length === 0) continue; // cal/distance movements don't count reps
    if (!scheme.every((n) => n === scheme[0])) return null; // non-uniform → no round size
    size += scheme[0];
  }
  return size > 0 ? size : null;
}

/** Parse capped progress: "4+7" (rounds+reps, needs round size) or a plain
 *  total. Returns total reps completed, or null when unparseable. */
export function parseCapProgress(input: string, roundSize: number | null): number | null {
  const t = input.trim();
  if (!t) return null;
  const plus = t.match(/^(\d+)\s*\+\s*(\d+)$/);
  if (plus) {
    if (roundSize == null) return null;
    return parseInt(plus[1], 10) * roundSize + parseInt(plus[2], 10);
  }
  return intOrNull(t);
}

// Match the coach review's common_faults to a movement by fuzzy name (same as
// the old logger). Coaching is lazy — empty until the review loads.
const normalizeName = (name: string): string => name.toLowerCase().replace(/[-\s'']/g, '').replace(/[^a-z0-9]/g, '');
function faultsForMovement(coaching: ReviewBlock | null | undefined, movementName: string): string[] {
  if (!coaching?.cues_and_faults) return [];
  const n = normalizeName(movementName);
  for (const cf of coaching.cues_and_faults) {
    const rn = normalizeName(cf.movement);
    if (rn === n || rn.includes(n) || n.includes(rn)) return cf.common_faults ?? [];
  }
  return [];
}
function blockFaults(coaching: ReviewBlock | null | undefined, movements: ProgramMovementV2[]): string[] {
  const all = new Set<string>();
  for (const m of movements) for (const f of faultsForMovement(coaching, m.movement)) all.add(f);
  return [...all];
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14, textAlign: 'center',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
  color: 'var(--text)', fontFamily: "'Outfit', sans-serif",
};
const wrapStyle: React.CSSProperties = { marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' };

// Common-fault checkboxes (from the coach review). Checked → faults_observed.
function FaultChecklist({ faults, checked, onToggle }: { faults: string[]; checked: string[]; onToggle: (f: string) => void }) {
  if (faults.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Faults to flag</div>
      {faults.map(f => {
        const on = checked.includes(f);
        return (
          <label key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, lineHeight: 1.4, color: on ? 'var(--danger, #e74c3c)' : 'var(--text-dim)', cursor: 'pointer' }}>
            <input type="checkbox" checked={on} onChange={() => onToggle(f)} style={{ accentColor: 'var(--danger, #e74c3c)', marginTop: 2, flexShrink: 0 }} />
            <span>{f}</span>
          </label>
        );
      })}
    </div>
  );
}

function SavedBadge({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="block-log" style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        Logged
      </span>
      <button type="button" className="block-ai-edit-toggle" onClick={onEdit}>Edit</button>
    </div>
  );
}

/**
 * The one effort question per block. Lives inside SaveButton so it appears
 * exactly once per log panel, directly above Save — the natural "how did
 * that go?" moment. Unprefilled on purpose: this is the first real effort
 * signal the system collects (per-set RPE was prescription-prefilled noise).
 */
function SaveButton({ saving, onSave, rpe, onRpe, notes, onNotes }: { saving: boolean; onSave: () => void; rpe: string; onRpe: (v: string) => void; notes: string; onNotes: (v: string) => void }) {
  return (
    <>
      <input
        style={{ ...inputStyle, textAlign: 'left', marginTop: 10 }}
        placeholder="Notes (optional)"
        maxLength={1000}
        value={notes}
        onChange={e => onNotes(e.target.value)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>How hard was this block? (RPE 1–10)</span>
        <select
          value={rpe}
          onChange={e => onRpe(e.target.value)}
          style={{ ...inputStyle, width: 72, padding: '8px 4px' }}
        >
          <option value="">—</option>
          {Array.from({ length: 10 }, (_, i) => String(i + 1)).map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
      <button type="button" className="auth-btn" style={{ width: '100%', marginTop: 8 }} onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save block'}
      </button>
    </>
  );
}
const useChecked = () => {
  const [checked, setChecked] = useState<Record<string, string[]>>({});
  const toggle = (key: string, fault: string) => setChecked(prev => {
    const cur = prev[key] ?? [];
    return { ...prev, [key]: cur.includes(fault) ? cur.filter(f => f !== fault) : [...cur, fault] };
  });
  return { checked, toggle };
};

// ── Shared per-set grid: strength / skills / accessory ──
// A row is a set, prefilled from the prescription. showWeight adds the load
// column (strength + accessory); skills is bodyweight/technique work.
function PerSetLog({ block, controller, coaching, label, type, showWeight, faultsPerMovement }: {
  block: ProgramBlockV2;
  controller: DayLogController;
  coaching: ReviewBlock | null;
  label: string;
  type: string;
  showWeight: boolean;
  faultsPerMovement: boolean;
}) {
  const saving = controller.saving === block.sort_order;
  const initial = useMemo(() => {
    const rows: Record<string, { weight: string; value: string }> = {};
    for (const m of block.movements) {
      const { count, prefill } = plannedSets(m);
      for (let i = 0; i < count; i++) {
        rows[`${m.id}-${i}`] = {
          weight: m.weight != null ? String(m.weight) : '',
          value: prefill[i] != null ? String(prefill[i]) : '',
        };
      }
    }
    return rows;
  }, [block]);
  const [vals, setVals] = useState(initial);
  const [blockRpe, setBlockRpe] = useState('');
  const [notes, setNotes] = useState('');
  const set = (k: string, f: 'weight' | 'value', v: string) => setVals(p => ({ ...p, [k]: { ...p[k], [f]: v } }));
  const { checked, toggle } = useChecked();
  const sharedFaults = faultsPerMovement ? [] : blockFaults(coaching, block.movements);

  const save = () => {
    const blockFaultsChecked = checked['block'] ?? [];
    const entries: LogEntry[] = [];
    for (const m of block.movements) {
      const { kind, count, prefill } = plannedSets(m);
      const movementFaults = faultsPerMovement ? (checked[m.id] ?? []) : blockFaultsChecked;
      for (let i = 0; i < count; i++) {
        const r = vals[`${m.id}-${i}`] ?? { weight: '', value: '' };
        const v = kind === 'distance' ? numOrNull(r.value) : intOrNull(r.value);
        entries.push(emptyEntry(m.movement, {
          sets: 1,
          set_number: i + 1,
          reps: kind === 'reps' ? v : null,
          hold_seconds: kind === 'seconds' ? v : null,
          distance: kind === 'distance' ? v : null,
          distance_unit: kind === 'distance' ? (m.distance_unit ?? null) : null,
          weight: showWeight ? numOrNull(r.weight) : null,
          weight_unit: m.weight_unit || controller.userUnits,
          faults_observed: movementFaults.length ? movementFaults : null,
          prescribed_weight: m.weight ?? null,
          // Per-set prescription (was the movement's TOTAL pre-redesign, which
          // made every logged set read as an 80% miss to any comparer).
          prescribed_reps: kind === 'reps' ? (prefill[i] ?? null) : null,
        }));
      }
    }
    controller.saveBlock({
      label: block.block_label || label, type, text: blockText(block), score: null, rx: false, notes: notes.trim() || null,
      sort_order: block.sort_order, entries, capped: false, capped_reps: null, rpe: numOrNull(blockRpe),
    });
  };

  const cols = showWeight ? '28px 1fr 1fr' : '28px 1fr';
  return (
    <div className="block-log" style={wrapStyle}>
      {block.movements.map((m) => {
        const { count, unitLabel } = plannedSets(m);
        const faults = faultsPerMovement ? faultsForMovement(coaching, m.movement) : [];
        return (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{formatMovementName(m.movement)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, alignItems: 'center' }}>
              <span />
              {showWeight && <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{controller.userUnits}</span>}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{unitLabel}</span>
              {Array.from({ length: count }, (_, i) => {
                const k = `${m.id}-${i}`; const r = vals[k] ?? { weight: '', value: '' };
                return (
                  <>
                    <span key={`${k}-l`} style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>S{i + 1}</span>
                    {showWeight && <input key={`${k}-w`} style={inputStyle} inputMode="decimal" value={r.weight} onChange={e => set(k, 'weight', e.target.value)} />}
                    <input key={`${k}-v`} style={inputStyle} inputMode="decimal" value={r.value} onChange={e => set(k, 'value', e.target.value)} />
                  </>
                );
              })}
            </div>
            {faultsPerMovement && <FaultChecklist faults={faults} checked={checked[m.id] ?? []} onToggle={(f) => toggle(m.id, f)} />}
          </div>
        );
      })}
      {!faultsPerMovement && <FaultChecklist faults={sharedFaults} checked={checked['block'] ?? []} onToggle={(f) => toggle('block', f)} />}
      <SaveButton saving={saving} onSave={save} rpe={blockRpe} onRpe={setBlockRpe} notes={notes} onNotes={setNotes} />
    </div>
  );
}

// ── Metcon: one result (time or rounds+reps), capped + block faults ──
// No Rx checkbox: these are personal programs — editing the prescription IS
// the scaling mechanism, so "as prescribed" is a tautology. The rx column
// stays in the schema (always false) for a future group-program world.
function MetconLog({ block, controller, coaching }: { block: ProgramBlockV2; controller: DayLogController; coaching: ReviewBlock | null }) {
  const saving = controller.saving === block.sort_order;
  const [score, setScore] = useState('');
  const [capped, setCapped] = useState(false);
  const [cappedReps, setCappedReps] = useState('');
  const [notes, setNotes] = useState('');
  const [blockRpe, setBlockRpe] = useState('');
  const { checked, toggle } = useChecked();
  // "Hit the cap" only applies to for-time work; AMRAP/EMOM score IS rounds+reps.
  const isForTime = inferMetconType(block) === 'for_time';
  const roundSize = metconRoundSize(block);
  const capTotal = capped ? parseCapProgress(cappedReps, roundSize) : null;
  const save = () => {
    const entries: LogEntry[] = block.movements.map((m) => {
      const isCal = m.calories != null && m.calories > 0;
      const f = checked[m.id] ?? [];
      return emptyEntry(m.movement, {
        // Calories are calories — never reps with a phantom unit. (The old
        // smuggled encoding is backfilled by the logging-fidelity migration.)
        reps: isCal ? null : (m.reps ?? null),
        calories: isCal ? (m.calories ?? null) : null,
        weight: m.weight ?? null, weight_unit: m.weight_unit || controller.userUnits,
        distance: isCal ? null : (m.distance ?? null), distance_unit: isCal ? null : (m.distance_unit ?? null),
        faults_observed: f.length ? f : null,
        prescribed_weight: m.weight ?? null, prescribed_reps: isCal ? null : (m.reps ?? null),
      });
    });
    const benchmark = reshapeBenchmark(block.expected_benchmark);
    const wType = inferMetconType(block);
    const text = [block.block_scheme, block.block_label].filter(Boolean).join('\n');
    const scoring = !capped && score.trim() && benchmark ? scoreMetcon(score.trim(), wType, benchmark) : null;
    // Capped: the athlete's time IS the cap — save it as the score so a capped
    // workout is distinguishable from an unlogged one. capped:true marks it.
    const cappedScore = block.time_cap_seconds != null ? formatClock(block.time_cap_seconds) : null;
    controller.saveBlock({
      label: block.block_label || 'Metcon', type: 'metcon', text: blockText(block),
      score: capped ? cappedScore : (score.trim() || null), rx: false, notes: notes.trim() || null,
      sort_order: block.sort_order, entries, capped, capped_reps: capped ? capTotal : null,
      rpe: numOrNull(blockRpe),
      block_scheme: block.block_scheme, time_cap_seconds: block.time_cap_seconds,
      percentile: scoring?.percentile ?? null, performance_tier: scoring?.performanceTier ?? null,
      median_benchmark: benchmark && benchmark.medianScore !== '--' ? benchmark.medianScore : null,
      excellent_benchmark: benchmark && benchmark.excellentScore !== '--' ? benchmark.excellentScore : null,
      time_domain: deriveTimeDomain(wType, text, benchmark?.medianScore ?? null),
    });
  };
  return (
    <div className="block-log" style={wrapStyle}>
      {!capped && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{isForTime ? 'Result (time)' : 'Result (rounds + reps)'}</div>
          <input style={{ ...inputStyle, textAlign: 'left' }} placeholder={isForTime ? 'e.g. 12:34' : 'e.g. 5+18'} value={score} onChange={e => setScore(e.target.value)} />
        </div>
      )}
      {isForTime && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={capped} onChange={e => setCapped(e.target.checked)} /> Hit the cap</label>
          {capped && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input
                style={{ ...inputStyle, width: 140 }}
                placeholder={roundSize != null ? 'e.g. 4+7 or total reps' : 'total reps done'}
                value={cappedReps}
                onChange={e => setCappedReps(e.target.value)}
              />
              {capTotal != null && cappedReps.includes('+') && (
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>= {capTotal} reps</span>
              )}
            </span>
          )}
        </div>
      )}
      {block.movements.map((m) => {
        const mFaults = faultsForMovement(coaching, m.movement);
        if (!mFaults.length) return null;
        return (
          <div key={m.id} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{formatMovementName(m.movement)}</div>
            <FaultChecklist faults={mFaults} checked={checked[m.id] ?? []} onToggle={(f) => toggle(m.id, f)} />
          </div>
        );
      })}
      <SaveButton saving={saving} onSave={save} rpe={blockRpe} onRpe={setBlockRpe} notes={notes} onNotes={setNotes} />
    </div>
  );
}

// ── Cardio: machine avg watts + work time (power) ──
function CardioLog({ block, controller }: { block: ProgramBlockV2; controller: DayLogController }) {
  const saving = controller.saving === block.sort_order;
  const [watts, setWatts] = useState('');
  const [time, setTime] = useState('');
  const [blockRpe, setBlockRpe] = useState('');
  const [notes, setNotes] = useState('');
  const save = () => {
    const entries: LogEntry[] = block.movements.map((m) => emptyEntry(m.movement, { distance: m.distance ?? null, distance_unit: m.distance_unit ?? null }));
    controller.saveBlock({
      label: block.block_label || 'Cardio', type: 'cardio', text: blockText(block), score: null, rx: false, notes: notes.trim() || null,
      sort_order: block.sort_order, entries, capped: false, capped_reps: null, rpe: numOrNull(blockRpe),
      cardio_avg_watts: numOrNull(watts), cardio_work_seconds: parseClock(time), cardio_modality: null,
    });
  };
  return (
    <div className="block-log" style={wrapStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Avg watts</div><input style={inputStyle} inputMode="decimal" placeholder="watts" value={watts} onChange={e => setWatts(e.target.value)} /></div>
        <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Work time</div><input style={inputStyle} placeholder="mm:ss" value={time} onChange={e => setTime(e.target.value)} /></div>
      </div>
      <SaveButton saving={saving} onSave={save} rpe={blockRpe} onRpe={setBlockRpe} notes={notes} onNotes={setNotes} />
    </div>
  );
}

// ── Dispatcher ──
function renderWorld(block: ProgramBlockV2, controller: DayLogController, coaching: ReviewBlock | null) {
  switch (block.block_type) {
    case 'strength':
      return <PerSetLog block={block} controller={controller} coaching={coaching} label="Strength" type="strength" showWeight faultsPerMovement={false} />;
    case 'metcon':
      return <MetconLog block={block} controller={controller} coaching={coaching} />;
    case 'skills':
      return <PerSetLog block={block} controller={controller} coaching={coaching} label="Skills" type="skills" showWeight={false} faultsPerMovement />;
    case 'accessory':
      return <PerSetLog block={block} controller={controller} coaching={coaching} label="Accessory" type="accessory" showWeight faultsPerMovement />;
    case 'cardio':
      return <CardioLog block={block} controller={controller} />;
    default: return null;
  }
}
const LOGGABLE_TYPES = ['strength', 'metcon', 'skills', 'accessory', 'cardio'];

export default function BlockLog({ block, controller, coaching, onEnsureCoaching }: {
  block: ProgramBlockV2;
  controller: DayLogController;
  coaching?: ReviewBlock | null;
  onEnsureCoaching?: () => void;
}) {
  // Collapsed by default — the day reads as a workout; you open the block you're
  // doing, log it, and it collapses to "✓ Logged". Each block opens independently.
  const [open, setOpen] = useState(false);
  if (!LOGGABLE_TYPES.includes(block.block_type)) return null;

  if (controller.isSaved(block.sort_order)) {
    return <SavedBadge onEdit={() => { controller.reopen(block.sort_order); setOpen(true); }} />;
  }
  if (!open) {
    return (
      <div style={{ textAlign: 'center', marginTop: 10 }}>
        <button
          type="button"
          onClick={() => { setOpen(true); onEnsureCoaching?.(); }}
          style={{ padding: '7px 14px', background: 'transparent', border: '1px solid #ffffff', borderRadius: 8, color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Outfit', sans-serif" }}
        >
          Log block
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer', marginTop: 10, padding: '4px 0', fontFamily: "'Outfit', sans-serif" }}
      >
        Log
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
      </button>
      {renderWorld(block, controller, coaching ?? null)}
    </div>
  );
}
