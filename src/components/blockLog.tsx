// Per-block-type logging UI that lands on the V3 day cards. Each block type is
// its own little world; BlockLog dispatches to the right one. The day page owns a
// DayLogController (in-progress log id, saved-state, save via save-workout-block);
// each world reads the prescription off the block and collects actuals.
//
// Rx-first redesign (2026-09): logging is a claim, so the UI collects explicit
// claims instead of prefilled form data.
//  - The panel opens as CONFIRMATION: each task (movement, or the whole piece
//    for metcons; all movements for strength — a complex is one bar cycle)
//    shows its prescription read-only with an Rx / Edit choice. Rx asserts
//    "did exactly this"; Edit opens that task's rows for what changed.
//    Save stays disabled until every task is answered — an untouched form
//    can never write data.
//  - No Skip button (2026-09 polish): a user who skips a block is not a user
//    who wants to tap more buttons, and doctrine already guarantees an
//    unlogged block sends NO signal (the previous-cycle summary removed
//    completion_pct/skip_pct precisely so non-loggers are never punished).
//    The 'block_skipped' badge/history handling stays for legacy rows.
//  - Faults are self-report chips under "Anything break down?" — orthogonal
//    to Rx: you can hit every number and still grind.
//  - Effort is ONE question per block, a +/- stepper saved on
//    workout_log_blocks.rpe. Untouched → null, never an echoed prescription.
//  - The collapsed card shows status after save: ✓ Rx · RPE 8 / ✓ Modified ·
//    RPE 7 / Skipped — the day becomes a scannable summary of the session.
//  - blocks.rx finally carries signal: true = every task Rx'd via the
//    as-written path (it was parked always-false since the Rx checkbox was
//    removed as a tautology).
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

/** Collapsed-card status for a saved block — what the badge renders from. */
export interface SavedBlockMeta {
  rx: boolean;
  rpe: number | null;
  skipped: boolean;
}

export interface DayLogController {
  workoutDate: string;
  userUnits: 'lbs' | 'kg';
  isSaved: (sortOrder: number) => boolean;
  saving: number | null;
  saveBlock: (block: SaveBlockPayload) => Promise<{ auto_completed?: boolean } | null>;
  reopen: (sortOrder: number) => void;
  /** Status of a saved block for the collapsed badge; null/absent → plain "Logged". */
  savedMeta?: (sortOrder: number) => SavedBlockMeta | null;
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

// ── Fault chips: self-reports, not coaching cues ──
// Tapped = "yes, this happened." Saved onto faults_observed. Orthogonal to
// Rx — hitting every number ugly is still worth reporting.
function FaultChips({ faults, checked, onToggle }: { faults: string[]; checked: string[]; onToggle: (f: string) => void }) {
  if (faults.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {faults.map(f => {
          const on = checked.includes(f);
          return (
            <button
              key={f}
              type="button"
              onClick={() => onToggle(f)}
              style={{
                padding: '5px 10px', fontSize: 12, lineHeight: 1.35, borderRadius: 14, cursor: 'pointer',
                textAlign: 'left', fontFamily: "'Outfit', sans-serif",
                background: on ? 'rgba(231, 76, 60, 0.15)' : 'var(--surface)',
                border: `1px solid ${on ? 'var(--danger, #e74c3c)' : 'var(--border)'}`,
                color: on ? 'var(--danger, #e74c3c)' : 'var(--text-dim)',
              }}
            >
              {f}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Rx / Modify choice, one per task ──
// Styled like the Log block button (white text, white outline) so the two
// controls the panel is gated on read as pressable, not disabled; the chosen
// one flips to the accent. "Modify" — not "Edit" — because the card's own
// Edit button changes the PRESCRIPTION; this one records that YOU deviated.
type TaskMode = 'rx' | 'edit' | null;
function RxModifyChoice({ mode, onRx, onModify }: { mode: TaskMode; onRx: () => void; onModify: () => void }) {
  const btn = (active: boolean): React.CSSProperties => ({
    padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    fontFamily: "'Outfit', sans-serif", borderRadius: 8,
    background: active ? 'var(--accent-dim, rgba(255,77,77,0.12))' : 'transparent',
    border: `1px solid ${active ? 'var(--accent)' : '#ffffff'}`,
    color: active ? 'var(--accent)' : 'var(--text)',
  });
  return (
    <span style={{ display: 'inline-flex', gap: 8, flexShrink: 0 }}>
      <button type="button" style={btn(mode === 'rx')} onClick={onRx}>
        {mode === 'rx' ? '✓ Rx' : 'Rx'}
      </button>
      <button type="button" style={btn(mode === 'edit')} onClick={onModify}>
        {mode === 'edit' ? '✓ Modify' : 'Modify'}
      </button>
    </span>
  );
}

/** Compact one-line prescription summary — the card above already lists the
 *  work, so the confirmation view names it in one breath ("3×10 @ 50 lbs")
 *  instead of repeating every set as a row. Rows appear only under Modify. */
function prescriptionSummary(m: ProgramMovementV2, showWeight: boolean, units: string): string {
  const { count, prefill, unitLabel } = plannedSets(m);
  const vals = prefill.filter((v): v is number => v != null);
  let core: string;
  if (vals.length === 0) {
    core = `${count} set${count === 1 ? '' : 's'}`;
  } else if (vals.length === count && vals.every(v => v === vals[0])) {
    core = unitLabel === 'reps' ? `${count}×${vals[0]}` : `${count}×${vals[0]}${unitLabel === 'sec' ? 's' : unitLabel}`;
  } else {
    core = vals.join('-');
  }
  if (showWeight && m.weight != null) core += ` @ ${m.weight} ${m.weight_unit || units}`;
  return core;
}

/** Fault chips folded behind a "Common faults" disclosure — exception-path
 *  input shouldn't occupy half the panel at rest. */
function FaultsDisclosure({ children, count }: { children: React.ReactNode; count: number }) {
  const [openFaults, setOpenFaults] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpenFaults(o => !o)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: count > 0 ? 'var(--danger, #e74c3c)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, fontFamily: "'Outfit', sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5 }}
      >
        Common faults{count > 0 ? ` (${count})` : ''}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: openFaults ? 'rotate(180deg)' : 'none' }}><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {openFaults && children}
    </div>
  );
}

// ── RPE stepper: the one effort question per block ──
// Starts unset ("—") and saves null when untouched — effort is asserted, never
// prefilled (per-set RPE was prescription-prefilled noise; this is the fix's
// block-level descendant). First tap lands mid-scale at 5.
function RpeStepper({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const bump = (d: number) => {
    if (value == null) { onChange(5); return; }
    onChange(Math.min(10, Math.max(1, value + d)));
  };
  const stepBtn: React.CSSProperties = {
    width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text)', fontSize: 18, fontWeight: 700, cursor: 'pointer', fontFamily: "'Outfit', sans-serif",
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>How hard was this block? (RPE 1–10)</span>
      <button type="button" style={stepBtn} onClick={() => bump(-1)} aria-label="Lower RPE">−</button>
      <span style={{ width: 28, textAlign: 'center', fontSize: 16, fontWeight: 700, color: value != null ? 'var(--text)' : 'var(--text-muted)' }}>
        {value ?? '—'}
      </span>
      <button type="button" style={stepBtn} onClick={() => bump(1)} aria-label="Raise RPE">+</button>
    </div>
  );
}

/** Notes + RPE + Save — the block-level tail of every panel. Save is gated by
 *  the panel (every task answered) so an untouched form can't write data. */
function SaveFooter({ saving, canSave, onSave, rpe, onRpe, notes, onNotes }: {
  saving: boolean; canSave: boolean;
  onSave: () => void; rpe: number | null; onRpe: (v: number | null) => void;
  notes: string; onNotes: (v: string) => void;
}) {
  return (
    <>
      <RpeStepper value={rpe} onChange={onRpe} />
      <input
        style={{ ...inputStyle, textAlign: 'left', marginTop: 10 }}
        placeholder="Notes (optional)"
        maxLength={1000}
        value={notes}
        onChange={e => onNotes(e.target.value)}
      />
      <button type="button" className="auth-btn" style={{ width: '100%', marginTop: 8, opacity: canSave ? 1 : 0.5 }} onClick={onSave} disabled={saving || !canSave}>
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

// ── Editable rows for a movement (the Edit path) ──
// A row is a set, prefilled from the prescription; ✕ marks a set skipped
// (saved completed:false — "planned 5, did 4" stays legible downstream).
type RowState = { weight: string; value: string; skipped: boolean };
function EditableRows({ m, rows, showWeight, units, onRow }: {
  m: ProgramMovementV2; rows: RowState[]; showWeight: boolean; units: string;
  onRow: (i: number, patch: Partial<RowState>) => void;
}) {
  const { count, unitLabel } = plannedSets(m);
  const iconBtn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', padding: 4,
    color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', flexShrink: 0,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: count }, (_, i) => {
        const r = rows[i] ?? { weight: '', value: '', skipped: false };
        if (r.skipped) {
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, cursor: 'pointer' }} onClick={() => onRow(i, { skipped: false })}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, width: 24, flexShrink: 0 }}>S{i + 1}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                {showWeight && r.weight ? `${r.weight} ${units} × ` : ''}{r.value || '—'} {unitLabel}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>skipped — tap to restore</span>
            </div>
          );
        }
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34 }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, width: 24, flexShrink: 0 }}>S{i + 1}</span>
            {showWeight && <input style={{ ...inputStyle, flex: 1 }} inputMode="decimal" placeholder={units} value={r.weight} onChange={e => onRow(i, { weight: e.target.value })} />}
            <input style={{ ...inputStyle, flex: 1 }} inputMode="decimal" placeholder={unitLabel} value={r.value} onChange={e => onRow(i, { value: e.target.value })} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{unitLabel}</span>
            <button type="button" style={iconBtn} title="Skip this set" onClick={() => onRow(i, { skipped: true })}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Strength / skills / accessory: Rx-first per task ──
// A TASK is one movement for skills/accessory; ALL movements for strength
// (a complex is one bar cycle — you can't Rx the clean but edit the front
// squat of the same complex). Each task shows its prescription read-only
// with an Rx/Edit choice; faults sit per task (skills/accessory) or on the
// block (strength); RPE + notes + Save close the block.
function PerTaskLog({ block, controller, coaching, label, type, showWeight, faultsPerMovement }: {
  block: ProgramBlockV2;
  controller: DayLogController;
  coaching: ReviewBlock | null;
  label: string;
  type: string;
  showWeight: boolean;
  faultsPerMovement: boolean;
}) {
  const saving = controller.saving === block.sort_order;
  // strength → one task with every movement; others → one task per movement.
  const tasks: ProgramMovementV2[][] = useMemo(
    () => (type === 'strength' ? [block.movements] : block.movements.map(m => [m])),
    [block, type],
  );
  const taskKey = (t: ProgramMovementV2[]) => t.map(m => m.id).join('+');

  const initialRows = useMemo(() => {
    const rows: Record<string, RowState[]> = {};
    for (const m of block.movements) {
      const { count, prefill } = plannedSets(m);
      rows[m.id] = Array.from({ length: count }, (_, i) => ({
        weight: m.weight != null ? String(m.weight) : '',
        value: prefill[i] != null ? String(prefill[i]) : '',
        skipped: false,
      }));
    }
    return rows;
  }, [block]);
  const [rows, setRows] = useState(initialRows);
  const [modes, setModes] = useState<Record<string, TaskMode>>({});
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const { checked, toggle } = useChecked();
  const sharedFaults = faultsPerMovement ? [] : blockFaults(coaching, block.movements);

  const setRow = (mId: string, i: number, patch: Partial<RowState>) =>
    setRows(prev => ({ ...prev, [mId]: prev[mId].map((r, k) => (k === i ? { ...r, ...patch } : r)) }));

  const allAnswered = tasks.every(t => modes[taskKey(t)] != null);

  const save = () => {
    const blockFaultsChecked = checked['block'] ?? [];
    const entries: LogEntry[] = [];
    for (const t of tasks) {
      const mode = modes[taskKey(t)];
      for (const m of t) {
        const { kind, count, prefill } = plannedSets(m);
        const movementFaults = faultsPerMovement ? (checked[m.id] ?? []) : blockFaultsChecked;
        for (let i = 0; i < count; i++) {
          const prescribed = {
            prescribed_weight: m.weight ?? null,
            prescribed_reps: kind === 'reps' ? (prefill[i] ?? null) : null,
          };
          const r = rows[m.id]?.[i] ?? { weight: '', value: '', skipped: false };
          if (mode === 'edit' && r.skipped) {
            // Recorded, not omitted: null actuals keep it out of e1RM/volume/
            // hit-rate math; completed:false makes the skip itself the signal.
            entries.push(emptyEntry(m.movement, {
              sets: 1, set_number: i + 1, completed: false, skip_reason: 'skipped',
              weight_unit: m.weight_unit || controller.userUnits, ...prescribed,
            }));
            continue;
          }
          // Rx → the prescription IS the actual (that's the claim being made).
          // Edit → whatever the inputs hold.
          const weightStr = mode === 'rx' ? (m.weight != null ? String(m.weight) : '') : r.weight;
          const valueStr = mode === 'rx' ? (prefill[i] != null ? String(prefill[i]) : '') : r.value;
          const v = kind === 'distance' ? numOrNull(valueStr) : intOrNull(valueStr);
          entries.push(emptyEntry(m.movement, {
            sets: 1,
            set_number: i + 1,
            reps: kind === 'reps' ? v : null,
            hold_seconds: kind === 'seconds' ? v : null,
            distance: kind === 'distance' ? v : null,
            distance_unit: kind === 'distance' ? (m.distance_unit ?? null) : null,
            weight: showWeight ? numOrNull(weightStr) : null,
            weight_unit: m.weight_unit || controller.userUnits,
            faults_observed: movementFaults.length ? movementFaults : null,
            ...prescribed,
          }));
        }
      }
    }
    controller.saveBlock({
      label: block.block_label || label, type, text: blockText(block), score: null,
      rx: tasks.every(t => modes[taskKey(t)] === 'rx'),
      notes: notes.trim() || null,
      sort_order: block.sort_order, entries, capped: false, capped_reps: null, rpe,
    });
  };

  // Faults for the whole panel fold behind ONE disclosure (per-movement
  // chips grouped inside it) — exception-path input, closed at rest.
  const taskFaults = (t: ProgramMovementV2[]) =>
    t.flatMap((m) => faultsForMovement(coaching, m.movement));
  const anyFaults = faultsPerMovement
    ? tasks.some(t => taskFaults(t).length > 0)
    : sharedFaults.length > 0;
  const checkedCount = Object.values(checked).reduce((n, arr) => n + arr.length, 0);

  return (
    <div className="block-log" style={wrapStyle}>
      {tasks.map((t) => {
        const k = taskKey(t);
        const mode = modes[k] ?? null;
        const choice = (
          <RxModifyChoice
            mode={mode}
            onRx={() => setModes(p => ({ ...p, [k]: 'rx' }))}
            onModify={() => setModes(p => ({ ...p, [k]: 'edit' }))}
          />
        );
        // Single-movement task: one line — "Name · 3×10 @ 50 lbs   [Rx][Modify]".
        // Multi-movement (strength complex): a summary line per movement, one
        // choice for the group. Modify expands rows in place; Rx collapses back.
        return (
          <div key={k} style={{ marginBottom: 12 }}>
            {t.length === 1 ? (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{formatMovementName(t[0].movement)}</span>
                  <span style={{ color: 'var(--text-dim)' }}> · {prescriptionSummary(t[0], showWeight, controller.userUnits)}</span>
                </span>
                {choice}
              </div>
            ) : (
              <>
                {t.map((m) => (
                  <div key={m.id} style={{ fontSize: 13, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600 }}>{formatMovementName(m.movement)}</span>
                    <span style={{ color: 'var(--text-dim)' }}> · {prescriptionSummary(m, showWeight, controller.userUnits)}</span>
                  </div>
                ))}
                <div style={{ marginTop: 6 }}>{choice}</div>
              </>
            )}
            {mode === 'edit' && t.map((m) => (
              <div key={m.id} style={{ marginTop: 8 }}>
                {t.length > 1 && <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-dim)' }}>{formatMovementName(m.movement)}</div>}
                <EditableRows m={m} rows={rows[m.id] ?? []} showWeight={showWeight} units={controller.userUnits} onRow={(i, p) => setRow(m.id, i, p)} />
              </div>
            ))}
          </div>
        );
      })}
      {anyFaults && (
        <FaultsDisclosure count={checkedCount}>
          {faultsPerMovement
            ? tasks.map(t => t.map((m) => {
                const f = faultsForMovement(coaching, m.movement);
                if (!f.length) return null;
                return (
                  <div key={m.id} style={{ marginTop: 6 }}>
                    {tasks.length > 1 && <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{formatMovementName(m.movement)}</div>}
                    <FaultChips faults={f} checked={checked[m.id] ?? []} onToggle={(x) => toggle(m.id, x)} />
                  </div>
                );
              }))
            : <FaultChips faults={sharedFaults} checked={checked['block'] ?? []} onToggle={(f) => toggle('block', f)} />}
        </FaultsDisclosure>
      )}
      <SaveFooter
        saving={saving}
        canSave={allAnswered}
        onSave={save} rpe={rpe} onRpe={setRpe} notes={notes} onNotes={setNotes}
      />
    </div>
  );
}

// ── Metcon: one entity — score + Rx/Edit for the piece + faults + RPE ──
// No Rx *checkbox* ambiguity anymore: Rx is the athlete's explicit claim
// ("did the piece as written"); Edit opens per-movement actuals for what
// changed (scaled the cleans, subbed a movement's volume). The score is the
// result either way.
function MetconLog({ block, controller, coaching }: { block: ProgramBlockV2; controller: DayLogController; coaching: ReviewBlock | null }) {
  const saving = controller.saving === block.sort_order;
  const [score, setScore] = useState('');
  const [capped, setCapped] = useState(false);
  const [cappedReps, setCappedReps] = useState('');
  const [notes, setNotes] = useState('');
  const [rpe, setRpe] = useState<number | null>(null);
  const [mode, setMode] = useState<TaskMode>(null);
  const { checked, toggle } = useChecked();
  // Per-movement actuals for the Edit path: one row per movement, prefilled.
  const initialActuals = useMemo(() => {
    const a: Record<string, { weight: string; value: string }> = {};
    for (const m of block.movements) {
      const isCal = m.calories != null && m.calories > 0;
      a[m.id] = {
        weight: m.weight != null ? String(m.weight) : '',
        value: isCal ? String(m.calories) : m.reps != null ? String(m.reps) : m.distance != null ? String(m.distance) : '',
      };
    }
    return a;
  }, [block]);
  const [actuals, setActuals] = useState(initialActuals);
  // "Hit the cap" only applies to for-time work; AMRAP/EMOM score IS rounds+reps.
  const isForTime = inferMetconType(block) === 'for_time';
  const roundSize = metconRoundSize(block);
  const capTotal = capped ? parseCapProgress(cappedReps, roundSize) : null;
  const save = () => {
    const entries: LogEntry[] = block.movements.map((m) => {
      const isCal = m.calories != null && m.calories > 0;
      const f = checked[m.id] ?? [];
      const a = actuals[m.id] ?? { weight: '', value: '' };
      const useEdited = mode === 'edit';
      const editedVal = numOrNull(a.value);
      return emptyEntry(m.movement, {
        // Calories are calories — never reps with a phantom unit.
        reps: isCal ? null : (useEdited ? (Number.isInteger(editedVal) ? editedVal : intOrNull(a.value)) : (m.reps ?? null)),
        calories: isCal ? (useEdited ? editedVal : (m.calories ?? null)) : null,
        weight: useEdited ? numOrNull(a.weight) : (m.weight ?? null),
        weight_unit: m.weight_unit || controller.userUnits,
        distance: isCal ? null : (useEdited && m.distance != null ? editedVal : (m.distance ?? null)),
        distance_unit: isCal ? null : (m.distance_unit ?? null),
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
      score: capped ? cappedScore : (score.trim() || null), rx: mode === 'rx', notes: notes.trim() || null,
      sort_order: block.sort_order, entries, capped, capped_reps: capped ? capTotal : null,
      rpe,
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
      {mode === 'edit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
          {block.movements.map((m) => {
            const isCal = m.calories != null && m.calories > 0;
            const a = actuals[m.id] ?? { weight: '', value: '' };
            const unit = isCal ? 'cal' : m.distance != null ? (m.distance_unit || 'dist') : 'reps';
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{formatMovementName(m.movement)}</span>
                {m.weight != null && (
                  <input style={{ ...inputStyle, width: 72 }} inputMode="decimal" placeholder={controller.userUnits}
                    value={a.weight} onChange={e => setActuals(p => ({ ...p, [m.id]: { ...p[m.id], weight: e.target.value } }))} />
                )}
                <input style={{ ...inputStyle, width: 72 }} inputMode="decimal" placeholder={unit}
                  value={a.value} onChange={e => setActuals(p => ({ ...p, [m.id]: { ...p[m.id], value: e.target.value } }))} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{unit}</span>
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Per-round numbers — record what you actually did.</div>
        </div>
      )}
      <div style={{ marginTop: 4 }}>
        <RxModifyChoice mode={mode} onRx={() => setMode('rx')} onModify={() => setMode('edit')} />
      </div>
      {block.movements.some((m) => faultsForMovement(coaching, m.movement).length > 0) && (
        <FaultsDisclosure count={Object.values(checked).reduce((n, arr) => n + arr.length, 0)}>
          {block.movements.map((m) => {
            const mFaults = faultsForMovement(coaching, m.movement);
            if (!mFaults.length) return null;
            return (
              <div key={m.id} style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{formatMovementName(m.movement)}</div>
                <FaultChips faults={mFaults} checked={checked[m.id] ?? []} onToggle={(f) => toggle(m.id, f)} />
              </div>
            );
          })}
        </FaultsDisclosure>
      )}
      <SaveFooter
        saving={saving}
        canSave={mode != null}
        onSave={save} rpe={rpe} onRpe={setRpe} notes={notes} onNotes={setNotes}
      />
    </div>
  );
}

// ── Cardio: machine avg watts + work time (power) ──
// The actuals are inherently manual (no prescription can prefill your output),
// so cardio keeps its two fields; Rx/Edit would have nothing to claim beyond
// them. Gate: at least one field entered.
function CardioLog({ block, controller }: { block: ProgramBlockV2; controller: DayLogController }) {
  const saving = controller.saving === block.sort_order;
  const [watts, setWatts] = useState('');
  const [time, setTime] = useState('');
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const save = () => {
    const entries: LogEntry[] = block.movements.map((m) => emptyEntry(m.movement, { distance: m.distance ?? null, distance_unit: m.distance_unit ?? null }));
    controller.saveBlock({
      label: block.block_label || 'Cardio', type: 'cardio', text: blockText(block), score: null, rx: false, notes: notes.trim() || null,
      sort_order: block.sort_order, entries, capped: false, capped_reps: null, rpe,
      cardio_avg_watts: numOrNull(watts), cardio_work_seconds: parseClock(time), cardio_modality: null,
    });
  };
  const canSave = watts.trim() !== '' || time.trim() !== '';
  return (
    <div className="block-log" style={wrapStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Avg watts</div><input style={inputStyle} inputMode="decimal" placeholder="watts" value={watts} onChange={e => setWatts(e.target.value)} /></div>
        <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Work time</div><input style={inputStyle} placeholder="mm:ss" value={time} onChange={e => setTime(e.target.value)} /></div>
      </div>
      <SaveFooter
        saving={saving}
        canSave={canSave}
        onSave={save} rpe={rpe} onRpe={setRpe} notes={notes} onNotes={setNotes}
      />
    </div>
  );
}

// ── Saved badge: the collapsed card becomes a status line ──
function SavedBadge({ meta, onEdit }: { meta: SavedBlockMeta | null; onEdit: () => void }) {
  const label = meta?.skipped
    ? 'Skipped'
    : `${meta?.rx ? 'Rx' : meta ? 'Modified' : 'Logged'}${meta?.rpe != null ? ` · RPE ${meta.rpe}` : ''}`;
  const skipped = meta?.skipped === true;
  return (
    <div className="block-log" style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: skipped ? 'var(--text-muted)' : 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {!skipped && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        )}
        {label}
      </span>
      <button type="button" className="block-ai-edit-toggle" onClick={onEdit}>Edit</button>
    </div>
  );
}

// ── Dispatcher ──
function renderWorld(block: ProgramBlockV2, controller: DayLogController, coaching: ReviewBlock | null) {
  switch (block.block_type) {
    case 'strength':
      return <PerTaskLog block={block} controller={controller} coaching={coaching} label="Strength" type="strength" showWeight faultsPerMovement={false} />;
    case 'metcon':
      return <MetconLog block={block} controller={controller} coaching={coaching} />;
    case 'skills':
      return <PerTaskLog block={block} controller={controller} coaching={coaching} label="Skills" type="skills" showWeight={false} faultsPerMovement />;
    case 'accessory':
      return <PerTaskLog block={block} controller={controller} coaching={coaching} label="Accessory" type="accessory" showWeight faultsPerMovement />;
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
  // doing, log it, and it collapses to a status line. Each block opens independently.
  const [open, setOpen] = useState(false);
  if (!LOGGABLE_TYPES.includes(block.block_type)) return null;

  if (controller.isSaved(block.sort_order)) {
    return <SavedBadge meta={controller.savedMeta?.(block.sort_order) ?? null} onEdit={() => { controller.reopen(block.sort_order); setOpen(true); }} />;
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
