import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

// ── Admin: the conditioning continuum for one athlete (Phase 0) ──────────────
// Spec: docs/conditioning_continuum_spec.md v2. Everything drawn here comes
// from admin_engine_continuum(target_user_id): per-session continuum values
// written by engine-continuum-backfill, the athlete's curve, trials, and the
// reference curves. Nothing on this page is computed differently from the
// module — the page only draws.

interface SessionRow {
  id: string;
  date: string;
  day_type: string | null;
  modality: string | null;
  units: string | null;
  actual_pace: number | null;
  target_pace: number | null;
  r: number | null;
  effort_s: number | null;
  bout_s: number | null;
  sustain: number | null;
  evidence: string | null;
  intervals: number | null;
  total_work_time: number | null;
  total_rest_time: number | null;
}
interface TrialRow { modality: string; units: string | null; pace: number; date: string; is_current: boolean }
interface CurveNode { seconds: number; m: number; conf: number; state: 'measured' | 'floor' | 'blank' }
interface EngineCurve { version: number; nodes: CurveNode[]; flags: string[]; as_of: string | null; computed_at?: string; module_version?: number }
interface Payload {
  sessions: SessionRow[];
  trials: TrialRow[];
  curve: EngineCurve | null;
  curves: Record<string, Array<{ r: number; seconds: number }>>;
}
// Phase 2 (engine-day-targets): both formulas for the athlete's next day — the rollout view.
interface SegTarget { target_pace: number | null; basis: string; fraction: number | null; share?: number; m?: number; band?: string; p_balanced?: number; capped?: boolean; floored?: boolean }
interface DayTargetsPayload {
  error?: string;
  workout?: { id: string; day_type: string; program_type: string; day_number: number; position: number | null };
  modality?: string; units?: string | null; mode?: 'curve' | 'legacy'; flag?: boolean;
  trial?: { id: string; pace: number; date: string } | null;
  machine_curve?: boolean; k_effort?: number | null; athlete_curve?: boolean; delivered_floor?: number | null; recent_sessions?: number;
  blocks?: Array<{ block_index: number; rounds: number; segments: Array<{ label: string; round_index: number; duration_seconds: number; curve: SegTarget; legacy: SegTarget }> }>;
  curve_fraction?: number | null; legacy_fraction?: number | null;
}

// Effort-duration bands (seconds), long on the left as on the chart.
const REGIONS: Array<[number, number | null, string]> = [
  [1200, 2400, '20–40 min'], [600, 1200, '10–20 min'], [240, 600, '4–10 min'], [120, 240, '2–4 min'],
  [60, 120, '1–2 min'], [30, 60, '30–60 s'], [0, 30, '≤30 s'],
];
const ZONE2_SECONDS = 2400;

// Chart geometry
const W = 1040, H = 410, L = 90, R = 960, T = 40, B = 330;
const SMAX = 3600, SMIN = 10, YMAX = 1.35;
// x = effort duration on a log scale, LONG on the left (slow twitch) and SHORT on the right (fast twitch)
const px = (sec: number) => L + (Math.log(SMAX) - Math.log(Math.min(Math.max(sec, SMIN), SMAX))) / (Math.log(SMAX) - Math.log(SMIN)) * (R - L);
const py = (v: number) => T + (1 - Math.min(v, YMAX) / YMAX) * (B - T);
const XTICKS: Array<[number, string]> = [[3600, '60 min'], [2400, '40'], [1200, '20'], [600, '10 min'], [240, '4'], [120, '2'], [60, '1 min'], [30, '30 s'], [10, '10 s']];
const YTICKS = [0.25, 0.5, 0.75, 1.0, 1.25];

export default function AdminContinuumPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [machine, setMachine] = useState<string>('');
  const [recomputing, setRecomputing] = useState(false);
  const [note, setNote] = useState('');
  const [tip, setTip] = useState<{ x: number; y: number; html: string } | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const [targets, setTargets] = useState<DayTargetsPayload | null>(null);
  const [targetsLoading, setTargetsLoading] = useState(false);

  // Fetch on mount and whenever a recompute bumps reloadKey. No synchronous
  // setState in the effect body: loading starts true and is only set after
  // the await (and in the recompute handler, an event).
  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const { data: result, error: err } = await supabase.rpc('admin_engine_continuum', { target_user_id: id });
      if (!active) return;
      if (err) setError(err.message);
      else setData(result as Payload);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id, reloadKey]);
  const load = useCallback(() => { setLoading(true); setError(''); setReloadKey((k) => k + 1); }, []);

  // Next day's targets, both formulas, on the selected machine (Phase 2 rollout view).
  const loadTargets = useCallback(async (machineKey: string) => {
    if (!id) return;
    setTargetsLoading(true);
    const [modality, units] = machineKey.split('|');
    const { data: res, error: err } = await supabase.functions.invoke('engine-day-targets', { body: { target_user_id: id, modality, units: units || null } });
    setTargets(err ? { error: err.message } : (res as DayTargetsPayload));
    setTargetsLoading(false);
  }, [id]);

  const machines = useMemo(() => {
    const set = new Set<string>();
    for (const s of data?.sessions ?? []) if (s.modality) set.add(`${s.modality}|${s.units ?? ''}`);
    return [...set].sort();
  }, [data]);
  // The selected machine, defaulting to the first one with sessions (derived, not an effect).
  const activeMachine = machine && machines.includes(machine) ? machine : (machines[0] ?? '');

  const sessions = useMemo(() => (data?.sessions ?? []).filter((s) => `${s.modality}|${s.units ?? ''}` === activeMachine), [data, activeMachine]);
  const trials = useMemo(() => (data?.trials ?? []).filter((t) => `${t.modality}|${t.units ?? ''}` === activeMachine), [data, activeMachine]);
  const ceilingR = useMemo(() => {
    const pts = data?.curves?.[activeMachine] ?? [];
    const at30 = pts.find((p) => Number(p.seconds) === 30);
    return at30 ? Number(at30.r) : null;
  }, [data, activeMachine]);

  const regions = useMemo(() => {
    const nodes = data?.curve?.nodes ?? [];
    return REGIONS.map(([lo, hi, label]) => {
      const ns = nodes.filter((n) => n.seconds >= lo && (hi == null || n.seconds < hi));
      const conf = ns.reduce((a, n) => a + n.conf, 0);
      const m = conf > 0 ? ns.reduce((a, n) => a + n.m * n.conf, 0) / conf : null;
      const state = ns.some((n) => n.state === 'measured') ? 'measured' : ns.some((n) => n.state === 'floor') ? 'floor' : 'blank';
      return { label, m, state, n: conf };
    });
  }, [data]);

  const recompute = async () => {
    if (!id) return;
    setRecomputing(true);
    setNote('');
    const { data: res, error: err } = await supabase.functions.invoke('engine-continuum-backfill', { body: { user_id: id } });
    setRecomputing(false);
    if (err || res?.error) setNote(`Recompute failed: ${res?.error || err?.message}`);
    else {
      setNote(`Recomputed ${res?.sessions ?? 0} sessions.`);
      load();
    }
  };

  const ceilings = sessions.filter((s) => s.evidence === 'ceiling' && s.effort_s != null && s.sustain != null).sort((a, b) => (b.effort_s! - a.effort_s!));
  const envelope = ceilings.length > 1 ? 'M' + ceilings.map((s) => `${px(s.effort_s!).toFixed(0)},${py(s.sustain!).toFixed(0)}`).join(' L') : '';
  const uncomputable = sessions.filter((s) => s.evidence === 'no_trial' || s.evidence === 'no_curve' || s.r == null || s.effort_s == null);

  const describe = (s: SessionRow) => {
    const kind = s.evidence === 'ceiling' ? 'reached the curve (ceiling)' : s.evidence === 'floor' ? 'floor only' : s.evidence === 'miss' ? 'miss — below the asked pace' : s.evidence === 'record' ? 'record (assess day)' : s.evidence === 'zone2' ? 'zone 2 — not scored' : s.evidence ?? '';
    return `<b>${s.date}</b> · ${(s.day_type ?? '').replace(/_/g, ' ')}<br>` +
      `<b>${s.r?.toFixed(2)}× trial pace</b> = a ${fmtSeconds(s.effort_s ?? 0)} effort for a balanced athlete · bout ${s.bout_s ?? '?'} s × ${s.intervals ?? '?'} · rest ${s.total_work_time && s.total_rest_time != null ? (s.total_rest_time / s.total_work_time).toFixed(2) : '?'}×<br>` +
      `sustain <b>${s.sustain?.toFixed(2)}</b> · ${kind}` +
      (s.target_pace != null && s.actual_pace != null ? `<br>asked ${s.target_pace.toFixed(1)} · delivered ${s.actual_pace.toFixed(1)} ${s.units ?? ''}/min` : '');
  };

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Continuum">
      {loading && <div className="page-loading"><div className="loading-pulse" /></div>}
      {error && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{error}</div>}
      {!loading && data && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            {machines.length > 1 && (
              <select value={activeMachine} onChange={(e) => setMachine(e.target.value)} className="engine-select" style={{ fontSize: 13 }}>
                {machines.map((m) => <option key={m} value={m}>{m.replace('|', ' · ').replace(/_/g, ' ')}</option>)}
              </select>
            )}
            <button className="auth-btn" disabled={recomputing} onClick={recompute} style={{ width: 'auto', padding: '6px 14px', marginTop: 0, fontSize: 13 }}>
              {recomputing ? 'Recomputing…' : 'Recompute from history'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {data.curve?.computed_at ? `curve computed ${data.curve.computed_at.slice(0, 16).replace('T', ' ')} (module v${data.curve.module_version ?? '?'})` : 'no curve yet — recompute to build it'}
              {note ? ` · ${note}` : ''}
            </span>
          </div>

          {data.curve?.flags?.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {data.curve.flags.map((f) => (
                <span key={f} style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: 'rgba(234,179,8,.12)', border: '1px solid rgba(234,179,8,.35)' }}>{f}</span>
              ))}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-dim)', flexWrap: 'wrap', marginBottom: 6 }}>
            <span><i style={legendDot('var(--accent)')} />reached the curve (ceiling)</span>
            <span><i style={{ display: 'inline-block', width: 2, height: 14, background: 'var(--accent)', opacity: .8, marginRight: 6, verticalAlign: 'middle' }} />sub-max: proved at least this (floor)</span>
            <span><i style={legendDot('transparent', '2px solid var(--accent)')} />miss (below the asked pace)</span>
            <span><i style={legendDot('var(--text-muted)', undefined, .55)} />zone 2 · record</span>
            <span><i style={{ display: 'inline-block', width: 18, height: 3, background: 'var(--accent)', opacity: .75, marginRight: 6, verticalAlign: 'middle' }} />ceiling envelope</span>
          </div>

          <div style={{ position: 'relative' }}>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sessions by effort duration and sustained bout versus balanced" style={{ width: '100%', height: 'auto', display: 'block', color: 'var(--text)' }}>
              <rect x={L} y={T} width={px(ZONE2_SECONDS) - L} height={B - T} fill="var(--surface2)" />
              <text x={(L + px(ZONE2_SECONDS)) / 2} y={T + 28} textAnchor="middle" fontSize={11} fill="var(--text-muted)">zone 2 · 40 min+</text>
              <rect x={px(30)} y={T} width={R - px(30)} height={B - T} fill="var(--surface2)" />
              <text x={(px(30) + R) / 2} y={T + 28} textAnchor="middle" fontSize={11} fill="var(--text-muted)">beyond balanced</text>
              <g stroke="var(--border)" strokeWidth={1}>
                {YTICKS.filter((v) => v !== 1).map((v) => <line key={v} x1={L} x2={R} y1={py(v)} y2={py(v)} />)}
                {XTICKS.map(([sec]) => <line key={sec} x1={px(sec)} x2={px(sec)} y1={T} y2={B} />)}
              </g>
              <line x1={L} x2={R} y1={py(1)} y2={py(1)} stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="6 5" />
              <text x={px(500)} y={py(1) - 6} fontSize={11} fill="var(--text-muted)">on the balanced power-duration curve = 1.0</text>
              <line x1={px(600)} x2={px(600)} y1={T} y2={B} stroke="currentColor" strokeWidth={1.3} strokeDasharray="3 3" />
              <text x={px(600) + 5} y={B - 8} fontSize={11} fill="var(--text-dim)">time trial · 10 min · 1.0×</text>
              <line x1={px(30)} x2={px(30)} y1={T} y2={B} stroke="currentColor" strokeWidth={1.3} strokeDasharray="3 3" />
              <text x={px(30) - 5} y={B - 8} fontSize={11} fill="var(--text-dim)" textAnchor="end">30-s max{ceilingR != null ? ` · ${ceilingR}× on this machine` : ''}</text>
              {YTICKS.map((v) => <text key={v} x={L - 8} y={py(v) + 4} fontSize={11} fill="var(--text-dim)" textAnchor="end">{v.toFixed(2)}</text>)}
              {XTICKS.map(([sec, label]) => <text key={sec} x={px(sec)} y={B + 18} fontSize={11} fill="var(--text-dim)" textAnchor="middle">{label}</text>)}
              <text x={(L + R) / 2} y={B + 44} fontSize={12.5} fill="currentColor" textAnchor="middle">effort duration — the bout a balanced athlete sustains at the pace delivered (log) · left = slow twitch, right = fast twitch</text>
              <text x={30} y={(T + B) / 2} fontSize={12.5} fill="currentColor" textAnchor="middle" transform={`rotate(-90 30 ${(T + B) / 2})`}>sustained bout ÷ balanced max bout at that pace</text>
              {envelope && <path d={envelope} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinejoin="round" opacity={.75} />}
              {sessions.map((s) => {
                if (s.r == null || s.sustain == null || s.effort_s == null) return null;
                const cx = px(s.effort_s), cy = py(s.sustain);
                const common = {
                  onMouseMove: (e: React.MouseEvent) => {
                    const host = (e.currentTarget as SVGElement).closest('div');
                    const rect = host?.getBoundingClientRect();
                    setTip({ x: e.clientX - (rect?.left ?? 0) + 14, y: e.clientY - (rect?.top ?? 0) - 10, html: describe(s) });
                  },
                  onMouseLeave: () => setTip(null),
                };
                if (s.evidence === 'floor') {
                  return (
                    <g key={s.id} {...common} style={{ cursor: 'pointer' }}>
                      <line x1={cx} x2={cx} y1={cy} y2={cy - 22} stroke="var(--accent)" strokeWidth={1.8} opacity={.8} />
                      <polygon points={`${cx - 4},${cy - 20} ${cx + 4},${cy - 20} ${cx},${cy - 28}`} fill="var(--accent)" opacity={.8} />
                      <line x1={cx - 5} x2={cx + 5} y1={cy} y2={cy} stroke="var(--accent)" strokeWidth={1.8} opacity={.8} />
                      <circle cx={cx} cy={cy - 12} r={14} fill="transparent" />
                    </g>
                  );
                }
                if (s.evidence === 'ceiling') return <circle key={s.id} {...common} cx={cx} cy={cy} r={5.5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} style={{ cursor: 'pointer' }} />;
                if (s.evidence === 'miss') return <circle key={s.id} {...common} cx={cx} cy={cy} r={5} fill="var(--bg)" stroke="var(--accent)" strokeWidth={2} style={{ cursor: 'pointer' }} />;
                return <circle key={s.id} {...common} cx={cx} cy={cy} r={5} fill="var(--text-muted)" stroke="var(--bg)" strokeWidth={2} opacity={.55} style={{ cursor: 'pointer' }} />;
              })}
            </svg>
            {tip && (
              <div style={{ position: 'absolute', left: tip.x, top: tip.y, pointerEvents: 'none', background: 'var(--text)', color: 'var(--bg)', fontSize: 12, padding: '8px 10px', borderRadius: 6, lineHeight: 1.4, maxWidth: 340 }} dangerouslySetInnerHTML={{ __html: tip.html }} />
            )}
          </div>

          <h3 style={sectionH3}>Next day — targets (Phase 2 rollout view)</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <button className="auth-btn" disabled={targetsLoading || !activeMachine} onClick={() => loadTargets(activeMachine)} style={{ width: 'auto', padding: '6px 14px', marginTop: 0, fontSize: 13 }}>
              {targetsLoading ? 'Computing…' : `Compute next day on ${activeMachine.replace('|', ' · ').replace(/_/g, ' ')}`}
            </button>
            {targets?.workout && (
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {targets.workout.day_type.replace(/_/g, ' ')} · position {targets.workout.position ?? '?'} · {targets.workout.program_type.startsWith('gen:') ? 'sequenced' : 'curated'} ·
                athlete is on <b>{targets.mode}</b> targets · trial {targets.trial ? `${targets.trial.pace} (${targets.trial.date})` : 'none'} ·
                machine curve {targets.machine_curve ? `yes (k ${targets.k_effort})` : 'no'} · athlete curve {targets.athlete_curve ? 'yes' : 'no'} · delivered floor {targets.delivered_floor != null ? `${targets.delivered_floor.toFixed(1)} (${targets.recent_sessions} recent)` : 'none'}
              </span>
            )}
            {targets?.error && <span style={{ fontSize: 12, color: 'var(--danger, #e5484d)' }}>{targets.error}</span>}
          </div>
          {targets?.blocks && (
            <div style={{ overflowX: 'auto' }}>
              <table className="admin-table" style={{ fontSize: 12 }}>
                <thead><tr><th>block</th><th>round</th><th>segment</th><th>work</th><th>legacy target</th><th>curve target</th><th>Δ</th><th>basis</th><th>share</th><th>balanced</th><th>M</th><th>band</th></tr></thead>
                <tbody>
                  {targets.blocks.flatMap((b) => b.segments.map((sg) => {
                    const l = sg.legacy.target_pace, c = sg.curve.target_pace;
                    const delta = l != null && c != null && l > 0 ? ((c / l - 1) * 100) : null;
                    return (
                      <tr key={`${b.block_index}-${sg.round_index}-${sg.label}`}>
                        <td>{b.block_index + 1}</td><td>{sg.round_index + 1}/{b.rounds}</td><td>{sg.label}</td><td>{fmtSeconds(sg.duration_seconds)}</td>
                        <td>{l == null ? '—' : `${l.toFixed(1)} (${sg.legacy.fraction?.toFixed(2)}×)`}</td>
                        <td style={{ fontWeight: 600 }}>{c == null ? '—' : `${c.toFixed(1)} (${sg.curve.fraction?.toFixed(2)}×)`}{sg.curve.capped ? ' ·cap' : ''}{sg.curve.floored ? ' ·floor' : ''}</td>
                        <td style={{ color: delta == null ? undefined : delta > 0 ? 'var(--accent)' : 'var(--text-dim)' }}>{delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}</td>
                        <td>{sg.curve.basis}</td>
                        <td>{sg.curve.share != null ? sg.curve.share.toFixed(2) : '—'}</td>
                        <td>{sg.curve.p_balanced != null ? `${sg.curve.p_balanced.toFixed(2)}×` : '—'}</td>
                        <td>{sg.curve.m != null ? sg.curve.m.toFixed(2) : '—'}</td>
                        <td>{sg.curve.band ?? '—'}</td>
                      </tr>
                    );
                  }))}
                </tbody>
              </table>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
                Work-weighted ask: legacy {targets.legacy_fraction?.toFixed(2) ?? '—'}× trial · curve {targets.curve_fraction?.toFixed(2) ?? '—'}× trial.
                Legacy = trial × centre of the pace range × rolling ratio. Curve = trial × balanced pace for the bout × share^k × the athlete's M in that band, capped ±5 %/week, never below 97 % of the recent delivered pace on this type.
              </div>
            </div>
          )}

          <h3 style={sectionH3}>What the sequencer would receive</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table" style={{ fontSize: 12 }}>
              <thead><tr><th>region</th>{regions.map((r) => <th key={r.label}>{r.label}</th>)}</tr></thead>
              <tbody>
                <tr><td>M</td>{regions.map((r) => <td key={r.label}>{r.m == null ? '—' : r.m.toFixed(2)}</td>)}</tr>
                <tr><td>state</td>{regions.map((r) => <td key={r.label}>{r.state}</td>)}</tr>
                <tr><td>n</td>{regions.map((r) => <td key={r.label}>{r.n.toFixed(1)}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
            Trials {activeMachine.replace('|', ' · ').replace(/_/g, ' ')}: {trials.length ? trials.map((t) => `${t.pace} (${t.date})`).join(' → ') : 'none — sessions on this machine are not computable'}
          </div>
          {uncomputable.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
              {uncomputable.length} session{uncomputable.length === 1 ? '' : 's'} not computable ({[...new Set(uncomputable.map((s) => s.evidence ?? 'not yet computed'))].join(', ')}).
            </div>
          )}

          <h3 style={sectionH3}>Sessions</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table" style={{ fontSize: 12 }}>
              <thead><tr><th>date</th><th>type</th><th>× trial</th><th>effort</th><th>bout s</th><th>rest:work</th><th>asked</th><th>delivered</th><th>sustain</th><th>evidence</th></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.date}</td><td>{(s.day_type ?? '').replace(/_/g, ' ')}</td>
                    <td>{s.r?.toFixed(2) ?? '—'}</td><td>{s.effort_s != null ? fmtSeconds(s.effort_s) : '—'}</td><td>{s.bout_s ?? '—'}</td>
                    <td>{s.total_work_time && s.total_rest_time != null ? (s.total_rest_time / s.total_work_time).toFixed(2) : '—'}</td>
                    <td>{s.target_pace?.toFixed(1) ?? '—'}</td><td>{s.actual_pace?.toFixed(1) ?? '—'}</td>
                    <td>{s.sustain?.toFixed(2) ?? '—'}</td><td>{s.evidence ?? 'not computed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminSubPageLayout>
  );
}

function fmtSeconds(sec: number): string {
  if (sec >= 120) return `${Math.round(sec / 60)} min`;
  return `${Math.round(sec)} s`;
}
const sectionH3: React.CSSProperties = { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', marginTop: 28, marginBottom: 10 };
function legendDot(bg: string, border?: string, opacity?: number): React.CSSProperties {
  return { display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: bg, border, opacity, marginRight: 6, verticalAlign: 'middle', boxSizing: 'border-box' };
}
