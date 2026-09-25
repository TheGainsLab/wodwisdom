// Per-block-type logging UI that lands on the V3 day cards. Each block type is
// its own little world; BlockLog dispatches to the right one. The day page owns a
// DayLogController (in-progress log id, saved-state, save via save-workout-block);
// each world reads the prescription off the block and collects actuals.
//
// Rows-as-logger (2026-09, designed live against the mock with the founder):
//  - Tap "Log block" and THE PLAN ROWS BECOME THE LOG ROWS: BlockLog renders
//    the same movement rows the card shows (same formatter — prescriptionText
//    — so plan and log can never disagree), each with its own Rx / Modify
//    pair, per-exercise RPE stepper, and "Notes for the coach" fault chips.
//    Nothing is repeated; the card's own rows hide while the logger is open
//    (V3BlockCard listens via onOpenChange).
//  - EVERYTHING IS OPTIONAL. Save writes exactly what was asserted. A movement
//    never touched simply isn't logged — the same meaning silence has
//    everywhere else in the system (absence of logging is NEVER a penalty).
//  - Logging is INCREMENTAL: save one movement mid-session, come back, log the
//    next. Re-save replaces the block record (save-workout-block deletes by
//    log_id + sort_order before insert), so the panel rehydrates saved claims
//    from the controller's snapshot — without that, a later partial save
//    would silently erase the earlier one.
//  - Rx = "did exactly this": the prescription saves as the actuals. Modify
//    opens that movement's per-set editor in place (prefilled; ✕ skips a
//    set). The editor's open state is separate from the claim, so a saved
//    Modified movement sits collapsed until deliberately reopened.
//  - Fault chips are the athlete's notes FOR the coach — brief past-tense
//    observables sourced from the review's common_faults; instruction lives
//    behind the Coach button. Saved onto faults_observed per movement.
//  - Per-exercise RPE lands on that movement's entry rows (entries.rpe);
//    the block row's rpe stores the max — the limiter is the block's story.
//  - The saved card shows a red ✓ on each logged movement's plan row (parent
//    renders those); the footer button reads "Log block" while movements
//    remain, "Edit log" once all are logged.
import { useMemo, useState } from 'react';
import type { ProgramBlockV2, ProgramMovementV2 } from '../pages/ProgramDetailPage';
import type { ReviewBlock } from '../components/reviewCoaching';
import { scoreMetcon, deriveTimeDomain, type BenchmarkResult } from '../lib/metconScoring';
import { formatMovementName } from '../lib/movementName';
import { prescriptionText } from '../lib/formatMovement';

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
  /** Block-level effort — max across the logged movements' RPEs. */
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

// ── Saved-state snapshot: what the controller knows about a saved block ──
// Enough to (a) rehydrate the panel's claims on reopen and (b) let the parent
// card draw ✓ on logged plan rows. Built from the save payload client-side,
// and from a DB read on page load.
export interface SavedEntrySnapshot {
  movement: string;
  set_number: number | null;
  reps: number | null;
  hold_seconds: number | null;
  distance: number | null;
  weight: number | null;
  rpe: number | null;
  calories: number | null;
  faults_observed: string[] | null;
  completed: boolean | null;
  skip_reason: string | null;
}
export interface SavedBlockSnapshot {
  rx: boolean;
  rpe: number | null;
  notes: string | null;
  score: string | null;
  capped: boolean;
  entries: SavedEntrySnapshot[];
}

/** Movement names carrying at least one saved entry — the parent card's ✓s. */
export function loggedMovementNames(snap: SavedBlockSnapshot | null | undefined): Set<string> {
  const names = new Set<string>();
  for (const e of snap?.entries ?? []) names.add(e.movement);
  return names;
}
/** Every movement in the block has entries → the log is complete. */
export function blockFullyLogged(block: ProgramBlockV2, snap: SavedBlockSnapshot | null | undefined): boolean {
  if (!snap) return false;
  const names = loggedMovementNames(snap);
  return block.movements.length > 0 && block.movements.every((m) => names.has(m.movement));
}

export interface DayLogController {
  workoutDate: string;
  userUnits: 'lbs' | 'kg';
  isSaved: (sortOrder: number) => boolean;
  saving: number | null;
  saveBlock: (block: SaveBlockPayload) => Promise<{ auto_completed?: boolean } | null>;
  reopen: (sortOrder: number) => void;
  /** Saved-state snapshot for rehydration + the parent's row checkmarks. */
  savedSnapshot?: (sortOrder: number) => SavedBlockSnapshot | null;
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

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14, textAlign: 'center',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
  color: 'var(--text)', fontFamily: "'Outfit', sans-serif",
};

// ── Rx / Modify choice, one per task ──
// The chosen one fills solid accent with white text; its partner dims. At
// rest both wear the white outline so they read as pressable.
type Claim = 'rx' | 'mod' | null;
function RxModifyChoice({ claim, onRx, onModify }: { claim: Claim; onRx: () => void; onModify: () => void }) {
  const btn = (self: 'rx' | 'mod'): React.CSSProperties => {
    const active = claim === self;
    const other = claim != null && !active;
    return {
      padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
      fontFamily: "'Outfit', sans-serif", borderRadius: 8, transition: 'all .12s',
      background: active ? 'var(--accent)' : 'transparent',
      border: `1px solid ${active ? 'var(--accent)' : other ? 'var(--border)' : '#ffffff'}`,
      color: active ? '#ffffff' : other ? 'var(--text-muted)' : 'var(--text)',
    };
  };
  return (
    <span style={{ display: 'inline-flex', gap: 8, flexShrink: 0 }}>
      <button type="button" style={btn('rx')} onClick={onRx}>Rx</button>
      <button type="button" style={btn('mod')} onClick={onModify}>Modify</button>
    </span>
  );
}

// ── Per-exercise RPE stepper — optional, starts unset, first tap lands on 5 ──
function RpeStepper({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const bump = (d: number) => {
    if (value == null) { onChange(5); return; }
    onChange(Math.min(10, Math.max(1, value + d)));
  };
  const stepBtn: React.CSSProperties = {
    width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text)', fontSize: 17, fontWeight: 700, cursor: 'pointer', fontFamily: "'Outfit', sans-serif",
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>RPE</span>
      <button type="button" style={stepBtn} onClick={() => bump(-1)} aria-label="Lower RPE">−</button>
      <span style={{ width: 26, textAlign: 'center', fontSize: 15, fontWeight: 700, color: value != null ? 'var(--text)' : 'var(--text-muted)' }}>
        {value ?? '—'}
      </span>
      <button type="button" style={stepBtn} onClick={() => bump(1)} aria-label="Raise RPE">+</button>
    </div>
  );
}

// ── "Notes for the coach" — brief fault observables as tappable chips ──
// Tapped = "this happened." Solid accent when on. Instruction lives behind
// the Coach button, never on a chip.
function CoachNoteChips({ faults, checked, onToggle, showLabel = true }: { faults: string[]; checked: string[]; onToggle: (f: string) => void; showLabel?: boolean }) {
  if (faults.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {showLabel && <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>Notes for the coach</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {faults.map(f => {
          const on = checked.includes(f);
          return (
            <button
              key={f}
              type="button"
              onClick={() => onToggle(f)}
              style={{
                padding: '5px 11px', fontSize: 12, lineHeight: 1.35, borderRadius: 14, cursor: 'pointer',
                textAlign: 'left', fontFamily: "'Outfit', sans-serif", transition: 'all .12s',
                background: on ? 'var(--accent)' : 'transparent',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                color: on ? '#ffffff' : 'var(--text-dim)',
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

/** Additional notes + Save. Save lights up once anything is asserted. */
function SaveFooter({ saving, canSave, onSave, notes, onNotes }: {
  saving: boolean; canSave: boolean; onSave: () => void;
  notes: string; onNotes: (v: string) => void;
}) {
  return (
    <>
      <input
        style={{ ...inputStyle, textAlign: 'left', marginTop: 12 }}
        placeholder="Additional notes (optional)"
        maxLength={1000}
        value={notes}
        onChange={e => onNotes(e.target.value)}
      />
      <button type="button" className="auth-btn" style={{ width: '100%', marginTop: 10, opacity: canSave ? 1 : 0.45 }} onClick={onSave} disabled={saving || !canSave}>
        {saving ? 'Saving…' : 'Save block'}
      </button>
    </>
  );
}

// ── Editable per-set rows (the Modify path) ──
type RowState = { weight: string; value: string; skipped: boolean };
function EditableRows({ m, rows, showWeight, units, onRow }: {
  m: ProgramMovementV2; rows: RowState[]; showWeight: boolean; units: string;
  onRow: (i: number, patch: Partial<RowState>) => void;
}) {
  const { count, unitLabel } = plannedSets(m);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0 2px' }}>
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
            <button type="button" title="Skip this set" onClick={() => onRow(i, { skipped: true })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'inline-flex', flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Task state + hydration ──
// A TASK is one movement (skills/accessory) or the whole movement group
// (strength — a complex is one bar cycle, claimed together).
interface TaskState {
  claim: Claim;
  /** Editor open right now — separate from the claim, so a saved Modified
   *  task sits collapsed until deliberately reopened. */
  expanded: boolean;
  rpe: number | null;
}
function hydrateFromSnapshot(
  tasks: ProgramMovementV2[][],
  snap: SavedBlockSnapshot | null,
  showWeight: boolean,
): { states: Record<string, TaskState>; rows: Record<string, RowState[]>; checked: Record<string, string[]> } {
  const states: Record<string, TaskState> = {};
  const rows: Record<string, RowState[]> = {};
  const checked: Record<string, string[]> = {};
  const byMovement = new Map<string, SavedEntrySnapshot[]>();
  for (const e of snap?.entries ?? []) {
    const list = byMovement.get(e.movement) ?? [];
    list.push(e);
    byMovement.set(e.movement, list);
  }
  for (const t of tasks) {
    const key = t.map((m) => m.id).join('+');
    let claimed = false;
    let anyDeviation = false;
    let taskRpe: number | null = null;
    for (const m of t) {
      const { kind, count, prefill } = plannedSets(m);
      const saved = (byMovement.get(m.movement) ?? []).sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0));
      const fresh = Array.from({ length: count }, (_, i) => ({
        weight: m.weight != null ? String(m.weight) : '',
        value: prefill[i] != null ? String(prefill[i]) : '',
        skipped: false,
      }));
      if (saved.length > 0) {
        claimed = true;
        const faults = new Set<string>();
        saved.forEach((e) => (e.faults_observed ?? []).forEach((f) => faults.add(f)));
        if (faults.size > 0) checked[m.id] = [...faults];
        for (let i = 0; i < count; i++) {
          const e = saved[i];
          if (!e) continue;
          if (e.rpe != null && taskRpe == null) taskRpe = e.rpe;
          if (e.completed === false) { fresh[i].skipped = true; anyDeviation = true; continue; }
          const actual = kind === 'reps' ? e.reps : kind === 'seconds' ? e.hold_seconds : e.distance;
          if (actual != null) fresh[i].value = String(actual);
          if (showWeight && e.weight != null) fresh[i].weight = String(e.weight);
          const matchesPlan = actual != null && prefill[i] != null && actual === prefill[i] &&
            (!showWeight || e.weight == null || m.weight == null || e.weight === m.weight);
          if (!matchesPlan) anyDeviation = true;
        }
      }
      rows[m.id] = fresh;
    }
    states[key] = {
      claim: claimed ? (anyDeviation ? 'mod' : 'rx') : null,
      expanded: false,
      rpe: taskRpe,
    };
  }
  return { states, rows, checked };
}

// ── Strength / skills / accessory: the rows ARE the logger ──
function RowLogger({ block, controller, coaching, label, type, showWeight, onSaved }: {
  block: ProgramBlockV2;
  controller: DayLogController;
  coaching: ReviewBlock | null;
  label: string;
  type: string;
  showWeight: boolean;
  onSaved: () => void;
}) {
  const saving = controller.saving === block.sort_order;
  const tasks: ProgramMovementV2[][] = useMemo(
    () => (type === 'strength' ? [block.movements] : block.movements.map((m) => [m])),
    [block, type],
  );
  const taskKey = (t: ProgramMovementV2[]) => t.map((m) => m.id).join('+');
  const snap = controller.savedSnapshot?.(block.sort_order) ?? null;
  const hydrated = useMemo(() => hydrateFromSnapshot(tasks, snap, showWeight), [tasks, snap, showWeight]);

  const [states, setStates] = useState(hydrated.states);
  const [rows, setRows] = useState(hydrated.rows);
  const [checked, setChecked] = useState(hydrated.checked);
  const [notes, setNotes] = useState(snap?.notes ?? '');

  const setTask = (k: string, patch: Partial<TaskState>) =>
    setStates((p) => ({ ...p, [k]: { ...p[k], ...patch } }));
  const setRow = (mId: string, i: number, patch: Partial<RowState>) =>
    setRows((p) => ({ ...p, [mId]: p[mId].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const toggleChip = (mId: string, f: string) =>
    setChecked((p) => {
      const cur = p[mId] ?? [];
      return { ...p, [mId]: cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f] };
    });

  const anythingAsserted = tasks.some((t) => {
    const st = states[taskKey(t)];
    return st?.claim != null || st?.rpe != null;
  }) || Object.values(checked).some((c) => c.length > 0) || notes.trim() !== '';

  const save = () => {
    const entries: LogEntry[] = [];
    const claimedTasks = tasks.filter((t) => states[taskKey(t)]?.claim != null);
    for (const t of claimedTasks) {
      const st = states[taskKey(t)];
      for (const m of t) {
        const { kind, count, prefill } = plannedSets(m);
        const movementFaults = checked[m.id] ?? [];
        for (let i = 0; i < count; i++) {
          const prescribed = {
            prescribed_weight: m.weight ?? null,
            prescribed_reps: kind === 'reps' ? (prefill[i] ?? null) : null,
          };
          const r = rows[m.id]?.[i] ?? { weight: '', value: '', skipped: false };
          if (st.claim === 'mod' && r.skipped) {
            entries.push(emptyEntry(m.movement, {
              sets: 1, set_number: i + 1, completed: false, skip_reason: 'skipped',
              weight_unit: m.weight_unit || controller.userUnits, rpe: st.rpe, ...prescribed,
            }));
            continue;
          }
          const weightStr = st.claim === 'rx' ? (m.weight != null ? String(m.weight) : '') : r.weight;
          const valueStr = st.claim === 'rx' ? (prefill[i] != null ? String(prefill[i]) : '') : r.value;
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
            rpe: st.rpe,
            faults_observed: movementFaults.length ? movementFaults : null,
            ...prescribed,
          }));
        }
      }
    }
    const rpes = claimedTasks.map((t) => states[taskKey(t)].rpe).filter((v): v is number => v != null);
    controller.saveBlock({
      label: block.block_label || label, type, text: blockText(block), score: null,
      rx: claimedTasks.length > 0 && claimedTasks.every((t) => states[taskKey(t)].claim === 'rx'),
      notes: notes.trim() || null,
      sort_order: block.sort_order, entries, capped: false, capped_reps: null,
      rpe: rpes.length ? Math.max(...rpes) : null,
    }).then((res) => { if (res) onSaved(); });
  };

  return (
    <div className="block-log">
      {tasks.map((t, ti) => {
        const k = taskKey(t);
        const st = states[k] ?? { claim: null, expanded: false, rpe: null };
        const choice = (
          <RxModifyChoice
            claim={st.claim}
            onRx={() => setTask(k, { claim: st.claim === 'rx' ? null : 'rx', expanded: false })}
            onModify={() => st.claim === 'mod'
              ? setTask(k, { expanded: !st.expanded })
              : setTask(k, { claim: 'mod', expanded: true })}
          />
        );
        return (
          <div key={k} style={{ padding: '10px 0', borderBottom: ti < tasks.length - 1 ? '1px dashed var(--border)' : 'none' }}>
            {/* Name over grey prescription; buttons own the right side. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                {t.map((m) => (
                  <span key={m.id} style={{ display: 'block' }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{formatMovementName(m.movement)}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      {prescriptionText(m)}
                    </span>
                  </span>
                ))}
              </span>
              {choice}
            </div>
            {st.claim === 'mod' && st.expanded && t.map((m) => (
              <div key={m.id}>
                {t.length > 1 && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginTop: 6 }}>{formatMovementName(m.movement)}</div>}
                <EditableRows m={m} rows={rows[m.id] ?? []} showWeight={showWeight} units={controller.userUnits} onRow={(i, p) => setRow(m.id, i, p)} />
              </div>
            ))}
            <div style={{ marginTop: 8 }}>
              <RpeStepper value={st.rpe} onChange={(v) => setTask(k, { rpe: v })} />
            </div>
            {t.map((m) => (
              <CoachNoteChips key={m.id} faults={faultsForMovement(coaching, m.movement)} checked={checked[m.id] ?? []} onToggle={(f) => toggleChip(m.id, f)} />
            ))}
          </div>
        );
      })}
      <SaveFooter saving={saving} canSave={anythingAsserted} onSave={save} notes={notes} onNotes={setNotes} />
    </div>
  );
}

// ── Metcon: one piece — score + one Rx/Modify + per-movement chips + RPE ──
function MetconLog({ block, controller, coaching, onSaved }: {
  block: ProgramBlockV2; controller: DayLogController; coaching: ReviewBlock | null; onSaved: () => void;
}) {
  const saving = controller.saving === block.sort_order;
  const snap = controller.savedSnapshot?.(block.sort_order) ?? null;
  const [score, setScore] = useState(snap?.score ?? '');
  const [capped, setCapped] = useState(snap?.capped ?? false);
  const [cappedReps, setCappedReps] = useState('');
  const [notes, setNotes] = useState(snap?.notes ?? '');
  const [rpe, setRpe] = useState<number | null>(snap?.rpe ?? null);
  const [claim, setClaim] = useState<Claim>(snap ? (snap.rx ? 'rx' : snap.entries.length ? 'mod' : null) : null);
  const [checked, setChecked] = useState<Record<string, string[]>>(() => {
    const c: Record<string, string[]> = {};
    for (const m of block.movements) {
      const faults = new Set<string>();
      (snap?.entries ?? []).filter((e) => e.movement === m.movement)
        .forEach((e) => (e.faults_observed ?? []).forEach((f) => faults.add(f)));
      if (faults.size > 0) c[m.id] = [...faults];
    }
    return c;
  });
  const toggleChip = (mId: string, f: string) =>
    setChecked((p) => {
      const cur = p[mId] ?? [];
      return { ...p, [mId]: cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f] };
    });
  // Per-movement actuals for the Modify path, hydrated from saved entries.
  const initialActuals = useMemo(() => {
    const a: Record<string, { weight: string; value: string }> = {};
    for (const m of block.movements) {
      const isCal = m.calories != null && m.calories > 0;
      const saved = (snap?.entries ?? []).find((e) => e.movement === m.movement);
      a[m.id] = {
        weight: saved?.weight != null ? String(saved.weight) : m.weight != null ? String(m.weight) : '',
        value: saved != null
          ? String((isCal ? saved.calories : saved.reps ?? saved.distance) ?? '')
          : isCal ? String(m.calories) : m.reps != null ? String(m.reps) : m.distance != null ? String(m.distance) : '',
      };
    }
    return a;
  }, [block, snap]);
  const [actuals, setActuals] = useState(initialActuals);
  const isForTime = inferMetconType(block) === 'for_time';
  const roundSize = metconRoundSize(block);
  const capTotal = capped ? parseCapProgress(cappedReps, roundSize) : null;
  const anythingAsserted = claim != null || score.trim() !== '' || capped || rpe != null ||
    Object.values(checked).some((c) => c.length > 0) || notes.trim() !== '';
  const save = () => {
    const entries: LogEntry[] = block.movements.map((m) => {
      const isCal = m.calories != null && m.calories > 0;
      const f = checked[m.id] ?? [];
      const a = actuals[m.id] ?? { weight: '', value: '' };
      const useEdited = claim === 'mod';
      const editedVal = numOrNull(a.value);
      return emptyEntry(m.movement, {
        reps: isCal ? null : (useEdited ? intOrNull(a.value) : (m.reps ?? null)),
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
    const cappedScore = block.time_cap_seconds != null ? formatClock(block.time_cap_seconds) : null;
    controller.saveBlock({
      label: block.block_label || 'Metcon', type: 'metcon', text: blockText(block),
      score: capped ? cappedScore : (score.trim() || null), rx: claim === 'rx', notes: notes.trim() || null,
      sort_order: block.sort_order, entries, capped, capped_reps: capped ? capTotal : null,
      rpe,
      block_scheme: block.block_scheme, time_cap_seconds: block.time_cap_seconds,
      percentile: scoring?.percentile ?? null, performance_tier: scoring?.performanceTier ?? null,
      median_benchmark: benchmark && benchmark.medianScore !== '--' ? benchmark.medianScore : null,
      excellent_benchmark: benchmark && benchmark.excellentScore !== '--' ? benchmark.excellentScore : null,
      time_domain: deriveTimeDomain(wType, text, benchmark?.medianScore ?? null),
    }).then((res) => { if (res) onSaved(); });
  };
  return (
    <div className="block-log">
      <div style={{ margin: '10px 0 8px' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{isForTime ? 'Result (time)' : 'Result (rounds + reps)'}</div>
        {!capped && <input style={{ ...inputStyle, textAlign: 'left' }} placeholder={isForTime ? 'e.g. 12:34' : 'e.g. 5+18'} value={score} onChange={e => setScore(e.target.value)} />}
      </div>
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
      {claim === 'mod' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
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
      <RxModifyChoice
        claim={claim}
        onRx={() => setClaim(claim === 'rx' ? null : 'rx')}
        onModify={() => setClaim(claim === 'mod' ? null : 'mod')}
      />
      <div style={{ marginTop: 10 }}>
        <RpeStepper value={rpe} onChange={setRpe} />
      </div>
      {block.movements.some((m) => faultsForMovement(coaching, m.movement).length > 0) && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Notes for the coach</div>
          {block.movements.map((m) => {
            const mFaults = faultsForMovement(coaching, m.movement);
            if (!mFaults.length) return null;
            return (
              <div key={m.id} style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{formatMovementName(m.movement)}</div>
                <CoachNoteChips faults={mFaults} checked={checked[m.id] ?? []} onToggle={(f) => toggleChip(m.id, f)} showLabel={false} />
              </div>
            );
          })}
        </div>
      )}
      <SaveFooter saving={saving} canSave={anythingAsserted} onSave={save} notes={notes} onNotes={setNotes} />
    </div>
  );
}

// ── Cardio: machine avg watts + work time (power) ──
function CardioLog({ block, controller, onSaved }: { block: ProgramBlockV2; controller: DayLogController; onSaved: () => void }) {
  const saving = controller.saving === block.sort_order;
  const snap = controller.savedSnapshot?.(block.sort_order) ?? null;
  const [watts, setWatts] = useState('');
  const [time, setTime] = useState('');
  const [rpe, setRpe] = useState<number | null>(snap?.rpe ?? null);
  const [notes, setNotes] = useState(snap?.notes ?? '');
  const save = () => {
    const entries: LogEntry[] = block.movements.map((m) => emptyEntry(m.movement, { distance: m.distance ?? null, distance_unit: m.distance_unit ?? null, rpe }));
    controller.saveBlock({
      label: block.block_label || 'Cardio', type: 'cardio', text: blockText(block), score: null, rx: false, notes: notes.trim() || null,
      sort_order: block.sort_order, entries, capped: false, capped_reps: null, rpe,
      cardio_avg_watts: numOrNull(watts), cardio_work_seconds: parseClock(time), cardio_modality: null,
    }).then((res) => { if (res) onSaved(); });
  };
  const canSave = watts.trim() !== '' || time.trim() !== '' || rpe != null || notes.trim() !== '';
  return (
    <div className="block-log" style={{ marginTop: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Avg watts</div><input style={inputStyle} inputMode="decimal" placeholder="watts" value={watts} onChange={e => setWatts(e.target.value)} /></div>
        <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Work time</div><input style={inputStyle} placeholder="mm:ss" value={time} onChange={e => setTime(e.target.value)} /></div>
      </div>
      <div style={{ marginTop: 8 }}>
        <RpeStepper value={rpe} onChange={setRpe} />
      </div>
      <SaveFooter saving={saving} canSave={canSave} onSave={save} notes={notes} onNotes={setNotes} />
    </div>
  );
}

const LOGGABLE_TYPES = ['strength', 'metcon', 'skills', 'accessory', 'cardio'];
/** Strength/skills/accessory replace the card's movement list while open —
 *  their rows ARE the logger. Metcon and cardio panels are fields below the
 *  rows (score, watts), so the plan rows stay visible for context. */
const ROW_LOGGER_TYPES = ['strength', 'skills', 'accessory'];

export default function BlockLog({ block, controller, coaching, onEnsureCoaching, onOpenChange }: {
  block: ProgramBlockV2;
  controller: DayLogController;
  coaching?: ReviewBlock | null;
  onEnsureCoaching?: () => void;
  /** Fires when the logger opens/closes so the parent card can hide its own
   *  movement rows while the logger's live rows are showing. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenRaw] = useState(false);
  const setOpen = (o: boolean) => { setOpenRaw(o); onOpenChange?.(o && ROW_LOGGER_TYPES.includes(block.block_type)); };
  if (!LOGGABLE_TYPES.includes(block.block_type)) return null;

  const saved = controller.isSaved(block.sort_order);
  const snap = controller.savedSnapshot?.(block.sort_order) ?? null;
  const complete = saved && blockFullyLogged(block, snap);

  if (!open) {
    return (
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => { setOpen(true); onEnsureCoaching?.(); }}
          style={{ padding: '7px 16px', background: 'transparent', border: '1px solid var(--accent)', borderRadius: 8, color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Outfit', sans-serif" }}
        >
          {complete ? 'Edit log' : 'Log block'}
        </button>
      </div>
    );
  }
  const onSaved = () => setOpen(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer', marginTop: 10, padding: '4px 0', fontFamily: "'Outfit', sans-serif" }}
      >
        Log
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
      </button>
      {block.block_type === 'metcon'
        ? <MetconLog block={block} controller={controller} coaching={coaching ?? null} onSaved={onSaved} />
        : block.block_type === 'cardio'
          ? <CardioLog block={block} controller={controller} onSaved={onSaved} />
          : <RowLogger
              block={block} controller={controller} coaching={coaching ?? null}
              label={block.block_type === 'strength' ? 'Strength' : block.block_type === 'skills' ? 'Skills' : 'Accessory'}
              type={block.block_type}
              showWeight={block.block_type !== 'skills'}
              onSaved={onSaved}
            />}
    </div>
  );
}
