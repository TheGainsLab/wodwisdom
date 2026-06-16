// Per-block-type logging UI that lands on the V3 day cards. Each block type is
// its own little world; BlockLog dispatches to the right one. The day page owns a
// DayLogController (in-progress log id, saved-state, save via save-workout-block);
// each world reads the prescription off the block and collects actuals.
import { useMemo, useState } from 'react';
import type { ProgramBlockV2, ProgramMovementV2 } from '../pages/ProgramDetailPage';
import type { ReviewBlock } from '../components/reviewCoaching';
import { scoreMetcon, deriveTimeDomain, type BenchmarkResult } from '../lib/metconScoring';

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
function plannedSets(m: ProgramMovementV2): { count: number; reps: (number | null)[] } {
  const scheme = Array.isArray(m.rep_scheme) ? m.rep_scheme : null;
  if (scheme && scheme.length > 0) return { count: scheme.length, reps: scheme };
  const count = m.sets ?? 1;
  return { count, reps: Array.from({ length: count }, () => m.reps ?? null) };
}
const blockText = (b: ProgramBlockV2) => b.block_scheme || b.block_label || '';
const emptyEntry = (movement: string, extra: Partial<LogEntry>): LogEntry => ({
  movement, sets: null, reps: null, weight: null, weight_unit: 'lbs', rpe: null, set_number: null,
  reps_completed: null, hold_seconds: null, distance: null, distance_unit: null, quality: null,
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

// A/B/C/D self-rated movement quality. Red border until set (a "rate me" nudge).
function QualitySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      title="Movement quality A–D"
      style={{ ...inputStyle, padding: '8px 2px', border: value ? '1px solid var(--border)' : '1px solid var(--accent)' }}
    >
      <option value="">Q</option>
      <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option>
    </select>
  );
}

// RPE 1–10 dropdown (perceived exertion). Blank until set.
function RpeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      title="RPE 1–10"
      style={{ ...inputStyle, padding: '8px 2px' }}
    >
      <option value="">RPE</option>
      {Array.from({ length: 10 }, (_, i) => String(i + 1)).map(n => (
        <option key={n} value={n}>{n}</option>
      ))}
    </select>
  );
}

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
function SaveButton({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <button type="button" className="auth-btn" style={{ width: '100%', marginTop: 8 }} onClick={onSave} disabled={saving}>
      {saving ? 'Saving…' : 'Save block'}
    </button>
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

// ── Strength: per-set weight / reps / RPE / quality + block faults ──
function StrengthLog({ block, controller, coaching }: { block: ProgramBlockV2; controller: DayLogController; coaching: ReviewBlock | null }) {
  const saving = controller.saving === block.sort_order;
  const initial = useMemo(() => {
    const rows: Record<string, { weight: string; reps: string; rpe: string; quality: string }> = {};
    for (const m of block.movements) {
      const { count, reps } = plannedSets(m);
      for (let i = 0; i < count; i++) rows[`${m.id}-${i}`] = { weight: m.weight != null ? String(m.weight) : '', reps: reps[i] != null ? String(reps[i]) : '', rpe: m.rpe != null ? String(m.rpe) : '', quality: '' };
    }
    return rows;
  }, [block]);
  const [vals, setVals] = useState(initial);
  const set = (k: string, f: 'weight' | 'reps' | 'rpe' | 'quality', v: string) => setVals(p => ({ ...p, [k]: { ...p[k], [f]: v } }));
  const { checked, toggle } = useChecked();
  const faults = blockFaults(coaching, block.movements);
  const save = () => {
    const blockFaultsChecked = checked['block'] ?? [];
    const entries: LogEntry[] = [];
    for (const m of block.movements) {
      const { count } = plannedSets(m);
      for (let i = 0; i < count; i++) {
        const r = vals[`${m.id}-${i}`] ?? { weight: '', reps: '', rpe: '', quality: '' };
        entries.push(emptyEntry(m.movement, { sets: 1, reps: intOrNull(r.reps), weight: numOrNull(r.weight), weight_unit: m.weight_unit || controller.userUnits, rpe: numOrNull(r.rpe), set_number: i + 1, quality: r.quality || null, faults_observed: blockFaultsChecked.length ? blockFaultsChecked : null, prescribed_weight: m.weight ?? null, prescribed_reps: m.reps ?? null }));
      }
    }
    controller.saveBlock({ label: block.block_label || 'Strength', type: 'strength', text: blockText(block), score: null, rx: false, notes: null, sort_order: block.sort_order, entries, capped: false, capped_reps: null });
  };
  return (
    <div className="block-log" style={wrapStyle}>
      {block.movements.map((m) => {
        const { count } = plannedSets(m);
        return (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{m.movement}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 1fr 44px', gap: 6, alignItems: 'center' }}>
              <span /><span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{controller.userUnits}</span><span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>reps</span><span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>RPE</span><span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Q</span>
              {Array.from({ length: count }, (_, i) => {
                const k = `${m.id}-${i}`; const r = vals[k] ?? { weight: '', reps: '', rpe: '', quality: '' };
                return (
                  <>
                    <span key={`${k}-l`} style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>S{i + 1}</span>
                    <input key={`${k}-w`} style={inputStyle} inputMode="decimal" value={r.weight} onChange={e => set(k, 'weight', e.target.value)} />
                    <input key={`${k}-r`} style={inputStyle} inputMode="numeric" value={r.reps} onChange={e => set(k, 'reps', e.target.value)} />
                    <RpeSelect key={`${k}-p`} value={r.rpe} onChange={v => set(k, 'rpe', v)} />
                    <QualitySelect key={`${k}-q`} value={r.quality} onChange={v => set(k, 'quality', v)} />
                  </>
                );
              })}
            </div>
          </div>
        );
      })}
      <FaultChecklist faults={faults} checked={checked['block'] ?? []} onToggle={(f) => toggle('block', f)} />
      <SaveButton saving={saving} onSave={save} />
    </div>
  );
}

// ── Metcon: one result (time or rounds+reps), Rx/scaled, capped + block faults ──
function MetconLog({ block, controller, coaching }: { block: ProgramBlockV2; controller: DayLogController; coaching: ReviewBlock | null }) {
  const saving = controller.saving === block.sort_order;
  const [score, setScore] = useState('');
  const [rx, setRx] = useState(true);
  const [capped, setCapped] = useState(false);
  const [cappedReps, setCappedReps] = useState('');
  const [notes, setNotes] = useState('');
  const { checked, toggle } = useChecked();
  const faults = blockFaults(coaching, block.movements);
  // "Hit the cap" only applies to for-time work; AMRAP/EMOM score IS rounds+reps.
  const isForTime = inferMetconType(block) === 'for_time';
  const save = () => {
    const blockFaultsChecked = checked['block'] ?? [];
    const entries: LogEntry[] = block.movements.map((m) => {
      const isCal = m.calories != null && m.calories > 0;
      return emptyEntry(m.movement, {
        reps: isCal ? (m.calories ?? null) : (m.reps ?? null),
        weight: m.weight ?? null, weight_unit: m.weight_unit || controller.userUnits,
        distance: isCal ? null : (m.distance ?? null), distance_unit: isCal ? 'cal' : (m.distance_unit ?? null),
        faults_observed: blockFaultsChecked.length ? blockFaultsChecked : null,
        prescribed_weight: m.weight ?? null, prescribed_reps: m.reps ?? null,
      });
    });
    const benchmark = reshapeBenchmark(block.expected_benchmark);
    const wType = inferMetconType(block);
    const text = [block.block_scheme, block.block_label].filter(Boolean).join('\n');
    const scoring = !capped && score.trim() && benchmark ? scoreMetcon(score.trim(), wType, benchmark) : null;
    controller.saveBlock({
      label: block.block_label || 'Metcon', type: 'metcon', text: blockText(block),
      score: capped ? null : (score.trim() || null), rx, notes: notes.trim() || null,
      sort_order: block.sort_order, entries, capped, capped_reps: capped ? intOrNull(cappedReps) : null,
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 8 }}>
        <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={rx} onChange={e => setRx(e.target.checked)} /> Rx</label>
        {isForTime && <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={capped} onChange={e => setCapped(e.target.checked)} /> Hit the cap</label>}
        {isForTime && capped && <input style={{ ...inputStyle, width: 120 }} inputMode="numeric" placeholder="reps at cap" value={cappedReps} onChange={e => setCappedReps(e.target.value)} />}
      </div>
      <input style={{ ...inputStyle, textAlign: 'left' }} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      <FaultChecklist faults={faults} checked={checked['block'] ?? []} onToggle={(f) => toggle('block', f)} />
      <SaveButton saving={saving} onSave={save} />
    </div>
  );
}

// ── Skills: reps completed + RPE + quality + per-movement faults ──
function SkillsLog({ block, controller, coaching }: { block: ProgramBlockV2; controller: DayLogController; coaching: ReviewBlock | null }) {
  const saving = controller.saving === block.sort_order;
  const [vals, setVals] = useState<Record<string, { reps: string; rpe: string; quality: string }>>(() => Object.fromEntries(block.movements.map(m => [m.id, { reps: '', rpe: '', quality: '' }])));
  const set = (id: string, f: 'reps' | 'rpe' | 'quality', v: string) => setVals(p => ({ ...p, [id]: { ...p[id], [f]: v } }));
  const { checked, toggle } = useChecked();
  const save = () => {
    const entries: LogEntry[] = block.movements.map((m) => {
      const r = vals[m.id] ?? { reps: '', rpe: '', quality: '' };
      const f = checked[m.id] ?? [];
      return emptyEntry(m.movement, { sets: m.sets ?? null, reps_completed: intOrNull(r.reps), rpe: numOrNull(r.rpe), quality: r.quality || null, faults_observed: f.length ? f : null, prescribed_reps: m.reps ?? null });
    });
    controller.saveBlock({ label: block.block_label || 'Skills', type: 'skills', text: blockText(block), score: null, rx: false, notes: null, sort_order: block.sort_order, entries, capped: false, capped_reps: null });
  };
  return (
    <div className="block-log" style={wrapStyle}>
      {block.movements.map((m) => {
        const r = vals[m.id] ?? { reps: '', rpe: '', quality: '' };
        const faults = faultsForMovement(coaching, m.movement);
        return (
          <div key={m.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 44px', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{m.movement}</span>
              <input style={inputStyle} inputMode="numeric" placeholder="reps" value={r.reps} onChange={e => set(m.id, 'reps', e.target.value)} />
              <RpeSelect value={r.rpe} onChange={v => set(m.id, 'rpe', v)} />
              <QualitySelect value={r.quality} onChange={v => set(m.id, 'quality', v)} />
            </div>
            <FaultChecklist faults={faults} checked={checked[m.id] ?? []} onToggle={(f) => toggle(m.id, f)} />
          </div>
        );
      })}
      <SaveButton saving={saving} onSave={save} />
    </div>
  );
}

// ── Accessory: weight / reps / RPE per movement + block faults ──
function AccessoryLog({ block, controller, coaching }: { block: ProgramBlockV2; controller: DayLogController; coaching: ReviewBlock | null }) {
  const saving = controller.saving === block.sort_order;
  const [vals, setVals] = useState<Record<string, { weight: string; reps: string; rpe: string }>>(
    () => Object.fromEntries(block.movements.map(m => [m.id, { weight: m.weight != null ? String(m.weight) : '', reps: m.reps != null ? String(m.reps) : '', rpe: m.rpe != null ? String(m.rpe) : '' }]))
  );
  const set = (id: string, f: 'weight' | 'reps' | 'rpe', v: string) => setVals(p => ({ ...p, [id]: { ...p[id], [f]: v } }));
  const { checked, toggle } = useChecked();
  const save = () => {
    const entries: LogEntry[] = block.movements.map((m) => {
      const r = vals[m.id] ?? { weight: '', reps: '', rpe: '' };
      const f = checked[m.id] ?? [];
      return emptyEntry(m.movement, { sets: m.sets ?? null, weight: numOrNull(r.weight), weight_unit: m.weight_unit || controller.userUnits, reps_completed: intOrNull(r.reps), rpe: numOrNull(r.rpe), faults_observed: f.length ? f : null, prescribed_weight: m.weight ?? null, prescribed_reps: m.reps ?? null });
    });
    controller.saveBlock({ label: block.block_label || 'Accessory', type: 'accessory', text: blockText(block), score: null, rx: false, notes: null, sort_order: block.sort_order, entries, capped: false, capped_reps: null });
  };
  return (
    <div className="block-log" style={wrapStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <span /><span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{controller.userUnits}</span><span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>reps</span><span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>RPE</span>
      </div>
      {block.movements.map((m) => {
        const r = vals[m.id] ?? { weight: '', reps: '', rpe: '' };
        const faults = faultsForMovement(coaching, m.movement);
        return (
          <div key={m.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{m.movement}</span>
              <input style={inputStyle} inputMode="decimal" value={r.weight} onChange={e => set(m.id, 'weight', e.target.value)} />
              <input style={inputStyle} inputMode="numeric" value={r.reps} onChange={e => set(m.id, 'reps', e.target.value)} />
              <RpeSelect value={r.rpe} onChange={v => set(m.id, 'rpe', v)} />
            </div>
            <FaultChecklist faults={faults} checked={checked[m.id] ?? []} onToggle={(f) => toggle(m.id, f)} />
          </div>
        );
      })}
      <SaveButton saving={saving} onSave={save} />
    </div>
  );
}

// ── Cardio: machine avg watts + work time (power) ──
function CardioLog({ block, controller }: { block: ProgramBlockV2; controller: DayLogController }) {
  const saving = controller.saving === block.sort_order;
  const [watts, setWatts] = useState('');
  const [time, setTime] = useState('');
  const save = () => {
    const entries: LogEntry[] = block.movements.map((m) => emptyEntry(m.movement, { distance: m.distance ?? null, distance_unit: m.distance_unit ?? null }));
    controller.saveBlock({
      label: block.block_label || 'Cardio', type: 'cardio', text: blockText(block), score: null, rx: false, notes: null,
      sort_order: block.sort_order, entries, capped: false, capped_reps: null,
      cardio_avg_watts: numOrNull(watts), cardio_work_seconds: parseClock(time), cardio_modality: null,
    });
  };
  return (
    <div className="block-log" style={wrapStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Avg watts</div><input style={inputStyle} inputMode="decimal" placeholder="watts" value={watts} onChange={e => setWatts(e.target.value)} /></div>
        <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Work time</div><input style={inputStyle} placeholder="mm:ss" value={time} onChange={e => setTime(e.target.value)} /></div>
      </div>
      <SaveButton saving={saving} onSave={save} />
    </div>
  );
}

// ── Dispatcher ──
function renderWorld(block: ProgramBlockV2, controller: DayLogController, coaching: ReviewBlock | null) {
  switch (block.block_type) {
    case 'strength': return <StrengthLog block={block} controller={controller} coaching={coaching} />;
    case 'metcon': return <MetconLog block={block} controller={controller} coaching={coaching} />;
    case 'skills': return <SkillsLog block={block} controller={controller} coaching={coaching} />;
    case 'accessory': return <AccessoryLog block={block} controller={controller} coaching={coaching} />;
    case 'cardio': return <CardioLog block={block} controller={controller} />;
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
      <button
        type="button"
        onClick={() => { setOpen(true); onEnsureCoaching?.(); }}
        style={{ width: '100%', marginTop: 10, padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: "'Outfit', sans-serif" }}
      >
        Log block
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
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
