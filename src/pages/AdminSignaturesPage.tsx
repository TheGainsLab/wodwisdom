/**
 * /admin/signatures — the Workout Signatures review console (phase 2).
 *
 * Paste a workout → signature-workout parses it into the canonical structure
 * → the model drafts the three weight vectors (demand / discrimination /
 * stimulus over the coach-state focus axes) plus gates → it renders here for
 * adjudication. Every structured field (task, load, reps, cap) is editable
 * in place; Re-measure recomputes the deterministic layer instantly (zero
 * tokens), Re-draft re-tags with the model, and every number shows its delta
 * against the baseline captured when the workout was loaded — the what-if
 * loop: change the workout, see what it does to the signature.
 *
 * Approve persists the editorial artifact every downstream consumer reads.
 */
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import '../features.css';
import '../qa.css';

// Must mirror FOCUS_AREAS in supabase/functions/_shared/coach-state.ts
// (the function's selftest returns the live list; System Check compares).
const FOCUS_AREAS = [
  'olympic_lifting', 'powerlifting_strength', 'posterior_chain', 'upper_body_pressing',
  'gymnastics_pulling', 'gymnastics_pressing', 'midline', 'skill_coordination',
  'squat_cycling', 'aerobic_capacity', 'anaerobic_capacity', 'mixed_modal_conditioning',
] as const;
const FOCUS_LABELS: Record<string, string> = {
  olympic_lifting: 'Olympic lifting', powerlifting_strength: 'Max strength',
  posterior_chain: 'Posterior chain', upper_body_pressing: 'UB pressing',
  gymnastics_pulling: 'Gym pulling', gymnastics_pressing: 'Gym pressing',
  midline: 'Midline', skill_coordination: 'Skill / coordination',
  squat_cycling: 'Squat cycling',
  aerobic_capacity: 'Aerobic', anaerobic_capacity: 'Anaerobic',
  mixed_modal_conditioning: 'Mixed-modal',
};
const EXPECTED_FUNCTION_VERSION = '2026-10-30.3';

type Weights = Record<string, number>;
interface Gate { movement: string; kind: 'skill' | 'load' | 'capacity'; detail?: string }
interface Movement {
  movement: string; rep_scheme?: number[]; cal_scheme?: number[]; distance_scheme?: number[];
  calories?: number; distance?: number; distance_unit?: 'm' | 'ft';
  weight?: number; weight_unit?: 'lbs' | 'kg'; time_seconds?: number;
  sets?: number; reps?: number;
}
interface Workout { block_type: string; block_scheme?: string; time_cap_seconds?: number; movements: Movement[] }
interface Measured {
  time_domain?: string; median_score?: string; median_seconds?: number | null;
  excellent_score?: string | null; median_watts?: number; excellent_watts?: number | null;
  cohort_anchors?: Array<{ p: number; watts: number; score: string }>;
}
interface SigRow {
  id?: string; name: string; source: 'open' | 'quarterfinals' | 'adhoc';
  competition_workout_id?: string | null; workout: Workout;
  demand: Weights; discrimination?: Weights | null; stimulus?: Weights | null;
  gates: Gate[]; time_domain?: string | null; format?: string | null;
  archetype?: string | null; rationale?: string | null; measured?: Measured | null;
  status?: string; created_at?: string;
}
interface Baseline { demand: Weights; discrimination: Weights; stimulus: Weights; measured: Measured | null }

async function invokeSig(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error: err } = await supabase.functions.invoke('signature-workout', { body });
  if (err) {
    let msg = err.message ?? 'function call failed';
    const ctx = (err as { context?: Response }).context;
    if (ctx) {
      let detail = '';
      if (typeof ctx.json === 'function') {
        try { const b = await ctx.json(); if (b?.error) detail = String(b.error); } catch { /* non-JSON */ }
      }
      msg = `${detail || msg} (HTTP ${ctx.status}${ctx.status === 404 ? ' — function not deployed?' : ''})`;
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(String(data.error));
  return data ?? {};
}

const field: React.CSSProperties = {
  width: '100%', padding: '7px 9px', fontSize: 13, fontFamily: 'inherit',
  background: 'var(--surface)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 8,
};
const label: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 0.4, margin: '14px 0 4px', display: 'block',
};
const btn: React.CSSProperties = { ...field, width: 'auto', cursor: 'pointer', fontWeight: 600 };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, 'JetBrains Mono', monospace" };

const sum = (w: Weights | null | undefined) => Object.values(w ?? {}).reduce((a, b) => a + b, 0);
const parseNums = (s: string): number[] | undefined => {
  const arr = s.split(/[,\s-]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0);
  return arr.length ? arr : undefined;
};

/** Small ±delta chip vs baseline; nothing when unchanged. */
function Delta({ now, was, suffix = '' }: { now: number | null | undefined; was: number | null | undefined; suffix?: string }) {
  if (now == null || was == null || now === was) return null;
  const d = now - was;
  return (
    <span style={{ ...mono, fontSize: 10.5, fontWeight: 700, marginLeft: 5, color: d > 0 ? '#4ade80' : 'var(--accent)' }}>
      {d > 0 ? '+' : ''}{d}{suffix}
    </span>
  );
}

const fmtSecs = (s: number | null | undefined) =>
  s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export default function AdminSignaturesPage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [rows, setRows] = useState<SigRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sel, setSel] = useState<SigRow | null>(null);        // editable working copy
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [gender, setGender] = useState<'men' | 'women'>('men');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sysCheck, setSysCheck] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('profiles').select('role').eq('id', session.user.id).single()
      .then(({ data }) => setRole(data?.role ?? 'user'));
  }, [session.user.id]);

  const refresh = async () => {
    try {
      const out = await invokeSig({ action: 'list', status: statusFilter || undefined });
      setRows((out.rows as SigRow[]) ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { if (role === 'admin') refresh(); }, [role, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const snapshot = (r: SigRow): Baseline => ({
    demand: { ...(r.demand ?? {}) },
    discrimination: { ...(r.discrimination ?? {}) },
    stimulus: { ...(r.stimulus ?? {}) },
    measured: r.measured ?? null,
  });

  const open = (r: SigRow) => { setSel(structuredClone(r)); setBaseline(snapshot(r)); setError(''); };

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  const doSystemCheck = () => run('check', async () => {
    const out = await invokeSig({ action: 'selftest' });
    const v = String(out.version ?? '?');
    const axesOk = JSON.stringify(out.focus_areas) === JSON.stringify(FOCUS_AREAS);
    setSysCheck(
      `${v === EXPECTED_FUNCTION_VERSION ? '✓' : `✗ version ${v} (expected ${EXPECTED_FUNCTION_VERSION} — redeploy?)`}` +
      `${out.anthropic_key ? '' : ' · ✗ no API key'}${axesOk ? '' : ' · ✗ focus axes drifted from coach-state'}`,
    );
  });

  const doParse = () => run('parse', async () => {
    const out = await invokeSig({ action: 'parse', text: pasteText });
    const workout = out.workout as Workout;
    const fresh: SigRow = { name: '', source: 'adhoc', workout, demand: {}, gates: [] };
    setSel(fresh); setBaseline(null); setPasteText('');
  });

  const doDraft = () => sel && run('draft', async () => {
    const out = await invokeSig({ action: 'draft', workout: sel.workout, gender });
    const sig = out.signature as Partial<SigRow>;
    const next = {
      ...sel,
      demand: (sig.demand ?? {}) as Weights,
      discrimination: (sig.discrimination ?? {}) as Weights,
      stimulus: (sig.stimulus ?? {}) as Weights,
      gates: (sig.gates ?? []) as Gate[],
      time_domain: sig.time_domain ?? sel.time_domain,
      format: sig.format ?? sel.format,
      archetype: sig.archetype ?? sel.archetype,
      rationale: sig.rationale ?? sel.rationale,
      measured: (out.measured as Measured | null) ?? sel.measured,
    };
    setSel(next);
    if (!baseline) setBaseline(snapshot(next)); // first draft anchors the baseline
  });

  const doMeasure = () => sel && run('measure', async () => {
    const out = await invokeSig({ action: 'measure', workout: sel.workout, gender });
    setSel({ ...sel, measured: (out.measured as Measured | null) });
  });

  const doSave = (statusAction?: 'approve' | 'reject') => sel && run(statusAction ?? 'save', async () => {
    const payload: Record<string, unknown> = {
      action: statusAction ?? 'save', id: sel.id,
      source: sel.source, competition_workout_id: sel.competition_workout_id ?? null,
      name: sel.name, workout: sel.workout, demand: sel.demand,
      discrimination: sel.discrimination ?? null, stimulus: sel.stimulus ?? null,
      gates: sel.gates, time_domain: sel.time_domain ?? null, format: sel.format ?? null,
      archetype: sel.archetype ?? null, rationale: sel.rationale ?? null,
      measured: sel.measured ?? null, drafted_model: 'sonnet',
    };
    if (statusAction === 'reject') { await invokeSig({ action: 'reject', id: sel.id }); }
    else {
      if (statusAction !== 'approve' && !sel.id) {
        const out = await invokeSig(payload);
        setSel({ ...sel, id: (out.row as SigRow).id, status: 'draft' });
      } else if (statusAction !== 'approve') {
        await invokeSig(payload);
      } else {
        if (!sel.id) { // approve straight from a new draft: save first
          const saved = await invokeSig({ ...payload, action: 'save', id: undefined });
          payload.id = (saved.row as SigRow).id;
        }
        await invokeSig(payload);
      }
    }
    await refresh();
    if (statusAction) setSel(null);
  });

  const doDelete = () => sel?.id && run('delete', async () => {
    if (!window.confirm(`Delete the signature for "${sel.name}"?`)) return;
    await invokeSig({ action: 'delete', id: sel.id });
    await refresh(); setSel(null);
  });

  // ---- editors ----
  const setWorkout = (w: Partial<Workout>) => sel && setSel({ ...sel, workout: { ...sel.workout, ...w } });
  const setMovement = (i: number, m: Partial<Movement>) => {
    if (!sel) return;
    const movements = sel.workout.movements.map((mv, j) => (j === i ? { ...mv, ...m } : mv));
    setSel({ ...sel, workout: { ...sel.workout, movements } });
  };
  const stepWeight = (vec: 'demand' | 'discrimination' | 'stimulus', axis: string, d: number) => {
    if (!sel) return;
    const w = { ...((sel[vec] ?? {}) as Weights) };
    const next = Math.max(0, Math.min(100, (w[axis] ?? 0) + d));
    if (next === 0) delete w[axis]; else w[axis] = next;
    setSel({ ...sel, [vec]: w });
  };

  if (role && role !== 'admin') {
    return <div style={{ padding: 40, color: 'var(--text)' }}>Admin only.</div>;
  }

  const vectors: Array<'demand' | 'discrimination' | 'stimulus'> = ['demand', 'discrimination', 'stimulus'];

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Workout Signatures</h1>
        </header>

        <div className="page-body" style={{ padding: '0 20px 60px', maxWidth: 980 }}>
          {error && <div style={{ color: 'var(--accent)', fontSize: 13, margin: '10px 0' }}>{error}</div>}

          {!sel && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 0' }}>
                <button disabled={busy === 'check'} onClick={doSystemCheck} style={btn}>
                  {busy === 'check' ? 'Checking…' : 'Run system check'}
                </button>
                {sysCheck && <span style={{ fontSize: 12.5, fontWeight: 700, color: sysCheck.startsWith('✓') ? '#4ade80' : 'var(--accent)' }}>{sysCheck}</span>}
              </div>

              <span style={label}>New workout — paste the prescription</span>
              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={5}
                placeholder={'AMRAP 15:\n3 wall walks\n12 dumbbell snatches (50/35)\n15 box jump-overs (24/20)'}
                style={{ ...field, resize: 'vertical' }} />
              <button disabled={!pasteText.trim() || busy === 'parse'} onClick={doParse} style={{ ...btn, marginTop: 8 }}>
                {busy === 'parse' ? 'Parsing…' : 'Parse → structured workout'}
              </button>

              <span style={label}>Review queue</span>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {['', 'draft', 'approved', 'rejected'].map((s) => (
                  <button key={s || 'all'} onClick={() => setStatusFilter(s)}
                    style={{ ...btn, padding: '5px 12px', fontSize: 12, opacity: statusFilter === s ? 1 : 0.55 }}>
                    {s || 'all'}
                  </button>
                ))}
              </div>
              {rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No signatures yet.</div>}
              {rows.map((r) => (
                <div key={r.id} onClick={() => open(r)}
                  style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '9px 12px', margin: '6px 0', cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <strong style={{ fontSize: 13.5 }}>{r.name}</strong>
                  <span style={{ ...mono, fontSize: 11, color: 'var(--text-muted)' }}>{r.source}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {Object.entries(r.demand ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${FOCUS_LABELS[k] ?? k} ${v}`).join(' · ')}
                  </span>
                  {(r.gates?.length ?? 0) > 0 && <span style={{ fontSize: 11, color: 'var(--accent)' }}>⛩ {r.gates.length}</span>}
                  <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: r.status === 'approved' ? '#4ade80' : r.status === 'rejected' ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {r.status}
                  </span>
                </div>
              ))}
            </>
          )}

          {sel && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '14px 0', flexWrap: 'wrap' }}>
                <button onClick={() => { setSel(null); setBaseline(null); }} style={btn}>← Queue</button>
                <input value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })}
                  placeholder="Name (e.g. 22.1)" style={{ ...field, width: 140, fontWeight: 700 }} />
                <select value={sel.source} onChange={(e) => setSel({ ...sel, source: e.target.value as SigRow['source'] })} style={{ ...field, width: 'auto' }}>
                  <option value="open">open</option><option value="quarterfinals">quarterfinals</option><option value="adhoc">adhoc</option>
                </select>
                <select value={gender} onChange={(e) => setGender(e.target.value as 'men' | 'women')} style={{ ...field, width: 'auto' }}>
                  <option value="men">men</option><option value="women">women</option>
                </select>
                {sel.status && <span style={{ ...mono, fontSize: 11.5, fontWeight: 700, color: sel.status === 'approved' ? '#4ade80' : 'var(--text-muted)' }}>{sel.status}</span>}
              </div>

              {/* ---- structured workout editor ---- */}
              <span style={label}>Workout — edit any field, then Re-measure / Re-draft</span>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={sel.workout.block_scheme ?? ''} onChange={(e) => setWorkout({ block_scheme: e.target.value })}
                  placeholder="Scheme header (e.g. AMRAP 15, 21-15-9 for time)" style={{ ...field, flex: 2 }} />
                <input type="number" value={sel.workout.time_cap_seconds ?? ''} placeholder="cap (sec)"
                  onChange={(e) => setWorkout({ time_cap_seconds: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ ...field, width: 110 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.8fr 0.6fr 0.8fr 0.8fr 34px', gap: 6, fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, padding: '0 2px' }}>
                <span>Movement</span><span>Reps / round</span><span>Load</span><span>Unit</span><span>Cal</span><span>Dist (m)</span><span />
              </div>
              {sel.workout.movements.map((m, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.8fr 0.6fr 0.8fr 0.8fr 34px', gap: 6, margin: '4px 0' }}>
                  <input value={m.movement} onChange={(e) => setMovement(i, { movement: e.target.value })} style={field} />
                  <input defaultValue={(m.rep_scheme ?? m.cal_scheme ?? m.distance_scheme ?? []).join(',')}
                    key={`rs-${i}-${sel.id ?? 'new'}`}
                    onBlur={(e) => setMovement(i, { rep_scheme: parseNums(e.target.value) })}
                    placeholder="21,15,9" style={{ ...field, ...mono }} />
                  <input type="number" value={m.weight ?? ''} onChange={(e) => setMovement(i, { weight: e.target.value ? Number(e.target.value) : undefined })} style={field} />
                  <select value={m.weight_unit ?? 'lbs'} onChange={(e) => setMovement(i, { weight_unit: e.target.value as 'lbs' | 'kg' })} style={field}>
                    <option value="lbs">lbs</option><option value="kg">kg</option>
                  </select>
                  <input type="number" value={m.calories ?? ''} onChange={(e) => setMovement(i, { calories: e.target.value ? Number(e.target.value) : undefined })} style={field} />
                  <input type="number" value={m.distance ?? ''} onChange={(e) => setMovement(i, { distance: e.target.value ? Number(e.target.value) : undefined, distance_unit: 'm' })} style={field} />
                  <button onClick={() => setWorkout({ movements: sel.workout.movements.filter((_, j) => j !== i) })}
                    style={{ ...btn, padding: '0 8px' }} title="Remove movement">✕</button>
                </div>
              ))}
              <button onClick={() => setWorkout({ movements: [...sel.workout.movements, { movement: '' }] })} style={{ ...btn, marginTop: 6, fontSize: 12 }}>
                + movement
              </button>

              <div style={{ display: 'flex', gap: 8, margin: '16px 0 4px', flexWrap: 'wrap' }}>
                <button disabled={busy === 'draft'} onClick={doDraft} style={{ ...btn, borderColor: 'var(--accent)' }}>
                  {busy === 'draft' ? 'Drafting…' : sum(sel.demand) > 0 ? 'Re-draft signature (AI)' : 'Draft signature (AI)'}
                </button>
                <button disabled={busy === 'measure'} onClick={doMeasure} style={btn}>
                  {busy === 'measure' ? 'Measuring…' : 'Re-measure (instant)'}
                </button>
                <button onClick={() => setBaseline(snapshot(sel))} style={{ ...btn, fontSize: 12 }} title="Deltas compare against the baseline">
                  Set as baseline
                </button>
              </div>

              {/* ---- measured layer ---- */}
              {sel.measured && (
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12.5, ...mono }}>
                  <span>time domain <strong>{sel.measured.time_domain ?? '—'}</strong></span>
                  <span>median <strong>{sel.measured.median_score ?? '—'}</strong>
                    <Delta now={sel.measured.median_seconds ?? null} was={baseline?.measured?.median_seconds ?? null} suffix="s" />
                  </span>
                  <span>excellent <strong>{sel.measured.excellent_score ?? '—'}</strong></span>
                  <span>median watts <strong>{sel.measured.median_watts ?? '—'}</strong>
                    <Delta now={sel.measured.median_watts ?? null} was={baseline?.measured?.median_watts ?? null} />
                  </span>
                  {baseline?.measured?.median_seconds != null && sel.measured.median_seconds != null && baseline.measured.median_seconds !== sel.measured.median_seconds && (
                    <span style={{ color: 'var(--text-muted)' }}>was {fmtSecs(baseline.measured.median_seconds)} → now {fmtSecs(sel.measured.median_seconds)}</span>
                  )}
                </div>
              )}

              {/* ---- three weight vectors ---- */}
              <span style={label}>Signature — 5% steps, each column sums to 100</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(3, 1fr)', gap: 4, alignItems: 'center' }}>
                <span />
                {vectors.map((v) => (
                  <span key={v} style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', textAlign: 'center' }}>{v}</span>
                ))}
                {FOCUS_AREAS.map((axis) => (
                  <div key={axis} style={{ display: 'contents' }}>
                    <span style={{ fontSize: 12.5 }}>{FOCUS_LABELS[axis]}</span>
                    {vectors.map((v) => {
                      const val = ((sel[v] ?? {}) as Weights)[axis] ?? 0;
                      const was = baseline ? (baseline[v][axis] ?? 0) : null;
                      return (
                        <div key={v} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <button onClick={() => stepWeight(v, axis, -5)} style={{ ...btn, padding: '0 7px', fontSize: 13 }}>−</button>
                          <span style={{ ...mono, fontSize: 12.5, minWidth: 22, textAlign: 'center', opacity: val ? 1 : 0.25 }}>{val}</span>
                          <button onClick={() => stepWeight(v, axis, +5)} style={{ ...btn, padding: '0 7px', fontSize: 13 }}>+</button>
                          <Delta now={val} was={was} />
                        </div>
                      );
                    })}
                  </div>
                ))}
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)' }}>SUM</span>
                {vectors.map((v) => {
                  const s = sum(sel[v] as Weights);
                  return (
                    <span key={v} style={{ ...mono, fontSize: 12.5, fontWeight: 700, textAlign: 'center', color: s === 100 ? '#4ade80' : s === 0 ? 'var(--text-muted)' : 'var(--accent)' }}>
                      {s}
                    </span>
                  );
                })}
              </div>

              {/* ---- gates ---- */}
              <span style={label}>Gates — binary walls, outside the weights</span>
              {sel.gates.map((g, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, margin: '4px 0' }}>
                  <input value={g.movement} onChange={(e) => setSel({ ...sel, gates: sel.gates.map((x, j) => j === i ? { ...x, movement: e.target.value } : x) })}
                    placeholder="movement" style={{ ...field, flex: 1 }} />
                  <select value={g.kind} onChange={(e) => setSel({ ...sel, gates: sel.gates.map((x, j) => j === i ? { ...x, kind: e.target.value as Gate['kind'] } : x) })} style={{ ...field, width: 'auto' }}>
                    <option value="skill">skill</option><option value="load">load</option><option value="capacity">capacity</option>
                  </select>
                  <input value={g.detail ?? ''} onChange={(e) => setSel({ ...sel, gates: sel.gates.map((x, j) => j === i ? { ...x, detail: e.target.value } : x) })}
                    placeholder="what it blocks" style={{ ...field, flex: 2 }} />
                  <button onClick={() => setSel({ ...sel, gates: sel.gates.filter((_, j) => j !== i) })} style={{ ...btn, padding: '0 8px' }}>✕</button>
                </div>
              ))}
              <button onClick={() => setSel({ ...sel, gates: [...sel.gates, { movement: '', kind: 'skill' }] })} style={{ ...btn, fontSize: 12 }}>+ gate</button>

              {/* ---- meta ---- */}
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <select value={sel.time_domain ?? ''} onChange={(e) => setSel({ ...sel, time_domain: e.target.value || null })} style={{ ...field, width: 'auto' }}>
                  <option value="">time domain…</option><option value="short">short</option><option value="medium">medium</option><option value="long">long</option>
                </select>
                <input value={sel.format ?? ''} onChange={(e) => setSel({ ...sel, format: e.target.value || null })} placeholder="format" style={{ ...field, width: 120 }} />
                <input value={sel.archetype ?? ''} onChange={(e) => setSel({ ...sel, archetype: e.target.value || null })} placeholder="archetype" style={{ ...field, flex: 1, minWidth: 180 }} />
              </div>
              {sel.rationale && (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text)' }}>Model rationale:</strong> {sel.rationale}
                </div>
              )}

              {/* ---- persistence ---- */}
              <div style={{ display: 'flex', gap: 8, margin: '20px 0', flexWrap: 'wrap' }}>
                <button disabled={busy === 'save' || !sel.name.trim() || sum(sel.demand) !== 100} onClick={() => doSave()} style={btn}>
                  {busy === 'save' ? 'Saving…' : 'Save draft'}
                </button>
                <button disabled={busy === 'approve' || !sel.name.trim() || vectors.some((v) => sum(sel[v] as Weights) !== 100)}
                  onClick={() => doSave('approve')} style={{ ...btn, borderColor: '#4ade80', color: '#4ade80' }}>
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
                {sel.id && (
                  <>
                    <button disabled={busy === 'reject'} onClick={() => doSave('reject')} style={btn}>Reject</button>
                    <button disabled={busy === 'delete'} onClick={doDelete} style={{ ...btn, borderColor: 'var(--accent)', color: 'var(--accent)' }}>Delete</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
